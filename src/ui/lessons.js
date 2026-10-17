function countsLine(group) {
  const base = `${group.pickCount} picks · ${group.count} findings`;
  return group.stage ? `${base} · ${group.stage}` : base;
}

function findingNoun(count) {
  return count === 1 ? "finding" : "findings";
}

function receiptLink(finding, el) {
  const pickId = finding.pickId == null ? "" : String(finding.pickId);
  const name = `${pickId} #${finding.seq}`;
  if (/^p-\d{8}-\d{2}$/.test(pickId)) return el("a", { href: `#/picks/${pickId}` }, [name]);
  return name;
}

function receiptItem(finding, el) {
  const parts = [receiptLink(finding, el)];
  if (finding.kind === "gate" || finding.kind === "score" || finding.kind === "judge") {
    if (finding.pass !== null && finding.pass !== undefined) parts.push(` pass ${finding.pass}`);
    if (finding.cand) parts.push(` ${finding.cand}`);
    else if (finding.label) parts.push(` label ${finding.label}`);
  }
  if (finding.detail) parts.push(` ${finding.detail}`);
  return el("li", {}, parts);
}

function receiptDetails(findings, el) {
  return el("details", {}, [
    el("summary", {}, ["Receipts"]),
    el("ul", { class: "locker-receipts", "aria-label": "Receipts" }, findings.map((finding) => receiptItem(finding, el))),
  ]);
}

function lessonItem(lesson, el) {
  const proposal = lesson.proposal || {};
  const findings = Array.isArray(lesson.findings) ? lesson.findings : [];
  const prominent = lesson.rank === 1;
  const children = [
    el("h3", {}, [`${lesson.rank}. ${lesson.key}`]),
    el("span", { class: "locker-chip" }, [lesson.level == null ? "" : String(lesson.level)]),
    el("p", { class: "locker-counts" }, [countsLine(lesson)]),
    el("p", { class: "locker-check" }, [proposal.check == null ? "" : String(proposal.check)]),
    el("p", { class: "locker-where" }, [`where ${proposal.where == null ? "" : String(proposal.where)}`]),
  ];
  if (prominent && findings[0]) children.push(el("p", { class: "locker-top-receipt" }, [receiptLink(findings[0], el)]));
  children.push(receiptDetails(findings, el));
  return el("li", { class: prominent ? "locker-first" : "locker-short" }, children);
}

function oneOffItem(group, el) {
  const findings = Array.isArray(group.findings) ? group.findings : [];
  return el("li", { class: "locker-short" }, [
    el("p", { class: "locker-counts" }, [`${group.key} · ${group.count} ${findingNoun(group.count)}`]),
    receiptDetails(findings, el),
  ]);
}

function windowForm(report, el) {
  const bounds = report.window || {};
  const since = typeof bounds.since === "string" ? bounds.since : "";
  const until = typeof bounds.until === "string" ? bounds.until : "";
  const sinceInput = el("input", { id: "lesson-since", name: "since", type: "date", value: since });
  const untilInput = el("input", { id: "lesson-until", name: "until", type: "date", value: until });
  const clear = el("button", { type: "submit", class: "locker-clear", name: "clear" }, ["Clear"]);
  let dropWindow = false;
  clear.addEventListener("click", () => {
    dropWindow = true;
  });
  const form = el("form", { id: "lesson-window", class: "locker-window", "aria-label": "Window" }, [
    el("div", {}, [el("label", { for: "lesson-since" }, ["Since"]), sinceInput]),
    el("div", {}, [el("label", { for: "lesson-until" }, ["Until"]), untilInput]),
    el("div", { class: "locker-actions" }, [
      el("button", { type: "submit" }, ["Show"]),
      clear,
    ]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (dropWindow || (event.submitter && event.submitter.name === "clear")) {
      dropWindow = false;
      location.hash = "#/lessons";
      return;
    }
    const params = new URLSearchParams();
    if (sinceInput.value) params.set("since", sinceInput.value);
    if (untilInput.value) params.set("until", untilInput.value);
    const query = params.toString();
    location.hash = query ? `#/lessons?${query}` : "#/lessons";
  });
  return form;
}

function draftDayLessons(report, el) {
  const data = report && typeof report === "object" ? report : {};
  const lessons = Array.isArray(data.lessons) ? data.lessons : [];
  const oneOffs = Array.isArray(data.oneOffs) ? data.oneOffs : [];
  const findings = typeof data.findings === "number" ? data.findings : 0;
  const summary = typeof data.summary === "string" ? data.summary : "";
  const error = typeof data.error === "string" ? data.error : "";
  const body = [
    el("h2", {}, ["Locker Room"]),
    el("p", { class: "locker-summary" }, [summary]),
  ];
  if (lessons.length) body.push(el("p", { class: "locker-lead" }, ["Fix the first one before the rest."]));
  body.push(windowForm(data, el));
  if (error) body.push(el("p", { role: "alert" }, [error]));
  if (findings === 0) body.push(el("p", { class: "locker-empty" }, ["No findings yet."]));
  if (lessons.length) {
    body.push(el("h3", {}, ["Lessons"]));
    body.push(el("ul", { class: "locker-tasks", "aria-label": "Lessons" }, lessons.map((lesson) => lessonItem(lesson, el))));
  }
  if (oneOffs.length) {
    body.push(el("h3", {}, ["One-offs"]));
    body.push(el("ul", { class: "locker-oneoffs", "aria-label": "One-offs" }, oneOffs.map((group) => oneOffItem(group, el))));
  }
  return el("section", { class: "panel locker", "aria-label": "Locker Room" }, body);
}

globalThis.draftDayLessons = draftDayLessons;
