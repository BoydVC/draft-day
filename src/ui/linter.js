// Scout clipboard. The server grades the document; this file only paints the report.
(function () {
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

function chip(text, attrs) {
  return el("span", Object.assign({ class: "chip" }, attrs || {}), [text]);
}

function checklist(label, className, items) {
  return el("section", { class: className }, [
    el("h3", {}, [label]),
    el("ul", { class: "dd-linter-list", "aria-label": label }, items),
  ]);
}

function sourceSection(doc) {
  if (!doc) return null;
  const bits = [el("h3", {}, ["Scout text"])];
  if (doc.restatement) bits.push(el("p", {}, [doc.restatement]));
  for (const line of doc.acceptance || []) {
    bits.push(el("p", {}, [`${line.id} WHEN ${line.when} THE SYSTEM SHALL ${line.shall}`]));
  }
  for (const item of doc.rubric || []) {
    bits.push(el("p", {}, [`${item.id} ${item.howToGrade || ""}`]));
  }
  for (const angle of doc.angles || []) bits.push(el("p", {}, [angle]));
  for (const item of doc.forbidden || []) bits.push(el("p", {}, [item]));
  return el("section", { class: "dd-linter-source", "aria-label": "Scout text" }, bits);
}

function paint(id, doc, report, submit, draft) {
  const safe = report || {
    ok: false,
    summary: "fail · no report",
    criteria: [],
    ears: [],
    angles: [],
    hard: [],
    soft: [],
  };
  const pick = /^p-\d{8}-\d{2}$/.test(id);
  const nav = [el("a", { href: "#/" }, ["Big Board"])];
  if (pick) nav.unshift(el("a", { href: `#/picks/${id}` }, ["Pick page"]));
  const criteria = (safe.criteria || []).map((item) => el("li", { "data-criterion": item.id, "data-severity": item.severity }, [
    el("span", { class: "dd-linter-id" }, [item.id]),
    chip(item.severity, { "data-severity": item.severity }),
  ]));
  const ears = (safe.ears || []).map((line) => el("li", { "data-ears": line.id, "data-status": line.status }, [
    el("span", { class: "dd-linter-id" }, [line.id]),
    chip(line.status, { "data-status": line.status }),
  ]));
  const angles = (safe.angles || []).map((pair) => el("li", { "data-pair": `${pair.i}-${pair.j}`, "data-collide": String(pair.collide) }, [
    el("span", { class: "dd-linter-id" }, [`${pair.i}-${pair.j}`]),
    el("span", { class: "dd-linter-score" }, [Number(pair.score).toFixed(2)]),
    chip(pair.collide ? "collide" : "clear", { "data-collide": String(pair.collide) }),
  ]));
  const hardItems = (safe.hard || []).map((finding) => el("li", {}, [`${finding.kind}:${finding.id}  ${finding.why}`]));
  const softItems = (safe.soft || []).map((finding) => el("li", {}, [`${finding.kind}:${finding.id}  ${finding.why}`]));
  const box = el("textarea", {
    id: "lint-document",
    "aria-label": "Lint document",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
  });
  if (draft) box.value = draft;
  const error = el("p", { class: "dd-linter-error", role: "status" }, [""]);
  const button = el("button", { type: "button" }, ["Lint"]);
  button.addEventListener("click", () => {
    if (typeof submit !== "function") return;
    error.textContent = "";
    void submit(box.value).then((result) => {
      if (!result || result.error || !result.report) {
        error.textContent = result && result.error ? result.error : "Lint failed.";
        return;
      }
      const nextDoc = result.document && typeof result.document === "object" ? result.document : doc;
      paint(id, nextDoc, result.report, submit, box.value);
    }).catch(() => {
      error.textContent = "Lint failed.";
    });
  });
  const root = el("article", {
    class: "dd-linter",
    "aria-label": "Scouting linter",
    "data-pick-id": id || "fixture",
    "data-ok": safe.ok === true ? "true" : "false",
  }, [
    el("p", { class: "dd-linter-nav" }, nav),
    el("h2", {}, [`Scouting linter \u00b7 ${id || "fixture"}`]),
    el("p", { class: "chip dd-linter-summary", "data-linter": "summary", role: "status" }, [safe.summary]),
    el("div", { class: "dd-linter-lists" }, [
      checklist("Rubric gradeability", "dd-linter-rubric", criteria),
      checklist("EARS coverage", "dd-linter-ears", ears),
      checklist("Angle pairs", "dd-linter-angles", angles),
    ]),
    el("section", { class: "dd-linter-findings" }, [
      el("h3", {}, ["Hard findings"]),
      el("ul", { class: "dd-linter-list", "aria-label": "Hard findings" }, hardItems),
    ]),
    el("section", { class: "dd-linter-findings" }, [
      el("h3", {}, ["Soft warnings"]),
      el("ul", { class: "dd-linter-list", "aria-label": "Soft warnings" }, softItems),
    ]),
    sourceSection(doc),
    el("div", { class: "dd-linter-paste" }, [
      el("p", { class: "dd-linter-paste-label" }, ["Paste a scout, then Lint"]),
      box,
      button,
      error,
    ]),
  ].filter((child) => child != null));
  document.getElementById("app").replaceChildren(root);
}

function show(id, doc, report, submit, draft) {
  paint(id, doc, report, submit, draft || "");
}

function missing(submit) {
  paint("fixture", null, {
    ok: false,
    summary: "fail \u00b7 no pick",
    criteria: [],
    ears: [],
    angles: [],
    hard: [],
    soft: [],
  }, submit, "");
}

globalThis.draftDayLinter = { show, missing };
})();
