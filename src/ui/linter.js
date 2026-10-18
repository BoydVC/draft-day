// The linter panel paints a LintReport. app.js fetches; this file does not.
const PICK_HREF = /^p-\d{8}-\d{2}$/;

function badAttrs(bad) {
  return bad ? { "aria-invalid": "true", "aria-current": "true" } : {};
}

function coverageGrid(ears) {
  const checks = [];
  for (const row of ears) {
    if (row.check && checks.indexOf(row.check) < 0) checks.push(row.check);
  }
  const head = [el("th", { scope: "col" }, ["EARS"])];
  checks.forEach((check, index) => {
    head.push(el("th", { scope: "col", "aria-label": check }, [String(index + 1)]));
  });
  const body = ears.map((row) => {
    const missing = row.status === "MISSING";
    const cells = [
      el("th", { scope: "row", "aria-label": row.id, ...badAttrs(missing) }, [row.id]),
    ];
    for (const check of checks) {
      const bound = row.status === "ok" && row.check === check;
      cells.push(el("td", { "aria-label": `${row.id} ${bound ? "bound" : "empty"}` }, [bound ? "●" : ""]));
    }
    return el("tr", {}, cells);
  });
  return el("div", { class: "dd-linter-grid-wrap" }, [
    el("table", { class: "dd-linter-grid", "aria-label": "EARS by check" }, [
      el("thead", {}, [el("tr", {}, head)]),
      el("tbody", {}, body),
    ]),
  ]);
}

function earsDefs(ears) {
  return el("dl", { class: "dd-linter-defs", "aria-label": "EARS by check" }, ears.map((row) => {
    const missing = row.status === "MISSING";
    return el("div", {}, [
      el("dt", {}, [row.id]),
      el("dd", badAttrs(missing), [missing ? "MISSING" : row.check || "bound"]),
    ]);
  }));
}

function angleGrid(pairs) {
  let count = 0;
  for (const pair of pairs) count = Math.max(count, pair.i + 1, pair.j + 1);
  const at = (i, j) => pairs.find((pair) => pair.i === i && pair.j === j)
    || pairs.find((pair) => pair.i === j && pair.j === i)
    || null;
  const head = [el("th", { scope: "col" }, ["∠"])];
  for (let index = 0; index < count; index += 1) head.push(el("th", { scope: "col" }, [String(index)]));
  const body = [];
  for (let i = 0; i < count; i += 1) {
    const cells = [el("th", { scope: "row" }, [String(i)])];
    for (let j = 0; j < count; j += 1) {
      if (i === j) {
        cells.push(el("td", { "aria-label": `${i} same` }, ["—"]));
        continue;
      }
      const pair = at(i, j);
      const collide = Boolean(pair && pair.collide);
      const score = pair ? String(pair.score) : "";
      cells.push(el("td", { "aria-label": `${i}-${j} ${score}`, ...badAttrs(collide) }, [score]));
    }
    body.push(el("tr", {}, cells));
  }
  return el("div", { class: "dd-linter-grid-wrap" }, [
    el("table", { class: "dd-linter-grid", "aria-label": "Angle score matrix" }, [
      el("thead", {}, [el("tr", {}, head)]),
      el("tbody", {}, body),
    ]),
  ]);
}

function angleDefs(pairs) {
  return el("dl", { class: "dd-linter-defs", "aria-label": "Angle score matrix" }, pairs.map((pair) => el("div", {}, [
    el("dt", {}, [`${pair.i}-${pair.j}`]),
    el("dd", badAttrs(pair.collide), [`${pair.score} ${pair.collide ? "collide" : "ok"}`]),
  ])));
}

function sourceBlock(doc) {
  if (!doc) return null;
  const bits = [];
  if (doc.restatement) bits.push(doc.restatement);
  for (const line of doc.acceptance || []) {
    if (line.when) bits.push(line.when);
    if (line.shall) bits.push(line.shall);
  }
  for (const angle of doc.angles || []) bits.push(angle);
  for (const item of doc.forbidden || []) bits.push(item);
  if (!bits.length) return null;
  return el("div", { class: "dd-linter-source" }, bits.map((bit) => el("p", {}, [bit])));
}

function show(model, hooks) {
  const report = model.report || { ok: false, summary: "fail · 1 hard", criteria: [], ears: [], angles: [], hard: [], soft: [] };
  const pickId = model.pickId || "fixture";
  const pickHref = PICK_HREF.test(pickId) ? `#/picks/${pickId}` : "#/";
  const criteria = report.criteria || [];
  const ears = report.ears || [];
  const angles = report.angles || [];
  const hard = report.hard || [];
  const soft = report.soft || [];
  const area = el("textarea", { "aria-label": "Lint document" });
  if (model.source) area.value = model.source;
  const form = el("form", { id: "linter-paste", "aria-label": "Paste a scout" }, [
    area,
    el("button", { type: "submit" }, ["Lint"]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (hooks && typeof hooks.onLint === "function") hooks.onLint(area.value);
  });
  const root = el("article", {
    class: "dd-linter",
    "aria-label": "Scouting linter",
    "data-pick-id": pickId,
    "data-ok": report.ok ? "true" : "false",
  }, [
    el("p", { "data-linter": "summary", class: "chip", "data-status": report.ok ? "drafted" : "failed" }, [report.summary]),
    form,
    el("div", { class: "dd-linter-columns" }, [
      el("section", { class: "panel" }, [
        el("h3", {}, ["Rubric gradeability"]),
        el("ul", { "aria-label": "Rubric gradeability" }, criteria.map((row) => el("li", {
          "data-criterion": row.id,
          "data-severity": row.severity,
        }, [`${row.id} ${row.severity} ${row.why}`]))),
      ]),
      el("section", { class: "panel" }, [
        el("h3", {}, ["EARS coverage"]),
        el("ul", { "aria-label": "EARS coverage" }, ears.map((row) => el("li", {
          "data-ears": row.id,
          "data-status": row.status,
          ...badAttrs(row.status === "MISSING"),
        }, [`${row.id} ${row.status} ${row.check || ""} ${row.why}`]))),
        coverageGrid(ears),
        earsDefs(ears),
      ]),
      el("section", { class: "panel" }, [
        el("h3", {}, ["Angle pairs"]),
        el("ul", { "aria-label": "Angle pairs" }, angles.map((pair) => el("li", {
          "data-pair": `${pair.i}-${pair.j}`,
          "data-collide": pair.collide ? "true" : "false",
          ...badAttrs(pair.collide),
        }, [`${pair.i}-${pair.j} ${pair.score} ${pair.why}`]))),
        angleGrid(angles),
        angleDefs(angles),
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
    sourceBlock(model.document),
    el("p", { class: "dd-linter-nav" }, [
      el("a", { href: pickHref }, ["Pick page"]),
      el("a", { href: "#/" }, ["Big Board"]),
    ]),
    el("h2", { class: "dd-linter-title" }, [`Scouting linter · ${pickId}`]),
  ].filter((child) => child != null));
  document.getElementById("app").replaceChildren(root);
}

globalThis.draftDayLinter = { show };
