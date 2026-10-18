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

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function stop() {}

function draftDayLinter(report, options) {
  const opts = options || {};
  const pickId = opts.pickId ? String(opts.pickId) : "fixture";
  const ok = Boolean(report && report.ok);
  const summary = report && typeof report.summary === "string" ? report.summary : "";
  const criteria = rows(report && report.criteria);
  const ears = rows(report && report.ears);
  const angles = rows(report && report.angles);
  const hard = rows(report && report.hard);
  const soft = rows(report && report.soft);
  const lines = rows(opts.lines);
  const status = ok ? (soft.length ? "awaiting_go" : "drafted") : "failed";
  const textarea = el("textarea", { "aria-label": "Lint document" });
  const button = el("button", { type: "button" }, ["Lint"]);
  const form = el("form", { id: "linter-paste", class: "dd-linter-paste", "aria-label": "Paste a scout" }, [
    textarea,
    button,
  ]);
  const lintPaste = () => {
    if (typeof opts.onPaste === "function") opts.onPaste(textarea.value);
  };
  button.addEventListener("click", lintPaste);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    lintPaste();
  });
  const nav = [el("a", { href: "#/" }, ["Big Board"])];
  if (/^p-\d{8}-\d{2}$/.test(pickId)) nav.push(el("a", { href: `#/picks/${pickId}` }, ["Pick page"]));
  const root = el("article", {
    class: "dd-linter",
    "aria-label": "Scouting linter",
    "data-pick-id": pickId,
    "data-ok": ok ? "true" : "false",
  }, [
    el("p", { class: "dd-linter-nav" }, nav),
    el("h2", {}, ["Scouting linter"]),
    el("p", { class: "dd-linter-id" }, [pickId]),
    el("p", { class: "chip dd-linter-summary", "data-linter": "summary", "data-status": status }, [summary]),
    form,
    el("div", { class: "dd-linter-columns" }, [
      el("section", { class: "panel" }, [
        el("h3", {}, ["Rubric gradeability"]),
        el("ul", { "aria-label": "Rubric gradeability" }, criteria.map((row) => el("li", {
          "data-criterion": row.id,
          "data-severity": row.severity,
        }, [`${row.id} ${row.severity}`]))),
      ]),
      el("section", { class: "panel" }, [
        el("h3", {}, ["EARS coverage"]),
        el("ul", { "aria-label": "EARS coverage" }, ears.map((row) => el("li", {
          "data-ears": row.id,
          "data-status": row.status,
        }, [`${row.id} ${row.status}`]))),
      ]),
      el("section", { class: "panel" }, [
        el("h3", {}, ["Angle pairs"]),
        el("ul", { "aria-label": "Angle pairs" }, angles.map((pair) => el("li", {
          "data-pair": `${pair.i}-${pair.j}`,
          "data-collide": pair.collide ? "true" : "false",
        }, [`${pair.i}-${pair.j} ${pair.collide ? "collide" : "ok"} (${Number(pair.score).toFixed(2)})`]))),
      ]),
    ]),
    el("section", { class: "panel" }, [
      el("h3", {}, ["Hard findings"]),
      el("ul", { "aria-label": "Hard findings" }, hard.map((row) => el("li", {}, [`${row.kind}:${row.id} ${row.why}`]))),
    ]),
    el("section", { class: "panel" }, [
      el("h3", {}, ["Soft warnings"]),
      el("ul", { "aria-label": "Soft warnings" }, soft.map((row) => el("li", {}, [`${row.kind}:${row.id} ${row.why}`]))),
    ]),
    lines.length ? el("ul", { "aria-label": "Report text" }, lines.map((line) => el("li", {}, [String(line)]))) : null,
  ].filter(Boolean));
  return root;
}

draftDayLinter.stop = stop;
globalThis.draftDayLinter = draftDayLinter;
