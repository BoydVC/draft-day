import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { timeline, type DraftEvent, type Timeline } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { byName, find, findAll, text, walk } from "./fixtures/phone/dom-harness.mjs";
import type { FakeElement, FakeNode } from "./fixtures/phone/dom-harness.mjs";
import {
  REPLAY_STEP_MS,
  compareFrame,
  frameAt,
  loadReplay,
  readPicks,
  type PickBody,
  type ReplayRoom,
  type TimelineView,
} from "./fixtures/replay/replay-harness.mjs";

const root = process.cwd();
const picks = readPicks(join(root, "test/fixtures/replay"));
const IDS = ["p-20261017-94", "p-20261017-93", "p-20261017-98", "p-20261017-99", "p-20261010-07"];
const HREF = /^(#\/|https:\/\/cursor\.com\/agents\/bc-[0-9a-f-]+$|https:\/\/github\.com\/BoydVC\/draft-day\/(pull|commit)\/)/;

function must<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}

function viewOf(id: string): TimelineView {
  return picks[id]?.timeline as TimelineView;
}

function open(id: string, query = ""): Promise<ReplayRoom> {
  const suffix = query ? `?${query}` : "";
  return loadReplay({ hash: `#/picks/${id}/replay${suffix}` });
}

function button(room: ReplayRoom, name: string): FakeElement {
  return must(byName(room.app, name, ["BUTTON"]));
}

function isElement(node: FakeNode): node is FakeElement {
  return "attributes" in node;
}

function loadLog(name: string): DraftEvent[] {
  return readFileSync(join(root, "test/fixtures/replay", name), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DraftEvent);
}

function withTimeline(id: string, view: Timeline): PickBody {
  const body = structuredClone(picks[id]) as PickBody;
  body.timeline = view as unknown as TimelineView;
  body.status = view.status;
  body.stage = view.stage;
  return body;
}

test("R1 opens at frame 1", async () => {
  for (const id of IDS) {
    const room = await open(id);
    const snap = room.snapshot();
    assert.deepEqual(compareFrame(snap, frameAt(viewOf(id), 0)), [], id);
    assert.equal(snap?.pickId, id);
    assert.equal(text(button(room, "Play")), "Play");
    assert.equal(room.clock.pending(), 0);
  }
});

test("R2 deep links and play=1", async () => {
  const view = viewOf("p-20261017-94");
  const at11 = await open("p-20261017-94", "at=11");
  assert.deepEqual(compareFrame(at11.snapshot(), frameAt(view, 10)), []);
  assert.equal(at11.clock.pending(), 0);

  const at20 = await open("p-20261017-94", "at=20");
  assert.deepEqual(compareFrame(at20.snapshot(), frameAt(view, 19)), []);

  const missingSeq = await open("p-20261017-94", "at=999");
  assert.deepEqual(compareFrame(missingSeq.snapshot(), frameAt(view, 0)), []);

  const notANumber = await open("p-20261017-94", "at=x");
  assert.deepEqual(compareFrame(notANumber.snapshot(), frameAt(view, 0)), []);

  const playing = await open("p-20261017-94", "play=1");
  assert.equal(playing.snapshot()?.counter, "Event 1 of 20");
  assert.equal(text(button(playing, "Pause")), "Pause");
  assert.equal(playing.clock.pending(), 1);
  await playing.clock.tick((view.entries.length - 1) * REPLAY_STEP_MS);
  assert.equal(playing.snapshot()?.counter, "Event 20 of 20");
  assert.equal(text(button(playing, "Play")), "Play");
  assert.equal(playing.clock.pending(), 0);

  const ignored = await open("p-20261017-94", "play=0");
  assert.equal(ignored.snapshot()?.counter, "Event 1 of 20");
  assert.equal(text(button(ignored, "Play")), "Play");
  assert.equal(ignored.clock.pending(), 0);

  const ordered = await open("p-20261017-94", "play=1&at=11");
  assert.equal(ordered.snapshot()?.counter, "Event 11 of 20");
  assert.equal(text(button(ordered, "Pause")), "Pause");
  assert.equal(ordered.clock.pending(), 1);
});

test("R3 every frame of every fixture", async () => {
  let frames = 0;
  for (const id of IDS) {
    const room = await open(id);
    const view = viewOf(id);
    for (let index = 0; index < view.entries.length; index += 1) {
      if (index > 0) await room.press("Next event");
      const diff = compareFrame(room.snapshot(), frameAt(view, index));
      assert.deepEqual(diff, [], `${id} frame ${index + 1}: ${diff.join("; ")}`);
      frames += 1;
    }
  }
  assert.equal(frames, 93);
});

test("R4 controls", async () => {
  const room = await open("p-20261017-94");
  const view = viewOf("p-20261017-94");
  const group = must(find(room.app, (node) => node.getAttribute("role") === "group" && node.getAttribute("aria-label") === "Replay controls"));
  const buttons = findAll(group, (node) => node.tagName === "BUTTON");
  assert.deepEqual(buttons.map((node) => text(node)), ["First event", "Previous event", "Play", "Next event", "Last event"]);
  assert.equal(buttons[0]?.disabled, true);
  assert.equal(buttons[1]?.disabled, true);
  assert.equal(buttons[3]?.disabled, false);
  assert.equal(buttons[4]?.disabled, false);
  const slider = must(find(group, (node) => node.tagName === "INPUT"));
  assert.equal(slider.getAttribute("type"), "range");

  await room.press("Last event");
  assert.equal(room.snapshot()?.counter, `Event ${view.entries.length} of ${view.entries.length}`);
  assert.equal(button(room, "Next event").disabled, true);
  assert.equal(button(room, "Last event").disabled, true);
  assert.equal(button(room, "First event").disabled, false);

  await room.press("Previous event");
  assert.equal(room.snapshot()?.counter, `Event ${view.entries.length - 1} of ${view.entries.length}`);

  await room.press("First event");
  assert.deepEqual(compareFrame(room.snapshot(), frameAt(view, 0)), []);

  await room.scrub(17);
  assert.deepEqual(compareFrame(room.snapshot(), frameAt(view, 16)), []);
});

test("R5 play", async () => {
  const room = await open("p-20261017-94");
  const n = viewOf("p-20261017-94").entries.length;
  await room.press("Play");
  assert.equal(text(button(room, "Pause")), "Pause");
  assert.equal(room.clock.pending(), 1);
  assert.equal(room.snapshot()?.counter, "Event 1 of 20");
  await room.clock.tick(REPLAY_STEP_MS - 1);
  assert.equal(room.snapshot()?.counter, "Event 1 of 20");
  await room.clock.tick(1);
  assert.equal(room.snapshot()?.counter, "Event 2 of 20");
  await room.clock.tick((n - 2) * REPLAY_STEP_MS);
  assert.equal(room.snapshot()?.counter, "Event 20 of 20");
  assert.equal(text(button(room, "Play")), "Play");
  assert.equal(room.clock.pending(), 0);

  await room.press("Play");
  assert.equal(room.snapshot()?.counter, "Event 1 of 20");
  assert.equal(text(button(room, "Pause")), "Pause");
  assert.equal(room.clock.pending(), 1);

  const single = await loadReplay({ hash: "#/" });
  const body = structuredClone(picks["p-20261017-94"]) as PickBody;
  body.timeline = { ...body.timeline, entries: body.timeline.entries.slice(0, 1), runs: [] };
  single.setPick("p-20261017-94", body);
  await single.hashchange("#/picks/p-20261017-94/replay");
  assert.equal(single.snapshot()?.counter, "Event 1 of 1");
  await single.press("Play");
  assert.equal(single.snapshot()?.counter, "Event 1 of 1");
  assert.equal(text(button(single, "Play")), "Play");
  assert.equal(single.clock.pending(), 0);
});

test("R6 manual moves pause", async () => {
  const room = await open("p-20261017-94");
  await room.press("Play");
  await room.clock.tick(100);
  await room.press("Next event");
  assert.equal(room.snapshot()?.counter, "Event 2 of 20");
  assert.equal(text(button(room, "Play")), "Play");
  assert.equal(room.clock.pending(), 0);
  await room.clock.tick(2 * REPLAY_STEP_MS);
  assert.equal(room.snapshot()?.counter, "Event 2 of 20");

  await room.press("Play");
  await room.clock.tick(100);
  await room.scrub(17);
  assert.equal(room.snapshot()?.counter, "Event 17 of 20");
  assert.equal(text(button(room, "Play")), "Play");
  assert.equal(room.clock.pending(), 0);

  await room.press("Play");
  await room.press("Last event");
  assert.equal(room.snapshot()?.counter, "Event 20 of 20");
  assert.equal(room.clock.pending(), 0);
});

test("R7 live updates keep the film", async () => {
  const room = await open("p-20261017-94");
  await room.press("Play");
  await room.clock.tick(500);
  assert.equal(room.snapshot()?.counter, "Event 1 of 20");
  await room.emit();
  await room.emit();
  await room.emit();
  assert.equal(room.snapshot()?.counter, "Event 1 of 20");
  assert.equal(text(button(room, "Pause")), "Pause");
  assert.equal(room.clock.pending(), 1);
  await room.clock.tick(500);
  assert.equal(room.snapshot()?.counter, "Event 2 of 20");

  const paused = await open("p-20261017-94", "at=11");
  await paused.emit();
  assert.equal(paused.snapshot()?.counter, "Event 11 of 20");
  assert.equal(text(button(paused, "Play")), "Play");
  assert.equal(paused.clock.pending(), 0);
});

test("R8 same nodes, same focus", async () => {
  const room = await open("p-20261017-94");
  const caption = must(find(room.app, (node) => node.getAttribute("data-replay") === "caption"));
  const next = button(room, "Next event");
  await room.press("Next event");
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(button(room, "Next event"), next);
  assert.equal(room.active(), "Next event");

  await room.press("Play");
  assert.equal(room.active(), "Pause");
  assert.equal(button(room, "Next event"), next);
  await room.emit();
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(button(room, "Next event"), next);
  assert.equal(room.active(), "Pause");

  await room.press("Last event");
  assert.equal(button(room, "Last event").disabled, true);
  assert.equal(room.active(), "Event");
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
});

test("R9 live and synthetic stages", async () => {
  const events = loadLog("p-20261017-94.events.jsonl");
  const live = must(timeline(events.slice(0, 12), Date.parse("2026-10-17T21:10:00.000Z")));
  const room = await loadReplay({ hash: "#/" });
  room.setPick("p-20261017-94", withTimeline("p-20261017-94", live));
  await room.hashchange("#/picks/p-20261017-94/replay?at=12");
  const atLive = room.snapshot();
  assert.deepEqual(compareFrame(atLive, frameAt(live as unknown as TimelineView, 11)), []);
  assert.equal(atLive?.counter, "Event 12 of 12");
  assert.equal(atLive?.runs.some((run) => run.text === "Film Room pass 2 · running"), true);

  const extended = must(timeline(events.slice(0, 13), Date.parse("2026-10-17T21:21:00.000Z")));
  room.setPick("p-20261017-94", withTimeline("p-20261017-94", extended));
  await room.emit();
  assert.equal(room.snapshot()?.counter, "Event 12 of 13");
  assert.equal(room.snapshot()?.runs.some((run) => run.text === "Film Room pass 2 · running"), true);
  assert.equal(text(button(room, "Play")), "Play");
  await room.press("Next event");
  assert.deepEqual(compareFrame(room.snapshot(), frameAt(extended as unknown as TimelineView, 12)), []);
  assert.equal(room.snapshot()?.counter, "Event 13 of 13");

  const timedOut = must(timeline(events.slice(0, 2), Date.parse("2026-10-20T00:00:00.000Z")));
  room.setPick("p-20261017-94", withTimeline("p-20261017-94", timedOut));
  await room.hashchange("#/picks/p-20261017-94/replay?at=2");
  const atEnd = room.snapshot();
  assert.deepEqual(compareFrame(atEnd, frameAt(timedOut as unknown as TimelineView, 1)), []);
  assert.deepEqual(atEnd?.stages.map((span) => span.text), ["Intake 37m", "Scouting Report 2d 0h", "Cancelled"]);
  await room.press("First event");
  const atStart = room.snapshot();
  assert.deepEqual(compareFrame(atStart, frameAt(timedOut as unknown as TimelineView, 0)), []);
  assert.deepEqual(atStart?.stages.map((span) => span.text), ["Intake"]);
});

test("R10 requests", async () => {
  const room = await open("p-20261017-94");
  const pickGets = () => room.calls.filter((call) => call.method === "GET" && call.url === "/api/picks/p-20261017-94");
  assert.equal(pickGets().length, 1);
  await room.press("Play");
  await room.clock.tick(REPLAY_STEP_MS);
  await room.press("Pause");
  await room.press("Next event");
  await room.scrub(4);
  assert.equal(pickGets().length, 1);
  assert.equal(room.calls.filter((call) => call.url.startsWith("/api/picks/")).length, 1);
  await room.emit();
  assert.equal(pickGets().length, 2);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
});

test("R11 leaving stops play", async () => {
  const home = await open("p-20261017-94", "play=1");
  assert.equal(home.clock.pending(), 1);
  await home.hashchange("#/");
  assert.equal(home.clock.pending(), 0);
  const afterHome = home.calls.length;
  await home.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(home.calls.length, afterHome);

  const pick = await open("p-20261017-94", "play=1");
  await pick.hashchange("#/picks/p-20261017-94");
  assert.equal(pick.clock.pending(), 0);
  const afterPick = pick.calls.length;
  await pick.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(pick.calls.length, afterPick);
});

test("R12 links", async () => {
  const pick = await loadReplay({ hash: "#/picks/p-20261017-94" });
  const replayLink = must(byName(pick.app, "Replay", ["A"]));
  assert.equal(replayLink.getAttribute("href"), "#/picks/p-20261017-94/replay");
  const statusLine = must(find(pick.app, (node) => node.classList.contains("status-line")));
  assert.equal(statusLine.contains(replayLink), true);

  const room = await open("p-20261017-94");
  assert.equal(must(byName(room.app, "Pick page", ["A"])).getAttribute("href"), "#/picks/p-20261017-94");
  assert.equal(must(byName(room.app, "Big Board", ["A"])).getAttribute("href"), "#/");
});

test("R13 unknown pick", async () => {
  const room = await open("p-20261017-55");
  assert.equal(room.snapshot(), null);
  assert.equal(find(room.app, (node) => node.getAttribute("aria-label") === "Replay"), null);
  assert.match(text(room.app), /That pick is not on the board\./);
  assert.equal(must(byName(room.app, "Big Board", ["A"])).getAttribute("href"), "#/");
  assert.equal(room.clock.pending(), 0);
});

test("R14 hostile text stays text", async () => {
  const id = "p-20261017-99";
  const room = await open(id);
  const pick = must(picks[id]);
  const lesson = '<img src=x onerror="alert(4)">';
  for (let index = 0; index < pick.timeline.entries.length; index += 1) {
    if (index > 0) await room.press("Next event");
    assert.equal(findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length, 0);
    walk(room.app, (node) => {
      if (!isElement(node)) return;
      for (const name of node.attributes.keys()) assert.equal(name.startsWith("on"), false, name);
      if (node.tagName === "A") assert.match(node.getAttribute("href") ?? "", HREF);
    });
    const run = find(room.app, (node) => node.tagName === "LI" && node.getAttribute("data-run") === "c2#1");
    if (run) assert.equal(findAll(run, (node) => node.tagName === "A").length, 0);
  }
  assert.equal(room.app.textContent.includes(pick.idea), true);
  assert.equal(room.app.textContent.includes(lesson), true);
  assert.equal(room.app.textContent.includes("javascript:alert(3)"), false);
});

test("R15 wiring", () => {
  const http = readFileSync(join(root, "src/server/http.ts"), "utf8");
  const html = readFileSync(join(root, "src/ui/index.html"), "utf8");
  assert.match(http, /\["\/", "\/index.html", "\/app.js", "\/styles.css", "\/timeline.js", "\/timeline.css", "\/lessons.js", "\/lessons.css", "\/replay.js", "\/replay.css"\]/);
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)">/g)].map((match) => match[1]);
  assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css"]);
  const scripts = [...html.matchAll(/<script src="\/([^"]+)"><\/script>/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "app.js"]);
});

test("R16 replay.js source rules", async () => {
  const source = readFileSync(join(root, "src/ui/replay.js"), "utf8");
  const banned = [
    "fetch(", "Date", "requestAnimationFrame", "localStorage", "sessionStorage", "document.cookie",
    "XMLHttpRequest", "WebSocket", "sendBeacon", "/test/", "history.", "location.hash =",
    "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function",
    "matchMedia", "innerWidth", "outerWidth", "innerHeight", "visualViewport", "screen.", "orientationchange",
  ];
  for (const word of banned) assert.equal(source.includes(word), false, word);
  assert.equal(/\bresize\b/.test(source), false);
  assert.match(source, /globalThis\.draftDayReplay\s*=/);
  const room = await open("p-20261017-94");
  assert.equal(typeof room.ctx.draftDayReplay, "object");
});

test("R17 replay.css rules", () => {
  const css = readFileSync(join(root, "src/ui/replay.css"), "utf8");
  assert.equal(css.includes("@import"), false);
  assert.equal(/url\(\s*http/i.test(css), false);
  assert.equal(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(css), false);
  assert.equal(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(css), false);
  const outside = css.replace(/@media\s*\(\s*prefers-reduced-motion:\s*no-preference\s*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  assert.equal(/\btransition\b/.test(outside), false);
  assert.equal(/\banimation\b/.test(outside), false);
  const named = new Set(["black", "white", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "pink", "brown", "cyan", "magenta", "navy", "teal", "olive", "maroon", "silver", "lime", "aqua", "fuchsia"]);
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of (block[1] ?? "").split(";")) {
      const split = decl.split(":");
      const prop = (split[0] ?? "").trim();
      const value = (split.slice(1).join(":") ?? "").trim();
      if (!colorProp.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        assert.equal(named.has(word.toLowerCase()), false, `${prop} ${word}`);
      }
    }
  }
});

test("R18 fixtures match the server", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-r18-"));
  for (const id of IDS) {
    await mkdir(join(data, "picks", id), { recursive: true });
    const source = id === "p-20261010-07"
      ? join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl")
      : join(root, "test/fixtures/replay", `${id}.events.jsonl`);
    await writeFile(join(data, "picks", id, "events.jsonl"), await readFile(source));
  }
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dataDir: data,
    configPath: join(root, "draftday.config.json"),
    targetsPath: join(root, "targets.json"),
  });
  try {
    for (const id of IDS) {
      const response = await fetch(`${server.url}/api/picks/${id}`);
      assert.equal(response.status, 200);
      const body = await response.json() as { timeline: Timeline };
      assert.deepEqual(body.timeline, picks[id]?.timeline);
    }
    const script = await fetch(`${server.url}/replay.js`);
    const sheet = await fetch(`${server.url}/replay.css`);
    assert.equal(script.status, 200);
    assert.equal(sheet.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
    assert.match(sheet.headers.get("content-type") ?? "", /^text\/css/);
  } finally {
    await server.close();
  }
});

test("R safety fact", async () => {
  const proof: Array<Record<string, unknown>> = [];
  const cases: Array<{ id: string; hrefs: string[]; room: ReplayRoom }> = [];
  for (const id of IDS) {
    const room = await open(id);
    const hrefs = viewOf(id).entries.flatMap((entry) => (entry.links || []).map((link) => link.href));
    cases.push({ id, hrefs, room });
  }
  const events = loadLog("p-20261017-94.events.jsonl");
  const prefix = must(timeline(events.slice(0, 12), Date.parse("2026-10-17T21:10:00.000Z")));
  const liveRoom = await loadReplay({ hash: "#/" });
  liveRoom.setPick("p-20261017-94", withTimeline("p-20261017-94", prefix));
  await liveRoom.hashchange("#/picks/p-20261017-94/replay");
  cases.push({
    id: "p-20261017-94",
    hrefs: (prefix as unknown as TimelineView).entries.flatMap((entry) => (entry.links || []).map((link) => link.href)),
    room: liveRoom,
  });

  for (const item of cases) {
    const { room, id, hrefs } = item;
    for (const key of ["localStorage", "sessionStorage", "history"] as const) {
      Object.defineProperty(room.ctx, key, {
        configurable: true,
        get() {
          throw new Error(`touched ${key}`);
        },
      });
    }
    Object.defineProperty(room.document, "cookie", {
      configurable: true,
      get() {
        throw new Error("touched cookie");
      },
      set() {
        throw new Error("touched cookie");
      },
    });
    await room.press("Play");
    await room.clock.tick(5 * REPLAY_STEP_MS);
    await room.emit();
    await room.emit();
    await room.scrub(Math.min(2, Number(room.snapshot()?.slider?.max ?? "1")));
    for (const name of ["First event", "Previous event", "Next event", "Last event"]) await room.press(name);
    const transport = byName(room.app, "Pause", ["BUTTON"]) ? "Pause" : "Play";
    await room.press(transport);
    const allowed = new Set<string>(["#/", `#/picks/${id}`, ...hrefs]);
    walk(room.app, (node) => {
      if (!isElement(node) || node.tagName !== "A") return;
      const href = node.getAttribute("href") ?? "";
      assert.equal(allowed.has(href), true, href);
    });
    assert.equal(findAll(room.app, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME").length, 0);
    await room.hashchange("#/");
    assert.equal(room.clock.pending(), 0);
    for (const call of room.calls) assert.match(call.url, /^\/api\/(board|picks\/p-\d{8}-\d{2})$/);
    assert.equal(room.sources.length, 1);
    assert.equal(room.sources[0]?.url, "/api/events");
    const after = room.calls.length;
    await room.clock.tick(REPLAY_STEP_MS);
    assert.equal(room.calls.length, after);
    proof.push({ id, fetches: room.calls.map((call) => call.url), pending: room.clock.pending(), sources: room.sources.length });
  }
  const line = { safety: "pass", fixtures: proof.length, pending: proof.map((row) => row.pending), sources: proof.map((row) => row.sources) };
  console.log(`SAFETY ${JSON.stringify(line)}`);
  assert.equal(line.safety, "pass");
  assert.equal(line.fixtures, 6);
});
