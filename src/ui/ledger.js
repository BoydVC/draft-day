function prAnchor(repo, number, el) {
  const label = `#${number}`;
  const repoOk = typeof repo === "string" && /^BoydVC\/[A-Za-z0-9._-]+$/.test(repo);
  const numberOk = Number.isInteger(number) && number > 0;
  if (!repoOk || !numberOk) return label;
  return el("a", { href: `https://github.com/${repo}/pull/${number}`, rel: "noreferrer" }, [label]);
}

function pickBits(picks, el) {
  const bits = [];
  const list = Array.isArray(picks) ? picks : [];
  list.forEach((id, index) => {
    if (index) bits.push(" ");
    const text = String(id);
    if (/^p-\d{8}-\d{2}$/.test(text)) bits.push(el("a", { href: `#/picks/${text}`, rel: "noreferrer" }, [text]));
    else bits.push(text);
  });
  return bits;
}

function joinedAnchors(repo, nums, el) {
  if (!nums.length) return ["none"];
  const bits = [];
  nums.forEach((number, index) => {
    if (index) bits.push(", ");
    bits.push(prAnchor(repo, number, el));
  });
  return bits;
}

function driftText(drift) {
  if (!drift || typeof drift.files !== "number") return "Drift · none recorded";
  const noun = drift.files === 1 ? "file" : "files";
  const kind = drift.docsOnly ? "docs-only" : "not docs-only";
  return `Drift · ${drift.files} ${noun} · ${kind}`;
}

function rowDetails(row, repo, el) {
  const number = row && typeof row.number === "number" ? row.number : 0;
  const position = row && row.position != null ? String(row.position) : "";
  const status = row && typeof row.status === "string" ? row.status : "";
  const why = row && typeof row.why === "string" ? row.why : "";
  const title = row && typeof row.title === "string" ? row.title : "";
  const head = row && typeof row.headSha === "string" ? row.headSha.slice(0, 7) : "";
  const verified = row && typeof row.verifiedSha === "string" ? row.verifiedSha.slice(0, 7) : "";
  const picks = Array.isArray(row && row.picks) ? row.picks.map((id) => String(id)) : [];
  const picksShown = pickBits(picks, el);
  const sequence = Array.isArray(row && row.sequence) ? row.sequence : [];
  const items = sequence.map((item) => {
    const source = item && (item.source === "pick" || item.source === "ledger") ? item.source : "";
    const sha = item && typeof item.headSha === "string" ? item.headSha : "";
    const verdict = item && typeof item.verdict === "string" ? item.verdict : "";
    const certainty = item && item.certainty != null ? String(item.certainty) : "";
    const agent = item && typeof item.agentId === "string" && item.agentId ? item.agentId : "none";
    const note = item && typeof item.note === "string" ? ` · ${item.note}` : "";
    return el("li", {}, [`${source} · ${sha} · ${verdict} · certainty ${certainty} · agent ${agent}${note}`]);
  });
  const parent = !row || row.parent == null
    ? el("p", {}, ["No parent. This row starts a stack or sits off it."])
    : el("p", {}, ["Parent ", prAnchor(repo, row.parent, el)]);
  return el("details", {
    class: "dd-row",
    "data-pr": String(number),
    "data-position": position,
    "data-status": status,
    "data-head": head,
    "data-verified": verified,
    "data-picks": picks.join(","),
  }, [
    el("summary", {}, [
      el("span", { "data-label": "Position", class: "dd-pos" }, [position === "" ? "-" : position]),
      el("span", { "data-label": "PR", class: "dd-pr" }, [prAnchor(repo, number, el)]),
      el("span", { "data-label": "Status", class: "dd-status", "data-status": status }, [status]),
      el("span", { "data-label": "Why", class: "dd-why" }, [why]),
      el("span", { "data-label": "Title", class: "dd-title" }, picksShown.length ? [title, " ", ...picksShown] : [title]),
    ]),
    el("div", { class: "dd-audit" }, [
      el("p", { class: "dd-kicker" }, ["Verdict sequence"]),
      items.length ? el("ol", {}, items) : el("p", {}, ["No verdict recorded"]),
      el("p", {}, [driftText(row && row.drift)]),
      parent,
    ]),
  ]);
}

function orderTable(label, list, repo, el) {
  return el("table", { "aria-label": label, class: label === "Merge order" ? "dd-merge" : "dd-off" }, [
    el("caption", {}, [label]),
    el("thead", {}, [el("tr", {}, ["Position", "PR", "Status", "Why", "Title"].map((name) => el("th", { scope: "col" }, [name])))]),
    el("tbody", {}, list.map((row) => el("tr", {}, [el("td", { colspan: "5" }, [rowDetails(row, repo, el)])]))),
  ]);
}

function draftDayLedger(ledger, el) {
  const body = ledger && typeof ledger === "object" ? ledger : {};
  const repo = typeof body.repo === "string" ? body.repo : "";
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const stackRows = rows.filter((row) => row && row.position != null);
  const offRows = rows.filter((row) => row && row.position == null);
  const rerun = Array.isArray(body.rerun) ? body.rerun : [];
  const notDraft = Array.isArray(body.notDraft) ? body.notDraft : [];
  const closed = Array.isArray(body.closed) ? body.closed : [];
  const merged = Array.isArray(body.merged) ? body.merged : [];
  const skipped = body.skipped && typeof body.skipped === "object" ? body.skipped : {};
  const lines = Array.isArray(skipped.lines) ? skipped.lines : [];
  const logs = Array.isArray(skipped.logs) ? skipped.logs : [];
  const skipItems = [];
  for (const skip of lines) skipItems.push(el("li", {}, [`line ${skip && skip.line}: ${skip && skip.reason}`]));
  for (const skip of logs) skipItems.push(el("li", {}, [`skipped log ${skip && skip.pickId}: ${skip && skip.reason}`]));
  const children = [
    el("h2", {}, ["Season ledger"]),
    el("p", { "data-ledger": "summary", class: "dd-summary" }, [typeof body.summary === "string" ? body.summary : ""]),
    el("section", { "aria-label": "Re-run list" }, [
      el("h3", {}, ["Re-run list"]),
      rerun.length
        ? el("ul", { class: "dd-rerun" }, rerun.map((number) => el("li", {}, [prAnchor(repo, number, el)])))
        : el("p", {}, ["none"]),
    ]),
  ];
  if (notDraft.length) {
    const bits = ["NOT DRAFT"];
    notDraft.forEach((number) => {
      bits.push(" ");
      bits.push(prAnchor(repo, number, el));
    });
    children.push(el("p", { role: "alert", "aria-label": "Not draft", class: "dd-alert" }, bits));
  }
  children.push(orderTable("Merge order", stackRows, repo, el));
  children.push(orderTable("Off the stack", offRows, repo, el));
  children.push(el("section", { "aria-label": "Skipped ledger lines" }, [
    el("h3", {}, ["Skipped"]),
    skipItems.length ? el("ul", {}, skipItems) : el("p", {}, ["Nothing skipped"]),
  ]));
  children.push(el("p", {
    "aria-label": "Off the board",
    "data-closed": closed.join(","),
    "data-merged": merged.join(","),
  }, ["Closed ", ...joinedAnchors(repo, closed, el), ". Merged ", ...joinedAnchors(repo, merged, el)]));
  return el("section", {
    class: "dd-ledger panel",
    "aria-label": "Season ledger",
    "data-open": String(typeof body.open === "number" ? body.open : rows.length),
    "data-merge-safe": body.mergeSafeThrough == null ? "none" : String(body.mergeSafeThrough),
    "data-rerun": rerun.join(","),
  }, children);
}

globalThis.draftDayLedger = draftDayLedger;
