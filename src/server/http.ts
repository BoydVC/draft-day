import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCandidateCount,
  isPickId,
  loadConfig,
  loadTargets,
  parseTargetRepo,
  filmRoom,
  reduce,
  screenIdea,
  stageLabel,
  timeline,
  type Config,
  type Pick,
} from "../core/index.ts";
import type { DraftEvent } from "../core/events.ts";
import { appendInbox, inboxCursor, readInbox } from "../store/inbox.ts";
import { loadPicks, readEvents, signature } from "../store/eventlog.ts";
import { forwardIntake } from "./relay.ts";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "../ui");

export interface ServerOptions {
  host: string;
  port: number;
  dataDir: string;
  configPath: string;
  targetsPath: string;
}

interface SseClient {
  res: ServerResponse;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  const payload = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pickView(pick: Pick, events: DraftEvent[], now: number) {
  return {
    id: pick.id,
    idea: pick.idea,
    status: pick.status,
    stage: stageLabel(pick.status),
    target: pick.target,
    source: pick.source,
    n: pick.n,
    approval: pick.approval,
    runs: pick.runs,
    failReason: pick.failReason ?? null,
    failDetail: pick.failDetail ?? null,
    updatedAt: pick.updatedAt,
    report: pick.report ?? null,
    candidates: pick.candidates,
    judgement: pick.judgement ?? null,
    filmRoom: filmRoom(pick),
    labels: pick.labels,
    graft: pick.graft ?? null,
    physical: pick.physical ?? null,
    verdicts: pick.verdicts,
    walkover: pick.walkover,
    fixLoops: pick.fixLoops,
    lessons: pick.lessons,
    timeline: timeline(events, now),
  };
}

function contentType(file: string): string {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "text/html; charset=utf-8";
}

export async function startServer(options: ServerOptions): Promise<{
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
}> {
  await mkdir(options.dataDir, { recursive: true });
  const clients = new Set<SseClient>();
  let version = 0;
  let lastSig = await signature(options.dataDir);

  const broadcast = () => {
    version += 1;
    const payload = `event: update\ndata: ${JSON.stringify({ version })}\n\n`;
    for (const client of clients) client.res.write(payload);
  };

  const timer = setInterval(() => {
    void signature(options.dataDir).then((sig) => {
      if (sig !== lastSig) {
        lastSig = sig;
        broadcast();
      }
    }).catch(() => undefined);
  }, 250);
  timer.unref();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : "error";
      send(res, 500, { error: message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write("retry: 1000\n\n");
      const client = { res };
      clients.add(client);
      req.on("close", () => clients.delete(client));
      return;
    }

    if (req.method === "GET" && path === "/api/board") {
      const now = Date.now();
      const [picks, inbox, cursor, config] = await Promise.all([
        loadPicks(options.dataDir, now),
        readInbox(options.dataDir),
        inboxCursor(options.dataDir),
        loadConfig(options.configPath).catch(() => null),
      ]);
      void config;
      send(res, 200, {
        picks: picks.map((pick) => ({
          id: pick.id,
          idea: pick.idea,
          status: pick.status,
          stage: stageLabel(pick.status),
          target: pick.target,
          runs: pick.runs,
          failReason: pick.failReason ?? null,
          updatedAt: pick.updatedAt,
          walkover: pick.walkover,
        })),
        inbox: inbox.filter((entry) => entry.offset > cursor).map((entry) => ({
          offset: entry.offset,
          idea: entry.idea,
          target: entry.target,
          n: entry.n,
          source: entry.source,
          status: "intake",
          stage: "Inbox",
        })),
      });
      return;
    }

    if (req.method === "GET" && path.startsWith("/api/picks/")) {
      const id = decodeURIComponent(path.slice("/api/picks/".length));
      if (!isPickId(id)) {
        send(res, 404, { error: "pick not found" });
        return;
      }
      const now = Date.now();
      const events = await readEvents(options.dataDir, id);
      const pick = reduce(events, now);
      if (!pick) {
        send(res, 404, { error: "pick not found" });
        return;
      }
      send(res, 200, pickView(pick, events, now));
      return;
    }

    if (req.method === "POST" && path === "/api/intake") {
      let config: Config;
      let targets: string[];
      try {
        config = await loadConfig(options.configPath);
        targets = await loadTargets(options.targetsPath);
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : "config" });
        return;
      }
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(await readBody(req) || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("body must be an object");
        body = parsed as Record<string, unknown>;
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : "bad json" });
        return;
      }
      const idea = typeof body.idea === "string" ? body.idea.trim() : "";
      const target = typeof body.target === "string" ? body.target.trim() : "";
      const source = typeof body.source === "string" && body.source.trim() ? body.source.trim() : "warroom";
      const n = body.n === undefined ? config.defaultN : Number(body.n);
      if (!idea) {
        send(res, 400, { error: "idea is required" });
        return;
      }
      const parsedTarget = parseTargetRepo(target, targets);
      if (!parsedTarget.ok) {
        send(res, 400, { error: parsedTarget.error });
        return;
      }
      const nError = assertCandidateCount(n, config);
      if (nError) {
        send(res, 400, { error: nError });
        return;
      }
      const policy = screenIdea(idea);
      const stored = await appendInbox(options.dataDir, {
        ts: new Date().toISOString(),
        idea,
        source,
        target: parsedTarget.repo,
        n,
      });
      try {
        await forwardIntake({ pick: null, inbox: stored, policy: policy.ok ? null : policy.detail });
      } catch {
        console.error("relay forward failed");
      }
      send(res, 200, {
        ok: true,
        inboxOffset: stored.offset,
        policy: policy.ok ? null : policy.detail,
      });
      return;
    }

    const files = ["/", "/index.html", "/app.js", "/styles.css", "/timeline.js", "/timeline.css"];
    if (req.method === "GET" && files.includes(path)) {
      const file = path === "/" || path === "/index.html" ? "index.html" : path.slice(1);
      const full = normalize(join(UI_DIR, file));
      if (!full.startsWith(UI_DIR)) {
        send(res, 404, { error: "not found" });
        return;
      }
      res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      createReadStream(full).pipe(res);
      return;
    }

    send(res, 404, { error: "not found" });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  const host = options.host;
  return {
    url: `http://${host}:${port}`,
    port,
    host,
    close: () => new Promise((resolve, reject) => {
      clearInterval(timer);
      for (const client of clients) client.res.end();
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
