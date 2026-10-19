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

function rowEl(row, repo, el) {
  const picks = Array.isArray(row && row.picks) ? row.picks : [];
  const position = row && row.position != null ? String(row.position) : "";
  const children = [
    el("span", { class: "dd-pos" }, [position === "" ? "-" : position]),
    prLink(repo, row && row.number, el),
    el("span", { class: "dd-status", "data-status": row && row.status }, [row && row.status ? String(row.status) : ""]),
    el("span", { class: "dd-why" }, [row && typeof row.why === "string" ? row.why : ""]),
    el("span", { class: "dd-title" }, [row && typeof row.title === "string" ? row.title : ""]),
  ];
  for (const id of picks) children.push(pickLink(id, el));
  return el("li", {
    "data-pr": String(row && row.number != null ? row.number : ""),
    "data-position": position,
    "data-status": row && row.status ? String(row.status) : "",
    "data-head": short(row && row.headSha),
    "data-verified": short(row && row.verifiedSha),
    "data-picks": picks.join(","),
  }, children);
}

function numberList(label, numbers, repo, el) {
  const items = Array.isArray(numbers) ? numbers : [];
  return el("div", { "aria-label": label }, [
    el("h3", {}, [label]),
    items.length
      ? el("ul", {}, items.map((number) => el("li", {}, [prLink(repo, number, el)])))
      : el("p", {}, ["none"]),
  ]);
}

function draftDayLedger(ledger, el) {
  const body = ledger || {};
  const repo = typeof body.repo === "string" ? body.repo : "";
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const stack = rows.filter((row) => row && row.position != null);
  const off = rows.filter((row) => !row || row.position == null);
  const notDraft = Array.isArray(body.notDraft) ? body.notDraft : [];
  const skipped = body.skipped || {};
  const lines = Array.isArray(skipped.lines) ? skipped.lines : [];
  const logs = Array.isArray(skipped.logs) ? skipped.logs : [];
  const closed = Array.isArray(body.closed) ? body.closed : [];
  const merged = Array.isArray(body.merged) ? body.merged : [];
  const children = [
    el("h2", {}, ["Season ledger"]),
    el("p", { "data-ledger": "summary" }, [typeof body.summary === "string" ? body.summary : ""]),
    numberList("Re-run list", body.rerun, repo, el),
    el("ol", { "aria-label": "Merge order" }, stack.map((row) => rowEl(row, repo, el))),
    el("ul", { "aria-label": "Off the stack" }, off.map((row) => rowEl(row, repo, el))),
  ];
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
    "data-open": String(count(body.open)),
    "data-merge-safe": body.mergeSafeThrough == null ? "none" : String(body.mergeSafeThrough),
    "data-rerun": Array.isArray(body.rerun) ? body.rerun.join(",") : "",
  }, children);
}

globalThis.draftDayLedger = draftDayLedger;
