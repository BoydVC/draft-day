// SPEC 006 pooled cross-tests. Expected values are the spec's literals and frameAt().
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { timeline, type DraftEvent, type Timeline } from "../src/core/index.ts";
import { startServer } from "../src/server/http.ts";
import {
  accessibleName,
  byName,
  compareFrame,
  find,
  findAll,
  frameAt,
  loadReplay,
  readPicks,
  text,
  type FakeElement,
  type PickBody,
  type ReplayRoom,
  type TimelineView,
} from "./fixtures/replay/replay-harness.mjs";

const root = process.cwd();
const picks = readPicks(join(root, "test", "fixtures", "replay"));
const IDS = ["p-20261017-94", "p-20261017-93", "p-20261017-98", "p-20261017-99", "p-20261010-07"] as const;
const DOT = "\u00b7";
const MARK = '"><img src=x onerror=alert(1)>';
const JS_URL = "javascript:alert(1)";
const LONG = "Z".repeat(2000);
const LESSON_IMG = '<img src=x onerror="alert(4)">';
const HREF = /^(#\/|https:\/\/cursor\.com\/agents\/bc-[0-9a-f-]+$|https:\/\/github\.com\/BoydVC\/draft-day\/(pull|commit)\/)/;
const NAMED = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" "),
);

function viewOf(id: string): TimelineView {
  const body = picks[id];
  assert.ok(body, id);
  return body.timeline;
}

function open(hash: string): Promise<ReplayRoom> {
  return loadReplay({ root, hash });
}

function assertFrame(room: ReplayRoom, view: TimelineView, index: number): void {
  const diffs = compareFrame(room.snapshot(), frameAt(view, index));
  assert.deepEqual(diffs, [], diffs.join("\n"));
}

function snap(room: ReplayRoom) {
  const shot = room.snapshot();
  assert.ok(shot, "Replay article");
  return shot;
}

function controls(room: ReplayRoom): FakeElement {
  const group = find(room.app, (node) => node.getAttribute("role") === "group" && node.getAttribute("aria-label") === "Replay controls");
  assert.ok(group, "replay controls");
  return group;
}

function buttons(room: ReplayRoom): FakeElement[] {
  return findAll(controls(room), (node) => node.tagName === "BUTTON");
}

function buttonNames(room: ReplayRoom): string[] {
  return buttons(room).map((node) => accessibleName(room.app, node));
}

function assertPaused(room: ReplayRoom): void {
  assert.equal(room.clock.pending(), 0);
  assert.ok(byName(room.app, "Play", ["BUTTON"]), "Play");
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), null);
}

function assertPlaying(room: ReplayRoom): void {
  assert.equal(room.clock.pending(), 1);
  assert.equal(byName(room.app, "Play", ["BUTTON"]), null);
  assert.ok(byName(room.app, "Pause", ["BUTTON"]), "Pause");
}

function part(room: ReplayRoom, name: string): FakeElement {
  const node = find(room.app, (item) => item.getAttribute("data-replay") === name);
  assert.ok(node, name);
  return node;
}

function poison(room: ReplayRoom): string[] {
  const found: string[] = [];
  for (const node of findAll(room.app, () => true)) {
    if (node.tagName === "IMG" || node.tagName === "SCRIPT" || node.tagName === "IFRAME") found.push(node.tagName);
    for (const name of node.attributes.keys()) {
      if (name.startsWith("on")) found.push(`${node.tagName}:${name}`);
    }
  }
  return found;
}

function assertHrefs(room: ReplayRoom): void {
  for (const node of findAll(room.app, (item) => item.tagName === "A")) {
    const href = node.getAttribute("href") ?? "";
    assert.match(href, HREF, href);
    assert.equal(href.toLowerCase().includes("javascript:"), false, href);
  }
}

function mustTimeline(events: DraftEvent[], now: number): Timeline {
  const view = timeline(events, now);
  assert.ok(view);
  return view;
}

function bodyFor(id: string, idea: string, view: Timeline): PickBody {
  return { id, idea, status: view.status, stage: view.stage, timeline: view as unknown as TimelineView };
}

async function loadEvents(name: string): Promise<DraftEvent[]> {
  const raw = await readFile(join(root, "test/fixtures/replay", name), "utf8");
  return raw.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as DraftEvent);
}

test("R1 opens at frame 1", async () => {
  for (const id of IDS) {
    const room = await open(`#/picks/${id}/replay`);
    const articles = findAll(room.app, (node) => node.tagName === "ARTICLE" && node.getAttribute("aria-label") === "Replay");
    assert.equal(articles.length, 1, id);
    assert.equal(articles[0]?.getAttribute("data-pick-id"), id);
    assert.equal(findAll(room.app, (node) => node.classList.contains("chip")).length, 1, id);
    assertPaused(room);
    assertFrame(room, viewOf(id), 0);
  }
  const room = await open("#/picks/p-20261017-94/replay");
  const shot = snap(room);
  assert.equal(shot.clock, "+0s");
  assert.equal(shot.status, "intake");
  assert.equal(shot.statusText, "intake");
  assert.equal(shot.stage, "Intake");
  assert.equal(shot.counter, "Event 1 of 20");
  assert.equal(shot.caption, "Pick created from plan, and the pick is in Intake.");
  assert.deepEqual(shot.runs, []);
  assert.deepEqual(shot.stages, [{ stage: "Intake", current: true, text: "Intake" }]);
});

test("R2 deep links and play=1", async () => {
  const view = viewOf("p-20261017-94");
  const at11 = await open("#/picks/p-20261017-94/replay?at=11");
  assertPaused(at11);
  assertFrame(at11, view, 10);
  const mid = snap(at11);
  assert.equal(mid.clock, "+2h 53m");
  assert.equal(mid.status, "judging");
  assert.equal(mid.stage, "Film Room");
  assert.equal(mid.counter, "Event 11 of 20");
  assert.equal(mid.caption, "Film Room pass 1 scored 3 cards and the judge named c1.");
  assert.deepEqual(mid.runs.map((run) => run.text), [
    `c1 attempt 1 ${DOT} finished ${DOT} 19m`,
    `c2 attempt 1 ${DOT} finished ${DOT} 19m`,
    `c3 attempt 1 ${DOT} finished ${DOT} 18m`,
    `Film Room pass 1 ${DOT} scored ${DOT} 33m`,
  ]);
  assert.deepEqual(mid.stages.map((stage) => stage.text), ["Intake 37m", "Scouting Report 1h 21m", "Combine 22m", "Film Room"]);

  const at20 = await open("#/picks/p-20261017-94/replay?at=20");
  assertPaused(at20);
  assertFrame(at20, view, 19);
  const end = snap(at20);
  assert.equal(end.clock, "+3h 41m");
  assert.equal(end.status, "drafted");
  assert.equal(end.stage, "Draft Pick");
  assert.equal(end.counter, "Event 20 of 20");
  assert.equal(end.caption, "Pull request #6 is confirmed as a draft, and the stage changed from Physical to Draft Pick. PR #6");
  assert.equal(end.runs.at(-1)?.text, `Physical ${DOT} not_verified ${DOT} 12m`);
  assert.equal(end.runs.length, 7);
  assert.deepEqual(end.stages.slice(-2).map((stage) => stage.text), ["Physical 17m", "Draft Pick"]);

  for (const hash of ["#/picks/p-20261017-94/replay?at=999", "#/picks/p-20261017-94/replay?at=x"]) {
    const room = await open(hash);
    assertPaused(room);
    assertFrame(room, view, 0);
  }

  const quiet = await open("#/picks/p-20261017-94/replay?at=11&play=0");
  assertPaused(quiet);
  assertFrame(quiet, view, 10);
  await quiet.clock.tick(1000);
  assertFrame(quiet, view, 10);

  const ordered = await open("#/picks/p-20261017-94/replay?play=1&at=11");
  assertPlaying(ordered);
  assertFrame(ordered, view, 10);
  await ordered.clock.tick(9 * 1000);
  assertFrame(ordered, view, 19);
  assertPaused(ordered);

  const playing = await open("#/picks/p-20261017-94/replay?play=1");
  assertPlaying(playing);
  assertFrame(playing, view, 0);
  await playing.clock.tick((view.entries.length - 1) * 1000);
  assertFrame(playing, view, view.entries.length - 1);
  assert.equal(snap(playing).counter, "Event 20 of 20");
  assertPaused(playing);
});

test("R3 every frame of every fixture", async () => {
  let frames = 0;
  for (const id of IDS) {
    const view = viewOf(id);
    frames += view.entries.length;
    const room = await open(`#/picks/${id}/replay`);
    for (let index = 0; index < view.entries.length; index += 1) {
      assertFrame(room, view, index);
      if (index < view.entries.length - 1) await room.press("Next event");
    }
  }
  assert.equal(frames, 93);
  const failed = await open("#/picks/p-20261017-98/replay?at=9");
  const shot = snap(failed);
  assert.equal(shot.counter, "Event 9 of 9");
  assert.ok(shot.runs.some((run) => run.text === `c2 attempt 1 ${DOT} abandoned ${DOT} 34m`));
  assert.deepEqual(shot.stages.map((stage) => stage.text), ["Intake 37m", "Scouting Report 1h 21m", "Combine 35m", "Failed"]);
  assertFrame(failed, viewOf("p-20261017-98"), 8);
});

test("R4 controls", async () => {
  const view = viewOf("p-20261017-94");
  const room = await open("#/picks/p-20261017-94/replay");
  assert.deepEqual(buttonNames(room), ["First event", "Previous event", "Play", "Next event", "Last event"]);
  const sliders = findAll(controls(room), (node) => node.tagName === "INPUT");
  assert.equal(sliders.length, 1);
  assert.equal(sliders[0]?.getAttribute("type"), "range");
  assert.equal(sliders[0]?.getAttribute("min"), "1");
  assert.equal(sliders[0]?.getAttribute("step"), "1");
  assert.equal(sliders[0]?.getAttribute("aria-label"), "Event");
  const named = (name: string) => {
    const node = byName(room.app, name, ["BUTTON"]);
    assert.ok(node, name);
    return node;
  };
  assert.equal(named("First event").disabled, true);
  assert.equal(named("Previous event").disabled, true);
  assert.equal(named("Next event").disabled, false);
  assert.equal(named("Last event").disabled, false);

  await room.press("Last event");
  assertFrame(room, view, 19);
  assert.equal(named("Next event").disabled, true);
  assert.equal(named("Last event").disabled, true);
  assert.equal(named("First event").disabled, false);
  assert.equal(named("Previous event").disabled, false);
  assertPaused(room);

  await room.press("Previous event");
  assertFrame(room, view, 18);
  for (const name of ["First event", "Previous event", "Next event", "Last event"]) assert.equal(named(name).disabled, false);

  await room.press("First event");
  assertFrame(room, view, 0);
  assert.equal(named("First event").disabled, true);
  assert.equal(named("Previous event").disabled, true);

  await room.scrub(17);
  assertFrame(room, view, 16);
  assert.equal(snap(room).counter, "Event 17 of 20");
  assertPaused(room);
  assert.deepEqual(buttonNames(room), ["First event", "Previous event", "Play", "Next event", "Last event"]);
});

test("R5 play", async () => {
  const view = viewOf("p-20261017-94");
  const room = await open("#/picks/p-20261017-94/replay");
  const playButton = byName(room.app, "Play", ["BUTTON"]);
  assert.ok(playButton);
  await room.press("Play");
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), playButton);
  assert.equal(accessibleName(room.app, playButton), "Pause");
  assertPlaying(room);
  assertFrame(room, view, 0);
  await room.clock.tick(999);
  assertFrame(room, view, 0);
  assertPlaying(room);
  await room.clock.tick(1);
  assertFrame(room, view, 1);
  assertPlaying(room);
  await room.clock.tick(18 * 1000);
  assertFrame(room, view, 19);
  assert.equal(byName(room.app, "Play", ["BUTTON"]), playButton);
  assert.equal(accessibleName(room.app, playButton), "Play");
  assertPaused(room);

  await room.press("Play");
  assertFrame(room, view, 0);
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), playButton);
  assertPlaying(room);

  const events = await loadEvents("p-20261017-94.events.jsonl");
  const one = mustTimeline(events.slice(0, 1), Date.parse("2026-10-17T18:11:30.075Z"));
  const solo = await open("#/");
  solo.setPick("p-20261017-01", bodyFor("p-20261017-01", "one event", one));
  await solo.hashchange("#/picks/p-20261017-01/replay");
  assertFrame(solo, one as unknown as TimelineView, 0);
  await solo.press("Play");
  assertFrame(solo, one as unknown as TimelineView, 0);
  assertPaused(solo);
  await solo.clock.tick(2000);
  assertFrame(solo, one as unknown as TimelineView, 0);
  assertPaused(solo);
});

test("R6 manual moves pause", async () => {
  const view = viewOf("p-20261017-94");
  const room = await open("#/picks/p-20261017-94/replay?at=11");
  await room.press("Play");
  await room.clock.tick(250);
  await room.press("Next event");
  assertPaused(room);
  assertFrame(room, view, 11);

  await room.press("Play");
  await room.clock.tick(250);
  await room.press("Previous event");
  assertPaused(room);
  assertFrame(room, view, 10);

  await room.press("Play");
  await room.clock.tick(250);
  await room.press("First event");
  assertPaused(room);
  assertFrame(room, view, 0);

  await room.press("Next event");
  await room.press("Play");
  await room.clock.tick(250);
  await room.press("Last event");
  assertPaused(room);
  assertFrame(room, view, 19);

  await room.hashchange("#/picks/p-20261017-94/replay?at=11");
  await room.press("Play");
  await room.clock.tick(250);
  await room.scrub(17);
  assertPaused(room);
  assertFrame(room, view, 16);
});

test("R7 live updates keep the film", async () => {
  const view = viewOf("p-20261017-94");
  const room = await open("#/picks/p-20261017-94/replay?at=11");
  await room.press("Play");
  assertPlaying(room);
  assert.equal(snap(room).counter, "Event 11 of 20");
  await room.clock.tick(500);
  assert.equal(snap(room).counter, "Event 11 of 20");
  await room.emit();
  await room.emit();
  await room.emit();
  assertPlaying(room);
  assert.equal(snap(room).counter, "Event 11 of 20");
  assertFrame(room, view, 10);
  await room.clock.tick(500);
  assertPlaying(room);
  assert.equal(snap(room).counter, "Event 12 of 20");
  assertFrame(room, view, 11);

  await room.press("Pause");
  assertPaused(room);
  assert.equal(snap(room).counter, "Event 12 of 20");
  await room.emit();
  await room.emit();
  assertPaused(room);
  assert.equal(snap(room).counter, "Event 12 of 20");
  assertFrame(room, view, 11);
});

test("R8 same nodes, same focus", async () => {
  const room = await open("#/picks/p-20261017-94/replay?at=11");
  const caption = part(room, "caption");
  const next = byName(room.app, "Next event", ["BUTTON"]);
  assert.ok(next);
  await room.press("Next event");
  assert.equal(part(room, "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assert.equal(room.active(), "Next event");
  assert.equal(snap(room).counter, "Event 12 of 20");

  await room.press("Play");
  const pause = byName(room.app, "Pause", ["BUTTON"]);
  assert.ok(pause);
  assert.equal(room.active(), "Pause");
  assert.equal(part(room, "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  await room.clock.tick(1000);
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), pause);
  assert.equal(room.active(), "Pause");
  assert.equal(part(room, "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assert.equal(snap(room).counter, "Event 13 of 20");

  await room.emit();
  assert.equal(byName(room.app, "Pause", ["BUTTON"]), pause);
  assert.equal(room.active(), "Pause");
  assert.equal(part(room, "caption"), caption);
  assert.equal(byName(room.app, "Next event", ["BUTTON"]), next);
  assertPlaying(room);

  const last = byName(room.app, "Last event", ["BUTTON"]);
  assert.ok(last);
  next.focus();
  assert.equal(room.active(), "Next event");
  last.dispatch("click");
  await room.flush();
  assert.equal(room.active(), "Event");
  assert.equal(part(room, "caption"), caption);
  assert.equal(snap(room).counter, "Event 20 of 20");
});

test("R9 live and synthetic stages", async () => {
  const events = await loadEvents("p-20261017-94.events.jsonl");
  const liveNow = Date.parse("2026-10-17T21:10:00Z");
  const twelve = mustTimeline(events.slice(0, 12), liveNow);
  const thirteen = mustTimeline(events.slice(0, 13), liveNow);
  const room = await open("#/");
  room.setPick("p-20261017-94", bodyFor("p-20261017-94", picks["p-20261017-94"]?.idea ?? "", twelve));
  await room.hashchange("#/picks/p-20261017-94/replay?at=12");
  assertFrame(room, twelve as unknown as TimelineView, 11);
  const shot = snap(room);
  assert.equal(shot.counter, "Event 12 of 12");
  assert.ok(shot.runs.some((run) => run.text === `Film Room pass 2 ${DOT} running`));

  room.setPick("p-20261017-94", bodyFor("p-20261017-94", picks["p-20261017-94"]?.idea ?? "", thirteen));
  await room.emit();
  assert.equal(snap(room).counter, "Event 12 of 13");
  assertFrame(room, thirteen as unknown as TimelineView, 11);
  await room.press("Next event");
  assert.equal(snap(room).counter, "Event 13 of 13");
  assertFrame(room, thirteen as unknown as TimelineView, 12);

  const timeout = mustTimeline(events.slice(0, 2), Date.parse("2026-10-20T00:00:00Z"));
  const late = await open("#/");
  late.setPick("p-20261017-94", bodyFor("p-20261017-94", "go timeout", timeout));
  await late.hashchange("#/picks/p-20261017-94/replay?at=2");
  assertFrame(late, timeout as unknown as TimelineView, 1);
  assert.deepEqual(snap(late).stages.map((stage) => stage.text), ["Intake 37m", "Scouting Report 2d 0h", "Cancelled"]);
  await late.hashchange("#/picks/p-20261017-94/replay?at=1");
  assertFrame(late, timeout as unknown as TimelineView, 0);
  assert.deepEqual(snap(late).stages.map((stage) => stage.text), ["Intake"]);
});

test("R10 requests", async () => {
  const room = await open("#/picks/p-20261017-94/replay?at=4");
  const url = "/api/picks/p-20261017-94";
  const gets = () => room.calls.filter((call) => call.method === "GET" && call.url === url).length;
  assert.equal(gets(), 1);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
  await room.press("Play");
  await room.clock.tick(3000);
  await room.press("Pause");
  await room.press("Next event");
  await room.press("Previous event");
  await room.scrub(6);
  await room.clock.tick(2000);
  assert.equal(gets(), 1);
  await room.emit();
  assert.equal(gets(), 2);
  await room.emit();
  assert.equal(gets(), 3);
  assert.equal(room.sources.length, 1);
  assert.equal(room.sources[0]?.url, "/api/events");
});

test("R11 leaving stops play", async () => {
  const room = await open("#/picks/p-20261017-94/replay?at=4&play=1");
  assert.equal(room.clock.pending(), 1);
  await room.hashchange("#/");
  assert.equal(room.snapshot(), null);
  assert.equal(room.clock.pending(), 0);
  const afterBoard = room.calls.length;
  await room.clock.tick(4000);
  assert.equal(room.calls.length, afterBoard);
  assert.equal(room.clock.pending(), 0);

  await room.hashchange("#/picks/p-20261017-94/replay?at=4&play=1");
  assert.equal(room.clock.pending(), 1);
  await room.hashchange("#/picks/p-20261017-94");
  assert.equal(room.snapshot(), null);
  assert.equal(room.clock.pending(), 0);
  const afterPick = room.calls.length;
  await room.clock.tick(4000);
  assert.equal(room.calls.length, afterPick);
  assert.equal(room.clock.pending(), 0);
});

test("R12 links", async () => {
  const pick = await open("#/picks/p-20261017-94");
  const replay = byName(pick.app, "Replay", ["A"]);
  assert.ok(replay);
  assert.equal(replay.getAttribute("href"), "#/picks/p-20261017-94/replay");

  const room = await open("#/picks/p-20261017-98/replay");
  const back = byName(room.app, "Pick page", ["A"]);
  const board = byName(room.app, "Big Board", ["A"]);
  assert.ok(back);
  assert.ok(board);
  assert.equal(back.getAttribute("href"), "#/picks/p-20261017-98");
  assert.equal(board.getAttribute("href"), "#/");
});

test("R13 unknown pick", async () => {
  const hashes = [
    "#/picks/p-20261017-55/replay",
    "#/picks/p-20261017-55/replay?at=11&play=1",
    "#/picks/p-20990101-44/replay?play=1",
    "#/picks/p-20261017-55/replay?at=\"><img src=x onerror=alert(9)>&play='><svg onload=alert(8)>",
  ];
  for (const hash of hashes) {
    const room = await open(hash);
    assert.equal(room.snapshot(), null, hash);
    assert.equal(room.clock.pending(), 0, hash);
    assert.equal(text(room.app).includes("That pick is not on the board."), true, hash);
    const board = byName(room.app, "Big Board", ["A"]);
    assert.ok(board, hash);
    assert.equal(board.getAttribute("href"), "#/");
    assert.deepEqual(poison(room), [], hash);
    for (const call of room.calls) assert.equal(/^[a-z][a-z0-9+.-]*:/i.test(call.url), false, call.url);
    const before = room.calls.length;
    await room.clock.tick(2000);
    assert.equal(room.clock.pending(), 0);
    assert.equal(room.calls.length, before);
  }
});

test("R14 hostile text stays text", async () => {
  const id = "p-20261017-99";
  const view = viewOf(id);
  const idea = picks[id]?.idea ?? "";
  assert.equal(idea.includes('<img src=x onerror="alert(1)">'), true);
  assert.equal(idea.includes("<script>alert(2)</script>"), true);
  const room = await open(`#/picks/${id}/replay`);
  for (let index = 0; index < view.entries.length; index += 1) {
    assertFrame(room, view, index);
    assert.deepEqual(poison(room), []);
    assertHrefs(room);
    const c2 = find(room.app, (node) => node.getAttribute("data-run") === "c2#1");
    if (c2) assert.equal(findAll(c2, (node) => node.tagName === "A").length, 0);
    if (index < view.entries.length - 1) await room.press("Next event");
  }
  const shown = text(room.app);
  assert.equal(shown.includes(idea), true);
  assert.equal(shown.includes(LESSON_IMG), true);
  assert.equal(shown.includes('href="javascript:alert(5)"'), true);

  const hostile = JSON.parse(JSON.stringify(picks[id])) as PickBody;
  hostile.idea = MARK;
  hostile.timeline.entries[1]!.title = LONG;
  hostile.timeline.entries[10]!.title = MARK;
  const linked = hostile.timeline.entries.find((entry) => entry.links.length > 0);
  assert.ok(linked);
  linked.links[0]!.label = MARK;
  hostile.timeline.runs[0]!.label = MARK;
  hostile.timeline.entries[0]!.cand = JS_URL;
  hostile.timeline.runs[1]!.id = JS_URL;
  hostile.timeline.runs[1]!.agentId = JS_URL;
  const attack = await open("#/");
  attack.setPick(id, hostile);
  await attack.hashchange(`#/picks/${id}/replay`);
  for (let index = 0; index < hostile.timeline.entries.length; index += 1) {
    assertFrame(attack, hostile.timeline, index);
    assert.deepEqual(poison(attack), []);
    assertHrefs(attack);
    for (const node of findAll(attack.app, (item) => item.tagName === "A")) {
      assert.equal((node.getAttribute("href") ?? "").includes(JS_URL), false);
    }
    if (index < hostile.timeline.entries.length - 1) await attack.press("Next event");
  }
  const attacked = text(attack.app);
  assert.equal(attacked.includes(MARK), true);
  assert.equal(attacked.includes(LONG), true);
});

test("R15 wiring", async () => {
  const html = await readFile(join(root, "src/ui/index.html"), "utf8");
  const sheets = [...html.matchAll(/<link\b[^>]*\bhref="\/([^"]+\.css)"/g)].map((match) => match[1]);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((match) => match[1]);
  assert.deepEqual(sheets, ["styles.css", "timeline.css", "lessons.css", "replay.css", "linter.css", "bigboard.css", "ledger.css"]);
  assert.deepEqual(scripts, ["timeline.js", "lessons.js", "replay.js", "linter.js", "bigboard.js", "ledger.js", "app.js"]);
  const http = await readFile(join(root, "src/server/http.ts"), "utf8");
  const files = [...http.matchAll(/\[[^\]]*\]/g)].map((match) => match[0]).find((list) => list.includes('"/app.js"') && list.includes('"/lessons.css"'));
  assert.ok(files, "static files array");
  assert.match(files, /"\/replay\.js"/);
  assert.match(files, /"\/replay\.css"/);
});

test("R16 replay.js source rules", async () => {
  const source = await readFile(join(root, "src/ui/replay.js"), "utf8");
  const banned = [
    /fetch\s*\(/,
    /\bDate\b/,
    /requestAnimationFrame/,
    /localStorage/,
    /sessionStorage/,
    /document\.cookie/,
    /XMLHttpRequest/,
    /WebSocket/,
    /sendBeacon/,
    /\/test\//,
    /history\./,
    /location\.hash\s*=(?!=)/,
    /innerHTML/,
    /outerHTML/,
    /insertAdjacentHTML/,
    /document\.write/,
    /eval\s*\(/,
    /new\s+Function/,
    /matchMedia/,
    /innerWidth/,
    /outerWidth/,
    /innerHeight/,
    /visualViewport/,
    /screen\./,
    /\bresize\b/,
    /orientationchange/,
  ];
  for (const pattern of banned) assert.doesNotMatch(source, pattern, pattern.source);
  assert.match(source, /globalThis\.draftDayReplay\s*=/);
});

test("R17 replay.css rules", async () => {
  const raw = await readFile(join(root, "src/ui/replay.css"), "utf8");
  assert.doesNotMatch(raw, /@import/i);
  assert.doesNotMatch(raw, /url\(\s*\/\//i);
  assert.doesNotMatch(raw, /url\(\s*https?:/i);
  const clean = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(clean, /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  assert.doesNotMatch(clean, /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
  const colorProp = /^(?:color|background|background-color|border|border-color|border-top|border-right|border-bottom|border-left|outline|outline-color|box-shadow|fill|stroke|caret-color|text-decoration-color|column-rule-color)$/i;
  const named: string[] = [];
  for (const block of clean.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of (block[1] ?? "").split(";")) {
      const cut = part.indexOf(":");
      if (cut <= 0) continue;
      const prop = part.slice(0, cut).trim().toLowerCase();
      if (!colorProp.test(prop)) continue;
      const bare = part.slice(cut + 1).replace(/var\([^)]*\)/g, " ").replace(/transparent|currentColor|inherit/gi, " ");
      for (const word of bare.split(/[^a-zA-Z]+/)) {
        if (NAMED.has(word.toLowerCase())) named.push(`${prop} ${word}`);
      }
    }
  }
  assert.deepEqual(named, []);
  const marker = /@media\s*\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)\s*\{/g;
  let rest = "";
  let cursor = 0;
  for (const match of clean.matchAll(marker)) {
    const start = match.index ?? 0;
    rest += clean.slice(cursor, start);
    const brace = clean.indexOf("{", start);
    let depth = 1;
    let index = brace + 1;
    while (index < clean.length && depth > 0) {
      if (clean[index] === "{") depth += 1;
      else if (clean[index] === "}") depth -= 1;
      index += 1;
    }
    cursor = index;
  }
  rest += clean.slice(cursor);
  const motion: string[] = [];
  for (const block of rest.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of (block[1] ?? "").split(";")) {
      const cut = part.indexOf(":");
      if (cut <= 0) continue;
      const prop = part.slice(0, cut).trim().toLowerCase();
      if (/^(?:transition|animation)\b/.test(prop)) motion.push(prop);
    }
  }
  assert.deepEqual(motion, []);
});

test("R18 fixtures match the server", async () => {
  const data = await mkdtemp(join(tmpdir(), "dd-r18-"));
  const logs: Array<[string, string]> = [
    ["p-20261017-93", "test/fixtures/replay/p-20261017-93.events.jsonl"],
    ["p-20261017-94", "test/fixtures/replay/p-20261017-94.events.jsonl"],
    ["p-20261017-98", "test/fixtures/replay/p-20261017-98.events.jsonl"],
    ["p-20261017-99", "test/fixtures/replay/p-20261017-99.events.jsonl"],
    ["p-20261010-07", "test/fixtures/timeline/p-20261010-07.events.jsonl"],
  ];
  for (const [id, file] of logs) {
    await mkdir(join(data, "picks", id), { recursive: true });
    await writeFile(join(data, "picks", id, "events.jsonl"), await readFile(join(root, file)));
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
      assert.equal(response.status, 200, id);
      const body = await response.json() as { timeline: unknown };
      assert.deepEqual(body.timeline, picks[id]?.timeline, id);
    }
    const js = await fetch(`${server.url}/replay.js`);
    const css = await fetch(`${server.url}/replay.css`);
    assert.equal(js.status, 200);
    assert.equal(css.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /^text\/javascript\b/);
    assert.match(css.headers.get("content-type") ?? "", /^text\/css\b/);
    assert.equal(await js.text(), await readFile(join(root, "src/ui/replay.js"), "utf8"));
    assert.equal(await css.text(), await readFile(join(root, "src/ui/replay.css"), "utf8"));
  } finally {
    await server.close();
  }
});
