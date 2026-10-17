function receiptHead(finding, el) {
  const name = `${finding.pickId} #${finding.seq}`;
  return /^p-\d{8}-\d{2}$/.test(String(finding.pickId))
    ? el("a", { href: `#/picks/${finding.pickId}` }, [name])
    : name;
}

function receiptChildren(finding, el) {
  const bits = [];
  if (finding.pass != null) {
    bits.push(`pass ${finding.pass}`);
    if (finding.cand) bits.push(String(finding.cand));
    else if (finding.label) bits.push(`label ${finding.label}`);
  }
  if (finding.detail) bits.push(String(finding.detail));
  const head = receiptHead(finding, el);
  return bits.length ? [head, ` ${bits.join(" ")}`] : [head];
}

function receiptLine(finding, el) {
  return el("li", {}, receiptChildren(finding, el));
}

function lessonItem(group, el) {
  const proposal = group.proposal;
  const counts = `${group.pickCount} picks · ${group.count} findings`;
  const prominent = group.rank === 1;
  const findings = Array.isArray(group.findings) ? group.findings : [];
  const children = [
    el("h3", {}, [`${group.rank}. ${group.key}`]),
    el("span", { class: "dd-level" }, [group.level]),
    el("p", { class: "meta dd-counts" }, [group.stage ? `${counts} · ${group.stage}` : counts]),
    el("p", { class: "dd-check" }, [proposal.check]),
    el("p", { class: "meta dd-where" }, [`where ${proposal.where}`]),
  ];
  if (prominent && findings[0]) children.push(el("p", { class: "dd-top-receipt" }, receiptChildren(findings[0], el)));
  const listed = prominent ? findings.slice(1) : findings;
  children.push(el("ul", { "aria-label": "Receipts" }, listed.map((finding) => receiptLine(finding, el))));
  return el("li", prominent ? { class: "dd-first" } : {}, children);
}

function oneOffItem(group, el) {
  const noun = group.count === 1 ? "finding" : "findings";
  return el("li", {}, [
    `${group.key} · ${group.count} ${noun}`,
    el("ul", { "aria-label": "Receipts" }, group.findings.map((finding) => receiptLine(finding, el))),
  ]);
}

function draftDayLessons(report, el) {
  const bounds = report && report.window ? report.window : {};
  const since = el("input", {
    id: "since",
    name: "since",
    type: "date",
    value: bounds.since || "",
  });
  const until = el("input", {
    id: "until",
    name: "until",
    type: "date",
    value: bounds.until || "",
  });
  const clear = el("button", { type: "submit", class: "dd-clear", name: "clear" }, ["Clear"]);
  let dropWindow = false;
  clear.addEventListener("click", () => {
    dropWindow = true;
  });
  const form = el("form", { id: "lesson-window", "aria-label": "Window" }, [
    el("div", {}, [el("label", { for: "since" }, ["Since"]), since]),
    el("div", {}, [el("label", { for: "until" }, ["Until"]), until]),
    el("div", { class: "dd-window-actions" }, [
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
    if (since.value) params.set("since", since.value);
    if (until.value) params.set("until", until.value);
    const query = params.toString();
    location.hash = query ? `#/lessons?${query}` : "#/lessons";
  });
  const children = [
    el("h2", {}, ["Locker Room"]),
    el("p", {}, [report && typeof report.summary === "string" ? report.summary : ""]),
  ];
  if (report && Array.isArray(report.lessons) && report.lessons.length) {
    children.push(el("p", { class: "dd-lead" }, ["Fix the first one before the rest."]));
  }
  children.push(form);
  if (report && report.error && !Array.isArray(report.lessons)) {
    children.push(el("p", {}, [String(report.error)]));
  } else if (!report || !report.findings) {
    children.push(el("p", {}, ["No findings yet."]));
  } else {
    children.push(el("h3", {}, ["Lessons"]));
    children.push(el("ul", { "aria-label": "Lessons" }, (report.lessons || []).map((group) => lessonItem(group, el))));
    children.push(el("h3", {}, ["One-offs"]));
    children.push(el("ul", { "aria-label": "One-offs" }, (report.oneOffs || []).map((group) => oneOffItem(group, el))));
  }
  return el("section", { class: "panel dd-lessons", "aria-label": "Locker Room" }, children);
}

globalThis.draftDayLessons = draftDayLessons;
