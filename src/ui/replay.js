const REPLAY_STEP_MS = 1000;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);

const film = {
  id: null,
  index: 0,
  playing: false,
  timer: null,
  built: false,
  pick: null,
  view: null,
  nodes: null,
};

function clearTimer() {
  if (film.timer == null) return;
  globalThis.clearTimeout(film.timer);
  film.timer = null;
}

function arm() {
  if (film.timer != null) return;
  film.timer = globalThis.setTimeout(onStep, REPLAY_STEP_MS);
}

function halt() {
  clearTimer();
  film.playing = false;
  film.built = false;
  film.id = null;
  film.pick = null;
  film.view = null;
  film.nodes = null;
}

function onStep() {
  film.timer = null;
  if (!film.playing || !film.built || !film.view) return;
  const total = film.view.entries.length;
  if (film.index >= total - 1) {
    film.playing = false;
    paint();
    return;
  }
  film.index += 1;
  if (film.index >= total - 1) film.playing = false;
  paint();
  if (film.playing) arm();
}

function startPlaying() {
  const total = film.view.entries.length;
  if (total <= 1) return;
  if (film.index >= total - 1) film.index = 0;
  film.playing = true;
  clearTimer();
  arm();
  paint();
}

function go(index) {
  film.playing = false;
  clearTimer();
  const total = film.view.entries.length;
  const last = Math.max(0, total - 1);
  film.index = Math.max(0, Math.min(last, index));
  paint();
}

function indexFor(entries, at) {
  if (at == null || at === "") return 0;
  const seq = Number(at);
  if (!Number.isInteger(seq)) return 0;
  const index = entries.findIndex((entry) => entry.seq === seq);
  return index >= 0 ? index : 0;
}

function frameModel(view, index) {
  const entries = view.entries;
  const total = entries.length;
  const entry = entries[index];
  const last = index === total - 1;
  const over = TERMINAL.has(entry.status) || (last && !view.live);
  const runs = [];
  for (const run of view.runs) {
    if (run.startSeq == null || run.startSeq > entry.seq) continue;
    let state = "running";
    if (run.endSeq != null && run.endSeq <= entry.seq) state = run.outcome;
    else if (run.outcome === "abandoned" && over) state = "abandoned";
    const label = state === "running" ? `${run.label} · running` : `${run.label} · ${state} · ${run.durationText}`;
    runs.push({ id: run.id, state, text: label });
  }
  const shown = [];
  for (const span of view.stages) {
    const visible = span.firstSeq != null ? span.firstSeq <= entry.seq : last && !view.live;
    if (visible) shown.push(span);
  }
  const stages = shown.map((span, i) => {
    const current = i === shown.length - 1;
    return {
      span,
      stage: span.stage,
      current,
      text: current ? span.stage : `${span.stage} ${span.durationText}`,
    };
  });
  return { entry, total, runs, stages };
}

function beatsFor(span, entries, seq) {
  const beats = [];
  if (span.firstSeq == null) return beats;
  for (const entry of entries) {
    if (entry.seq < span.firstSeq || entry.seq > seq) continue;
    if (span.lastSeq != null && entry.seq > span.lastSeq) continue;
    if (entry.title.indexOf("NOT_VERIFIED") >= 0 && beats.indexOf("NOT_VERIFIED") < 0) beats.push("NOT_VERIFIED");
    if (entry.title.indexOf("Fix loop") >= 0 && beats.indexOf("Fix loop") < 0) beats.push("Fix loop");
  }
  return beats;
}

function chapterName(span, entries, seq) {
  const beats = beatsFor(span, entries, seq);
  return beats.length ? `${span.stage} · ${beats.join(" · ")}` : span.stage;
}

function linkNode(link) {
  return el("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, [link.label]);
}

function fillSentence(node, title, links) {
  node.replaceChildren(document.createTextNode(title));
  for (const link of links || []) {
    node.append(document.createTextNode(" "));
    node.append(linkNode(link));
  }
}

function settleFocus() {
  const active = document.activeElement;
  const nodes = film.nodes;
  const controls = [nodes.first, nodes.prev, nodes.play, nodes.next, nodes.last];
  if (active && controls.indexOf(active) >= 0 && active.disabled) nodes.slider.focus();
}

function paintChapters(model) {
  const nav = film.nodes.chapters;
  const entries = film.view.entries;
  nav.replaceChildren();
  for (const stage of model.stages) {
    const span = stage.span;
    const name = chapterName(span, entries, model.entry.seq);
    const button = el("button", {
      type: "button",
      "aria-current": stage.current ? "true" : null,
      "data-beat": name === span.stage ? null : "yes",
    }, [name]);
    button.addEventListener("click", () => {
      if (span.firstSeq == null) {
        go(film.view.entries.length - 1);
        return;
      }
      const index = film.view.entries.findIndex((entry) => entry.seq === span.firstSeq);
      go(index < 0 ? 0 : index);
    });
    nav.append(button);
  }
}

function paint() {
  const nodes = film.nodes;
  const view = film.view;
  const model = frameModel(view, film.index);
  const entry = model.entry;
  const total = model.total;
  const number = film.index + 1;
  nodes.article.setAttribute("data-seq", String(entry.seq));
  nodes.idea.textContent = film.pick.idea || "";
  nodes.clock.textContent = `+${entry.sinceStartText}`;
  nodes.status.replaceChildren(chip(entry.status));
  nodes.stage.textContent = entry.stage;
  nodes.counter.textContent = `Event ${number} of ${total}`;
  fillSentence(nodes.caption, entry.title, entry.links);
  nodes.slider.setAttribute("max", String(total));
  nodes.slider.setAttribute("value", String(number));
  nodes.slider.value = String(number);
  nodes.slider.setAttribute("aria-valuetext", `Event ${number} of ${total} · +${entry.sinceStartText} · ${entry.title}`);
  nodes.play.textContent = film.playing ? "Pause" : "Play";
  nodes.first.disabled = film.index === 0;
  nodes.prev.disabled = film.index === 0;
  nodes.next.disabled = film.index >= total - 1;
  nodes.last.disabled = film.index >= total - 1;
  nodes.runs.replaceChildren(...model.runs.map((run) => el("li", { "data-run": run.id, "data-state": run.state }, [run.text])));
  nodes.stages.replaceChildren(...model.stages.map((stage) => el("li", {
    "data-stage": stage.stage,
    "aria-current": stage.current ? "step" : null,
  }, [stage.text])));
  const played = view.entries.slice(0, film.index + 1).reverse();
  nodes.plays.replaceChildren(...played.map((item) => {
    const row = el("li", {
      class: "dd-event",
      "data-seq": String(item.seq),
      "aria-current": item.seq === entry.seq ? "true" : null,
    });
    fillSentence(row, `+${item.sinceStartText} ${item.title}`, item.links);
    return row;
  }));
  paintChapters(model);
  settleFocus();
}

function mount(pick) {
  const caption = el("p", { "data-replay": "caption", "aria-live": "polite", class: "dd-caption" });
  const slider = el("input", { type: "range", min: "1", step: "1", "aria-label": "Event" });
  const first = el("button", { type: "button" }, ["First event"]);
  const prev = el("button", { type: "button" }, ["Previous event"]);
  const play = el("button", { type: "button" }, ["Play"]);
  const next = el("button", { type: "button" }, ["Next event"]);
  const last = el("button", { type: "button" }, ["Last event"]);
  const chapters = el("nav", { "aria-label": "Chapters", class: "dd-chapters" });
  const runs = el("ul", { "aria-label": "Runs so far", class: "dd-runs-so-far" });
  const stages = el("ol", { "aria-label": "Stages so far", class: "dd-stages-so-far" });
  const plays = el("ol", { "aria-label": "Play by play", class: "dd-play" });
  const clock = el("p", { "data-replay": "clock", class: "dd-clock" });
  const status = el("div", { "data-replay": "status" });
  const stage = el("p", { "data-replay": "stage", class: "dd-stage" });
  const counter = el("p", { "data-replay": "counter", class: "dd-counter" });
  const idea = el("p", { class: "dd-idea" });
  first.addEventListener("click", () => { if (!first.disabled) go(0); });
  prev.addEventListener("click", () => { if (!prev.disabled) go(film.index - 1); });
  next.addEventListener("click", () => { if (!next.disabled) go(film.index + 1); });
  last.addEventListener("click", () => { if (!last.disabled) go(film.view.entries.length - 1); });
  play.addEventListener("click", () => {
    if (film.playing) go(film.index);
    else startPlaying();
  });
  slider.addEventListener("input", () => {
    const raw = Number(slider.value);
    const frame = Number.isFinite(raw) ? Math.round(raw) : 1;
    go(frame - 1);
  });
  const article = el("article", { "aria-label": "Replay", "data-pick-id": pick.id, class: "dd-replay" }, [
    el("p", { class: "back dd-replay-nav" }, [
      el("a", { href: `#/picks/${pick.id}` }, ["Pick page"]),
      el("a", { href: "#/" }, ["Big Board"]),
    ]),
    el("div", { class: "dd-film" }, [
      el("h2", {}, [`Replay · ${pick.id}`]),
      idea,
      el("div", { class: "dd-film-row" }, [clock, status, stage, counter]),
      caption,
    ]),
    el("div", { role: "group", "aria-label": "Replay controls", class: "dd-controls" }, [
      slider, first, prev, play, next, last,
    ]),
    el("div", { class: "dd-chapter-block" }, [
      el("h2", {}, ["Chapters"]),
      chapters,
    ]),
    el("div", { class: "dd-replay-lists" }, [
      el("section", { class: "panel" }, [el("h2", {}, ["Runs so far"]), runs]),
      el("section", { class: "panel" }, [el("h2", {}, ["Stages so far"]), stages]),
      el("section", { class: "panel" }, [el("h2", {}, ["Play by play"]), plays]),
    ]),
  ]);
  film.nodes = { article, caption, slider, first, prev, play, next, last, chapters, runs, stages, plays, clock, status, stage, counter, idea };
  film.built = true;
  film.id = pick.id;
  document.getElementById("app").replaceChildren(article);
}

function stop(where, options) {
  const keep = Boolean(options && options.soft && where && where.name === "replay" && film.built && film.id === where.id);
  if (keep) return;
  halt();
}

function show(pick, where, options) {
  const live = Boolean(options && options.soft && film.built && film.id === pick.id);
  film.pick = pick;
  film.view = pick.timeline;
  if (!live) {
    film.id = pick.id;
    film.index = indexFor(pick.timeline.entries, where.at);
    film.playing = false;
    clearTimer();
    mount(pick);
    paint();
    if (where.play === "1") startPlaying();
    return;
  }
  const total = pick.timeline.entries.length;
  if (film.index > total - 1) film.index = Math.max(0, total - 1);
  paint();
}

function missing() {
  halt();
  document.getElementById("app").replaceChildren(
    el("p", {}, ["That pick is not on the board."]),
    el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
  );
}

globalThis.draftDayReplay = { stop, show, missing };
