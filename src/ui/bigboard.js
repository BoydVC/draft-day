function percentText(rate) {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function meter(el, rate, max) {
  const top = max > 0 ? String(max) : "1";
  const value = rate === null || rate === undefined ? "0" : String(rate);
  return el("meter", { class: "bb-meter", min: "0", max: top, value, "aria-hidden": "true" });
}

function winRow(row, el, kind) {
  const wins = num(row.wins);
  const entries = num(row.entries);
  const walkovers = num(row.walkovers);
  const walk = walkovers ? ` +${walkovers} walkover${walkovers === 1 ? "" : "s"}` : "";
  const attrs = {
    "data-wins": String(wins),
    "data-entries": String(entries),
    "data-walkovers": String(walkovers),
  };
  if (kind === "angle") attrs["data-angle"] = String(row.key ?? "");
  else attrs["data-slot"] = String(row.key ?? "");
  return el("li", attrs, [
    el("span", { class: "bb-name" }, [String(row.name ?? "")]),
    el("span", { class: "bb-record" }, [`${wins}/${entries} ${percentText(row.rate)}${walk}`]),
    meter(el, row.rate, 1),
  ]);
}

function pickLink(id, el) {
  return /^p-\d{8}-\d{2}$/.test(String(id)) ? el("a", { href: `#/picks/${id}` }, [String(id)]) : String(id);
}

function leaders(stats, el) {
  const best = list(stats.angles)[0];
  const trades = stats.trades || {};
  const first = (stats.verify && stats.verify.firstTry) || {};
  const mean = trades.mean === null || trades.mean === undefined ? "—" : String(trades.mean);
  return el("div", { class: "bb-leaders" }, [
    el("article", { class: "bb-tile", "data-leader": "angle" }, [
      el("p", { class: "bb-kicker" }, ["Best angle"]),
      el("strong", {}, [best ? String(best.name) : "—"]),
      el("p", { class: "bb-record" }, [best ? `${num(best.wins)}/${num(best.entries)} · ${percentText(best.rate)}` : "—"]),
      meter(el, best ? best.rate : 0, 1),
    ]),
    el("article", { class: "bb-tile", "data-leader": "trades" }, [
      el("p", { class: "bb-kicker" }, ["Trades per pick"]),
      el("strong", {}, [mean]),
      el("p", { class: "bb-record" }, [`${num(trades.total)} grafted`]),
    ]),
    el("article", { class: "bb-tile", "data-leader": "verify" }, [
      el("p", { class: "bb-kicker" }, ["First-try verify"]),
      el("strong", {}, [percentText(first.rate)]),
      el("p", { class: "bb-record" }, [`${num(first.num)}/${num(first.den)}`]),
      meter(el, first.rate, 1),
    ]),
  ]);
}

function windowForm(stats, el) {
  const bounds = stats.window || {};
  const since = el("input", { id: "stats-since", name: "since", type: "date", value: bounds.since || "" });
  const until = el("input", { id: "stats-until", name: "until", type: "date", value: bounds.until || "" });
  const form = el("form", { id: "stats-window", "aria-label": "Stats window" }, [
    el("div", {}, [el("label", { for: "stats-since" }, ["Since"]), since]),
    el("div", {}, [el("label", { for: "stats-until" }, ["Until"]), until]),
    el("button", { type: "submit" }, ["Apply"]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (/^\d{4}-\d{2}-\d{2}$/.test(since.value)) params.set("since", since.value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(until.value)) params.set("until", until.value);
    const query = params.toString();
    location.hash = query ? `#/stats?${query}` : "#/stats";
  });
  return form;
}

function draftDayBigBoard(stats, el) {
  const view = stats && typeof stats === "object" ? stats : {};
  const picks = view.picks || {};
  const excluded = view.excluded || {};
  const verify = view.verify || {};
  const verdicts = verify.verdicts || {};
  const trades = view.trades || {};
  const stages = list(view.stages);
  const maxMedian = stages.reduce((max, row) => Math.max(max, num(row.medianMs)), 0);
  const children = [
    el("p", { class: "bb-kicker" }, ["Scoreboard"]),
    el("p", { class: "bb-headline", "data-stats": "summary" }, [typeof view.summary === "string" ? view.summary : ""]),
  ];
  if (num(excluded.selftest) > 0) {
    const count = num(excluded.selftest);
    children.push(el("p", { class: "bb-note" }, [`${count} selftest ${count === 1 ? "pick" : "picks"} not counted`]));
  }
  children.push(leaders(view, el));
  children.push(windowForm(view, el));
  children.push(el("section", { class: "bb-block" }, [
    el("h2", {}, ["Win rate by angle"]),
    el("ul", { "aria-label": "Win rate by angle" }, list(view.angles).map((row) => winRow(row, el, "angle"))),
  ]));
  children.push(el("section", { class: "bb-block" }, [
    el("h2", {}, ["Win rate by slot"]),
    el("ul", { "aria-label": "Win rate by slot" }, list(view.slots).map((row) => winRow(row, el, "slot"))),
  ]));
  const mean = trades.mean === null || trades.mean === undefined ? "—" : String(trades.mean);
  children.push(el("section", { class: "bb-block" }, [
    el("h2", {}, ["Trades per pick"]),
    el("p", { class: "bb-record" }, [`mean ${mean}`]),
    el("ul", { "aria-label": "Trades per pick" }, list(trades.rows).map((row) => el("li", {
      "data-pick": String(row.pickId ?? ""),
      "data-trades": String(num(row.trades)),
    }, [
      pickLink(row.pickId, el),
      ` ${row.base ?? "—"} · ${num(row.trades)}`,
    ]))),
  ]));
  children.push(el("section", {
    class: "bb-block",
    "aria-label": "Verify pass rate",
    "data-first-try": `${num(verify.firstTry && verify.firstTry.num)}/${num(verify.firstTry && verify.firstTry.den)}`,
    "data-final": `${num(verify.final && verify.final.num)}/${num(verify.final && verify.final.den)}`,
    "data-fix-loops": String(num(verify.fixLoops)),
  }, [
    el("h2", {}, ["Verify pass rate"]),
    el("p", {}, [`first try ${num(verify.firstTry && verify.firstTry.num)}/${num(verify.firstTry && verify.firstTry.den)} ${percentText(verify.firstTry && verify.firstTry.rate)}`]),
    el("p", {}, [`final ${num(verify.final && verify.final.num)}/${num(verify.final && verify.final.den)} ${percentText(verify.final && verify.final.rate)}`]),
    el("p", {}, [`fix loops ${num(verify.fixLoops)}`]),
    el("p", {}, [`VERIFIED ${num(verdicts.VERIFIED)} · NOT_VERIFIED ${num(verdicts.NOT_VERIFIED)} · INCONCLUSIVE ${num(verdicts.INCONCLUSIVE)}`]),
    meter(el, verify.firstTry && verify.firstTry.rate, 1),
  ]));
  children.push(el("section", { class: "bb-block" }, [
    el("h2", {}, ["Time per stage"]),
    el("ul", { "aria-label": "Time per stage" }, stages.map((row) => el("li", {
      "data-stage": String(row.stage ?? ""),
      "data-median-ms": String(num(row.medianMs)),
      "data-picks": String(num(row.picks)),
    }, [
      el("span", { class: "bb-name" }, [String(row.stage ?? "")]),
      el("span", { class: "bb-record" }, [String(row.medianText ?? "")]),
      meter(el, num(row.medianMs), maxMedian),
    ]))),
  ]));
  children.push(el("section", { class: "bb-block" }, [
    el("h2", {}, ["Skipped logs"]),
    el("ul", { "aria-label": "Skipped logs" }, list(view.skipped).map((row) => el("li", {}, [`${row.pickId}: ${row.reason}`]))),
  ]));
  return el("section", {
    class: "panel bb-board",
    "aria-label": "Big Board stats",
    "data-picks": String(num(picks.total)),
    "data-excluded": String(num(excluded.selftest)),
  }, children);
}

globalThis.draftDayBigBoard = draftDayBigBoard;
