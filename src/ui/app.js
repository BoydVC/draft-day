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
    el("section", { class: "panel", "aria-label": "Big Board", id: "big-board" }, [
      el("h2", {}, ["Big Board"]),
      boardTable(data),
    ]),
  ]);
}

function section(title, children) {
  return el("section", { class: "panel", "aria-label": title }, [el("h2", {}, [title]), ...children]);
}

let openPass = { pickId: "", pass: 0 };

function chosenPass(room, pickId) {
  if (!room || !room.passes || room.passes.length === 0) return null;
  if (openPass.pickId === pickId) {
    const found = room.passes.find((pass) => pass.pass === openPass.pass);
    if (found) return found;
  }
  return room.passes[room.passes.length - 1];
}

function diffText(diff) {
  if (!diff) return "—";
  return `+${diff.added} −${diff.removed}, ${diff.files} files`;
}

function crossText(cross) {
  const pct = cross.rate === null ? "" : ` (${Math.round(cross.rate * 100)}%)`;
  return `${cross.passed}/${cross.total}${pct}`;
}

function scorecardSection(pick) {
  const room = pick.filmRoom;
  const view = room ? chosenPass(room, pick.id) : null;
  if (!room || !view) return [el("p", { class: "empty" }, ["Film Room has not scored this pick."])];
  const chips = [
    el("span", { class: "chip", "data-swap": room.swap }, [room.swap === "single" ? "Single pass" : `Swap: ${room.swap}`]),
  ];
  if (room.closeCall) chips.push(el("span", { class: "chip", "data-close": "true" }, ["Close call"]));
  const toggles = room.passes.length >= 2
    ? el("div", { class: "pass-toggle", role: "group", "aria-label": "Judge passes" }, room.passes.map((pass) => {
        const button = el("button", { type: "button", "aria-pressed": pass.pass === view.pass ? "true" : "false" }, [`Pass ${pass.pass}`]);
        button.addEventListener("click", () => {
          openPass = { pickId: pick.id, pass: pass.pass };
          void render();
        });
        return button;
      }))
    : null;
  const head = [el("th", { scope: "col" }, [" "])].concat(view.lines.map((line) => el("th", {
    scope: "col",
    class: line.cand === room.base ? "base" : "",
  }, [
    el("span", { class: "cand-label" }, [`${line.cand} · ${line.label}${line.cand === room.base ? " BASE" : ""}`]),
    el("span", { class: "angle" }, [line.angle || ""]),
  ])));
  const row = (name, values) => el("tr", {}, [el("th", { scope: "row" }, [name]), ...values.map((value, index) => {
    const line = view.lines[index];
    return el("td", { class: line && line.cand === room.base ? "base" : "" }, [value]);
  })]);
  const body = [
    row("Gates", view.lines.map((line) => `${line.gates.build} ${line.gates.tests} ${line.gates.journey}`)),
    row("Cross-tests", view.lines.map((line) => crossText(line.cross))),
  ];
  const cells = view.lines[0]?.cells || [];
  for (const criterion of cells) {
    body.push(row(`${criterion.name} ×${criterion.weight}`, view.lines.map((line) => {
      const cell = line.cells.find((item) => item.criterionId === criterion.criterionId);
      if (!cell || cell.score === null) return "—";
      return `${cell.score} ${cell.evidence}`;
    })));
  }
  body.push(row("Weighted", view.lines.map((line) => line.weighted.toFixed(2))));
  body.push(row("Rank", view.lines.map((line) => (line.rank === null ? "—" : String(line.rank)))));
  body.push(row("Diff", view.lines.map((line) => diffText(line.diff))));
  const notes = [el("p", { class: "reason" }, [room.reason])];
  if (room.judgeDisagrees || room.secondRead === "disagree") {
    const offending = room.passes.find((pass) => pass.judgeBase && pass.judgeBase !== pass.winner) || view;
    notes.push(el("p", { class: "judge-note" }, [`Judge picked ${offending.judgeBase}; the board picked ${room.base}.`]));
    notes.push(el("p", { class: "second-read" }, [room.note || ""]));
  }
  return [
    el("div", { class: "score-head" }, toggles ? [el("div", { class: "score-chips" }, chips), toggles] : [el("div", { class: "score-chips" }, chips)]),
    ...notes,
    el("div", { class: "scorecard-scroll" }, [
      el("table", { class: "scorecard" }, [
        el("thead", {}, [el("tr", {}, head)]),
        el("tbody", {}, body),
      ]),
    ]),
  ];
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

  const log = pick.events?.length
    ? pick.events.map((event) => el("li", {}, [`${event.ts} ${event.summary}`]))
    : [el("li", { class: "empty" }, ["No events."])];

  return el("article", { "data-pick-id": pick.id }, [
    el("p", { class: "back" }, [el("a", { href: "#/" }, ["Big Board"])]),
    el("div", { class: "status-line" }, [
      el("h2", { id: "pick-title" }, [pick.id]),
      chip(pick.status),
      el("span", { class: "meta" }, [pick.stage]),
    ]),
    el("p", {}, [pick.idea]),
    pick.failReason ? el("p", { class: "meta" }, [`Reason: ${pick.failReason}`]) : el("span"),
    section("Scouting report", [
      el("p", {}, [report?.restatement || "The report has not been written."]),
      el("ul", {}, acceptance),
    ]),
    section("Candidates", [el("div", { class: "cards" }, cards)]),
    section("Scorecard", scorecardSection(pick)),
    section("Trades", [el("ul", {}, trades)]),
    section("Physical", physicalBits),
    section("Decision log", [el("ol", { class: "events" }, log)]),
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
