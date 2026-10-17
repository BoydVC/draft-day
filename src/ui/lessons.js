function pickHref(id) {
  return /^p-\d{8}-\d{2}$/.test(id) ? `#/picks/${id}` : "";
}

function receiptRows(findings, el) {
  return (findings || []).map((finding) => {
    const id = String(finding.pickId);
    const pickText = `${id} #${finding.seq}`;
    const href = pickHref(id);
    const pickCell = href ? el("a", { href }, [pickText]) : pickText;
    const judgeKind = finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge";
    const passText = judgeKind && typeof finding.pass === "number" ? `pass ${finding.pass}` : "";
    let candText = "";
    if (judgeKind) {
      if (finding.cand) candText = String(finding.cand);
      else if (finding.label) candText = `label ${finding.label}`;
    }
    return el("tr", { role: "listitem" }, [
      el("td", {}, [pickCell]),
      el("td", {}, [String(finding.seq)]),
      el("td", {}, [passText]),
      el("td", {}, [candText]),
      el("td", {}, [finding.detail || ""]),
    ]);
  });
}

function receiptsTable(findings, el) {
  const columns = ["pick", "seq", "pass", "cand", "detail"];
  return el("table", { class: "receipts" }, [
    el("caption", {}, ["Receipts"]),
    el("thead", {}, [el("tr", {}, columns.map((name) => el("th", { scope: "col" }, [name])))]),
    el("tbody", { role: "list", "aria-label": "Receipts" }, receiptRows(findings, el)),
  ]);
}

function countLine(group) {
  const base = `${group.pickCount} picks · ${group.count} findings`;
  return group.stage ? `${base} · ${group.stage}` : base;
}

function lessonItem(group, el) {
  const proposal = group.proposal || {};
  return el("li", { class: "lesson" }, [
    el("div", { class: "lesson-head" }, [
      el("h3", {}, [`${group.rank}. ${group.key}`]),
      el("span", { class: "chip lesson-level" }, [group.level]),
    ]),
    el("p", { class: "lesson-meta" }, [countLine(group)]),
    el("p", { class: "lesson-check" }, [proposal.check || ""]),
    el("p", { class: "lesson-where" }, [`where ${proposal.where || ""}`]),
    receiptsTable(group.findings, el),
  ]);
}

function oneOffItem(group, el) {
  const noun = group.count === 1 ? "finding" : "findings";
  return el("li", { class: "one-off" }, [
    el("p", {}, [`${group.key} · ${group.count} ${noun}`]),
    receiptsTable(group.findings, el),
  ]);
}

function draftDayLessons(report, el) {
  const lessons = Array.isArray(report && report.lessons) ? report.lessons : [];
  const oneOffs = Array.isArray(report && report.oneOffs) ? report.oneOffs : [];
  const summary = report && typeof report.summary === "string" ? report.summary : "";
  const bounds = report && report.window ? report.window : {};
  const sinceInput = el("input", {
    id: "lesson-since",
    name: "since",
    type: "date",
    value: bounds.since || "",
  });
  const untilInput = el("input", {
    id: "lesson-until",
    name: "until",
    type: "date",
    value: bounds.until || "",
  });
  const form = el("form", { "aria-label": "Window", id: "lesson-window", class: "locker-form" }, [
    el("p", { class: "window-name" }, ["Window"]),
    el("div", {}, [el("label", { for: "lesson-since" }, ["Since"]), sinceInput]),
    el("div", {}, [el("label", { for: "lesson-until" }, ["Until"]), untilInput]),
    el("button", { type: "submit" }, ["Show"]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (sinceInput.value) params.set("since", sinceInput.value);
    if (untilInput.value) params.set("until", untilInput.value);
    const query = params.toString();
    location.hash = query ? `#/lessons?${query}` : "#/lessons";
  });
  const children = [
    el("h2", {}, ["Locker Room"]),
    el("p", { class: "locker-summary" }, [summary]),
    form,
  ];
  if (!lessons.length && !oneOffs.length) {
    children.push(el("p", {}, ["No findings yet."]));
  } else {
    if (lessons.length) {
      children.push(el("h3", { class: "locker-list-title" }, ["Lessons"]));
      children.push(el("ul", { "aria-label": "Lessons" }, lessons.map((group) => lessonItem(group, el))));
    }
    if (oneOffs.length) {
      children.push(el("h3", { class: "locker-list-title" }, ["One-offs"]));
      children.push(el("ul", { "aria-label": "One-offs" }, oneOffs.map((group) => oneOffItem(group, el))));
    }
  }
  return el("section", { class: "panel locker", "aria-label": "Locker Room" }, children);
}

globalThis.draftDayLessons = draftDayLessons;
