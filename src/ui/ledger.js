function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function short(sha) {
  return typeof sha === "string" ? sha.slice(0, 7) : "";
}

function prHref(repo, number) {
  const match = /^BoydVC\/([A-Za-z0-9._-]+)$/.exec(String(repo ?? ""));
  const n = Number(number);
  if (!match || !Number.isInteger(n) || n < 1) return null;
  return "https://github.com/BoydVC/" + match[1] + "/pull/" + String(n);
}

function prLink(repo, number, el) {
  const label = "#" + String(number);
  const href = prHref(repo, number);
  if (!href) return label;
  return el("a", { href: href, rel: "noreferrer" }, [label]);
}

function pickLink(id, el) {
  const text = String(id);
  if (!/^p-\d{8}-\d{2}$/.test(text)) return text;
  return el("a", { href: "#/picks/" + text }, [text]);
}

function kids(value) {
  return Array.isArray(value) ? value : [value];
}

function joinBits(bits) {
  const out = [];
  bits.forEach((bit, index) => {
    if (index > 0) out.push(", ");
    out.push(bit);
  });
  return out;
}

function driftText(drift) {
  if (!drift || typeof drift.files !== "number") return "Drift · none recorded";
  const noun = drift.files === 1 ? "file" : "files";
  const kind = drift.docsOnly ? "docs-only" : "not docs-only";
  return "Drift · " + String(drift.files) + " " + noun + " · " + kind;
}

function sequenceList(row, el) {
  const sequence = Array.isArray(row && row.sequence) ? row.sequence : [];
  if (!sequence.length) return el("p", {}, ["No verdict recorded"]);
  return el("ol", { class: "dd-seq" }, sequence.map((item) => {
    const source = item && (item.source === "pick" || item.source === "ledger") ? item.source : "";
    const sha = item && typeof item.headSha === "string" ? item.headSha : "";
    const verdict = item && typeof item.verdict === "string" ? item.verdict : "";
    const certainty = item && item.certainty != null ? String(item.certainty) : "";
    const agent = item && typeof item.agentId === "string" && item.agentId ? item.agentId : "none";
    const note = item && typeof item.note === "string" && item.note ? " · " + item.note : "";
    return el("li", {}, [source + " · " + sha + " · " + verdict + " · certainty " + certainty + " · agent " + agent + note]);
  }));
}

function parentLine(row, repo, el) {
  if (!row || row.parent == null) return el("p", {}, ["No parent. This row starts a stack or sits off it."]);
  return el("p", {}, ["Parent ", prLink(repo, row.parent, el)]);
}

function rowEl(row, repo, el) {
  const picks = Array.isArray(row && row.picks) ? row.picks : [];
  const position = row && row.position != null ? String(row.position) : "";
  const status = row && row.status ? String(row.status) : "";
  const statusAttrs = { class: "dd-status", "data-status": status };
  if (status === "docs-only") statusAttrs.title = "docs-only change since verify (still safe)";
  const summary = [
    el("span", { class: "dd-pos" }, [position === "" ? "-" : position]),
    prLink(repo, row && row.number, el),
    el("span", statusAttrs, [status]),
    el("span", { class: "dd-why" }, [row && typeof row.why === "string" ? row.why : ""]),
    el("span", { class: "dd-title" }, [row && typeof row.title === "string" ? row.title : ""]),
  ];
  for (const id of picks) summary.push(pickLink(id, el));
  const rowAttrs = {
    class: "dd-row",
    "data-pr": String(row && row.number != null ? row.number : ""),
    "data-position": position,
    "data-status": status,
    "data-head": short(row && row.headSha),
    "data-verified": short(row && row.verifiedSha),
    "data-picks": picks.join(","),
  };
  if (position === "" && Number(row && row.number) === 4) rowAttrs.title = "#4 is not in the stack";
  return el("details", rowAttrs, [
    el("summary", {}, summary),
    el("div", { class: "dd-audit" }, [
      el("p", { class: "dd-kicker" }, ["Verdict sequence"]),
      sequenceList(row, el),
      el("p", {}, [driftText(row && row.drift)]),
      parentLine(row, repo, el),
    ]),
  ]);
}

function draftDayLedger(ledger, el) {
  const body = ledger || {};
  const repo = typeof body.repo === "string" ? body.repo : "";
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const stack = rows.filter((row) => row && row.position != null);
  const off = rows.filter((row) => !row || row.position == null);
  const open = count(body.open);
  const mergeSafe = Number.isInteger(body.mergeSafeThrough) ? body.mergeSafeThrough : null;
  const rerun = Array.isArray(body.rerun) ? body.rerun : [];
  const notDraft = Array.isArray(body.notDraft) ? body.notDraft : [];
  const skipped = body.skipped || {};
  const lines = Array.isArray(skipped.lines) ? skipped.lines : [];
  const logs = Array.isArray(skipped.logs) ? skipped.logs : [];
  const closed = Array.isArray(body.closed) ? body.closed : [];
  const merged = Array.isArray(body.merged) ? body.merged : [];
  const call = open === 0
    ? "No open PRs"
    : mergeSafe === null
      ? "Not merge-safe yet"
      : ["Merge-safe through ", prLink(repo, mergeSafe, el)];
  const next = rerun.length === 0
    ? (mergeSafe !== null && open > 0 ? "Nothing to re-run. The stack is clear." : "Nothing to re-run.")
    : ["Re-run ", ...joinBits(rerun.map((number) => prLink(repo, number, el))), " before you merge."];
  const offNumbers = off.map((row) => Number(row && row.number)).filter((number) => Number.isInteger(number));
  const legendBits = [
    "The number in parentheses is how many pull requests are in the stack.",
    "docs-only means a docs-only change since verify (still safe).",
  ];
  if (offNumbers.indexOf(4) !== -1) legendBits.push("#4 is not in the stack.");
  else if (off.length) legendBits.push("Off stack means that pull request is not in the stack.");
  const children = [
    el("h2", { class: "dd-call" }, kids(call)),
    el("p", { class: "dd-next", "aria-label": "Re-run list" }, kids(next)),
    el("p", {
      class: "dd-summary",
      "data-ledger": "summary",
      title: "docs-only means a docs-only change since verify (still safe). Off stack means the pull request is not in the stack.",
    }, [typeof body.summary === "string" ? body.summary : ""]),
  ];
  if (open > 0) {
    children.push(el("p", { class: "dd-legend", "data-ledger": "legend" }, [legendBits.join(" ")]));
  }
  children.push(
    el("h3", {}, ["Merge order"]),
    el("ol", { "aria-label": "Merge order" }, stack.map((row) => rowEl(row, repo, el))),
    el("h3", {}, ["Off the stack"]),
    el("ul", { "aria-label": "Off the stack" }, off.map((row) => rowEl(row, repo, el))),
  );
  if (notDraft.length) {
    children.push(el("div", { role: "alert", "aria-label": "Not draft" }, [
      el("h3", {}, ["Not draft"]),
      el("ul", {}, notDraft.map((number) => el("li", {}, [prLink(repo, number, el)]))),
    ]));
  }
  const skippedChildren = [el("h3", {}, ["Skipped"])];
  for (const skip of lines) skippedChildren.push(el("p", {}, ["line " + String(skip.line) + ": " + String(skip.reason)]));
  for (const skip of logs) skippedChildren.push(el("p", {}, ["skipped log " + String(skip.pickId) + ": " + String(skip.reason)]));
  if (lines.length === 0 && logs.length === 0) skippedChildren.push(el("p", {}, ["none"]));
  children.push(el("div", { "aria-label": "Skipped ledger lines" }, skippedChildren));
  children.push(el("div", {
    "aria-label": "Off the board",
    "data-closed": closed.join(","),
    "data-merged": merged.join(","),
  }, [
    el("h3", {}, ["Off the board"]),
    el("p", {}, ["Closed"]),
    closed.length ? el("ul", {}, closed.map((number) => el("li", {}, [prLink(repo, number, el)]))) : el("p", {}, ["none"]),
    el("p", {}, ["Merged"]),
    merged.length ? el("ul", {}, merged.map((number) => el("li", {}, [prLink(repo, number, el)]))) : el("p", {}, ["none"]),
  ]));
  return el("section", {
    class: "dd-ledger panel",
    "aria-label": "Season ledger",
    "data-open": String(open),
    "data-merge-safe": mergeSafe == null ? "none" : String(mergeSafe),
    "data-rerun": rerun.join(","),
  }, children);
}

globalThis.draftDayLedger = draftDayLedger;
