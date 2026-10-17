function receiptLine(finding, el) {
  const name = `${finding.pickId} #${finding.seq}`;
  const head = /^p-\d{8}-\d{2}$/.test(String(finding.pickId))
    ? el("a", { href: `#/picks/${finding.pickId}` }, [name])
    : name;
  const bits = [];
  if (finding.pass != null) {
    bits.push(`pass ${finding.pass}`);
    if (finding.cand) bits.push(String(finding.cand));
    else if (finding.label) bits.push(`label ${finding.label}`);
  }
  if (finding.detail) bits.push(String(finding.detail));
  const tail = bits.length ? ` ${bits.join(" ")}` : "";
  return el("li", {}, tail ? [head, tail] : [head]);
}

function lessonItem(group, el) {
  const proposal = group.proposal;
  const counts = `${group.pickCount} picks · ${group.count} findings`;
  return el("li", {}, [
    el("h3", {}, [`${group.rank}. ${group.key}`]),
    el("span", { class: "dd-level" }, [group.level]),
    el("p", { class: "meta" }, [group.stage ? `${counts} · ${group.stage}` : counts]),
    el("p", {}, [proposal.check]),
    el("p", { class: "meta" }, [`where ${proposal.where}`]),
    el("ul", { "aria-label": "Receipts" }, group.findings.map((finding) => receiptLine(finding, el))),
  ]);
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
  const form = el("form", { id: "lesson-window", "aria-label": "Window" }, [
    el("div", {}, [el("label", { for: "since" }, ["Since"]), since]),
    el("div", {}, [el("label", { for: "until" }, ["Until"]), until]),
    el("button", { type: "submit" }, ["Show"]),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (since.value) params.set("since", since.value);
    if (until.value) params.set("until", until.value);
    const query = params.toString();
    location.hash = query ? `#/lessons?${query}` : "#/lessons";
  });
  const children = [
    el("h2", {}, ["Locker Room"]),
    el("p", {}, [report && typeof report.summary === "string" ? report.summary : ""]),
    form,
  ];
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
