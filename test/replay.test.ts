import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { timeline, type DraftEvent } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import { byName, compareFrame, find, findAll, frameAt, loadReplay, readPicks, REPLAY_STEP_MS, text, type PickBody, type ReplayRoom, type TimelineView } from "./fixtures/replay/replay-harness.mjs";
import type { FakeElement } from "./fixtures/phone/dom-harness.mjs";

const root = process.cwd();
const picks = readPicks(join(root, "test/fixtures/replay"));
const IDS = ["p-20261017-94", "p-20261017-93", "p-20261017-98", "p-20261017-99", "p-20261010-07"];

function open(id: string, query = "") {
  return loadReplay({ hash: `#/picks/${id}/replay${query}` });
}

function assertFrame(room: ReplayRoom, view: TimelineView, index: number) {
  const diff = compareFrame(room.snapshot(), frameAt(view, index));
  assert.deepEqual(diff, [], diff.join("\n"));
}

function regionOrder(root: FakeElement) {
  const out: string[] = [];
  const visit = (node: FakeElement) => {
    if (node.getAttribute("data-replay") === "clock") out.push("film");
    if (node.getAttribute("aria-label") === "Replay controls") out.push("controls");
    if (node.getAttribute("aria-label") === "Chapters" && node.tagName === "NAV") out.push("chapters");
    if (node.getAttribute("aria-label") === "Runs so far") out.push("lists");
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

function chapters(root: FakeElement) {
  const nav = find(root, (node) => node.tagName === "NAV" && node.getAttribute("aria-label") === "Chapters");
  assert.ok(nav);
  const group = find(root, (node) => node.getAttribute("aria-label") === "Replay controls");
  assert.ok(group);
  assert.equal(group.contains(nav), false);
  return nav.children.filter((node) => node.tagName === "BUTTON");
}

function assertChapters(room: ReplayRoom, view: TimelineView, index: number) {
  const frame = frameAt(view, index);
  const buttons = chapters(room.app);
  assert.equal(buttons.length, frame.stages.length);
  assert.equal(buttons.some((node) => node.classList.contains("chip")), false);
  buttons.forEach((button, i) => {
    const stage = frame.stages[i];
    assert.ok(stage);
    assert.equal(text(button).startsWith(stage.stage), true);
    assert.equal(button.getAttribute("aria-current") === "true", stage.current);
  });
  assert.equal(findAll(room.app, (node) => node.classList.contains("chip")).length, 1);
  assert.deepEqual(regionOrder(room.app), ["film", "controls", "chapters", "lists"]);
}

function controlNames(root: FakeElement) {
  const group = find(root, (node) => node.getAttribute("aria-label") === "Replay controls");
  assert.ok(group);
  const buttons = group.children.filter((node) => node.tagName === "BUTTON");
  assert.equal(buttons.length, 5);
  return buttons.map((node) => text(node));
}

async function loadEvents(name: string) {
  const raw = await readFile(join(root, "test/fixtures/replay", name), "utf8");
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as DraftEvent);
}

function asView(view: NonNullable<ReturnType<typeof timeline>>): TimelineView {
  return view as unknown as TimelineView;
}

function bodyFor(id: string, view: TimelineView): PickBody {
  const entry = view.entries[view.entries.length - 1];
  return { ...picks[id]!, status: entry?.status ?? picks[id]!.status, stage: entry?.stage ?? picks[id]!.stage, timeline: view };
}

test("R1 opens at frame 1", async () => {
  for (const id of IDS) {
    const room = await open(id);
    const view = picks[id]!.timeline;
    assertFrame(room, view, 0);
    assertChapters(room, view, 0);
    assert.equal(room.clock.pending(), 0);
    assert.equal(room.snapshot()?.pickId, id);
  }
});

test("R2 deep links and play=1", async () => {
  const id = "p-20261017-94";
  const view = picks[id]!.timeline;
  const at11 = await open(id, "?at=11");
  assertFrame(at11, view, 10);
  const at20 = await open(id, "?at=20");
  assertFrame(at20, view, 19);
  const unknown = await open(id, "?at=999");
  assertFrame(unknown, view, 0);
  const word = await open(id, "?at=x");
  assertFrame(word, view, 0);
  const playing = await open(id, "?play=1");
  assert.equal(controlNames(playing.app)[2], "Pause");
  assert.equal(playing.clock.pending(), 1);
  await playing.clock.tick((view.entries.length - 1) * REPLAY_STEP_MS);
  assertFrame(playing, view, view.entries.length - 1);
  assert.equal(controlNames(playing.app)[2], "Play");
  assert.equal(playing.clock.pending(), 0);
  const held = await open(id, "?play=0");
  assert.equal(controlNames(held.app)[2], "Play");
  assert.equal(held.clock.pending(), 0);
  await held.clock.tick(2 * REPLAY_STEP_MS);
  assertFrame(held, view, 0);
  const ordered = await open(id, "?play=1&at=11");
  assertFrame(ordered, view, 10);
  assert.equal(controlNames(ordered.app)[2], "Pause");
  assert.equal(ordered.clock.pending(), 1);
});

test("R3 every frame of every fixture", async () => {
  let frames = 0;
  for (const id of IDS) {
    const view = picks[id]!.timeline;
    const room = await open(id);
    for (let index = 0; index < view.entries.length; index += 1) {
      if (index > 0) await room.press("Next event");
      assertFrame(room, view, index);
      assertChapters(room, view, index);
      frames += 1;
    }
  }
  assert.equal(frames, 93);
  const late = await open("p-20261017-94", "?at=20");
  assert.equal(chapters(late.app).some((node) => text(node) === "Physical · NOT_VERIFIED"), true);
  const fix = await open("p-20261017-93", "?at=21");
  const fixNames = chapters(fix.app).map((node) => text(node));
  assert.equal(fixNames.some((name) => name.includes("Fix loop") && name.includes("NOT_VERIFIED")), true);
});

test("R4 controls", async () => {
  const id = "p-20261017-94";
  const view = picks[id]!.timeline;
  const room = await open(id);
  assert.deepEqual(controlNames(room.app), ["First event", "Previous event", "Play", "Next event", "Last event"]);
  assert.equal(byName(room.app, "First event", ["BUTTON"])?.disabled, true);
  assert.equal(byName(room.app, "Previous event", ["BUTTON"])?.disabled, true);
  assert.equal(byName(room.app, "Next event", ["BUTTON"])?.disabled, false);
  assert.equal(byName(room.app, "Last event", ["BUTTON"])?.disabled, false);
  await room.press("Last event");
  assertFrame(room, view, view.entries.length - 1);
  assert.equal(byName(room.app, "Next event", ["BUTTON"])?.disabled, true);
  assert.equal(byName(room.app, "Last event", ["BUTTON"])?.disabled, true);
  await room.press("Previous event");
  assertFrame(room, view, view.entries.length - 2);
  await room.press("First event");
  assertFrame(room, view, 0);
  await room.scrub(17);
  assertFrame(room, view, 16);
  await room.press("Last event");
  await room.press("Combine");
  const combine = view.stages.find((span) => span.stage === "Combine");
  assert.ok(combine);
  assert.equal(room.snapshot()?.seq, combine.firstSeq);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
});

test("R5 play", async () => {
  const id = "p-20261017-94";
  const view = picks[id]!.timeline;
  const room = await open(id);
  await room.press("Play");
  assert.equal(controlNames(room.app)[2], "Pause");
  assert.equal(room.clock.pending(), 1);
  await room.clock.tick(REPLAY_STEP_MS - 1);
  assertFrame(room, view, 0);
  await room.clock.tick(1);
  assertFrame(room, view, 1);
  await room.clock.tick((view.entries.length - 2) * REPLAY_STEP_MS);
  assertFrame(room, view, view.entries.length - 1);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
  await room.press("Play");
  assertFrame(room, view, 0);
  assert.equal(controlNames(room.app)[2], "Pause");
  assert.equal(room.clock.pending(), 1);
});

test("R6 manual moves pause", async () => {
  const id = "p-20261017-94";
  const view = picks[id]!.timeline;
  const room = await open(id);
  await room.press("Play");
  await room.press("Next event");
  assertFrame(room, view, 1);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
  await room.press("Play");
  await room.scrub(17);
  assertFrame(room, view, 16);
  assert.equal(room.clock.pending(), 0);
  await room.press("Play");
  await room.press("Last event");
  assertFrame(room, view, view.entries.length - 1);
  assert.equal(room.clock.pending(), 0);
  await room.press("Play");
  assertFrame(room, view, 0);
  assert.equal(room.clock.pending(), 1);
  await room.press("Next event");
  assertFrame(room, view, 1);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
  await room.press("Next event");
  await room.press("Play");
  await room.press("First event");
  assertFrame(room, view, 0);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
  await room.press("Next event");
  await room.press("Play");
  await room.press("Previous event");
  assertFrame(room, view, 0);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
});

test("R7 live updates keep the film", async () => {
  const id = "p-20261017-94";
  const view = picks[id]!.timeline;
  const room = await open(id);
  await room.press("Play");
  await room.clock.tick(500);
  assertFrame(room, view, 0);
  await room.emit();
  await room.emit();
  await room.emit();
  assertFrame(room, view, 0);
  assert.equal(controlNames(room.app)[2], "Pause");
  assert.equal(room.clock.pending(), 1);
  await room.clock.tick(500);
  assertFrame(room, view, 1);
  await room.press("Pause");
  assert.equal(room.clock.pending(), 0);
  const seq = room.snapshot()?.seq;
  await room.emit();
  assert.equal(room.snapshot()?.seq, seq);
  assert.equal(controlNames(room.app)[2], "Play");
  assert.equal(room.clock.pending(), 0);
});

test("R8 same nodes, same focus", async () => {
  const room = await open("p-20261017-94");
  const caption = find(room.app, (node) => node.getAttribute("data-replay") === "caption");
  const next = byName(room.app, "Next event", ["BUTTON"]);
  assert.ok(caption);
  assert.ok(next);
  await room.press("Next event");
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assert.equal(room.active(), "Next event");
  await room.press("Play");
  assert.equal(room.active(), "Pause");
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), byName(room.app, "Next event", ["BUTTON"]) ? byName(room.app, "Pause", ["BUTTON"]) : null);
  const play = byName(room.app, "Pause", ["BUTTON"]);
  await room.clock.tick(REPLAY_STEP_MS);
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assert.equal(room.active(), "Pause");
  await room.emit();
  assert.equal(find(room.app, (node) => node.getAttribute("data-replay") === "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), play);
  assert.equal(room.active(), "Pause");
  await room.press("Last event");
  assert.equal(room.active(), "Event");
  assert.equal(byName(room.app, "Last event", ["BUTTON"])?.disabled, true);
});

test("R9 live and synthetic stages", async () => {
  const id = "p-20261017-94";
  const events = await loadEvents("p-20261017-94.events.jsonl");
  const now = Date.parse("2026-10-17T21:10:00.000Z");
  const live = timeline(events.slice(0, 12), now);
  assert.ok(live);
  const room = await loadReplay({ hash: `#/picks/${id}/replay?at=12`, picks: { [id]: bodyFor(id, asView(live)) } });
  assertFrame(room, asView(live), 11);
  assert.equal(room.snapshot()?.counter, "Event 12 of 12");
  assert.equal(room.snapshot()?.runs.some((run) => run.text === "Film Room pass 2 · running"), true);
  const extended = timeline(events.slice(0, 13), now);
  assert.ok(extended);
  room.setPick(id, bodyFor(id, asView(extended)));
  await room.emit();
  assert.equal(room.snapshot()?.counter, "Event 12 of 13");
  assert.equal(room.snapshot()?.seq, live.entries[11]?.seq);
  assert.equal(controlNames(room.app)[2], "Play");
  await room.press("Next event");
  assertFrame(room, asView(extended), 12);
  const ended = timeline(events.slice(0, 2), Date.parse("2026-10-20T00:00:00.000Z"));
  assert.ok(ended);
  const timeout = await loadReplay({
    hash: `#/picks/${id}/replay?at=${ended.entries[1]?.seq}`,
    picks: { [id]: bodyFor(id, asView(ended)) },
  });
  assert.deepEqual(timeout.snapshot()?.stages.map((stage) => stage.text), ["Intake 37m", "Scouting Report 2d 0h", "Cancelled"]);
  await timeout.press("First event");
  assert.deepEqual(timeout.snapshot()?.stages.map((stage) => stage.text), ["Intake"]);
});

test("R10 requests", async () => {
  const id = "p-20261017-94";
  const room = await open(id);
  const pickUrl = `/api/picks/${id}`;
  const picksFetched = () => room.calls.filter((call) => call.url === pickUrl).length;
  assert.equal(picksFetched(), 1);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  const before = room.calls.length;
  await room.press("Play");
  await room.clock.tick(REPLAY_STEP_MS);
  await room.press("Pause");
  await room.press("Next event");
  await room.scrub(4);
  assert.equal(room.calls.length, before);
  assert.equal(picksFetched(), 1);
  await room.emit();
  assert.equal(picksFetched(), 2);
  assert.equal(room.sources.length, 1);
});

test("R11 leaving stops play", async () => {
  const id = "p-20261017-94";
  const room = await open(id);
  await room.press("Play");
  assert.equal(room.clock.pending(), 1);
  await room.hashchange("#/");
  assert.equal(room.clock.pending(), 0);
  const after = room.calls.length;
  await room.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(room.calls.length, after);
  const again = await open(id, "?play=1");
  await again.hashchange(`#/picks/${id}`);
  assert.equal(again.clock.pending(), 0);
  const parked = again.calls.length;
  await again.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(again.calls.length, parked);
});

test("R12 links", async () => {
  const id = "p-20261017-94";
  const page = await loadReplay({ hash: `#/picks/${id}` });
  const replay = byName(page.app, "Replay", ["A"]);
  assert.equal(replay?.getAttribute("href"), `#/picks/${id}/replay`);
  await page.hashchange(`#/picks/${id}/replay`);
  assert.equal(byName(page.app, "Pick page", ["A"])?.getAttribute("href"), `#/picks/${id}`);
  assert.equal(byName(page.app, "Big Board", ["A"])?.getAttribute("href"), "#/");
  const fresh = await open(id);
  assert.equal(byName(fresh.app, "Pick page", ["A"])?.getAttribute("href"), `#/picks/${id}`);
  assert.equal(byName(fresh.app, "Big Board", ["A"])?.getAttribute("href"), "#/");
});

test("R13 unknown pick", async () => {
  const room = await loadReplay({ hash: "#/picks/p-20261017-55/replay" });
  assert.equal(room.snapshot(), null);
  assert.equal(find(room.app, (node) => node.tagName === "ARTICLE" && node.getAttribute("aria-label") === "Replay"), null);
  assert.match(text(room.app), /That pick is not on the board\./);
  assert.equal(byName(room.app, "Big Board", ["A"])?.getAttribute("href"), "#/");
  assert.equal(room.clock.pending(), 0);
});

function badNodes(root: FakeElement) {
  const bad: string[] = [];
  const visit = (node: FakeElement) => {
    if (node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME") bad.push(node.tagName);
    for (const name of node.attributes.keys()) if (name.startsWith("on")) bad.push(name);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return bad;
}

const HREF = /^(#\/|https:\/\/cursor\.com\/agents\/bc-[0-9a-f-]+$|https:\/\/github\.com\/BoydVC\/draft-day\/(pull|commit)\/)/;

test("R14 hostile text stays text", async () => {
  const id = "p-20261017-99";
  const view = picks[id]!.timeline;
  const room = await open(id);
  for (let index = 0; index < view.entries.length; index += 1) {
    if (index > 0) await room.press("Next event");
    assert.deepEqual(badNodes(room.app), []);
    for (const link of findAll(room.app, (node) => node.tagName === "A")) {
      assert.match(link.getAttribute("href") ?? "", HREF);
    }
    const idea = text(find(room.app, (node) => node.className.split(/\s+/).includes("dd-idea")) ?? room.app);
    assert.match(idea, /<img src=x onerror="alert\(1\)">/);
    assert.match(idea, /<script>alert\(2\)<\/script>/);
  }
  const hostile = view.entries.find((entry) => entry.seq === 18);
  assert.ok(hostile);
  await room.scrub(18);
  assert.match(room.snapshot()?.caption ?? "", /<img src=x onerror="alert\(4\)">/);
  const c2 = room.snapshot()?.runs.find((run) => run.id === "c2#1");
  assert.ok(c2);
  const row = find(room.app, (node) => node.getAttribute("data-run") === "c2#1");
  assert.equal(findAll(row ?? room.app, (node) => node.tagName === "A" && Boolean(row?.contains(node))).length, 0);
  assert.equal(text(room.app).includes(hostile.title), true);

  const proof = await proveSafety();
  console.log(`SAFETY ${JSON.stringify(proof)}`);
  assert.equal(proof.pass, true);
});

async function proveSafety() {
  const checked: string[] = [];
  const trap = () => { throw new Error("storage"); };
  for (const id of IDS) {
    await walkSafety(id, picks[id]!, trap);
    checked.push(id);
  }
  const events = await loadEvents("p-20261017-94.events.jsonl");
  const prefix = timeline(events.slice(0, 12), Date.parse("2026-10-17T21:10:00.000Z"));
  const longer = timeline(events.slice(0, 14), Date.parse("2026-10-17T21:10:00.000Z"));
  assert.ok(prefix);
  assert.ok(longer);
  await walkSafety("p-20261017-94", bodyFor("p-20261017-94", asView(prefix)), trap, bodyFor("p-20261017-94", asView(longer)));
  checked.push("p-20261017-94 live");
  return { pass: true, fixtures: checked, timers: 0, storage: "threw-if-touched" };
}

async function walkSafety(id: string, body: PickBody, trap: () => never, next?: PickBody) {
  const room = await loadReplay({ hash: `#/picks/${id}/replay`, picks: { [id]: body } });
  const ctx = room.ctx as object;
  Object.defineProperty(ctx, "localStorage", { configurable: true, get: trap });
  Object.defineProperty(ctx, "sessionStorage", { configurable: true, get: trap });
  Object.defineProperty(ctx, "history", { configurable: true, get: trap });
  Object.defineProperty(room.document, "cookie", { configurable: true, get: trap, set: trap });
  const links = new Set(body.timeline.entries.flatMap((entry) => entry.links.map((link) => link.href)));
  await room.press("Play");
  await room.clock.tick(5 * REPLAY_STEP_MS);
  if (next) room.setPick(id, next);
  await room.emit();
  await room.emit();
  await room.scrub(1);
  const names = new Set<string>();
  for (const button of findAll(room.app, (node) => node.tagName === "BUTTON")) names.add(text(button));
  for (const name of names) await room.press(name);
  assert.deepEqual(badNodes(room.app), []);
  for (const href of findAll(room.app, (node) => node.tagName === "A").map((node) => node.getAttribute("href") ?? "")) {
    const known = links.has(href) || href === "#/" || href === `#/picks/${id}` || href === `#/picks/${id}/replay`;
    assert.equal(known, true, href);
  }
  const fetchOk = /^\/api\/(board|picks\/p-\d{8}-\d{2})$/;
  for (const call of room.calls) assert.match(call.url, fetchOk);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  await room.hashchange("#/");
  assert.equal(room.clock.pending(), 0);
  const after = room.calls.length;
  await room.clock.tick(5 * REPLAY_STEP_MS);
  assert.equal(room.calls.length, after);
  assert.equal(room.clock.pending(), 0);
}

test("R15 wiring", async () => {
  const http = await readFile(join(root, "src/server/http.ts"), "utf8");
  assert.match(http, /"\/replay\.js", "\/replay\.css"/);
  const html = await readFile(join(root, "src/ui/index.html"), "utf8");
  const styles = [...html.matchAll(/href="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/src="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(styles, ["styles.css", "timeline.css", "lessons.css", "replay.css"]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "app.js"]);
});

test("R16 replay.js source rules", async () => {
  const source = await readFile(join(root, "src/ui/replay.js"), "utf8");
  const banned = ["fetch(", "Date", "requestAnimationFrame", "localStorage", "sessionStorage", "document.cookie", "XMLHttpRequest", "WebSocket", "sendBeacon", "/test/", "history.", "location.hash ="];
  for (const word of banned) assert.equal(source.includes(word), false, word);
  assert.match(source, /globalThis\.draftDayReplay\s*=/);
});

test("R17 replay.css rules", async () => {
  const css = await readFile(join(root, "src/ui/replay.css"), "utf8");
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(clean), false);
  assert.equal(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(clean), false);
  assert.equal(/@import|url\(\s*['"]?http/i.test(clean), false);
  assert.equal(/transition|animation/.test(clean), false);
  const named = new Set(["black", "white", "red", "green", "blue", "gray", "grey", "orange", "yellow", "purple", "pink", "brown", "cyan", "magenta", "navy", "teal", "olive", "maroon", "silver", "lime", "aqua", "fuchsia"]);
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const problems: string[] = [];
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const line of (block[1] ?? "").split(";")) {
      const split = line.indexOf(":");
      if (split < 0) continue;
      const prop = line.slice(0, split).trim();
      const value = line.slice(split + 1);
      if (!colorProp.test(prop)) continue;
      const bare = value.replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/g, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) if (named.has(word.toLowerCase())) problems.push(`${prop} ${word}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("R18 fixtures match the server", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-replay-"));
  const logs: Array<[string, string]> = [
    ["p-20261017-93", join(root, "test/fixtures/replay/p-20261017-93.events.jsonl")],
    ["p-20261017-94", join(root, "test/fixtures/replay/p-20261017-94.events.jsonl")],
    ["p-20261017-98", join(root, "test/fixtures/replay/p-20261017-98.events.jsonl")],
    ["p-20261017-99", join(root, "test/fixtures/replay/p-20261017-99.events.jsonl")],
    ["p-20261010-07", join(root, "test/fixtures/timeline/p-20261010-07.events.jsonl")],
  ];
  for (const [id, file] of logs) {
    const dir = join(data, "picks", id);
    await mkdir(dir, { recursive: true });
    await copyFile(file, join(dir, "events.jsonl"));
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
      const body = await response.json() as { timeline: TimelineView };
      assert.deepEqual(body.timeline, picks[id]!.timeline);
    }
    const script = await fetch(`${server.url}/replay.js`);
    const style = await fetch(`${server.url}/replay.css`);
    assert.equal(script.status, 200);
    assert.equal(style.status, 200);
    assert.match(script.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(style.headers.get("content-type") ?? "", /text\/css/);
  } finally {
    await server.close();
  }
});
