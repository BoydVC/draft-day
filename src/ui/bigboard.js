// Paints BigBoardStats. app.js fetches; this file does not.
(function () {
  const PICK_HREF = /^p-\d{8}-\d{2}$/;

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function percentText(rate) {
    if (rate === null || rate === undefined) return "—";
    const n = Number(rate);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(n * 100)}%`;
  }

  function clockText(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return "0s";
    const seconds = Math.floor(n / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  function pickLabel(id, el) {
    const text = String(id);
    return PICK_HREF.test(text) ? el("a", { href: `#/picks/${text}` }, [text]) : text;
  }

  function walkNote(row) {
    const n = Number(row && row.walkovers) || 0;
    if (n === 0) return "0";
    if (n === 1) return "1 (+1 walkover)";
    return `${n} (+${n} walkovers)`;
  }

  function rateCell(row, el) {
    const wins = Number(row && row.wins) || 0;
    const entries = Number(row && row.entries) || 0;
    const pct = percentText(row ? row.rate : null);
    const kids = [`${wins}/${entries} ${pct}`];
    if (row && row.rate !== null && row.rate !== undefined && Number.isFinite(Number(row.rate))) {
      kids.push(el("meter", {
        min: "0",
        max: "1",
        value: String(row.rate),
        "aria-label": pct,
      }, []));
    }
    return el("td", { "data-label": "Rate" }, kids);
  }

  function winTable(label, rows, keyAttr, title, el) {
    const body = list(rows).map((row) => el("tr", {
      [keyAttr]: String(row.key),
      "data-wins": String(row.wins),
      "data-entries": String(row.entries),
      "data-walkovers": String(row.walkovers),
    }, [
      el("th", { scope: "row", "data-label": title }, [String(row.name)]),
      el("td", { "data-label": "W" }, [String(row.wins)]),
      el("td", { "data-label": "Entries" }, [String(row.entries)]),
      el("td", { "data-label": "Walkovers" }, [walkNote(row)]),
      rateCell(row, el),
    ]));
    return el("table", {
      "aria-label": label,
      class: keyAttr === "data-angle" ? "dd-angles dd-span" : "dd-slots",
    }, [
      el("caption", {}, [label]),
      el("thead", {}, [el("tr", {}, [
        el("th", { scope: "col" }, [title]),
        el("th", { scope: "col" }, ["W"]),
        el("th", { scope: "col" }, ["Entries"]),
        el("th", { scope: "col" }, ["Walkovers"]),
        el("th", { scope: "col" }, ["Rate"]),
      ])]),
      el("tbody", {}, body),
    ]);
  }

  function draftDayBigBoard(stats, el) {
    const body = stats && typeof stats === "object" ? stats : {};
    const picks = body.picks && typeof body.picks === "object" ? body.picks : {};
    const excluded = body.excluded && typeof body.excluded === "object" ? body.excluded : {};
    const bounds = body.window && typeof body.window === "object" ? body.window : {};
    const summary = typeof body.summary === "string" ? body.summary : "";
    const verify = body.verify && typeof body.verify === "object" ? body.verify : {};
    const first = verify.firstTry && typeof verify.firstTry === "object" ? verify.firstTry : {};
    const finalPass = verify.final && typeof verify.final === "object" ? verify.final : {};
    const verdicts = verify.verdicts && typeof verify.verdicts === "object" ? verify.verdicts : {};
    const trades = body.trades && typeof body.trades === "object" ? body.trades : {};
    const tradeRows = list(trades.rows);
    const stages = list(body.stages);
    const skipped = list(body.skipped);
    const selftest = Number(excluded.selftest) || 0;
    const since = el("input", {
      id: "stats-since",
      name: "since",
      type: "date",
      value: bounds.since || "",
    });
    const until = el("input", {
      id: "stats-until",
      name: "until",
      type: "date",
      value: bounds.until || "",
    });
    const form = el("form", { id: "stats-window", "aria-label": "Stats window" }, [
      el("div", {}, [el("label", { for: "stats-since" }, ["Since"]), since]),
      el("div", {}, [el("label", { for: "stats-until" }, ["Until"]), until]),
      el("button", { type: "submit" }, ["Apply"]),
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      if (since.value) params.set("since", since.value);
      if (until.value) params.set("until", until.value);
      const query = params.toString();
      location.hash = query ? `#/stats?${query}` : "#/stats";
    });
    const children = [
      el("h2", { "aria-hidden": "true" }, ["Big Board stats"]),
      el("p", { class: "dd-box-summary", "data-stats": "summary" }, [summary]),
    ];
    if (selftest > 0) {
      const noun = selftest === 1 ? "pick" : "picks";
      children.push(el("p", { class: "dd-box-excluded" }, [`${selftest} selftest ${noun} not counted`]));
    }
    children.push(el("p", { class: "dd-box-counts" }, [
      el("span", { class: "chip", "data-status": "drafted" }, [`${Number(picks.drafted) || 0} drafted`]),
      el("span", { class: "chip", "data-status": "failed" }, [`${Number(picks.failed) || 0} failed`]),
      el("span", { class: "chip", "data-status": "cancelled" }, [`${Number(picks.cancelled) || 0} cancelled`]),
      el("span", { class: "chip", "data-status": "judging" }, [`${Number(picks.live) || 0} live`]),
    ]));
    children.push(form);
    const tradeMean = trades.mean === null || trades.mean === undefined ? "—" : String(trades.mean);
    const stageTotal = stages.reduce((sum, row) => sum + (Number(row.totalMs) || 0), 0);
    children.push(el("div", { class: "dd-box-sheets" }, [
      winTable("Win rate by angle", body.angles, "data-angle", "Angle", el),
      winTable("Win rate by slot", body.slots, "data-slot", "Slot", el),
      el("table", { "aria-label": "Trades per pick", class: "dd-trades" }, [
        el("caption", {}, [`Trades per pick · mean ${tradeMean}`]),
        el("thead", {}, [el("tr", {}, [
          el("th", { scope: "col" }, ["Pick"]),
          el("th", { scope: "col" }, ["Base"]),
          el("th", { scope: "col" }, ["Trades"]),
        ])]),
        el("tbody", {}, tradeRows.map((row) => el("tr", {
          "data-pick": String(row.pickId),
          "data-trades": String(row.trades),
        }, [
          el("th", { scope: "row", "data-label": "Pick" }, [pickLabel(row.pickId, el)]),
          el("td", { "data-label": "Base" }, [row.base == null ? "—" : String(row.base)]),
          el("td", { "data-label": "Trades" }, [String(row.trades)]),
        ]))),
        el("tfoot", {}, [el("tr", {}, [
          el("th", { scope: "row", "data-label": "Total" }, ["Total"]),
          el("td", { "data-label": "Picks" }, [String(Number(trades.picks) || 0)]),
          el("td", { "data-label": "Trades" }, [String(Number(trades.total) || 0)]),
        ])]),
      ]),
      el("table", {
        "aria-label": "Verify pass rate",
        class: "dd-verify",
        "data-first-try": `${Number(first.num) || 0}/${Number(first.den) || 0}`,
        "data-final": `${Number(finalPass.num) || 0}/${Number(finalPass.den) || 0}`,
        "data-fix-loops": String(Number(verify.fixLoops) || 0),
      }, [
        el("caption", {}, ["Verify pass rate"]),
        el("thead", {}, [el("tr", {}, [
          el("th", { scope: "col" }, ["First try"]),
          el("th", { scope: "col" }, ["Final"]),
          el("th", { scope: "col" }, ["Fix loops"]),
          el("th", { scope: "col" }, ["VERIFIED"]),
          el("th", { scope: "col" }, ["NOT_VERIFIED"]),
          el("th", { scope: "col" }, ["INCONCLUSIVE"]),
        ])]),
        el("tbody", {}, [el("tr", {}, [
          el("td", { "data-label": "First try" }, [`${Number(first.num) || 0}/${Number(first.den) || 0}`]),
          el("td", { "data-label": "Final" }, [`${Number(finalPass.num) || 0}/${Number(finalPass.den) || 0}`]),
          el("td", { "data-label": "Fix loops" }, [String(Number(verify.fixLoops) || 0)]),
          el("td", { "data-label": "VERIFIED" }, [String(Number(verdicts.VERIFIED) || 0)]),
          el("td", { "data-label": "NOT_VERIFIED" }, [String(Number(verdicts.NOT_VERIFIED) || 0)]),
          el("td", { "data-label": "INCONCLUSIVE" }, [String(Number(verdicts.INCONCLUSIVE) || 0)]),
        ])]),
      ]),
      el("table", { "aria-label": "Time per stage", class: "dd-stages" }, [
        el("caption", {}, ["Time per stage"]),
        el("thead", {}, [el("tr", {}, [
          el("th", { scope: "col" }, ["Stage"]),
          el("th", { scope: "col" }, ["Picks"]),
          el("th", { scope: "col" }, ["Median"]),
          el("th", { scope: "col" }, ["Total"]),
        ])]),
        el("tbody", {}, stages.map((row) => el("tr", {
          "data-stage": String(row.stage),
          "data-median-ms": String(row.medianMs),
          "data-picks": String(row.picks),
        }, [
          el("th", { scope: "row", "data-label": "Stage" }, [String(row.stage)]),
          el("td", { "data-label": "Picks" }, [String(row.picks)]),
          el("td", { "data-label": "Median" }, [row.medianText != null && row.medianText !== "" ? String(row.medianText) : clockText(row.medianMs)]),
          el("td", { "data-label": "Total" }, [clockText(row.totalMs)]),
        ]))),
        el("tfoot", {}, [el("tr", {}, [
          el("th", { scope: "row", "data-label": "Total" }, ["All stages"]),
          el("td", { "data-label": "Picks" }, [""]),
          el("td", { "data-label": "Median" }, [""]),
          el("td", { "data-label": "Total" }, [clockText(stageTotal)]),
        ])]),
      ]),
      el("table", { "aria-label": "Skipped logs", class: "dd-skipped dd-span" }, [
        el("caption", {}, ["Skipped logs"]),
        el("thead", {}, [el("tr", {}, [
          el("th", { scope: "col" }, ["Pick"]),
          el("th", { scope: "col" }, ["Reason"]),
        ])]),
        el("tbody", {}, skipped.length
          ? skipped.map((row) => el("tr", {}, [
            el("th", { scope: "row", "data-label": "Pick" }, [pickLabel(row.pickId, el)]),
            el("td", { "data-label": "Reason" }, [String(row.reason)]),
          ]))
          : [el("tr", {}, [el("td", { colspan: "2", "data-label": "Skipped" }, ["None"])])]),
      ]),
    ]));
    return el("section", {
      class: "panel dd-bigboard",
      "aria-label": "Big Board stats",
      "data-picks": String(Number(picks.total) || 0),
      "data-excluded": String(selftest),
    }, children);
  }

  globalThis.draftDayBigBoard = draftDayBigBoard;
})();
