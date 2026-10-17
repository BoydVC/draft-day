import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  assertCandidateCount,
  branchFor,
  eventKey,
  isCandId,
  isEventType,
  isPickId,
  labelMapForPass,
  loadConfig,
  timeline,
  loadTargets,
  nextAction,
  parseCandidateReport,
  parseJudgement,
  parseScoutingReport,
  parseTargetRepo,
  parseVerdict,
  reduce,
  type Config,
  type DraftEvent,
  type EventType,
  type Pick,
} from "../core/index.ts";
import { allocatePickId, commitPick, loadPicks, readEvents } from "../store/eventlog.ts";
import { inboxCursor, readInbox } from "../store/inbox.ts";
import { startServer } from "../server/http.ts";
import { drive, HAPPY, POLICY, WALK, type DriverIo } from "../../test/fixtures/fake-driver.ts";

class Exit extends Error {
  code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.code = code;
  }
}

interface Flags {
  [key: string]: string | boolean;
}

interface Paths {
  dataDir: string;
  configPath: string;
  targetsPath: string;
  json: boolean;
  cwd: string;
}

function parseArgs(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positional, flags };
}

function flag(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function pathsFrom(flags: Flags, cwd = process.cwd()): Paths {
  return {
    dataDir: resolve(flag(flags, "data") || process.env.DD_DATA_DIR || join(cwd, "data")),
    configPath: resolve(flag(flags, "config") || join(cwd, "draftday.config.json")),
    targetsPath: resolve(flag(flags, "targets") || join(cwd, "targets.json")),
    json: flags.json === true,
    cwd,
  };
}

function emit(paths: Paths, data: unknown, text?: string): void {
  if (paths.json || text === undefined) console.log(JSON.stringify(data));
  else console.log(text);
}

async function loadContext(paths: Paths): Promise<{ config: Config; targets: string[] }> {
  try {
    const config = await loadConfig(paths.configPath);
    const targets = await loadTargets(paths.targetsPath);
    return { config, targets };
  } catch (error) {
    throw new Exit(error instanceof Error ? error.message : "config");
  }
}

async function loadOne(paths: Paths, pickId: string, now = Date.now()): Promise<{ pick: Pick; events: DraftEvent[] }> {
  if (!isPickId(pickId)) throw new Exit(`bad pick id ${pickId}`);
  const events = await readEvents(paths.dataDir, pickId);
  const pick = reduce(events, now);
  if (!pick) throw new Exit(`unknown pick ${pickId}`);
  return { pick, events };
}

function countOf(events: readonly DraftEvent[], type: EventType, cand?: string): number {
  return events.filter((event) => event.type === type && (cand === undefined || event.payload.cand === cand)).length;
}

async function fileText(flags: Flags): Promise<string | undefined> {
  const path = flag(flags, "file") || flag(flags, "report");
  if (!path) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Exit(`cannot read ${path}`);
  }
}

function normalize(
  type: EventType,
  raw: Record<string, unknown>,
  events: readonly DraftEvent[],
  pick: Pick,
): { payload: Record<string, unknown> } | { error: string } {
  if (type === "scouting_report_written") {
    const text = typeof raw.fileText === "string" ? raw.fileText : JSON.stringify(raw.report ?? raw);
    const parsed = parseScoutingReport(text);
    if (!parsed.ok) return parsed;
    return { payload: { report: parsed.value } };
  }
  if (type === "scouting_approved") return { payload: { via: String(raw.via ?? "human") } };
  if (type === "candidate_launched" || type === "candidate_failed" || type === "candidate_finished" || type === "candidate_dropped") {
    const cand = String(raw.cand ?? "");
    if (!isCandId(cand)) return { error: `unknown candidate ${cand}` };
    if (type === "candidate_dropped") return { payload: { cand, reason: String(raw.reason ?? "dropped") } };
    if (type === "candidate_failed") {
      return { payload: { cand, attempt: countOf(events, "candidate_failed", cand) + 1 } };
    }
    if (type === "candidate_launched") {
      const attempt = countOf(events, "candidate_launched", cand) + 1;
      return {
        payload: {
          cand,
          attempt,
          agentId: String(raw.agentId ?? `agent-${cand}-${attempt}`),
          branch: String(raw.branch ?? branchFor(pick.id, cand)),
          ...(raw.model ? { model: String(raw.model) } : {}),
        },
      };
    }
    const text = typeof raw.fileText === "string" ? raw.fileText : JSON.stringify(raw.report ?? raw);
    const parsed = parseCandidateReport(text);
    if (!parsed.ok) return parsed;
    return { payload: { cand, attempt: countOf(events, "candidate_launched", cand) || 1, report: parsed.value } };
  }
  if (type === "judge_launched") {
    const pass = pick.judgeLaunches + 1;
    const finished = pick.candidates.filter((cand) => cand.status === "finished").map((cand) => cand.id);
    const map = labelMapForPass(pick.id, finished, pass);
    const labels: Record<string, string> = {};
    for (const [label, cand] of Object.entries(map.labels)) {
      if (cand) labels[label] = cand;
    }
    return {
      payload: {
        pass,
        order: map.order,
        labels,
        reversed: pass >= 2,
        ...(raw.agentId ? { agentId: String(raw.agentId) } : {}),
      },
    };
  }
  if (type === "judgement_recorded") {
    const text = typeof raw.fileText === "string" ? raw.fileText : JSON.stringify(raw.judgement ?? raw);
    const parsed = parseJudgement(text);
    if (!parsed.ok) return parsed;
    return {
      payload: {
        pass: pick.judgeLaunches,
        order: parsed.value.order,
        cards: parsed.value.cards,
        base: parsed.value.base,
        runnerUps: parsed.value.runnerUps,
        trades: parsed.value.trades,
        swapConsistent: parsed.value.swapConsistent,
        secondRead: raw.secondRead === "disagree" ? "disagree" : parsed.value.secondRead ?? "agree",
        note: typeof raw.note === "string" ? raw.note : parsed.value.note ?? "",
        ...(parsed.value.judgeModel ? { judgeModel: parsed.value.judgeModel } : {}),
      },
    };
  }
  if (type === "graft_launched") return { payload: { ...(raw.agentId ? { agentId: String(raw.agentId) } : {}) } };
  if (type === "graft_recorded") {
    const prNumber = Number(raw.prNumber);
    const headSha = String(raw.headSha ?? "");
    if (!Number.isInteger(prNumber) || prNumber < 1) return { error: "prNumber is required" };
    if (!/^[0-9a-f]{40}$/i.test(headSha)) return { error: "headSha must be 40 hex chars" };
    return { payload: { prNumber, headSha: headSha.toLowerCase(), summary: String(raw.summary ?? "") } };
  }
  if (type === "physical_launched") {
    const finished = pick.candidates.filter((cand) => cand.status === "finished").length;
    const walkover = raw.walkover === true || (pick.judgeLaunches === 0 && finished === 1);
    return { payload: { attempt: 1, walkover, ...(raw.agentId ? { agentId: String(raw.agentId) } : {}) } };
  }
  if (type === "verdict_recorded") {
    const text = typeof raw.fileText === "string" ? raw.fileText : JSON.stringify(raw.physical ?? raw);
    const parsed = parseVerdict(text);
    if (!parsed.ok) return parsed;
    const attempt = pick.verdicts.length + 1;
    return { payload: { attempt, headSha: parsed.value.headSha, physical: parsed.value } };
  }
  if (type === "fix_requested") return { payload: { loop: pick.fixLoops + 1, agentId: pick.graftAgentId ?? "" } };
  if (type === "draft_pr_confirmed") {
    const prNumber = Number(raw.prNumber ?? pick.physical?.prNumber ?? pick.graft?.prNumber);
    if (!Number.isInteger(prNumber)) return { error: "prNumber is required" };
    return { payload: { prNumber } };
  }
  if (type === "pick_failed") return { payload: { reason: String(raw.reason ?? "failed"), detail: String(raw.detail ?? "") } };
  if (type === "pick_cancelled") return { payload: { detail: String(raw.detail ?? "no") } };
  if (type === "lesson_recorded") {
    const text = typeof raw.fileText === "string" ? raw.fileText.trim() : String(raw.text ?? "");
    if (!text) return { error: "lesson text is required" };
    return { payload: { topic: String(raw.topic ?? "general"), text } };
  }
  if (type === "pick_created") return { error: "use dd intake to create a pick" };
  return { error: `cannot record ${type}` };
}

async function recordObject(
  paths: Paths,
  pickId: string,
  type: EventType,
  raw: Record<string, unknown>,
  by = "dd",
): Promise<{ noop: boolean; pick: Pick }> {
  const now = Date.now();
  const ts = new Date(now).toISOString();
  let noop = false;
  const result = await commitPick(paths.dataDir, pickId, (events) => {
    const pick = reduce(events, now);
    if (!pick) throw new Exit(`unknown pick ${pickId}`);
    const normalized = normalize(type, raw, events, pick);
    if ("error" in normalized) throw new Exit(normalized.error);
    const key = eventKey(type, normalized.payload);
    if (events.some((event) => event.type === type && event.key === key)) {
      noop = true;
      return [];
    }
    return [{ ts, type, by, key, payload: normalized.payload }];
  }, now);
  const pick = reduce(result.events, now);
  if (!pick) throw new Exit(`unknown pick ${pickId}`);
  return { noop: noop || result.noop, pick };
}

async function createPick(
  paths: Paths,
  input: { idea: string; source: string; target: string; n?: number; approval?: "ask" | "auto"; inboxOffset?: number },
): Promise<Pick> {
  const { config, targets } = await loadContext(paths);
  const parsed = parseTargetRepo(input.target, targets);
  if (!parsed.ok) throw new Exit(parsed.error);
  const n = input.n ?? config.defaultN;
  const nError = assertCandidateCount(n, config);
  if (nError) throw new Exit(nError);
  const approval = input.approval ?? config.approval;
  if (!input.idea.trim()) throw new Exit("idea is required");
  const now = new Date();
  const pickId = await allocatePickId(paths.dataDir, now);
  const ts = now.toISOString();
  const payload = {
    id: pickId,
    idea: input.idea.trim(),
    source: input.source,
    target: parsed.repo,
    n,
    approval,
    ...(input.inboxOffset ? { inboxOffset: input.inboxOffset } : {}),
  };
  const committed = await commitPick(paths.dataDir, pickId, () => [
    { ts, type: "pick_created", by: "dd", key: eventKey("pick_created", payload), payload },
  ], now.getTime());
  const pick = reduce(committed.events, now.getTime());
  if (!pick) throw new Exit("pick was not created");
  return pick;
}

async function intake(paths: Paths, flags: Flags): Promise<number> {
  if (flags["from-inbox"] === true) {
    const cursor = await inboxCursor(paths.dataDir);
    const lines = await readInbox(paths.dataDir);
    const fresh = lines.filter((line) => line.offset > cursor);
    const created = [];
    for (const line of fresh) {
      const pick = await createPick(paths, {
        idea: line.idea,
        source: line.source,
        target: line.target,
        n: line.n,
        inboxOffset: line.offset,
      });
      created.push({ pickId: pick.id, status: pick.status, inboxOffset: line.offset });
    }
    emit(paths, { picks: created }, created.map((pick) => `${pick.pickId} ${pick.status}`).join("\n") || "inbox empty");
    return 0;
  }
  const idea = flag(flags, "idea");
  const target = flag(flags, "target");
  const source = flag(flags, "source") ?? "chat";
  if (!idea || !target) throw new Exit("intake needs --idea and --target");
  const n = flag(flags, "n") ? Number(flag(flags, "n")) : undefined;
  const approvalFlag = flag(flags, "approval");
  const approval = approvalFlag === "auto" || approvalFlag === "ask" ? approvalFlag : undefined;
  const pick = await createPick(paths, { idea, source, target, n, approval });
  emit(paths, { pickId: pick.id, status: pick.status });
  return 0;
}

async function nextCommand(paths: Paths, pickId: string | undefined): Promise<number> {
  if (!pickId) throw new Exit("next needs a pick id");
  const { config } = await loadContext(paths);
  const { pick } = await loadOne(paths, pickId);
  const action = nextAction(pick, { config });
  emit(paths, action);
  return 0;
}

async function recordCommand(paths: Paths, pickId: string | undefined, typeName: string | undefined, flags: Flags): Promise<number> {
  if (!pickId || !typeName) throw new Exit("record needs a pick id and an event type");
  if (!isEventType(typeName)) throw new Exit(`unknown event ${typeName}`);
  const text = await fileText(flags);
  const raw: Record<string, unknown> = {
    ...(text ? { fileText: text } : {}),
    ...(flag(flags, "cand") ? { cand: flag(flags, "cand") } : {}),
    ...(flag(flags, "agent") ? { agentId: flag(flags, "agent") } : {}),
    ...(flag(flags, "reason") ? { reason: flag(flags, "reason") } : {}),
    ...(flag(flags, "detail") ? { detail: flag(flags, "detail") } : {}),
    ...(flag(flags, "topic") ? { topic: flag(flags, "topic") } : {}),
    ...(flag(flags, "text") ? { text: flag(flags, "text") } : {}),
    ...(flag(flags, "pr") ? { prNumber: Number(flag(flags, "pr")) } : {}),
    ...(flag(flags, "sha") ? { headSha: flag(flags, "sha") } : {}),
    ...(flag(flags, "summary") ? { summary: flag(flags, "summary") } : {}),
    ...(flag(flags, "second-read") ? { secondRead: flag(flags, "second-read") } : {}),
    ...(flag(flags, "note") ? { note: flag(flags, "note") } : {}),
    ...(flag(flags, "model") ? { model: flag(flags, "model") } : {}),
  };
  const { noop, pick } = await recordObject(paths, pickId, typeName, raw, flag(flags, "by") ?? "dd");
  emit(paths, { ok: true, noop, pickId: pick.id, status: pick.status });
  return 0;
}

function humanPick(pick: Pick): string {
  return `${pick.id}  ${pick.status}  runs ${pick.runs}  ${pick.idea}`;
}

async function show(paths: Paths, pickId: string | undefined): Promise<number> {
  if (!pickId) throw new Exit("show needs a pick id");
  const { pick, events } = await loadOne(paths, pickId);
  emit(paths, { ...pick, eventCount: events.length }, humanPick(pick));
  return 0;
}

async function board(paths: Paths): Promise<number> {
  const picks = await loadPicks(paths.dataDir);
  const rows = picks.map((pick) => ({
    pickId: pick.id,
    status: pick.status,
    runs: pick.runs,
    idea: pick.idea,
    failReason: pick.failReason ?? null,
  }));
  emit(paths, { picks: rows }, rows.map((row) => `${row.pickId}  ${row.status}  runs ${row.runs}  ${row.idea}`).join("\n") || "no picks");
  return 0;
}

async function brief(paths: Paths, pickId: string | undefined, role: string | undefined, cand: string | undefined): Promise<number> {
  if (!pickId || !role) throw new Exit("brief needs a pick id and a role");
  const { pick } = await loadOne(paths, pickId);
  const { candidateBrief, graftBrief, judgeBrief, physicalBrief } = await import("../core/index.ts");
  let markdown = "";
  if (role === "candidate") {
    if (!cand || !isCandId(cand)) throw new Exit("candidate brief needs c1-c5");
    const found = pick.candidates.find((item) => item.id === cand) ?? {
      id: cand,
      angle: pick.report?.angles[Number(cand.slice(1)) - 1] ?? cand,
      status: "queued" as const,
      relaunches: 0 as const,
      failures: 0,
      branch: branchFor(pick.id, cand),
    };
    markdown = candidateBrief(pick, found, found.relaunches > 0);
  } else if (role === "judge") markdown = judgeBrief(pick, pick.judgeLaunches + 1);
  else if (role === "graft") markdown = graftBrief(pick);
  else if (role === "physical") markdown = physicalBrief(pick, pick.walkover || pick.candidates.filter((item) => item.status === "finished").length === 1);
  else throw new Exit("role must be candidate, judge, graft, or physical");
  emit(paths, { markdown }, markdown);
  return 0;
}

async function lessons(paths: Paths): Promise<number> {
  const picks = await loadPicks(paths.dataDir);
  const groups = new Map<string, { topic: string; count: number; texts: string[] }>();
  for (const pick of picks) {
    for (const lesson of pick.lessons) {
      const group = groups.get(lesson.topic) ?? { topic: lesson.topic, count: 0, texts: [] };
      group.count += 1;
      group.texts.push(lesson.text);
      groups.set(lesson.topic, group);
    }
  }
  const lessonsOut = [...groups.values()];
  emit(paths, { lessons: lessonsOut }, lessonsOut.map((group) => `${group.topic} (${group.count})`).join("\n") || "no lessons");
  return 0;
}

export function resolveServeOptions(flags: Flags, config: Config): { host: string; port: number } {
  const host = flag(flags, "host") ?? config.host;
  const portFlag = flag(flags, "port");
  const port = portFlag === undefined ? config.port : Number(portFlag);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Exit("bad port");
  return { host, port };
}

async function serve(paths: Paths, flags: Flags): Promise<number> {
  const { config } = await loadContext(paths);
  const { host, port } = resolveServeOptions(flags, config);
  const running = await startServer({
    host,
    port,
    dataDir: paths.dataDir,
    configPath: paths.configPath,
    targetsPath: paths.targetsPath,
  });
  console.log(`War Room listening on ${running.url}`);
  await new Promise(() => undefined);
  return 0;
}

function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen(port, host, () => {
      probe.close(() => resolveFree(true));
    });
  });
}

async function doctor(paths: Paths, flags: Flags): Promise<number> {
  const lines: string[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  lines.push(major >= 20 ? `node: pass ${process.versions.node}` : `node: fail ${process.versions.node}`);
  try {
    await mkdir(paths.dataDir, { recursive: true });
    const probe = join(paths.dataDir, ".doctor-write");
    await writeFile(probe, "ok");
    await rm(probe);
    lines.push(`data: pass ${paths.dataDir}`);
  } catch (error) {
    lines.push(`data: fail ${error instanceof Error ? error.message : "unwritable"}`);
  }
  let port = 4420;
  let host = "127.0.0.1";
  try {
    const { config } = await loadContext(paths);
    const resolved = resolveServeOptions(flags, config);
    port = resolved.port;
    host = resolved.host;
    lines.push("config: pass");
  } catch (error) {
    lines.push(`config: fail ${error instanceof Error ? error.message : "bad config"}`);
  }
  try {
    const targets = await loadTargets(paths.targetsPath);
    if (targets.length === 0) throw new Error("no targets");
    for (const target of targets) {
      const parsed = parseTargetRepo(target, targets);
      if (!parsed.ok) throw new Error(`${target}: ${parsed.error}`);
    }
    lines.push(`targets: pass ${targets.length}`);
  } catch (error) {
    lines.push(`targets: fail ${error instanceof Error ? error.message : "bad targets"}`);
  }
  const free = await portFree(host, port);
  lines.push(free ? `port: pass ${port}` : `port: fail ${port} in use`);
  const ok = lines.every((line) => line.includes(": pass"));
  emit(paths, { ok, checks: lines }, lines.join("\n"));
  return ok ? 0 : 1;
}

async function selftest(paths: Paths, flags: Flags): Promise<number> {
  const keep = flags.keep === true;
  const dataDir = flag(flags, "data") ? paths.dataDir : await mkdtemp(join(tmpdir(), "dd-selftest-"));
  const local: Paths = { ...paths, dataDir };
  const io = (): DriverIo => ({
    intake: async (input) => {
      const pick = await createPick(local, { idea: input.idea, source: "selftest", target: "BoydVC/draft-day", n: input.n, approval: input.approval });
      return { pickId: pick.id, status: pick.status };
    },
    next: async (pickId) => {
      const { config } = await loadContext(local);
      const { pick } = await loadOne(local, pickId);
      return nextAction(pick, { config });
    },
    record: async (pickId, type, payload) => {
      if (!isEventType(type)) throw new Exit(`unknown event ${type}`);
      await recordObject(local, pickId, type, payload, "selftest");
    },
    load: async (pickId) => (await loadOne(local, pickId)).pick,
    events: async (pickId) => (await readEvents(local.dataDir, pickId)).map((event) => event.type),
  });
  const results = [];
  try {
    for (const scenario of [HAPPY, POLICY, WALK]) {
      const result = await drive(scenario, io());
      const problems: string[] = [];
      if (result.status !== scenario.expect) problems.push(`status ${result.status} wanted ${scenario.expect}`);
      if (scenario.policy && result.failReason !== "policy") problems.push(`reason ${result.failReason}`);
      if (scenario.policy && result.action !== "policy") problems.push(`next ${result.action}`);
      if (scenario.name === "happy") {
        if (!result.events.includes("candidate_failed")) problems.push("missing the errored candidate");
        if (result.verdicts.join(",") !== "NOT_VERIFIED,VERIFIED") problems.push(`verdicts ${result.verdicts.join(",")}`);
        if (!result.events.includes("draft_pr_confirmed")) problems.push("draft was not confirmed");
      }
      if (scenario.name === "walkover") {
        if (result.events.includes("judge_launched") || result.events.includes("graft_launched")) problems.push("walkover ran the film room or the trade");
      }
      results.push({ ...result, name: scenario.name, problems });
    }
    const ok = results.every((result) => result.problems.length === 0);
    const lines = [`DATA_DIR=${dataDir}`, ...results.map((result) => `${result.name} ${result.pickId} ${result.status}${result.problems.length ? ` FAIL ${result.problems.join("; ")}` : ""}`)];
    emit(local, { ok, dataDir, results }, lines.join("\n"));
    return ok ? 0 : 1;
  } finally {
    if (!keep && !flag(flags, "data")) await rm(dataDir, { recursive: true, force: true });
  }
}

async function timelineCommand(paths: Paths, pickId: string | undefined): Promise<number> {
  if (!pickId) throw new Exit("timeline needs a pick id");
  const now = Date.now();
  const { events } = await loadOne(paths, pickId, now);
  const view = timeline(events, now);
  if (!view) throw new Exit(`unknown pick ${pickId}`);
  const relaunch = view.counts.relaunches === 1 ? "1 relaunch" : `${view.counts.relaunches} relaunches`;
  const text = [
    `${view.pickId}  ${view.status}  ${view.elapsedText}  ${view.counts.total} runs`,
    ...view.entries.map((entry) => `+${entry.sinceStartText}  ${entry.stage}  ${entry.title}`),
    `runs ${view.counts.total}: candidate ${view.counts.candidate} (${relaunch}), judge ${view.counts.judge}, graft ${view.counts.graft}, physical ${view.counts.physical}, fix ${view.counts.fix}`,
  ].join("\n");
  emit(paths, view, text);
  return 0;
}

function help(): string {
  return [
    "dd intake --idea TEXT --source chat --target BoydVC/draft-day [--n 3] [--approval ask]",
    "dd intake --from-inbox",
    "dd next <pickId>",
    "dd record <pickId> <event> [--file path] [--cand c1] [--agent id]",
    "dd show <pickId>",
    "dd timeline <pickId>",
    "dd board",
    "dd brief <pickId> <candidate|judge|graft|physical> [cand]",
    "dd lessons",
    "dd serve [--port 4420] [--host 127.0.0.1]",
    "dd doctor",
    "dd selftest [--keep]",
    "Add --json for a JSON payload. Add --data, --config, and --targets to point at files.",
  ].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const paths = pathsFrom(flags);
  const [command, ...rest] = positional;
  if (!command || command === "help" || flags.help === true) {
    console.log(help());
    return command ? 0 : 2;
  }
  try {
    switch (command) {
      case "intake":
        return await intake(paths, flags);
      case "next":
        return await nextCommand(paths, rest[0]);
      case "record":
        return await recordCommand(paths, rest[0], rest[1], flags);
      case "show":
        return await show(paths, rest[0]);
      case "timeline":
        return await timelineCommand(paths, rest[0]);
      case "board":
        return await board(paths);
      case "brief":
        return await brief(paths, rest[0], rest[1], rest[2]);
      case "lessons":
        return await lessons(paths);
      case "serve":
        return await serve(paths, flags);
      case "doctor":
        return await doctor(paths, flags);
      case "selftest":
        return await selftest(paths, flags);
      default:
        console.log(help());
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    return error instanceof Exit ? error.code : 1;
  }
}

function isDirectRun(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
