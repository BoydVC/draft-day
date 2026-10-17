function timelineEl(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children || []) {
    if (child === undefined || child === null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const TERMINAL_STAGES = new Set(["Draft Pick", "Failed", "Cancelled"]);

function startedClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? "");
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function linkEl(link) {
  return timelineEl("a", {
    href: link.href,
    target: "_blank",
    rel: "noopener noreferrer",
  }, [link.label]);
}

function stageList(stages) {
  return timelineEl("ul", { "aria-label": "Stages", class: "timeline-stages" }, stages.map((span) => {
    const text = TERMINAL_STAGES.has(span.stage) ? span.stage : `${span.stage} ${span.durationText}`;
    return timelineEl("li", {}, [text]);
  }));
}

function runTable(runs) {
  const head = timelineEl("tr", {}, ["Run", "Agent", "Started", "Duration", "Outcome"].map((name) => timelineEl("th", {}, [name])));
  const rows = runs.map((run) => {
    const agent = run.agentUrl ? linkEl({ href: run.agentUrl, label: `Agent ${run.label}` }) : (run.agentId || "");
    return timelineEl("tr", {}, [
      timelineEl("td", {}, [run.label]),
      timelineEl("td", {}, [agent]),
      timelineEl("td", {}, [startedClock(run.startedAt)]),
      timelineEl("td", {}, [run.durationText]),
      timelineEl("td", {}, [run.outcome]),
    ]);
  });
  return timelineEl("div", { class: "timeline-runs" }, [
    timelineEl("table", { "aria-label": "Runs" }, [
      timelineEl("thead", {}, [head]),
      timelineEl("tbody", {}, rows),
    ]),
  ]);
}

function eventList(entries) {
  const list = timelineEl("ul", { "aria-label": "Events", class: "timeline-events" });
  let stage = "";
  let items = null;
  for (const entry of entries) {
    if (!items || stage !== entry.stage) {
      stage = entry.stage;
      items = timelineEl("ul", {});
      list.append(timelineEl("li", {}, [timelineEl("h3", {}, [entry.stage]), items]));
    }
    const row = timelineEl("li", {}, [`+${entry.sinceStartText} ${entry.title}`]);
    for (const link of entry.links || []) {
      row.append(document.createTextNode(" "));
      row.append(linkEl(link));
    }
    items.append(row);
  }
  return list;
}

function decisionLog(timeline) {
  if (!timeline) return [timelineEl("p", { class: "empty" }, ["No events."])];
  return [
    timelineEl("p", { class: "timeline-summary" }, [timeline.summary]),
    stageList(timeline.stages || []),
    runTable(timeline.runs || []),
    eventList(timeline.entries || []),
  ];
}
