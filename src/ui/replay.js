// Replay paints one frame of a pick's Decision log. The server already computed every clock string.
const REPLAY_STEP_MS = 1000;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);

const playback = { pickId: "", index: 0, playing: false, timer: null };
let film = null;
let nodes = null;

function frameAt(view, index) {
  const entries = view.entries;
  const entry = entries[index];
  const total = entries.length;
  const last = index === total - 1;
  const over = TERMINAL.has(entry.status) || (last && !view.live);
  const runs = [];
  for (const run of view.runs || []) {
    if (run.startSeq === null || !(run.startSeq <= entry.seq)) continue;
    let state = "running";
    if (run.endSeq !== null && run.endSeq <= entry.seq) state = run.outcome;
    else if (run.outcome === "abandoned" && over) state = "abandoned";
    const text = state === "running"
      ? `${run.label} \u00b7 running`
      : `${run.label} \u00b7 ${state} \u00b7 ${run.durationText}`;
    runs.push({ id: run.id, state, text });
  }
  const shown = [];
  for (const span of view.stages || []) {
    const keep = span.firstSeq !== null ? span.firstSeq <= entry.seq : last && !view.live;
    if (keep) shown.push(span);
  }
  const stages = shown.map((span, i) => {
    const current = i === shown.length - 1;
    return { stage: span.stage, current, text: current ? span.stage : `${span.stage} ${span.durationText}` };
  });
  const plays = [];
  for (let i = index; i >= 0; i -= 1) {
    const item = entries[i];
    plays.push({
      seq: item.seq,
      current: item.seq === entry.seq,
      sinceStartText: item.sinceStartText,
      title: item.title,
      links: item.links || [],
    });
  }
  const links = (entry.links || []).map((link) => ({ label: link.label, href: link.href }));
  return {
    seq: entry.seq,
    clock: `+${entry.sinceStartText}`,
    status: entry.status,
    stage: entry.stage,
    counter: `Event ${index + 1} of ${total}`,
    title: entry.title,
    links,
    slider: {
      max: String(total),
      value: String(index + 1),
      valuetext: `Event ${index + 1} of ${total} \u00b7 +${entry.sinceStartText} \u00b7 ${entry.title}`,
    },
    runs,
    stages,
    plays,
  };
}

function mounted(id) {
  const app = document.getElementById("app");
  return Boolean(film && nodes && playback.pickId === id && app && app.contains(nodes.root));
}

function disarm() {
  if (playback.timer != null) {
    clearTimeout(playback.timer);
    playback.timer = null;
  }
  playback.playing = false;
}

function arm() {
  if (playback.timer != null) clearTimeout(playback.timer);
  playback.timer = setTimeout(onStep, REPLAY_STEP_MS);
}

function onStep() {
  playback.timer = null;
  if (!playback.playing || !film) return;
  const last = film.entries.length - 1;
  if (playback.index >= last) {
    playback.playing = false;
    paint();
    return;
  }
  playback.index += 1;
  if (playback.index >= last) playback.playing = false;
  else playback.timer = setTimeout(onStep, REPLAY_STEP_MS);
  paint();
}

function indexFor(at, view) {
  if (typeof at !== "string" || !/^[0-9]+$/.test(at)) return 0;
  const seq = Number(at);
  for (let i = 0; i < view.entries.length; i += 1) {
    if (view.entries[i].seq === seq) return i;
  }
  return 0;
}

function linkAnchor(link) {
  return el("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, [link.label]);
}

function paint() {
  if (!film || !nodes) return;
  const frame = frameAt(film, playback.index);
  const last = film.entries.length - 1;
  nodes.root.setAttribute("data-pick-id", playback.pickId);
  nodes.root.setAttribute("data-seq", String(frame.seq));
  nodes.clock.textContent = frame.clock;
  nodes.status.replaceChildren(chip(frame.status));
  nodes.stage.textContent = frame.stage;
  nodes.counter.textContent = frame.counter;
  const caption = [frame.title];
  for (const link of frame.links) {
    caption.push(" ");
    caption.push(linkAnchor(link));
  }
  nodes.caption.replaceChildren(...caption);
  nodes.slider.setAttribute("min", "1");
  nodes.slider.setAttribute("max", frame.slider.max);
  nodes.slider.setAttribute("step", "1");
  nodes.slider.value = frame.slider.value;
  nodes.slider.setAttribute("aria-valuetext", frame.slider.valuetext);
  nodes.play.textContent = playback.playing ? "Pause" : "Play";
  const active = document.activeElement;
  const flags = [
    [nodes.first, playback.index === 0],
    [nodes.prev, playback.index === 0],
    [nodes.next, playback.index === last],
    [nodes.last, playback.index === last],
  ];
  let shift = false;
  for (const [button, off] of flags) {
    if (off && active === button) shift = true;
    button.disabled = off;
  }
  if (shift) nodes.slider.focus();
  nodes.runs.replaceChildren(...frame.runs.map((run) => el("li", { "data-run": run.id, "data-state": run.state }, [run.text])));
  nodes.stages.replaceChildren(...frame.stages.map((span) => {
    const attrs = { "data-stage": span.stage };
    if (span.current) attrs["aria-current"] = "step";
    return el("li", attrs, [span.text]);
  }));
  nodes.plays.replaceChildren(...frame.plays.map((item) => {
    const children = [el("span", { class: "dd-when" }, [`+${item.sinceStartText}`]), ` ${item.title}`];
    for (const link of item.links) {
      children.push(" ");
      children.push(linkAnchor(link));
    }
    const attrs = { class: "dd-event", "data-seq": String(item.seq) };
    if (item.current) attrs["aria-current"] = "true";
    return el("li", attrs, children);
  }));
}

function moveTo(index) {
  if (!film) return;
  const last = film.entries.length - 1;
  let next = index;
  if (next < 0) next = 0;
  if (next > last) next = last;
  disarm();
  playback.index = next;
  paint();
}

function onPlay() {
  if (!film || !film.entries.length) return;
  if (playback.playing) {
    disarm();
    paint();
    return;
  }
  const last = film.entries.length - 1;
  if (last === 0) return;
  if (playback.index >= last) playback.index = 0;
  playback.playing = true;
  arm();
  paint();
}

function onScrub() {
  const raw = Number(nodes.slider.value);
  moveTo((raw > 0 ? raw : 1) - 1);
}

function mount(pick) {
  const clock = el("p", { "data-replay": "clock", class: "dd-replay-clock" });
  const status = el("div", { "data-replay": "status" });
  const stage = el("p", { "data-replay": "stage", class: "dd-replay-stage" });
  const counter = el("p", { "data-replay": "counter", class: "dd-replay-counter" });
  const caption = el("p", { "data-replay": "caption", class: "dd-replay-caption", "aria-live": "polite" });
  const slider = el("input", { type: "range", "aria-label": "Event", min: "1", step: "1" });
  const first = el("button", { type: "button" }, ["First event"]);
  const prev = el("button", { type: "button" }, ["Previous event"]);
  const play = el("button", { type: "button" }, ["Play"]);
  const next = el("button", { type: "button" }, ["Next event"]);
  const last = el("button", { type: "button" }, ["Last event"]);
  const runs = el("ul", { class: "dd-replay-runs", "aria-label": "Runs so far" });
  const stages = el("ol", { class: "dd-replay-stages", "aria-label": "Stages so far" });
  const plays = el("ol", { class: "dd-replay-plays", "aria-label": "Play by play" });
  first.addEventListener("click", () => moveTo(0));
  prev.addEventListener("click", () => moveTo(playback.index - 1));
  play.addEventListener("click", onPlay);
  next.addEventListener("click", () => moveTo(playback.index + 1));
  last.addEventListener("click", () => {
    if (film) moveTo(film.entries.length - 1);
  });
  slider.addEventListener("input", onScrub);
  const root = el("article", { class: "dd-replay", "aria-label": "Replay", "data-pick-id": pick.id }, [
    el("p", { class: "dd-replay-nav" }, [
      el("a", { href: `#/picks/${pick.id}` }, ["Pick page"]),
      el("a", { href: "#/" }, ["Big Board"]),
    ]),
    el("h2", {}, [`Replay \u00b7 ${pick.id}`]),
    el("p", { class: "dd-replay-idea" }, [pick.idea]),
    el("div", { class: "dd-replay-now" }, [clock, status, stage, counter]),
    caption,
    el("div", { class: "dd-replay-controls", role: "group", "aria-label": "Replay controls" }, [
      slider, first, prev, play, next, last,
    ]),
    el("div", { class: "dd-replay-columns" }, [
      el("section", { class: "panel", "aria-label": "Runs and stages" }, [
        el("h3", {}, ["Runs so far"]),
        runs,
        el("h3", {}, ["Stages so far"]),
        stages,
      ]),
      el("section", { class: "panel", "aria-label": "Film" }, [
        el("h3", {}, ["Play by play"]),
        plays,
      ]),
    ]),
  ]);
  nodes = { root, clock, status, stage, counter, caption, slider, first, prev, play, next, last, runs, stages, plays };
  document.getElementById("app").replaceChildren(root);
}

function stop(where) {
  if (where && where.name === "replay" && mounted(where.id)) return;
  disarm();
  film = null;
  nodes = null;
  playback.pickId = "";
  playback.index = 0;
}

function missing() {
  disarm();
  film = null;
  nodes = null;
  playback.pickId = "";
  playback.index = 0;
  const app = document.getElementById("app");
  app.replaceChildren(
    el("p", {}, ["That pick is not on the board."]),
    el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
  );
}

function show(pick, where, options) {
  const view = pick && pick.timeline;
  if (!view || !view.entries || !view.entries.length) {
    missing();
    return;
  }
  if (options && options.soft && mounted(pick.id)) {
    film = view;
    const last = view.entries.length - 1;
    if (playback.index > last) playback.index = last;
    paint();
    return;
  }
  disarm();
  film = view;
  playback.pickId = pick.id;
  playback.index = indexFor(where && where.at, view);
  mount(pick);
  paint();
  if (where && where.play === "1") onPlay();
}

globalThis.draftDayReplay = { stop, show, missing };
