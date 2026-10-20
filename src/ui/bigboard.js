function percentText(rate) {
  return rate === null || rate === undefined ? "\u2014" : `${Math.round(rate * 100)}%`;
}

function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function walkNote(row) {
  const n = Number(row && row.walkovers) || 0;
  if (n === 0) return "0";
  if (n === 1) return "1 (+1 walkover)";
  return `${n} (+${n} walkovers)`;
}

function winText(row) {
  return `${row.name} ${row.wins}/${row.entries} ${percentText(row.rate)}`;
}

function winRow(row, el, attr) {
  const children = [
    el("span", { class: "dd-win-main" }, [winText(row)]),
    el("span", { class: "dd-walk", "data-label": "Walkovers" }, [`Walkovers ${walkNote(row)}`]),
  ];
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

function tileMeter(el, rate) {
  return el("meter", {
    class: "dd-meter",
    min: "0",
    max: "1",
    value: rate === null || rate === undefined ? "0" : String(rate),
    "aria-hidden": "true",
  });
}

function leaders(stats, el) {
  const angles = Array.isArray(stats && stats.angles) ? stats.angles : [];
  const best = angles[0];
  const trades = (stats && stats.trades) || {};
  const first = (stats && stats.verify && stats.verify.firstTry) || {};
  const mean = trades.mean === null || trades.mean === undefined ? "\u2014" : String(trades.mean);
  return el("div", { class: "dd-leaders" }, [
    el("article", { class: "dd-tile", "data-leader": "angle" }, [
      el("p", { class: "dd-kicker" }, ["Best angle"]),
      el("strong", {}, [best ? String(best.name) : "\u2014"]),
      el("p", { class: "dd-record" }, [best ? `${count(best.wins)}/${count(best.entries)} \u00b7 ${percentText(best.rate)}` : "\u2014"]),
      tileMeter(el, best ? best.rate : 0),
    ]),
    el("article", { class: "dd-tile", "data-leader": "trades" }, [
      el("p", { class: "dd-kicker" }, ["Trades per pick"]),
      el("strong", {}, [mean]),
      el("p", { class: "dd-record" }, [`${count(trades.total)} grafted`]),
    ]),
    el("article", { class: "dd-tile", "data-leader": "verify" }, [
      el("p", { class: "dd-kicker" }, ["First-try verify"]),
      el("strong", {}, [percentText(first.rate)]),
      el("p", { class: "dd-record" }, [`${count(first.num)}/${count(first.den)}`]),
      tileMeter(el, first.rate),
    ]),
    el("article", { class: "dd-tile", "data-leader": "swap" }, [
      el("p", { class: "dd-kicker" }, ["Swap bias"]),
      el("strong", {}, [swapHeadline(stats && stats.swap)]),
      el("p", { class: "dd-record" }, [swapRecord(stats && stats.swap)]),
      tileMeter(el, count(stats && stats.swap && stats.swap.twoPass) ? stats.swap.rate : 0),
    ]),
  ]);
}

function pickHref(id) {
  return /^p-\d{8}-\d{2}$/.test(String(id)) ? `#/picks/${id}` : null;
}

function swapHeadline(swap) {
  const judged = count(swap && swap.judged);
  const twoPass = count(swap && swap.twoPass);
  const flipped = count(swap && swap.flipped);
  if (!judged) return "No judged picks yet";
  if (!twoPass) return "No two-pass picks yet";
  return `Reversed pass flipped ${flipped} of ${twoPass} two-pass picks (${percentText(swap.rate)})`;
}

function swapRecord(swap) {
  const twoPass = count(swap && swap.twoPass);
  if (!twoPass) return percentText(swap && swap.rate);
  return `${count(swap.flipped)}/${twoPass} flipped · tie rule ${count(swap.tieRule)}`;
}

function swapStateClass(state) {
  if (state === "flipped" || state === "consistent" || state === "single") return `dd-swap-state dd-swap-${state}`;
  return "dd-swap-state";
}

function passFacts(row) {
  const winners = Array.isArray(row && row.winners) ? row.winners : [];
  const models = Array.isArray(row && row.models) ? row.models : [];
  const lines = [];
  const total = Math.max(winners.length, models.length);
  for (let index = 0; index < total; index += 1) {
    const winner = winners[index] ? String(winners[index]) : "none";
    const model = typeof models[index] === "string" && models[index] ? models[index] : "account default";
    lines.push(`Pass ${index + 1} · winner ${winner} · judge ${model}`);
  }
  return lines;
}

function passBody(row, el) {
  const href = pickHref(row && row.pickId);
  const children = passFacts(row).map((line) => el("p", {}, [line]));
  children.push(href ? el("a", { href }, [String(row.pickId)]) : String(row && row.pickId || ""));
  return el("div", { class: "dd-swap-passes" }, children);
}

function strictNode(swap, el) {
  if (!count(swap && swap.twoPass)) return null;
  const ids = Array.isArray(swap.strict) ? swap.strict : [];
  if (!ids.length) {
    return el("p", { "data-swap": "strict" }, ["Strict rule (tie unless both passes agree): no base for none"]);
  }
  const children = ["Strict rule (tie unless both passes agree): no base for "];
  ids.forEach((id, index) => {
    if (index) children.push(", ");
    const href = pickHref(id);
    children.push(href ? el("a", { href }, [String(id)]) : String(id));
  });
  return el("p", { "data-swap": "strict", class: "dd-swap-strict" }, children);
}

function swapSection(stats, el) {
  const swap = (stats && stats.swap) || {};
  const labels = Array.isArray(swap.labels) ? swap.labels : [];
  const models = Array.isArray(swap.models) ? swap.models : [];
  const rows = Array.isArray(swap.rows) ? swap.rows : [];
  const strict = Array.isArray(swap.strict) ? swap.strict : [];
  const byId = new Map(rows.map((row) => [row.pickId, row]));
  const children = [
    el("h3", {}, ["Swap bias"]),
    el("p", { "data-swap": "headline", class: "dd-swap-headline" }, [swapHeadline(swap)]),
  ];
  const strictEl = strictNode(swap, el);
  if (strictEl) children.push(strictEl);
  if (count(swap.twoPass)) {
    children.push(el("div", { class: "dd-flip-meter", "aria-hidden": "true" }, [
      el("span", { class: "dd-flip-flipped", style: `flex-grow: ${count(swap.flipped)}` }),
      el("span", { class: "dd-flip-rest", style: `flex-grow: ${count(swap.consistent)}` }),
    ]));
  }
  children.push(el("p", { class: "meta" }, ["Open a judge model or a pick to see who won each pass."]));
  children.push(el("p", { class: "dd-kicker" }, ["Winner by label"]));
  if (labels.some((row) => count(row.wins) > 0)) {
    children.push(el("div", { class: "dd-label-meter", "aria-hidden": "true" }, labels.filter((row) => count(row.wins) > 0).map((row) => (
      el("span", { class: "dd-label-box", style: `flex-grow: ${count(row.wins)}` }, [String(row.label)])
    ))));
  }
  children.push(el("ul", { "aria-label": "Winner by label" }, labels.map((row) => el("li", {
    "data-winner-label": row.label,
    "data-wins": count(row.wins),
    "data-passes": count(row.passes),
  }, [`${row.label} ${count(row.wins)}/${count(row.passes)} ${percentText(row.rate)}`]))));
  children.push(el("ul", { "aria-label": "Swap bias by judge model", class: "dd-swap-models" }, models.map((row) => {
    const ids = Array.isArray(row.pickIds) ? row.pickIds : [];
    return el("li", {
      "data-model": row.key,
      "data-picks": count(row.picks),
      "data-flipped": count(row.flipped),
    }, [
      el("details", {}, [
        el("summary", {}, [
          el("span", { class: "dd-swap-model-name" }, [String(row.name)]),
          el("span", { class: "dd-swap-model-rate" }, [`${count(row.flipped)}/${count(row.picks)} flipped`]),
        ]),
        el("div", { class: "dd-swap-evidence" }, ids.map((id) => {
          const pick = byId.get(id);
          const href = pickHref(id);
          const state = pick && pick.swap ? String(pick.swap) : "";
          const proof = [
            href ? el("a", { href }, [String(id)]) : String(id),
          ];
          if (state) proof.push(el("span", { class: swapStateClass(state) }, [state]));
          if (pick) proof.push(...passFacts(pick).map((line) => el("p", {}, [line])));
          return el("div", { class: "dd-swap-proof" }, proof);
        })),
      ]),
    ]);
  })));
  children.push(el("div", { class: "dd-swap-head", "aria-hidden": "true" }, [
    el("span", {}, ["Pick"]),
    el("span", {}, ["Swap"]),
    el("span", {}, ["Base"]),
    el("span", {}, ["Judges"]),
  ]));
  children.push(el("ul", { "aria-label": "Swap by pick", class: "dd-swap-picks" }, rows.map((row) => {
    const href = pickHref(row.pickId);
    const state = String(row.swap || "");
    const judges = Array.isArray(row.models) ? row.models.map((name) => String(name)).join(" · ") : "";
    const idNode = href
      ? el("a", { href, "data-col": "Pick" }, [String(row.pickId)])
      : el("span", { "data-col": "Pick" }, [String(row.pickId)]);
    return el("li", {
      "data-pick": row.pickId,
      "data-swap": state,
      "data-base": row.base,
    }, [
      idNode,
      el("span", { class: swapStateClass(state), "data-col": "Swap" }, [state]),
      el("span", { "data-col": "Base" }, [row.base == null ? "" : String(row.base)]),
      el("details", {}, [
        el("summary", { "data-col": "Judges" }, [judges || "\u2014"]),
        passBody(row, el),
      ]),
    ]);
  })));
  return el("section", {
    class: "dd-stat dd-swap",
    "aria-label": "Swap bias",
    "data-judged": count(swap.judged),
    "data-two-pass": count(swap.twoPass),
    "data-flipped": count(swap.flipped),
    "data-single": count(swap.single),
    "data-tie-rule": count(swap.tieRule),
    "data-strict": strict.join(","),
  }, children);
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
  children.push(leaders(body, el));
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
    swapSection(body, el),
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
