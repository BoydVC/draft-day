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
  const match = hash.match(/^\/picks\/(p-\d{8}-\d{2})$/);
  if (match) return { name: "pick", id: match[1] };
  const lessons = hash.match(/^\/lessons(?:\?(.*))?$/);
  if (lessons) {
    const params = new URLSearchParams(lessons[1] || "");
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const since = params.get("since");
    const until = params.get("until");
    return {
      name: "lessons",
      since: since && day.test(since) ? since : undefined,
      until: until && day.test(until) ? until : undefined,
    };
  }
  return { name: "board" };
}

function formPanel() {
  const idea = el("textarea", { id: "idea", name: "idea", required: "true" });
  const target = el("input", { id: "target", name: "target", value: "BoydVC/draft-day", required: "true" });
  const n = el("input", { id: "n", name: "n", type: "number", min: "1", max: "5", value: "3" });
  const status = el("p", { id: "form-status", role: "status" });
  const form = el("form", { id: "new-pick", "aria-label": "New pick" }, [
    el("div", {}, [el("label", { for: "idea" }, ["Idea"]), idea]),
    el("div", { class: "row" }, [
      el("div", {}, [el("label", { for: "target" }, ["Target"]), target]),
      el("div", {}, [el("label", { for: "n" }, ["Candidates"]), n]),
    ]),
    el("button", { type: "submit" }, ["Add pick"]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPick(idea, target, n, status);
  });
  return el("section", { class: "panel", "aria-label": "New pick" }, [
    el("h2", {}, ["New pick"]),
    form,
  ]);
}

async function submitPick(idea, target, n, status) {
  status.textContent = "Sending…";
  const response = await fetch("/api/intake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idea: idea.value,
      target: target.value,
      n: Number(n.value),
      source: "warroom",
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    status.textContent = body.error || "Could not queue the pick";
    return;
  }
  idea.value = "";
  status.textContent = body.policy
    ? `Queued in the inbox. Policy will refuse it (${body.policy}).`
    : "Queued in the inbox.";
  await render({ soft: true });
}

function boardTable(data) {
  const rows = [];
  for (const pick of data.picks) {
    rows.push(el("tr", { "data-pick-id": pick.id }, [
      el("td", {}, [el("a", { href: `#/picks/${pick.id}` }, [pick.id])]),
      el("td", {}, [pick.idea]),
      el("td", {}, [pick.stage]),
      el("td", {}, [chip(pick.status)]),
      el("td", {}, [String(pick.runs)]),
    ]));
  }
  for (const item of data.inbox) {
    rows.push(el("tr", { "data-inbox": String(item.offset) }, [
      el("td", {}, ["queued"]),
      el("td", {}, [item.idea]),
      el("td", {}, [item.stage]),
      el("td", {}, [chip(item.status)]),
      el("td", {}, ["0"]),
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
    formPanel(),
    el("p", { class: "back" }, [el("a", { href: "#/lessons" }, ["Locker Room"])]),
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

let drawing = false;

async function render(options) {
  if (drawing) return;
  drawing = true;
  try {
    const where = route();
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
      const form = document.getElementById("lesson-window");
      if (options?.soft && form && form.contains(document.activeElement)) return;
      const params = new URLSearchParams();
      if (where.since) params.set("since", where.since);
      if (where.until) params.set("until", where.until);
      const query = params.toString();
      const response = await fetch(query ? `/api/lessons?${query}` : "/api/lessons");
      const report = await response.json();
      app.replaceChildren();
      app.append(el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]));
      if (!response.ok) {
        app.append(el("section", { class: "panel locker", "aria-label": "Locker Room" }, [
          el("p", {}, [report.error || "Could not load lessons"]),
        ]));
        return;
      }
      app.append(globalThis.draftDayLessons(report, el));
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
