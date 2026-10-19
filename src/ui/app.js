const app = document.getElementById("app");

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children || []) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function chip(status) {
  return el("span", { class: "chip", "data-status": status }, [status]);
}

function route() {
  const hash = location.hash.replace(/^#/, "");
  const lessons = hash.match(/^\/lessons(?:\?(.*))?$/);
  if (lessons) {
    const params = new URLSearchParams(lessons[1] || "");
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const since = params.get("since");
    const until = params.get("until");
    return {
      name: "lessons",
      since: since && day.test(since) ? since : null,
      until: until && day.test(until) ? until : null,
    };
  }
  const stats = hash.match(/^\/stats(?:\?(.*))?$/);
  if (stats) {
    const params = new URLSearchParams(stats[1] || "");
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const since = params.get("since");
    const until = params.get("until");
    return {
      name: "stats",
      since: since && day.test(since) ? since : null,
      until: until && day.test(until) ? until : null,
    };
  }
  if (hash === "/ledger") return { name: "ledger" };
  const replay = hash.match(/^\/picks\/(p-\d{8}-\d{2})\/replay(?:\?(.*))?$/);
  if (replay) {
    const params = new URLSearchParams(replay[2] || "");
    return { name: "replay", id: replay[1], at: params.get("at"), play: params.get("play") };
  }
  const linter = hash.match(/^\/picks\/(p-\d{8}-\d{2})\/linter$/);
  if (linter) return { name: "linter", id: linter[1] };
  const match = hash.match(/^\/picks\/(p-\d{8}-\d{2})$/);
  if (match) return { name: "pick", id: match[1] };
  return { name: "board" };
}

const INTAKE_TABLE = [
  { key: "inflight", phase: "sending", keepIdea: true, sentence: "Sending…" },
  { key: "ok", phase: "done", keepIdea: false, sentence: "Queued in the inbox. Nothing launches from this page." },
  { key: "policy", phase: "done", keepIdea: false, sentence: "Queued in the inbox. Policy will refuse it ({policy})." },
  { key: "error", phase: "failed", keepIdea: true, sentence: "{error}" },
  { key: "unreachable", phase: "failed", keepIdea: true, sentence: "Could not reach the War Room. Check the Big Board before trying again." },
];

const intake = {
  phase: "idle",
  idea: "",
  target: "BoydVC/draft-day",
  n: "3",
  status: "",
};

function intakeOutcome(answer, thrown) {
  let key = "unreachable";
  if (answer && answer.inflight) key = "inflight";
  else if (thrown || !answer || answer.badjson) key = "unreachable";
  else if (typeof answer.error === "string") key = "error";
  else if (typeof answer.policy === "string" && answer.policy) key = "policy";
  else key = "ok";
  const row = INTAKE_TABLE.find((item) => item.key === key);
  let sentence = row.sentence;
  if (key === "policy") sentence = row.sentence.split("{policy}").join(answer.policy);
  if (key === "error") sentence = answer.error;
  return { phase: row.phase, sentence, keepIdea: row.keepIdea };
}

function paintIntake() {
  const statusNode = document.getElementById("form-status");
  if (statusNode) statusNode.textContent = intake.status;
  const ideaNode = document.getElementById("idea");
  if (ideaNode) ideaNode.value = intake.idea;
  const add = document.getElementById("add-pick");
  if (add) add.disabled = intake.phase === "sending";
}

function applyOutcome(answer, thrown, idea) {
  const next = intakeOutcome(answer, thrown);
  intake.phase = next.phase;
  intake.status = next.sentence;
  intake.idea = next.keepIdea ? idea : "";
  paintIntake();
  return next;
}

function formPanel() {
  const idea = el("textarea", { id: "idea", name: "idea", required: "true" });
  idea.value = intake.idea;
  const target = el("input", {
    id: "target",
    name: "target",
    value: intake.target,
    required: "true",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    autocomplete: "off",
  });
  const n = el("input", {
    id: "n",
    name: "n",
    type: "number",
    min: "1",
    max: "5",
    value: intake.n,
    inputmode: "numeric",
  });
  const status = el("p", { id: "form-status", role: "status" });
  status.textContent = intake.status;
  const form = el("form", { id: "new-pick", "aria-label": "New pick" }, [
    el("div", {}, [el("label", { for: "idea" }, ["Idea"]), idea]),
    el("div", { class: "row" }, [
      el("div", {}, [el("label", { for: "target" }, ["Target"]), target]),
      el("div", {}, [el("label", { for: "n" }, ["Candidates"]), n]),
    ]),
    el("button", { id: "add-pick", type: "submit", disabled: intake.phase === "sending" ? "" : null }, ["Add pick"]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (intake.phase === "sending") return;
    intake.target = target.value;
    intake.n = n.value;
    applyOutcome({ inflight: true }, null, idea.value);
    void submitPick();
  });
  return el("section", { class: "panel", "aria-label": "New pick" }, [
    el("h2", {}, ["New pick"]),
    form,
  ]);
}

async function submitPick() {
  const idea = intake.idea;
  const target = intake.target;
  const n = Number(intake.n);
  let answer = null;
  let thrown = null;
  try {
    const response = await fetch("/api/intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea, target, n, source: "warroom" }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      thrown = error;
    }
    if (!thrown) {
      if (!response.ok) answer = body && typeof body.error === "string" ? { error: body.error } : { badjson: true };
      else answer = { policy: body && typeof body.policy === "string" ? body.policy : null };
    }
  } catch (error) {
    thrown = error;
  }
  const next = applyOutcome(answer, thrown, idea);
  if (next.phase !== "done") return;
  try {
    await render({ soft: true });
  } catch {
    paintIntake();
  }
}

function boardTable(data) {
  const rows = [];
  for (const pick of data.picks) {
    rows.push(el("tr", { "data-pick-id": pick.id }, [
      el("td", { "data-label": "Pick" }, [el("a", { href: `#/picks/${pick.id}` }, [pick.id])]),
      el("td", { "data-label": "Idea" }, [pick.idea]),
      el("td", { "data-label": "Stage" }, [pick.stage]),
      el("td", { "data-label": "Status" }, [chip(pick.status)]),
      el("td", { "data-label": "Runs" }, [String(pick.runs)]),
    ]));
  }
  for (const item of data.inbox) {
    rows.push(el("tr", { "data-inbox": String(item.offset) }, [
      el("td", { "data-label": "Pick" }, ["queued"]),
      el("td", { "data-label": "Idea" }, [item.idea]),
      el("td", { "data-label": "Stage" }, [item.stage]),
      el("td", { "data-label": "Status" }, [chip(item.status)]),
      el("td", { "data-label": "Runs" }, ["0"]),
    ]));
  }
  const body = rows.length
    ? rows
    : [el("tr", {}, [el("td", { colspan: "5", class: "empty" }, ["No picks yet. Add one from the form or from chat."])])];
  return el("table", {}, [
    el("thead", {}, [el("tr", {}, ["Pick", "Idea", "Stage", "Status", "Runs"].map((name) => el("th", {}, [name])))]),
    el("tbody", { id: "board-body" }, body),
  ]);
}

function boardView(data) {
  return el("div", {}, [
    el("p", { class: "back" }, [
      el("a", { href: "#/lessons" }, ["Locker Room"]),
      el("a", { href: "#/stats" }, ["Stats"]),
      el("a", { href: "#/ledger" }, ["Ledger"]),
    ]),
    formPanel(),
    el("section", { class: "panel", "aria-label": "Big Board", id: "big-board" }, [
      el("h2", {}, ["Big Board"]),
      boardTable(data),
    ]),
  ]);
}

function section(title, children) {
  return el("section", { class: "panel", "aria-label": title }, [el("h2", {}, [title]), ...children.filter((child) => child != null)]);
}

let scorePick = "";
let scorePass = null;

function showingPass(room, pick) {
  if (scorePick !== pick.id) return room.passes[room.passes.length - 1]?.pass ?? 1;
  return scorePass ?? room.passes[room.passes.length - 1]?.pass ?? 1;
}

function gateText(gates) {
  return `build ${gates.build}, tests ${gates.tests}, journey ${gates.journey}`;
}

function crossText(cross) {
  if (cross.rate == null) return `${cross.passed}/${cross.total}`;
  return `${cross.passed}/${cross.total} (${Math.round(cross.rate * 100)}%)`;
}

function diffText(diff) {
  if (!diff) return "—";
  const files = diff.files === 1 ? "1 file" : `${diff.files} files`;
  return `+${diff.added} −${diff.removed}, ${files}`;
}

function cellText(cell) {
  if (cell.score == null) return "—";
  return cell.evidence ? `${cell.score} "${cell.evidence}"` : String(cell.score);
}

function judgeSentence(room) {
  if (!room.judgeDisagrees && room.secondRead !== "disagree") return "";
  let judgeCand = null;
  for (const pass of room.passes) {
    if (pass.judgeBase && pass.judgeBase !== pass.winner) judgeCand = pass.judgeBase;
  }
  if (!judgeCand) {
    for (const pass of room.passes) {
      if (pass.judgeBase) judgeCand = pass.judgeBase;
    }
  }
  if (!judgeCand || !room.base) return "";
  return `Judge picked ${judgeCand}; the board picked ${room.base}.`;
}

function unstableSentence(room) {
  if (!room.unstable?.length) return "";
  const names = room.unstable.map((id) => {
    for (const pass of room.passes) {
      for (const line of pass.lines) {
        const cell = line.cells.find((item) => item.criterionId === id);
        if (cell) return cell.name;
      }
    }
    return id;
  });
  return `${names.join(", ")} moved by 2 or more between passes.`;
}

function scoreColumn(line, base) {
  const isBase = line.cand === base;
  const rows = [
    ["Gates", gateText(line.gates)],
    ["Cross-tests", crossText(line.cross)],
    ...line.cells.map((cell) => [`${cell.name} ×${cell.weight}`, cellText(cell)]),
    ["Weighted", line.weighted.toFixed(2)],
    ["Rank", line.rank == null ? "— (gate failed)" : String(line.rank)],
    ["Diff", diffText(line.diff)],
  ];
  const heading = [el("span", { class: "cand-label" }, [`${line.cand} · ${line.label}`])];
  if (isBase) heading.push(el("span", { class: "base-mark" }, ["BASE"]));
  return el("article", { class: "score-col", "data-base": isBase ? "true" : "false", "aria-label": `${line.cand} · ${line.label}` }, [
    el("h3", {}, heading),
    el("p", { class: "angle" }, [line.angle || "No angle recorded"]),
    el("dl", {}, rows.map(([name, value]) => el("div", {}, [
      el("dt", {}, [name]),
      el("dd", {}, [value]),
    ]))),
  ]);
}

function passToggle(room, pick) {
  if (room.passes.length < 2) return null;
  const current = showingPass(room, pick);
  return el("div", { class: "pass-toggle", role: "group", "aria-label": "Judge pass" }, room.passes.map((pass) => {
    const button = el("button", { type: "button", "aria-pressed": pass.pass === current ? "true" : "false" }, [`Pass ${pass.pass}`]);
    button.addEventListener("click", () => {
      scorePick = pick.id;
      scorePass = pass.pass;
      void render();
    });
    return button;
  }));
}

function scorecard(pick) {
  const room = pick.filmRoom;
  if (!room) {
    const empty = section("Scorecard", [el("p", { class: "empty" }, ["Film Room has not scored this pick."])]);
    empty.id = "scorecard";
    return empty;
  }
  const current = showingPass(room, pick);
  const view = room.passes.find((pass) => pass.pass === current) ?? room.passes[room.passes.length - 1];
  const swapText = room.swap === "single" ? "Single pass" : `Swap: ${room.swap}`;
  const judge = judgeSentence(room);
  const moved = unstableSentence(room);
  const node = section("Scorecard", [
    el("div", { class: "score-tools" }, [
      el("span", { class: "chip score-chip", "data-swap": room.swap }, [swapText]),
      room.closeCall ? el("span", { class: "chip score-chip", "data-close": "true" }, ["Close call"]) : null,
      room.base ? el("strong", { class: "base-banner" }, [`Base ${room.base}`]) : null,
      passToggle(room, pick),
    ].filter(Boolean)),
    room.passes.length > 1 ? el("p", { class: "score-showing", role: "status" }, [`Showing pass ${view.pass}.`]) : null,
    el("p", { class: "score-reason", id: "score-reason" }, [room.reason]),
    judge ? el("p", { class: "score-judge" }, [judge]) : null,
    (room.judgeDisagrees || room.secondRead === "disagree") && room.note ? el("p", { class: "score-note" }, [room.note]) : null,
    moved ? el("p", { class: "score-unstable" }, [moved]) : null,
    el("div", { class: "score-board", "data-showing-pass": String(view.pass) }, (view?.lines ?? []).map((line) => scoreColumn(line, room.base))),
  ].filter((child) => child != null));
  node.id = "scorecard";
  return node;
}

function pickView(pick) {
  const report = pick.report;
  const acceptance = report
    ? report.acceptance.map((line) => el("li", {}, [`WHEN ${line.when} THE SYSTEM SHALL ${line.shall}`]))
    : [el("li", { class: "empty" }, ["No scouting report yet."])];
  const cards = pick.candidates.length
    ? pick.candidates.map((cand) => el("article", { class: "card" }, [
        el("h3", {}, [cand.id]),
        chip(cand.status),
        el("p", {}, [cand.angle]),
        el("p", { class: "meta" }, [cand.model ? `Model ${cand.model}` : "Model: account default"]),
        el("p", { class: "meta" }, [cand.branch || "No branch yet"]),
      ]))
    : [el("p", { class: "empty" }, ["No candidates yet."])];

  const trades = pick.judgement?.trades?.length
    ? pick.judgement.trades.map((trade) => el("li", {}, [`${trade.from}: ${trade.what} (${trade.pointers.join(", ")}) — ${trade.why}`]))
    : [el("li", { class: "empty" }, ["No trades."])];

  const physicalBits = [];
  if (pick.physical) {
    physicalBits.push(el("p", {}, [`Verdict ${pick.physical.verdict}`]));
    physicalBits.push(el("p", { class: "meta" }, [`Ledger ${pick.physical.ledger}. Certainty ${pick.physical.certainty}.`]));
    const pr = pick.physical.prNumber || pick.graft?.prNumber;
    if (pr) {
      physicalBits.push(el("p", {}, [
        el("a", { href: `https://github.com/${pick.target}/pull/${pr}` }, [`Draft PR #${pr}`]),
      ]));
    }
    const shots = pick.physical.evidence || [];
    physicalBits.push(el("ul", {}, shots.map((shot) => el("li", {}, [shot]))));
  } else {
    physicalBits.push(el("p", { class: "empty" }, ["Physical has not run."]));
  }

  const log = globalThis.draftDayTimeline(pick.timeline, el);

  return el("article", { "data-pick-id": pick.id }, [
    el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
    el("div", { class: "status-line" }, [
      el("h2", { id: "pick-title" }, [pick.id]),
      chip(pick.status),
      el("span", { class: "meta" }, [pick.stage]),
      el("a", { href: `#/picks/${pick.id}/replay`, class: "dd-replay-link" }, ["Replay"]),
      el("a", { href: `#/picks/${pick.id}/linter`, class: "dd-lint-link" }, ["Lint"]),
    ]),
    el("p", {}, [pick.idea]),
    pick.failReason ? el("p", { class: "meta" }, [`Reason: ${pick.failReason}`]) : el("span"),
    scorecard(pick),
    section("Scouting report", [
      el("p", {}, [report?.restatement || "The report has not been written."]),
      el("ul", {}, acceptance),
    ]),
    section("Candidates", [el("div", { class: "cards" }, cards)]),
    section("Trades", [el("ul", {}, trades)]),
    section("Physical", physicalBits),
    section("Decision log", [log]),
  ]);
}

function linterLines(doc) {
  if (!doc || typeof doc !== "object") return [];
  const lines = [];
  if (typeof doc.markdown === "string") lines.push(doc.markdown);
  if (typeof doc.restatement === "string") lines.push(doc.restatement);
  for (const angle of Array.isArray(doc.angles) ? doc.angles : []) lines.push(String(angle));
  for (const line of Array.isArray(doc.acceptance) ? doc.acceptance : []) {
    if (line && typeof line.when === "string") lines.push(line.when);
    if (line && typeof line.shall === "string") lines.push(line.shall);
  }
  for (const item of Array.isArray(doc.forbidden) ? doc.forbidden : []) lines.push(String(item));
  return lines;
}

function linterFailure(why) {
  return {
    ok: false,
    summary: "fail · 1 hard",
    criteria: [],
    ears: [],
    angles: [],
    hard: [{ kind: "criterion", id: "document", why: String(why) }],
    soft: [],
  };
}

async function showLinter(pickId, doc) {
  let payload = doc;
  if (typeof doc === "string") {
    const trimmed = doc.trim();
    if (trimmed.startsWith("{")) {
      try {
        payload = JSON.parse(trimmed);
      } catch (error) {
        app.replaceChildren();
        app.append(globalThis.draftDayLinter(linterFailure(error instanceof Error ? error.message : "lint document is not JSON"), {
          pickId,
          onPaste: (text) => { void showLinter(pickId, text); },
        }));
        return;
      }
    } else payload = { markdown: doc };
  }
  const lines = linterLines(payload);
  const again = (text) => { void showLinter(pickId, text); };
  let response;
  try {
    response = await fetch("/api/lint-scout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    app.replaceChildren();
    app.append(globalThis.draftDayLinter(linterFailure("Could not reach the War Room."), { pickId, lines, onPaste: again }));
    return;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  app.replaceChildren();
  const view = response.ok && body && typeof body.ok === "boolean" ? body : linterFailure(body && body.error ? body.error : "lint failed");
  app.append(globalThis.draftDayLinter(view, { pickId, lines, onPaste: again }));
}

let drawing = false;

async function render(options) {
  if (drawing) return;
  drawing = true;
  try {
    const where = route();
    globalThis.draftDayReplay.stop(where);
    if (globalThis.draftDayLinter) globalThis.draftDayLinter.stop();
    const typing = document.activeElement && document.getElementById("new-pick")?.contains(document.activeElement);
    if (where.name === "board" && options?.soft && typing && document.getElementById("big-board")) {
      const data = await fetch("/api/board").then((response) => response.json());
      document.getElementById("big-board").replaceWith(
        el("section", { class: "panel", "aria-label": "Big Board", id: "big-board" }, [
          el("h2", {}, ["Big Board"]),
          boardTable(data),
        ]),
      );
      return;
    }
    if (where.name === "lessons") {
      const open = document.getElementById("lesson-window");
      if (options?.soft && open && open.contains(document.activeElement)) return;
      const params = new URLSearchParams();
      if (where.since) params.set("since", where.since);
      if (where.until) params.set("until", where.until);
      const query = params.toString();
      const response = await fetch(query ? `/api/lessons?${query}` : "/api/lessons");
      const report = await response.json();
      app.replaceChildren();
      app.append(el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]));
      app.append(globalThis.draftDayLessons(report, el));
      return;
    }
    if (where.name === "stats") {
      const open = document.getElementById("stats-window");
      if (options?.soft && open && open.contains(document.activeElement)) return;
      const params = new URLSearchParams();
      if (where.since) params.set("since", where.since);
      if (where.until) params.set("until", where.until);
      const query = params.toString();
      const statsError = (message) => {
        app.replaceChildren();
        app.append(el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]));
        app.append(el("section", { class: "panel", "aria-label": "Big Board stats" }, [
          el("h2", {}, ["Big Board stats"]),
          el("p", {}, [message]),
          el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
        ]));
      };
      let response = null;
      try {
        response = await fetch(query ? `/api/stats?${query}` : "/api/stats");
      } catch {
        statsError("Could not load Big Board stats.");
        return;
      }
      if (!response.ok) {
        let message = "Could not load Big Board stats.";
        try {
          const body = await response.json();
          if (body && typeof body.error === "string" && body.error) message = body.error;
        } catch {
          message = "Could not load Big Board stats.";
        }
        statsError(message);
        return;
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!body) {
        statsError("Could not load Big Board stats.");
        return;
      }
      app.replaceChildren();
      app.append(el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]));
      app.append(globalThis.draftDayBigBoard(body, el));
      return;
    }
    if (where.name === "ledger") {
      const ledgerError = (message) => {
        app.replaceChildren();
        app.append(el("p", { class: "back ledger-back" }, [el("a", { href: "#/" }, ["Big Board"])]));
        app.append(el("section", { class: "panel", "aria-label": "Season ledger" }, [
          el("h2", {}, ["Season ledger"]),
          el("p", {}, [message]),
          el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
        ]));
      };
      let response = null;
      try {
        response = await fetch("/api/ledger");
      } catch {
        ledgerError("Could not load the season ledger.");
        return;
      }
      if (!response.ok) {
        ledgerError("Could not load the season ledger.");
        return;
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!body) {
        ledgerError("Could not load the season ledger.");
        return;
      }
      app.replaceChildren();
      app.append(el("p", { class: "back ledger-back" }, [el("a", { href: "#/" }, ["Big Board"])]));
      app.append(globalThis.draftDayLedger(body, el));
      return;
    }
    if (where.name === "replay") {
      const response = await fetch(`/api/picks/${where.id}`);
      if (!response.ok) {
        globalThis.draftDayReplay.missing();
        return;
      }
      globalThis.draftDayReplay.show(await response.json(), where, options);
      return;
    }
    if (where.name === "linter") {
      const box = document.querySelector('[aria-label="Lint document"]');
      if (options && options.soft && box && document.activeElement === box) return;
      const response = await fetch(`/api/picks/${where.id}`);
      if (!response.ok) {
        app.replaceChildren();
        app.append(section("Scouting linter", [
          el("p", {}, ["That pick is not on the board."]),
          el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
        ]));
        return;
      }
      const pick = await response.json();
      const report = pick.report || {};
      await showLinter(where.id, Object.assign({}, report, { checks: report.checks ?? {} }));
      return;
    }
    app.replaceChildren();
    if (where.name === "pick") {
      const response = await fetch(`/api/picks/${where.id}`);
      if (!response.ok) {
        app.append(section("Pick", [el("p", {}, ["That pick is not on the board."]), el("a", { href: "#/" }, ["Big Board"])]));
        return;
      }
      app.append(pickView(await response.json()));
      return;
    }
    const data = await fetch("/api/board").then((response) => response.json());
    app.append(boardView(data));
  } finally {
    drawing = false;
  }
}

const stream = new EventSource("/api/events");
stream.addEventListener("update", () => {
  void render({ soft: true });
});
window.addEventListener("hashchange", () => {
  void render();
});
void render();
