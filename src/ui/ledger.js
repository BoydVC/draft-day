function draftDayLedger(ledger, el) {
  const body = ledger || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const stack = Array.isArray(body.stack) ? body.stack : [];
  const rerun = Array.isArray(body.rerun) ? body.rerun : [];
  const notDraft = Array.isArray(body.notDraft) ? body.notDraft : [];
  const closed = Array.isArray(body.closed) ? body.closed : [];
  const merged = Array.isArray(body.merged) ? body.merged : [];
  const repo = typeof body.repo === "string" ? body.repo : "";
  const open = Number.isInteger(body.open) ? body.open : rows.length;
  const mergeSafe = Number.isInteger(body.mergeSafeThrough) ? body.mergeSafeThrough : null;
  const stackRows = rows.filter((row) => stack.includes(row.number) && row.position !== null && row.position !== undefined);
  const offRows = rows.filter((row) => !stack.includes(row.number));

  function repoName() {
    const match = /^BoydVC\/([A-Za-z0-9._-]+)$/.exec(repo);
    return match ? match[1] : null;
  }

  function prLink(number) {
    const label = `#${number}`;
    const name = repoName();
    const n = typeof number === "number" ? number : Number(number);
    if (!name || !Number.isInteger(n) || n < 1) return label;
    return el("a", { href: `https://github.com/BoydVC/${name}/pull/${n}`, rel: "noreferrer" }, [label]);
  }

  function pickLink(id) {
    const text = typeof id === "string" ? id : String(id ?? "");
    if (!/^p-\d{8}-\d{2}$/.test(text)) return text;
    return el("a", { href: `#/picks/${text}` }, [text]);
  }

  function joinBits(bits) {
    const out = [];
    bits.forEach((bit, index) => {
      if (index > 0) out.push(", ");
      out.push(bit);
    });
    return out;
  }

  function sha7(value) {
    return typeof value === "string" && value ? value.slice(0, 7) : "";
  }

  function card(row) {
    const head = sha7(row.headSha);
    const verified = sha7(row.verifiedSha);
    const picks = Array.isArray(row.picks) ? row.picks : [];
    const position = row.position === null || row.position === undefined || row.position === "" ? "" : String(row.position);
    const headBits = [el("span", { class: "ledger-sha" }, [head || "unknown head"])];
    if (verified && verified !== head) headBits.push(el("span", { class: "ledger-verified" }, [`verified ${verified}`]));
    const pickBits = picks.map((id) => pickLink(id));
    const children = [
      el("div", { class: "ledger-head" }, [
        el("span", { class: "ledger-pos" }, [position || "off"]),
        el("span", { class: "chip ledger-chip", "data-status": row.status }, [String(row.status ?? "")]),
        prLink(row.number),
        ...headBits,
      ]),
      el("p", { class: "ledger-why" }, [String(row.why ?? "")]),
      el("p", { class: "ledger-title" }, [String(row.title ?? "")]),
    ];
    if (pickBits.length) children.push(el("p", { class: "ledger-picks" }, joinBits(pickBits)));
    if (position === "" && row.parent !== null && row.parent !== undefined) {
      children.push(el("p", { class: "ledger-parent" }, ["parent ", prLink(row.parent)]));
    }
    return el("li", {
      class: "ledger-card",
      "data-pr": row.number,
      "data-position": position,
      "data-status": row.status ?? "",
      "data-head": head,
      "data-verified": verified,
      "data-picks": picks.join(","),
    }, children);
  }

  const call = open === 0
    ? "No open PRs"
    : mergeSafe === null
      ? "Not merge-safe yet"
      : el("span", {}, ["Merge-safe through ", prLink(mergeSafe)]);
  const next = rerun.length === 0
    ? (mergeSafe !== null && open > 0 ? "Nothing to re-run. The stack is clear." : "Nothing to re-run.")
    : el("span", {}, ["Re-run ", ...joinBits(rerun.map((number) => prLink(number))), rerun.length === 1 ? " before you merge." : " before you merge."]);
  const skippedLines = body.skipped && Array.isArray(body.skipped.lines) ? body.skipped.lines : [];
  const skippedLogs = body.skipped && Array.isArray(body.skipped.logs) ? body.skipped.logs : [];
  const children = [
    el("p", { class: "ledger-kicker" }, ["Merge desk"]),
    el("h2", { class: "ledger-call" }, [call]),
    el("p", { class: "ledger-next", "aria-label": "Re-run list" }, [next]),
    el("ol", { class: "ledger-rail", "aria-label": "Merge order" }, stackRows.map(card)),
    el("p", { class: "ledger-summary", "data-ledger": "summary" }, [typeof body.summary === "string" ? body.summary : ""]),
    el("section", { class: "ledger-off", "aria-label": "Off the stack" }, [
      el("h3", {}, ["Off the stack"]),
      el("ul", { class: "ledger-rail ledger-rail-off" }, offRows.map(card)),
    ]),
  ];
  if (notDraft.length) {
    children.push(el("p", { role: "alert", "aria-label": "Not draft", class: "ledger-alert" }, [
      "Not a draft: ",
      ...joinBits(notDraft.map((number) => prLink(number))),
    ]));
  }
  children.push(el("div", { "aria-label": "Skipped ledger lines" }, [
    ...skippedLines.map((skip) => el("p", {}, [`line ${skip.line}: ${skip.reason}`])),
    ...skippedLogs.map((skip) => el("p", {}, [`skipped log ${skip.pickId}: ${skip.reason}`])),
  ]));
  const boardBits = [];
  if (closed.length) boardBits.push("Closed ", ...joinBits(closed.map((number) => prLink(number))));
  if (merged.length) boardBits.push(boardBits.length ? ". Merged " : "Merged ", ...joinBits(merged.map((number) => prLink(number))));
  const notes = rows.flatMap((row) => (Array.isArray(row.notes) ? row.notes.filter((note) => typeof note === "string" && note) : []));
  if (notes.length) {
    children.push(el("div", { class: "ledger-notes" }, notes.map((note) => el("p", { class: "ledger-note" }, [note]))));
  }
  children.push(el("section", {
    class: "ledger-board",
    "aria-label": "Off the board",
    "data-closed": closed.join(","),
    "data-merged": merged.join(","),
  }, [
    el("h3", {}, ["Off the board"]),
    el("p", {}, boardBits.length ? boardBits : ["None closed or merged."]),
  ]));
  return el("section", {
    class: "panel ledger",
    "aria-label": "Season ledger",
    "data-open": open,
    "data-merge-safe": mergeSafe === null ? "none" : String(mergeSafe),
    "data-rerun": rerun.join(","),
  }, children);
}

globalThis.draftDayLedger = draftDayLedger;
