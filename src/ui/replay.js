const REPLAY_STEP_MS = 1000;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);

const film = {
  pickId: "",
  view: null,
  idea: "",
  index: 0,
  playing: false,
  timer: null,
  nodes: null,
};

function frameAt(view, index) {
  const entries = view.entries;
  const n = entries.length;
  const entry = entries[index];
  const last = index === n - 1;
  const over = TERMINAL.has(entry.status) || (last && !view.live);
  const runs = view.runs.filter((run) => run.startSeq !== null && run.startSeq <= entry.seq).map((run) => {
    let state = "running";
    if (run.endSeq !== null && run.endSeq <= entry.seq) state = run.outcome;
    else if (run.outcome === "abandoned" && over) state = "abandoned";
    const text = state === "running" ? `${run.label} \u00b7 running` : `${run.label} \u00b7 ${state} \u00b7 ${run.durationText}`;
    return { id: run.id, state, text };
  });
  const shown = view.stages.filter((span) => (span.firstSeq !== null ? span.firstSeq <= entry.seq : last && !view.live));
  const stages = shown.map((span, i) => {
    const current = i === shown.length - 1;
    return { stage: span.stage, current, text: current ? span.stage : `${span.stage} ${span.durationText}` };
  });
  const links = entry.links || [];
  const plays = entries.slice(0, index + 1).reverse().map((item) => ({
    seq: item.seq,
    current: item.seq === entry.seq,
    sinceStartText: item.sinceStartText,
    title: item.title,
    links: item.links || [],
  }));
  return {
    seq: entry.seq,
    clock: `+${entry.sinceStartText}`,
    status: entry.status,
    stage: entry.stage,
    counter: `Event ${index + 1} of ${n}`,
    title: entry.title,
    links,
    slider: {
      max: String(n),
      value: String(index + 1),
      valuetext: `Event ${index + 1} of ${n} \u00b7 +${entry.sinceStartText} \u00b7 ${entry.title}`,
    },
    runs,
    stages,
    plays,
  };
}

function indexForAt(entries, at) {
  if (at == null || at === "") return 0;
  if (!/^\d+$/.test(String(at))) return 0;
  const seq = Number(at);
  const index = entries.findIndex((entry) => entry.seq === seq);
  return index >= 0 ? index : 0;
}

function connected() {
  const root = film.nodes && film.nodes.root;
  const app = document.getElementById("app");
  return Boolean(root && app && app.contains(root));
}

function halt() {
  film.playing = false;
  if (film.timer != null) {
    globalThis.clearTimeout(film.timer);
    film.timer = null;
  }
}

function arm() {
  if (film.timer != null) globalThis.clearTimeout(film.timer);
  film.timer = globalThis.setTimeout(onTick, REPLAY_STEP_MS);
}

function onTick() {
  film.timer = null;
  if (!film.playing || !film.view || !connected()) {
    film.playing = false;
    return;
  }
  const n = film.view.entries.length;
  if (film.index >= n - 1) {
    film.playing = false;
    paint();
    return;
  }
  film.index += 1;
  if (film.index >= n - 1) film.playing = false;
  paint();
  if (film.playing) arm();
}

function start() {
  if (!film.view) return;
  const n = film.view.entries.length;
  if (n <= 1) return;
  if (film.index >= n - 1) film.index = 0;
  film.playing = true;
  arm();
  paint();
}

function stepTo(index) {
  if (!film.view || !film.view.entries.length) return;
  halt();
  const last = film.view.entries.length - 1;
  let next = Number(index);
  if (!Number.isFinite(next)) next = 0;
  if (next < 0) next = 0;
  if (next > last) next = last;
  film.index = next;
  paint();
}

function settleFocus() {
  const active = document.activeElement;
  const nodes = film.nodes;
  if (!active || !nodes || active.disabled !== true) return;
  if (active !== nodes.first && active !== nodes.prev && active !== nodes.play && active !== nodes.next && active !== nodes.last) return;
  nodes.slider.focus();
}

function linkNodes(links) {
  const children = [];
  for (const link of links) {
    children.push(" ");
    children.push(el("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, [link.label]));
  }
  return children;
}

function paint() {
  const nodes = film.nodes;
  const view = film.view;
  if (!nodes || !view || !view.entries.length) return;
  const last = view.entries.length - 1;
  if (film.index > last) film.index = last;
  if (film.index < 0) film.index = 0;
  const frame = frameAt(view, film.index);
  nodes.root.setAttribute("data-pick-id", film.pickId);
  nodes.root.setAttribute("data-seq", String(frame.seq));
  nodes.title.textContent = `Replay \u00b7 ${film.pickId}`;
  nodes.idea.textContent = film.idea;
  nodes.clock.textContent = frame.clock;
  nodes.stage.textContent = frame.stage;
  nodes.counter.textContent = frame.counter;
  nodes.status.replaceChildren(chip(frame.status));
  nodes.caption.replaceChildren(frame.title, ...linkNodes(frame.links));
  nodes.slider.setAttribute("min", "1");
  nodes.slider.setAttribute("max", frame.slider.max);
  nodes.slider.setAttribute("step", "1");
  nodes.slider.setAttribute("aria-valuetext", frame.slider.valuetext);
  nodes.slider.value = frame.slider.value;
  nodes.play.textContent = film.playing ? "Pause" : "Play";
  const onFirst = film.index <= 0;
  const onLast = film.index >= last;
  nodes.first.disabled = onFirst;
  nodes.prev.disabled = onFirst;
  nodes.next.disabled = onLast;
  nodes.last.disabled = onLast;
  nodes.runs.replaceChildren(...frame.runs.map((run) => el("li", {
    class: "replay-lane",
    "data-run": run.id,
    "data-state": run.state,
  }, [run.text])));
  nodes.stages.replaceChildren(...frame.stages.map((span) => el("li", {
    "data-stage": span.stage,
    "aria-current": span.current ? "step" : null,
  }, [span.text])));
  nodes.plays.replaceChildren(...frame.plays.map((item) => el("li", {
    class: "dd-event",
    "data-seq": String(item.seq),
    "aria-current": item.current ? "true" : null,
  }, [`+${item.sinceStartText} ${item.title}`, ...linkNodes(item.links)])));
  settleFocus();
}

function bindStep(button, indexOf) {
  button.addEventListener("click", () => {
    if (button.disabled) return;
    stepTo(indexOf());
  });
}

function build() {
  const first = el("button", { type: "button" }, ["First event"]);
  const prev = el("button", { type: "button" }, ["Previous event"]);
  const play = el("button", { type: "button", class: "replay-play" }, ["Play"]);
  const next = el("button", { type: "button" }, ["Next event"]);
  const last = el("button", { type: "button" }, ["Last event"]);
  const slider = el("input", { type: "range", "aria-label": "Event", min: "1", step: "1" });
  bindStep(first, () => 0);
  bindStep(prev, () => film.index - 1);
  bindStep(next, () => film.index + 1);
  bindStep(last, () => (film.view ? film.view.entries.length - 1 : 0));
  play.addEventListener("click", () => {
    if (play.disabled) return;
    if (film.playing) {
      halt();
      paint();
      return;
    }
    start();
  });
  slider.addEventListener("input", () => {
    stepTo(Number(slider.value) - 1);
  });
  const clock = el("p", { class: "replay-clock", "data-replay": "clock" });
  const status = el("div", { class: "replay-status", "data-replay": "status" });
  const stage = el("p", { class: "replay-stage", "data-replay": "stage" });
  const counter = el("p", { class: "replay-counter", "data-replay": "counter" });
  const caption = el("p", { class: "replay-lower", "data-replay": "caption", "aria-live": "polite" });
  const title = el("h2", { class: "replay-title" });
  const idea = el("p", { class: "replay-idea" });
  const runs = el("ul", { class: "replay-lanes", "aria-label": "Runs so far" });
  const stages = el("ol", { class: "replay-stages", "aria-label": "Stages so far" });
  const plays = el("ol", { class: "replay-plays", "aria-label": "Play by play" });
  const root = el("article", { class: "replay", "aria-label": "Replay", "data-pick-id": film.pickId }, [
    el("p", { class: "replay-links" }, [
      el("a", { href: `#/picks/${film.pickId}` }, ["Pick page"]),
      el("a", { href: "#/" }, ["Big Board"]),
    ]),
    el("header", { class: "replay-ident" }, [title, idea]),
    el("div", { class: "replay-scoreboard" }, [clock, status, stage, counter]),
    caption,
    el("div", { class: "replay-controls", role: "group", "aria-label": "Replay controls" }, [
      slider,
      el("div", { class: "replay-thumb" }, [first, prev, play, next, last]),
    ]),
    el("aside", { class: "replay-field" }, [
      el("h3", {}, ["Runs so far"]),
      runs,
      el("h3", {}, ["Stages so far"]),
      stages,
    ]),
    el("div", { class: "replay-log" }, [
      el("h3", {}, ["Play by play"]),
      plays,
    ]),
  ]);
  return { root, title, idea, clock, status, stage, counter, caption, slider, first, prev, play, next, last, runs, stages, plays };
}

function mount() {
  if (connected() && film.nodes.root.getAttribute("data-pick-id") === film.pickId) return;
  film.nodes = build();
  document.getElementById("app").replaceChildren(film.nodes.root);
}

function missing() {
  halt();
  film.pickId = "";
  film.view = null;
  film.idea = "";
  film.index = 0;
  film.nodes = null;
  document.getElementById("app").replaceChildren(el("section", { class: "panel", "aria-label": "Pick" }, [
    el("h2", {}, ["Pick"]),
    el("p", {}, ["That pick is not on the board."]),
    el("a", { href: "#/" }, ["Big Board"]),
  ]));
}

function leave(where) {
  if (where && where.name === "replay" && where.id === film.pickId && connected()) return;
  halt();
}

function show(where, pick, options) {
  const view = pick && pick.timeline;
  const entries = view && view.entries;
  if (!view || !Array.isArray(entries) || entries.length === 0) {
    missing();
    return;
  }
  const soft = Boolean(options && options.soft);
  if (soft && connected() && film.pickId === where.id) {
    film.view = view;
    film.idea = pick.idea == null ? "" : String(pick.idea);
    const last = entries.length - 1;
    if (film.index > last) film.index = last;
    if (film.index < 0) film.index = 0;
    if (film.playing && entries.length <= 1) halt();
    paint();
    return;
  }
  halt();
  film.pickId = where.id;
  film.view = view;
  film.idea = pick.idea == null ? "" : String(pick.idea);
  film.index = indexForAt(entries, where.at);
  mount();
  paint();
  if (where.play === "1") start();
}

globalThis.draftDayReplay = { leave, show, missing };
