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

function flipWidth(rate) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
  return `${Math.round(rate * 100)}%`;
}

function flipMeter(el, rate) {
  const width = flipWidth(rate);
  return el("span", {
    class: "dd-flip",
    style: `--flip:${width || "0%"}`,
    "data-empty": width === null ? "true" : "false",
    "aria-hidden": "true",
  }, [
    el("span", { class: "dd-flip-flipped" }),
    el("span", { class: "dd-flip-held" }),
  ]);
}

function swapHeadline(swap) {
  const judged = count(swap && swap.judged);
  const twoPass = count(swap && swap.twoPass);
  if (judged === 0) return "No judged picks yet";
  if (twoPass === 0) return "No two-pass picks yet";
  return `Reversed pass flipped ${count(swap.flipped)} of ${twoPass} two-pass picks (${percentText(swap.rate)})`;
}

function swapStrictLine(swap) {
  const ids = Array.isArray(swap && swap.strict) ? swap.strict : [];
  return `Strict rule (tie unless both passes agree): no base for ${ids.length ? ids.map((id) => String(id)).join(", ") : "none"}`;
}

function leaders(stats, el) {
  const angles = Array.isArray(stats && stats.angles) ? stats.angles : [];
  const best = angles[0];
  const trades = (stats && stats.trades) || {};
  const first = (stats && stats.verify && stats.verify.firstTry) || {};
  const mean = trades.mean === null || trades.mean === undefined ? "\u2014" : String(trades.mean);
  const swap = (stats && stats.swap) || {};
  const swapTwo = count(swap.twoPass);
  const swapChildren = [
    el("p", { class: "dd-kicker" }, ["Flip rate"]),
    el("strong", {}, [percentText(swap.rate)]),
    flipMeter(el, swapTwo > 0 ? swap.rate : null),
    el("p", { class: "dd-flip-key" }, [
      el("span", { class: "dd-flip-key-flipped" }, ["Flipped"]),
      el("span", { class: "dd-flip-key-held" }, ["Held"]),
    ]),
    el("p", { class: "dd-flip-line" }, [swapHeadline(swap)]),
  ];
  if (swapTwo > 0) swapChildren.push(el("p", { class: "dd-flip-strict" }, [swapStrictLine(swap)]));
  return el("div", { class: "dd-leaders" }, [
    el("article", { class: "dd-tile", "data-leader": "swap" }, swapChildren),
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
  ]);
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

function passFacts(row) {
  const winners = Array.isArray(row && row.winners) ? row.winners : [];
  const models = Array.isArray(row && row.models) ? row.models : [];
  const lines = [];
  const total = Math.max(winners.length, models.length);
  for (let index = 0; index < total; index += 1) {
    const winner = winners[index] ? String(winners[index]) : "none";
    const model = typeof models[index] === "string" && models[index] ? models[index] : "account default";
    lines.push(`Pass ${index + 1} \u00b7 winner ${winner} \u00b7 judge ${model}`);
  }
  return lines;
}

function stateClass(state) {
  if (state === "flipped" || state === "consistent" || state === "single") return `dd-swap-state dd-swap-${state}`;
  return "dd-swap-state";
}

function pickProof(row, el) {
  const id = String(row && row.pickId || "");
  const href = pickHref(id);
  const state = row && row.swap ? String(row.swap) : "";
  const children = [href ? el("a", { href }, [id]) : id];
  if (state) children.push(el("span", { class: stateClass(state) }, [state]));
  for (const line of passFacts(row)) children.push(el("p", {}, [line]));
  return el("div", { class: "dd-swap-proof" }, children);
}

function swapSection(swap, el) {
  const body = swap || {};
  const labels = Array.isArray(body.labels) ? body.labels : [];
  const models = Array.isArray(body.models) ? body.models : [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const strictIds = Array.isArray(body.strict) ? body.strict : [];
  const byId = new Map(rows.map((row) => [row.pickId, row]));
  const children = [
    el("p", { class: "dd-flip-line", "data-swap": "headline" }, [swapHeadline(body)]),
  ];
  if (count(body.twoPass) > 0) children.push(el("p", { class: "dd-flip-strict", "data-swap": "strict" }, [swapStrictLine(body)]));
  children.push(
    el("p", { class: "dd-kicker" }, ["Winner by label"]),
    el("ul", { "aria-label": "Winner by label", class: "dd-swap-labels" }, labels.map((row) => el("li", {
      "data-winner-label": row.label,
      "data-wins": count(row.wins),
      "data-passes": count(row.passes),
    }, [`${row.label} ${count(row.wins)}/${count(row.passes)} ${percentText(row.rate)}`]))),
    el("p", { class: "dd-kicker" }, ["By judge model"]),
    el("ul", { "aria-label": "Swap bias by judge model", class: "dd-swap-models" }, models.map((row) => {
      const ids = Array.isArray(row.pickIds) ? row.pickIds : [];
      return el("li", {
        "data-model": row.key,
        "data-picks": count(row.picks),
        "data-flipped": count(row.flipped),
      }, [
        el("details", {}, [
          el("summary", {}, [
            el("span", { class: "dd-swap-name" }, [String(row.name ?? "")]),
            el("span", { class: "dd-swap-frac" }, [`${count(row.flipped)}/${count(row.picks)}`]),
          ]),
          el("div", { class: "dd-swap-evidence" }, ids.map((id) => pickProof(byId.get(id) || { pickId: id }, el))),
        ]),
        flipMeter(el, row.rate),
      ]);
    })),
    el("p", { class: "dd-kicker" }, ["By pick"]),
    el("div", { class: "dd-swap-head", "aria-hidden": "true" }, [
      el("span", {}, ["Pick"]),
      el("span", {}, ["Swap"]),
      el("span", {}, ["Base"]),
      el("span", {}, ["Judges"]),
    ]),
    el("ul", { "aria-label": "Swap by pick", class: "dd-swap-picks" }, rows.map((row) => {
      const href = pickHref(row.pickId);
      const id = String(row.pickId);
      const judges = Array.isArray(row.models) ? row.models.map((name) => String(name)).filter(Boolean).join(" \u00b7 ") : "";
      const idNode = href
        ? el("a", { href, "data-col": "Pick" }, [id])
        : el("span", { "data-col": "Pick" }, [id]);
      return el("li", {
        "data-pick": row.pickId,
        "data-swap": row.swap,
        "data-base": row.base,
      }, [
        idNode,
        el("span", { class: stateClass(row.swap), "data-col": "Swap" }, [String(row.swap)]),
        el("span", { class: "dd-swap-base", "data-col": "Base" }, [`base ${row.base}`]),
        el("details", {}, [
          el("summary", { "data-col": "Judges" }, [judges || "\u2014"]),
          el("div", { class: "dd-swap-passes" }, passFacts(row).map((line) => el("p", {}, [line]))),
        ]),
      ]);
    })),
  );
  return el("div", {
    "aria-label": "Swap bias",
    "data-judged": count(body.judged),
    "data-two-pass": count(body.twoPass),
    "data-flipped": count(body.flipped),
    "data-single": count(body.single),
    "data-tie-rule": count(body.tieRule),
    "data-strict": strictIds.map((id) => String(id)).join(","),
  }, children);
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
    el("section", { class: "dd-stat dd-stat-swap" }, [
      el("h3", {}, ["Swap bias"]),
      swapSection(body.swap, el),
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
