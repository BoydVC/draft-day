function percentText(rate) {
  return rate === null || rate === undefined ? "\u2014" : `${Math.round(rate * 100)}%`;
}

function winText(row) {
  const walk = row.walkovers ? ` (+${row.walkovers} walkover${row.walkovers === 1 ? "" : "s"})` : "";
  return `${row.name} ${row.wins}/${row.entries} ${percentText(row.rate)}${walk}`;
}

function winRow(row, el, attr) {
  const children = [winText(row)];
  if (row.entries) {
    children.push(el("meter", {
      min: "0",
      max: String(row.entries),
      value: String(row.wins),
    }));
  }
  return el("li", {
    [attr]: row.key,
    "data-wins": row.wins,
    "data-entries": row.entries,
    "data-walkovers": row.walkovers,
  }, children);
}

function pickHref(id) {
  return /^p-\d{8}-\d{2}$/.test(String(id)) ? `#/picks/${id}` : null;
}

function windowForm(stats, el) {
  const bounds = stats && stats.window ? stats.window : {};
  const since = el("input", { id: "since", name: "since", type: "date", value: bounds.since || "" });
  const until = el("input", { id: "until", name: "until", type: "date", value: bounds.until || "" });
  const form = el("form", { id: "stats-window", "aria-label": "Stats window" }, [
    el("div", {}, [el("label", { for: "since" }, ["Since"]), since]),
    el("div", {}, [el("label", { for: "until" }, ["Until"]), until]),
    el("div", {}, [el("button", { type: "submit" }, ["Apply"])]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (since.value) params.set("since", since.value);
    if (until.value) params.set("until", until.value);
    const query = params.toString();
    location.hash = query ? `#/stats?${query}` : "#/stats";
  });
  return form;
}

function draftDayBigBoard(stats, el) {
  const body = stats || {};
  const picks = body.picks || {};
  const excluded = body.excluded || {};
  const angles = Array.isArray(body.angles) ? body.angles : [];
  const slots = Array.isArray(body.slots) ? body.slots : [];
  const tradeBlock = body.trades || {};
  const tradeRows = Array.isArray(tradeBlock.rows) ? tradeBlock.rows : [];
  const verify = body.verify || {};
  const first = verify.firstTry || {};
  const final = verify.final || {};
  const verdicts = verify.verdicts || {};
  const stages = Array.isArray(body.stages) ? body.stages : [];
  const skipped = Array.isArray(body.skipped) ? body.skipped : [];
  const mean = tradeBlock.mean === null || tradeBlock.mean === undefined ? "\u2014" : String(tradeBlock.mean);
  const selftest = Number(excluded.selftest) || 0;
  const children = [
    el("h2", {}, ["Big Board stats"]),
    el("p", { "data-stats": "summary", class: "dd-summary" }, [typeof body.summary === "string" ? body.summary : ""]),
  ];
  if (selftest) {
    const noun = selftest === 1 ? "pick" : "picks";
    children.push(el("p", { class: "meta" }, [`${selftest} selftest ${noun} not counted`]));
  }
  children.push(windowForm(body, el));
  children.push(el("div", { class: "dd-stats-grid" }, [
    el("section", { class: "dd-stat" }, [
      el("h3", {}, ["Win rate by angle"]),
      el("ul", { "aria-label": "Win rate by angle" }, angles.map((row) => winRow(row, el, "data-angle"))),
    ]),
    el("section", { class: "dd-stat" }, [
      el("h3", {}, ["Win rate by slot"]),
      el("ul", { "aria-label": "Win rate by slot" }, slots.map((row) => winRow(row, el, "data-slot"))),
    ]),
    el("section", { class: "dd-stat" }, [
      el("h3", {}, ["Trades per pick"]),
      el("p", { class: "meta" }, [`mean ${mean}`]),
      el("ul", { "aria-label": "Trades per pick" }, tradeRows.map((row) => {
        const href = pickHref(row.pickId);
        const name = href ? el("a", { href }, [String(row.pickId)]) : String(row.pickId);
        return el("li", { "data-pick": row.pickId, "data-trades": row.trades }, [name, ` ${row.trades}`]);
      })),
    ]),
    el("section", { class: "dd-stat" }, [
      el("h3", {}, ["Verify pass rate"]),
      el("div", {
        "aria-label": "Verify pass rate",
        "data-first-try": `${first.num ?? 0}/${first.den ?? 0}`,
        "data-final": `${final.num ?? 0}/${final.den ?? 0}`,
        "data-fix-loops": verify.fixLoops ?? 0,
      }, [
        `first try ${first.num ?? 0}/${first.den ?? 0} · final ${final.num ?? 0}/${final.den ?? 0} · fix loops ${verify.fixLoops ?? 0}`,
        el("p", { class: "meta" }, [
          `VERIFIED ${verdicts.VERIFIED ?? 0} · NOT_VERIFIED ${verdicts.NOT_VERIFIED ?? 0} · INCONCLUSIVE ${verdicts.INCONCLUSIVE ?? 0}`,
        ]),
      ]),
    ]),
    el("section", { class: "dd-stat dd-stat-stages" }, [
      el("h3", {}, ["Time per stage"]),
      el("ul", { "aria-label": "Time per stage" }, stages.map((row) => el("li", {
        "data-stage": row.stage,
        "data-median-ms": row.medianMs,
        "data-picks": row.picks,
      }, [`${row.stage} ${row.medianText}`]))),
    ]),
  ]));
  children.push(el("section", { class: "dd-stat" }, [
    el("h3", {}, ["Skipped logs"]),
    el("ul", { "aria-label": "Skipped logs" }, skipped.map((row) => el("li", {}, [`${row.pickId}: ${row.reason}`]))),
  ]));
  return el("section", {
    class: "panel dd-board",
    "aria-label": "Big Board stats",
    "data-picks": picks.total ?? 0,
    "data-excluded": excluded.selftest ?? 0,
  }, children);
}

globalThis.draftDayBigBoard = draftDayBigBoard;
