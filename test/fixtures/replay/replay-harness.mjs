// Draft Day Pick 5 (SPEC 006): the Replay harness. Commit byte-identical as test/fixtures/replay/replay-harness.mjs
// (with replay-harness.d.mts next to it). It wraps ../phone/dom-harness.mjs (Pick 4, unchanged): the same
// node:vm War Room, plus a fake clock, pick bodies served from test/fixtures/replay/*.pick.json, and the
// SPEC 006 frame rule as code (frameAt) so a test can compare the page against it event by event.
// It never opens a socket and never imports src/: it reads files and runs the page's own scripts.
//
// loadReplay(options)
//   options.root      repo root holding src/ui and test/fixtures/replay (default process.cwd())
//   options.picks     { [pickId]: body } served by GET /api/picks/<id> (default: every *.pick.json in the
//                     fixtures directory, keyed by the body's id); other ids answer 404 {error:"pick not found"}
//   options.fixtures  directory holding the *.pick.json files (default <root>/test/fixtures/replay)
//   options.hash      the hash to open, e.g. "#/picks/p-20261017-94/replay?at=11" (default "#/")
// The page first loads at "#/" (Pick 4 harness), then the fake clock and the pick server are installed,
// then options.hash is opened with a hashchange, exactly like a user following a link.
// Returns the Pick 4 WarRoom object plus:
//   clock.tick(ms)    advance the fake clock, firing due setTimeout/setInterval callbacks in time order
//   clock.pending()   how many timers are scheduled right now; clock.now() the fake time in ms
//   setPick(id, body) change what GET /api/picks/<id> answers (then call emit() for a live update)
//   snapshot()        the Replay DOM as data (see snapshot below), or null when no Replay article is shown
//   press(name)       focus the button with that accessible name, click it, settle
//   scrub(n)          focus the Event slider, set its value to n, fire "input", settle
//   active()          the accessible name of document.activeElement ("" when it is not inside #app)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accessibleName, byName, find, findAll, loadWarRoom, response, text } from "../phone/dom-harness.mjs";

export { accessibleName, byName, find, findAll, response, text };

/** SPEC 006: Play advances exactly one event per REPLAY_STEP_MS of clock time. */
export const REPLAY_STEP_MS = 1000;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);

/** Every *.pick.json body in a directory, keyed by pick id. */
export function readPicks(dir) {
  const out = {};
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".pick.json")) continue;
    const body = JSON.parse(readFileSync(join(dir, name), "utf8"));
    out[body.id] = body;
  }
  return out;
}

/**
 * The SPEC 006 frame rule. view is pick.timeline; index is 0-based (the page says "Event index+1 of N").
 * Uses only fields the server already sends; never formats a duration itself.
 */
export function frameAt(view, index) {
  const entries = view.entries;
  const n = entries.length;
  const e = entries[index];
  if (!e) throw new Error(`frameAt: no entry at index ${index} (have ${n})`);
  const last = index === n - 1;
  const over = TERMINAL.has(e.status) || (last && !view.live);
  const runs = view.runs.filter((r) => r.startSeq !== null && r.startSeq <= e.seq).map((r) => {
    let state = "running";
    if (r.endSeq !== null && r.endSeq <= e.seq) state = r.outcome;
    else if (r.outcome === "abandoned" && over) state = "abandoned";
    return { id: r.id, state, text: state === "running" ? `${r.label} · running` : `${r.label} · ${state} · ${r.durationText}` };
  });
  const shown = view.stages.filter((s) => (s.firstSeq !== null ? s.firstSeq <= e.seq : last && !view.live));
  const stages = shown.map((s, i) => {
    const current = i === shown.length - 1;
    return { stage: s.stage, current, text: current ? s.stage : `${s.stage} ${s.durationText}` };
  });
  const plays = entries.slice(0, index + 1).reverse().map((x) => ({ seq: x.seq, current: x.seq === e.seq, head: `+${x.sinceStartText} ${x.title}` }));
  const links = (e.links || []).map((l) => ({ label: l.label, href: l.href }));
  return {
    seq: e.seq,
    clock: `+${e.sinceStartText}`,
    status: e.status,
    stage: e.stage,
    counter: `Event ${index + 1} of ${n}`,
    caption: [e.title, ...links.map((l) => l.label)].join(" "),
    links,
    slider: { min: "1", max: String(n), value: String(index + 1), valuetext: `Event ${index + 1} of ${n} · +${e.sinceStartText} · ${e.title}` },
    runs,
    stages,
    plays,
  };
}

const attr = (node, name) => (node ? node.getAttribute(name) : null);

/** The Replay DOM as data. root = the page's #app element. */
export function snapshot(root) {
  const replay = find(root, (n) => n.tagName === "ARTICLE" && n.getAttribute("aria-label") === "Replay");
  if (!replay) return null;
  const part = (name) => find(replay, (n) => n.getAttribute("data-replay") === name);
  const caption = part("caption");
  const statusBox = part("status");
  const statusChip = statusBox ? find(statusBox, (n) => n.classList.contains("chip")) : null;
  const slider = find(replay, (n) => n.tagName === "INPUT" && n.getAttribute("aria-label") === "Event");
  const list = (name) => find(replay, (n) => n.getAttribute("aria-label") === name);
  const items = (name) => (list(name) ? list(name).children.filter((n) => n.tagName === "LI") : []);
  return {
    pickId: attr(replay, "data-pick-id"),
    seq: Number(attr(replay, "data-seq")),
    clock: text(part("clock")),
    status: attr(statusChip, "data-status"),
    statusText: text(statusChip),
    stage: text(part("stage")),
    counter: text(part("counter")),
    caption: text(caption),
    captionLive: attr(caption, "aria-live"),
    links: caption ? findAll(caption, (n) => n.tagName === "A").map((a) => ({ label: text(a), href: attr(a, "href"), target: attr(a, "target"), rel: attr(a, "rel") })) : [],
    slider: slider ? { type: attr(slider, "type"), min: attr(slider, "min"), max: attr(slider, "max"), value: slider.value, valuetext: attr(slider, "aria-valuetext") } : null,
    runs: items("Runs so far").map((li) => ({ id: attr(li, "data-run"), state: attr(li, "data-state"), text: text(li) })),
    stages: items("Stages so far").map((li) => ({ stage: attr(li, "data-stage"), current: attr(li, "aria-current") === "step", text: text(li) })),
    plays: items("Play by play").map((li) => ({ seq: Number(attr(li, "data-seq")), current: attr(li, "aria-current") === "true", event: li.classList.contains("dd-event"), text: text(li) })),
  };
}

/** Differences between a snapshot and frameAt(view, index), as readable strings ([] = the frame is right). */
export function compareFrame(snap, want) {
  if (!snap) return ["no Replay article"];
  const out = [];
  const eq = (what, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${what}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
  eq("seq", snap.seq, want.seq);
  eq("clock", snap.clock, want.clock);
  eq("status", snap.status, want.status);
  eq("statusText", snap.statusText, want.status);
  eq("stage", snap.stage, want.stage);
  eq("counter", snap.counter, want.counter);
  eq("caption", snap.caption, want.caption);
  eq("captionLive", snap.captionLive, "polite");
  eq("links", snap.links.map((l) => ({ label: l.label, href: l.href })), want.links);
  for (const l of snap.links) if (l.target !== "_blank" || l.rel !== "noopener noreferrer") out.push(`link ${l.label}: target/rel ${l.target}/${l.rel}`);
  eq("slider", snap.slider && { type: snap.slider.type, min: snap.slider.min, max: snap.slider.max, value: snap.slider.value, valuetext: snap.slider.valuetext }, { type: "range", ...want.slider });
  eq("runs", snap.runs, want.runs);
  eq("stages", snap.stages, want.stages.map((s) => ({ stage: s.stage, current: s.current, text: s.text })));
  eq("plays.seq", snap.plays.map((p) => p.seq), want.plays.map((p) => p.seq));
  eq("plays.current", snap.plays.map((p) => p.current), want.plays.map((p) => p.current));
  for (const [i, p] of snap.plays.entries()) {
    if (!p.event) out.push(`play ${p.seq}: li lacks class dd-event`);
    const head = want.plays[i]?.head;
    if (head && !p.text.startsWith(head)) out.push(`play ${p.seq}: text ${JSON.stringify(p.text.slice(0, 80))} does not start with ${JSON.stringify(head.slice(0, 80))}`);
  }
  return out;
}

function fakeClock(flush) {
  let now = 0;
  let next = 1;
  const timers = new Map();
  const add = (fn, ms, args, every) => {
    const id = next++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + (every ? Math.max(1, delay) : delay), fn, args, every: every ? Math.max(1, delay) : 0 });
    return id;
  };
  return {
    setTimeout: (fn, ms, ...args) => add(fn, ms, args, false),
    setInterval: (fn, ms, ...args) => add(fn, ms, args, true),
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    now: () => now,
    pending: () => timers.size,
    async tick(ms) {
      const end = now + Math.max(0, ms);
      for (let guard = 0; guard < 100000; guard += 1) {
        let dueId = null;
        let due = null;
        for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due.at)) { dueId = id; due = t; }
        if (!due) break;
        now = due.at;
        if (due.every) due.at += due.every; else timers.delete(dueId);
        if (typeof due.fn === "function") due.fn(...due.args);
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

export async function loadReplay(options = {}) {
  const root = options.root ?? process.cwd();
  const picks = { ...(options.picks ?? readPicks(options.fixtures ?? join(root, "test", "fixtures", "replay"))) };
  const board = {
    picks: Object.values(picks).map((p) => ({ id: p.id, idea: p.idea, status: p.status, stage: p.stage, target: p.target, runs: p.timeline?.runs?.length ?? 0, failReason: p.failReason ?? null, updatedAt: p.timeline?.endedAt ?? "2026-10-17T22:00:00.000Z", walkover: false })),
    inbox: [],
  };
  const room = await loadWarRoom({ root, board, hash: "#/" });
  const original = room.ctx.fetch;
  room.ctx.fetch = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const m = /^\/api\/picks\/([^/?#]+)$/.exec(String(url));
    if (method === "GET" && m) {
      room.calls.push({ url: String(url), method, headers: init.headers ?? null, body: init.body ?? null, json: null });
      const body = picks[decodeURIComponent(m[1])];
      return body ? response(200, body) : response(404, { error: "pick not found" });
    }
    return original(url, init);
  };
  const clock = fakeClock(room.flush);
  room.ctx.setTimeout = clock.setTimeout;
  room.ctx.setInterval = clock.setInterval;
  room.ctx.clearTimeout = clock.clearTimeout;
  room.ctx.clearInterval = clock.clearInterval;
  if (room.ctx.window) {
    room.ctx.window.setTimeout = clock.setTimeout;
    room.ctx.window.clearTimeout = clock.clearTimeout;
    room.ctx.window.setInterval = clock.setInterval;
    room.ctx.window.clearInterval = clock.clearInterval;
  }
  await room.hashchange(options.hash ?? "#/");
  const doc = room.document;
  const named = (name, tags) => byName(room.app, name, tags);
  return Object.assign(room, {
    clock,
    setPick: (id, body) => { if (body === null) delete picks[id]; else picks[id] = body; },
    snapshot: () => snapshot(room.app),
    press: async (name) => {
      const b = named(name, ["BUTTON"]);
      if (!b) throw new Error(`replay-harness: no button named ${name}`);
      b.focus();
      b.dispatch("click");
      await room.flush();
    },
    scrub: async (n) => {
      const s = named("Event", ["INPUT"]);
      if (!s) throw new Error("replay-harness: no Event slider");
      s.focus();
      s.value = String(n);
      s.dispatch("input");
      await room.flush();
    },
    active: () => (doc.activeElement && room.app.contains(doc.activeElement) ? accessibleName(room.app, doc.activeElement) : ""),
  });
}
