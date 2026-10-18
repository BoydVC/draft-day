import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { timeline, type DraftEvent } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  byName,
  compareFrame,
  find,
  findAll,
  frameAt,
  loadReplay,
  REPLAY_STEP_MS,
  readPicks,
  text,
  type PickBody,
  type ReplayRoom,
  type TimelineView,
} from "./fixtures/replay/replay-harness.mjs";

const root = process.cwd();
const picks = readPicks(join(root, "test/fixtures/replay"));
const IDS = ["p-20261017-94", "p-20261017-93", "p-20261017-98", "p-20261017-99", "p-20261010-07"] as const;
const PICK = "p-20261017-94";
const LENGTHS: Record<(typeof IDS)[number], number> = {
  "p-20261017-94": 20,
  "p-20261017-93": 21,
  "p-20261017-98": 9,
  "p-20261017-99": 20,
  "p-20261010-07": 23,
};
const HREF = /^(#\/|https:\/\/cursor\.com\/agents\/bc-[0-9a-f-]+$|https:\/\/github\.com\/BoydVC\/draft-day\/(pull|commit)\/)/;

function viewOf(id: string): TimelineView {
  const body = picks[id];
  assert.ok(body, id);
  return body.timeline;
}

function expectFrame(room: ReplayRoom, view: TimelineView, index: number): void {
  const diff = compareFrame(room.snapshot(), frameAt(view, index));
  assert.deepEqual(diff, []);
}

async function open(id: string, query = ""): Promise<ReplayRoom> {
  return loadReplay({ root, hash: `#/picks/${id}/replay${query}` });
}

function loadEvents(name: string): DraftEvent[] {
  const text = readFileSync(join(root, "test/fixtures/replay", name), "utf8");
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
}

function bodyWith(id: string, events: DraftEvent[], now: number): PickBody {
  const view = timeline(events, now);
  assert.ok(view);
  const base = picks[id];
  assert.ok(base);
  return { ...base, status: view.status, stage: view.stage, timeline: view } as unknown as PickBody;
}

function named(room: ReplayRoom, name: string, tag: string) {
  const node = byName(room.app, name, [tag]);
  assert.ok(node, name);
  return node;
}

test("R1 opens at frame 1", async () => {
  for (const id of IDS) {
    const room = await open(id);
    expectFrame(room, viewOf(id), 0);
    assert.equal(room.snapshot()?.pickId, id);
    assert.equal(room.clock.pending(), 0);
    assert.equal(text(named(room, "Play", "BUTTON")), "Play");
    assert.equal(findAll(room.app, (node) => node.classList.contains("chip")).length, 1);
  }
});

test("R2 deep links and play=1", async () => {
  const view = viewOf(PICK);
  const at11 = await open(PICK, "?at=11");
  expectFrame(at11, view, 10);
  assert.equal(at11.snapshot()?.counter, "Event 11 of 20");
  const at20 = await open(PICK, "?at=20");
  expectFrame(at20, view, 19);
  assert.equal(at20.snapshot()?.counter, "Event 20 of 20");
  const unknown = await open(PICK, "?at=999");
  expectFrame(unknown, view, 0);
  const word = await open(PICK, "?at=x");
  expectFrame(word, view, 0);
  const playing = await open(PICK, "?play=1");
  assert.equal(text(named(playing, "Pause", "BUTTON")), "Pause");
  assert.equal(playing.clock.pending(), 1);
  expectFrame(playing, view, 0);
  await playing.clock.tick((view.entries.length - 1) * REPLAY_STEP_MS);
  expectFrame(playing, view, view.entries.length - 1);
  assert.equal(playing.clock.pending(), 0);
  assert.equal(text(named(playing, "Play", "BUTTON")), "Play");
  const held = await open(PICK, "?play=0");
  expectFrame(held, view, 0);
  assert.equal(held.clock.pending(), 0);
  assert.equal(text(named(held, "Play", "BUTTON")), "Play");
  const ordered = await open(PICK, "?play=1&at=11");
  expectFrame(ordered, view, 10);
  assert.equal(text(named(ordered, "Pause", "BUTTON")), "Pause");
  assert.equal(ordered.clock.pending(), 1);
});

test("R3 every frame of every fixture", async () => {
  let seen = 0;
  for (const id of IDS) {
    const view = viewOf(id);
    assert.equal(view.entries.length, LENGTHS[id]);
    const room = await open(id);
    for (let index = 0; index < view.entries.length; index += 1) {
      if (index > 0) await room.press("Next event");
      expectFrame(room, view, index);
      seen += 1;
    }
  }
  assert.equal(seen, 93);
});

test("R4 controls", async () => {
  const view = viewOf(PICK);
  const room = await open(PICK);
  const group = find(room.app, (node) => node.getAttribute("role") === "group" && node.getAttribute("aria-label") === "Replay controls");
  assert.ok(group);
  const buttons = group.children.filter((node) => node.tagName === "BUTTON").map((node) => text(node));
  assert.deepEqual(buttons, ["First event", "Previous event", "Play", "Next event", "Last event"]);
  assert.equal(group.children.filter((node) => node.tagName === "INPUT").length, 1);
  assert.equal(named(room, "First event", "BUTTON").disabled, true);
  assert.equal(named(room, "Previous event", "BUTTON").disabled, true);
  assert.equal(named(room, "Next event", "BUTTON").disabled, false);
  assert.equal(named(room, "Last event", "BUTTON").disabled, false);
  await room.press("Last event");
  expectFrame(room, view, view.entries.length - 1);
  assert.equal(named(room, "Next event", "BUTTON").disabled, true);
  assert.equal(named(room, "Last event", "BUTTON").disabled, true);
  await room.press("Previous event");
  expectFrame(room, view, view.entries.length - 2);
  await room.press("First event");
  expectFrame(room, view, 0);
  await room.scrub(17);
  expectFrame(room, view, 16);
  assert.equal(room.snapshot()?.counter, "Event 17 of 20");
});

test("R5 play", async () => {
  const view = viewOf(PICK);
  const room = await open(PICK);
  await room.press("Play");
  assert.equal(text(named(room, "Pause", "BUTTON")), "Pause");
  assert.equal(room.clock.pending(), 1);
  await room.clock.tick(REPLAY_STEP_MS - 1);
  expectFrame(room, view, 0);
  await room.clock.tick(1);
  expectFrame(room, view, 1);
  await room.clock.tick((view.entries.length - 2) * REPLAY_STEP_MS);
  expectFrame(room, view, view.entries.length - 1);
  assert.equal(room.clock.pending(), 0);
  assert.equal(text(named(room, "Play", "BUTTON")), "Play");
  await room.press("Play");
  expectFrame(room, view, 0);
  assert.equal(text(named(room, "Pause", "BUTTON")), "Pause");
  assert.equal(room.clock.pending(), 1);
  const one = bodyWith(PICK, loadEvents("p-20261017-94.events.jsonl").slice(0, 1), Date.parse("2026-10-17T21:10:00.000Z"));
  const single = await loadReplay({ root, picks: { [one.id]: one }, hash: `#/picks/${one.id}/replay` });
  await single.press("Play");
  expectFrame(single, one.timeline, 0);
  assert.equal(single.clock.pending(), 0);
  assert.equal(text(named(single, "Play", "BUTTON")), "Play");
});

test("R6 manual moves pause", async () => {
  const view = viewOf(PICK);
  const next = await open(PICK);
  await next.press("Play");
  await next.press("Next event");
  expectFrame(next, view, 1);
  assert.equal(next.clock.pending(), 0);
  assert.equal(text(named(next, "Play", "BUTTON")), "Play");
  await next.clock.tick(3 * REPLAY_STEP_MS);
  expectFrame(next, view, 1);
  const previous = await open(PICK, "?at=11");
  await previous.press("Play");
  await previous.press("Previous event");
  expectFrame(previous, view, 9);
  assert.equal(previous.clock.pending(), 0);
  const first = await open(PICK, "?at=11");
  await first.press("Play");
  await first.press("First event");
  expectFrame(first, view, 0);
  assert.equal(first.clock.pending(), 0);
  const last = await open(PICK);
  await last.press("Play");
  await last.press("Last event");
  expectFrame(last, view, view.entries.length - 1);
  assert.equal(last.clock.pending(), 0);
  const scrub = await open(PICK);
  await scrub.press("Play");
  await scrub.scrub(17);
  expectFrame(scrub, view, 16);
  assert.equal(scrub.clock.pending(), 0);
  assert.equal(text(named(scrub, "Play", "BUTTON")), "Play");
});

test("R7 live updates keep the film", async () => {
  const view = viewOf(PICK);
  const room = await open(PICK);
  await room.press("Play");
  await room.clock.tick(500);
  assert.equal(room.clock.pending(), 1);
  const counter = room.snapshot()?.counter;
  await room.emit();
  await room.emit();
  await room.emit();
  expectFrame(room, view, 0);
  assert.equal(room.snapshot()?.counter, counter);
  assert.equal(text(named(room, "Pause", "BUTTON")), "Pause");
  assert.equal(room.clock.pending(), 1);
  await room.clock.tick(500);
  expectFrame(room, view, 1);
  await room.press("Pause");
  assert.equal(room.clock.pending(), 0);
  const paused = room.snapshot()?.counter;
  await room.emit();
  assert.equal(room.snapshot()?.counter, paused);
  assert.equal(room.clock.pending(), 0);
  assert.equal(text(named(room, "Play", "BUTTON")), "Play");
});

test("R8 same nodes, same focus", async () => {
  const room = await open(PICK);
  const caption = find(room.app, (node) => node.getAttribute("data-replay") === "caption");
  const next = named(room, "Next event", "BUTTON");
  assert.ok(caption);
  await room.press("Next event");
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(named(room, "Next event", "BUTTON"), next);
  assert.equal(room.active(), "Next event");
  await room.press("Play");
  assert.equal(named(room, "Pause", "BUTTON"), named(room, "Pause", "BUTTON"));
  assert.equal(room.active(), "Pause");
  const pause = named(room, "Pause", "BUTTON");
  await room.clock.tick(REPLAY_STEP_MS);
  assert.equal(named(room, "Pause", "BUTTON"), pause);
  assert.equal(room.active(), "Pause");
  await room.emit();
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(named(room, "Next event", "BUTTON"), next);
  assert.equal(named(room, "Pause", "BUTTON"), pause);
  assert.equal(room.active(), "Pause");
  await room.press("Last event");
  assert.equal(room.active(), "Event");
  assert.equal(named(room, "Last event", "BUTTON").disabled, true);
});

test("R9 live and synthetic stages", async () => {
  const events = loadEvents("p-20261017-94.events.jsonl");
  const now = Date.parse("2026-10-17T21:10:00.000Z");
  const live = bodyWith(PICK, events.slice(0, 12), now);
  const room = await loadReplay({ root, picks: { [live.id]: live }, hash: `#/picks/${live.id}/replay?at=12` });
  expectFrame(room, live.timeline, 11);
  assert.equal(room.snapshot()?.counter, "Event 12 of 12");
  assert.equal(room.snapshot()?.runs.some((run) => run.text === "Film Room pass 2 \u00b7 running"), true);
  const next = bodyWith(PICK, events.slice(0, 13), now);
  room.setPick(live.id, next);
  await room.emit();
  expectFrame(room, next.timeline, 11);
  assert.equal(room.snapshot()?.counter, "Event 12 of 13");
  await room.press("Next event");
  expectFrame(room, next.timeline, 12);
  assert.equal(room.snapshot()?.counter, "Event 13 of 13");
  const ended = bodyWith(PICK, events.slice(0, 2), Date.parse("2026-10-20T00:00:00.000Z"));
  const timeout = await loadReplay({ root, picks: { [ended.id]: ended }, hash: `#/picks/${ended.id}/replay?at=2` });
  expectFrame(timeout, ended.timeline, 1);
  assert.deepEqual(timeout.snapshot()?.stages.map((span) => span.text), ["Intake 37m", "Scouting Report 2d 0h", "Cancelled"]);
  await timeout.press("First event");
  expectFrame(timeout, ended.timeline, 0);
  assert.deepEqual(timeout.snapshot()?.stages.map((span) => span.text), ["Intake"]);
});

test("R10 requests", async () => {
  const room = await open(PICK);
  const picksOf = () => room.calls.filter((call) => call.method === "GET" && call.url === `/api/picks/${PICK}`);
  assert.equal(picksOf().length, 1);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  const before = room.calls.length;
  await room.press("Play");
  await room.clock.tick(REPLAY_STEP_MS);
  await room.press("Next event");
  await room.scrub(4);
  assert.equal(room.calls.length, before);
  assert.equal(picksOf().length, 1);
  await room.emit();
  assert.equal(picksOf().length, 2);
  assert.equal(room.sources.length, 1);
});

test("R11 leaving stops play", async () => {
  const board = await open(PICK);
  await board.press("Play");
  assert.equal(board.clock.pending(), 1);
  await board.hashchange("#/");
  assert.equal(board.clock.pending(), 0);
  const boardCalls = board.calls.length;
  await board.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(board.calls.length, boardCalls);
  assert.equal(board.clock.pending(), 0);
  const page = await open(PICK);
  await page.press("Play");
  await page.hashchange(`#/picks/${PICK}`);
  assert.equal(page.clock.pending(), 0);
  const pageCalls = page.calls.length;
  await page.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(page.calls.length, pageCalls);
});

test("R12 links", async () => {
  const page = await loadReplay({ root, hash: `#/picks/${PICK}` });
  assert.equal(named(page, "Replay", "A").getAttribute("href"), `#/picks/${PICK}/replay`);
  const room = await open(PICK);
  assert.equal(named(room, "Pick page", "A").getAttribute("href"), `#/picks/${PICK}`);
  assert.equal(named(room, "Big Board", "A").getAttribute("href"), "#/");
});

test("R13 unknown pick", async () => {
  const room = await loadReplay({ root, hash: "#/picks/p-20261017-55/replay" });
  assert.equal(room.snapshot(), null);
  assert.equal(room.app.textContent.includes("That pick is not on the board."), true);
  assert.equal(named(room, "Big Board", "A").getAttribute("href"), "#/");
  assert.equal(find(room.app, (node) => node.tagName === "ARTICLE" && node.getAttribute("aria-label") === "Replay"), null);
  assert.equal(room.clock.pending(), 0);
});

test("R14 hostile text stays text", async () => {
  const id = "p-20261017-99";
  const view = viewOf(id);
  const room = await open(id);
  for (let index = 0; index < view.entries.length; index += 1) {
    if (index > 0) await room.press("Next event");
    expectFrame(room, view, index);
    assert.equal(findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length, 0);
    const handlers = findAll(room.app, (node) => [...node.attributes.keys()].some((key) => key.startsWith("on")));
    assert.deepEqual(handlers, []);
    for (const anchor of findAll(room.app, (node) => node.tagName === "A")) {
      assert.match(anchor.getAttribute("href") ?? "", HREF);
    }
  }
  const idea = "Hostile replay fixture <img src=x onerror=\"alert(1)\"> & </li><script>alert(2)</script>";
  const lesson = "<img src=x onerror=\"alert(4)\">";
  assert.equal(room.app.textContent.includes(idea), true);
  assert.equal(room.app.textContent.includes(lesson), true);
  const c2 = find(room.app, (node) => node.tagName === "LI" && (node.getAttribute("data-run") ?? "").startsWith("c2"));
  assert.ok(c2);
  assert.equal(findAll(c2, (node) => node.tagName === "A").length, 0);
});

test("R15 wiring", () => {
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  assert.match(http, /"\/replay\.js", "\/replay\.css"/);
  const sheets = [...html.matchAll(/<link\b[^>]*href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css"]);
  const scripts = [...html.matchAll(/<script\b[^>]*src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "app.js"]);
});

test("R16 replay.js source rules", () => {
  const source = readFileSync(join(root, "src/ui/replay.js"), "utf8");
  for (const token of ["fetch(", "Date", "requestAnimationFrame", "localStorage", "sessionStorage", "document.cookie", "XMLHttpRequest", "WebSocket", "sendBeacon", "/test/", "history.", "location.hash ="]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.match(source, /globalThis\.draftDayReplay\s*=/);
});

test("R17 replay.css rules", () => {
  const css = readFileSync(join(root, "src/ui/replay.css"), "utf8");
  assert.equal(css.includes("@import"), false);
  assert.equal(css.includes("url(http"), false);
  const outside = css.replace(/@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{[^{}]*\}/g, "");
  assert.equal(/transition\s*:/.test(outside), false);
  assert.equal(/animation\s*:/.test(outside), false);
});

test("R18 fixtures match the server", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-replay-"));
  const logs: Array<[string, string]> = [
    ["p-20261017-94", "test/fixtures/replay/p-20261017-94.events.jsonl"],
    ["p-20261017-93", "test/fixtures/replay/p-20261017-93.events.jsonl"],
    ["p-20261017-98", "test/fixtures/replay/p-20261017-98.events.jsonl"],
    ["p-20261017-99", "test/fixtures/replay/p-20261017-99.events.jsonl"],
    ["p-20261010-07", "test/fixtures/timeline/p-20261010-07.events.jsonl"],
  ];
  for (const [id, rel] of logs) {
    const dir = join(data, "picks", id);
    await mkdir(dir, { recursive: true });
    await copyFile(join(root, rel), join(dir, "events.jsonl"));
  }
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    for (const [id] of logs) {
      const response = await fetch(`${server.url}/api/picks/${id}`);
      assert.equal(response.status, 200);
      const body = await response.json() as { timeline: unknown };
      const file = JSON.parse(readFileSync(join(root, "test/fixtures/replay", `${id}.pick.json`), "utf8")) as { timeline: unknown };
      assert.deepEqual(body.timeline, file.timeline);
    }
    const script = await fetch(`${server.url}/replay.js`);
    const style = await fetch(`${server.url}/replay.css`);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
    assert.match(style.headers.get("content-type") ?? "", /^text\/css/);
  } finally {
    await server.close();
  }
});

test("safety fact no extra request, markup, timer, or storage", async () => {
  const events = loadEvents("p-20261017-94.events.jsonl");
  const live = bodyWith(PICK, events.slice(0, 12), Date.parse("2026-10-17T21:10:00.000Z"));
  const bodies: PickBody[] = [...IDS.map((id) => picks[id]!), live];
  const fetchUrls: string[] = [];
  let badNodes = 0;
  let hrefViolations = 0;
  let timersAfterLeave = 0;
  let sources = 0;
  for (const body of bodies) {
    const allowed = new Set<string>(["#/", `#/picks/${body.id}`, `#/picks/${body.id}/replay`]);
    for (const entry of body.timeline.entries) {
      for (const link of entry.links || []) allowed.add(link.href);
    }
    const room = await loadReplay({ root, picks: { [body.id]: body }, hash: `#/picks/${body.id}/replay` });
    let cookieReads = 0;
    Object.defineProperty(room.document, "cookie", {
      configurable: true,
      get() {
        cookieReads += 1;
        throw new Error("cookie");
      },
    });
    await room.press("Play");
    await room.clock.tick(5 * REPLAY_STEP_MS);
    room.setPick(body.id, body);
    await room.emit();
    await room.emit();
    await room.scrub(1);
    for (const name of ["First event", "Previous event", "Play", "Next event", "Last event"]) {
      if (byName(room.app, name, ["BUTTON"])) await room.press(name);
    }
    if (room.snapshot()) {
      badNodes += findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length;
      badNodes += findAll(room.app, (node) => [...node.attributes.keys()].some((key) => key.startsWith("on"))).length;
      for (const anchor of findAll(room.app, (node) => node.tagName === "A")) {
        const href = anchor.getAttribute("href") ?? "";
        if (!allowed.has(href)) hrefViolations += 1;
      }
    }
    assert.equal(cookieReads, 0);
    await room.hashchange("#/");
    timersAfterLeave += room.clock.pending();
    const after = room.calls.length;
    await room.clock.tick(5 * REPLAY_STEP_MS);
    assert.equal(room.calls.length, after);
    timersAfterLeave += room.clock.pending();
    sources = room.sources.length;
    for (const call of room.calls) fetchUrls.push(call.url);
    assert.equal(room.sources.length, 1);
    assert.equal(room.sources[0]?.url, "/api/events");
  }
  const offenders = fetchUrls.filter((url) => !/^\/api\/(board|picks\/p-\d{8}-\d{2})$/.test(url));
  const proof = {
    pass: offenders.length === 0 && badNodes === 0 && hrefViolations === 0 && timersAfterLeave === 0 && sources === 1,
    fixtures: bodies.length,
    fetches: fetchUrls.length,
    offenders,
    badNodes,
    hrefViolations,
    timersAfterLeave,
    eventSources: sources,
  };
  console.log(`safety-fact ${JSON.stringify(proof)}`);
  assert.equal(proof.pass, true);
});
