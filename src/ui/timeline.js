function startedClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function agentCell(run, el) {
  if (run.agentUrl) {
    return el("a", {
      href: run.agentUrl,
      target: "_blank",
      rel: "noopener noreferrer",
    }, [`Agent ${run.label}`]);
  }
  return run.agentId || "";
}

function stageGroups(entries) {
  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (!last || last.stage !== entry.stage) groups.push({ stage: entry.stage, entries: [entry] });
    else last.entries.push(entry);
  }
  return groups;
}

function eventItem(entry, el) {
  const children = [el("span", { class: "dd-when" }, [`+${entry.sinceStartText}`]), ` ${entry.title}`];
  for (const link of entry.links || []) {
    children.push(" ");
    children.push(el("a", {
      href: link.href,
      target: "_blank",
      rel: "noopener noreferrer",
    }, [link.label]));
  }
  return el("li", { class: "dd-event" }, children);
}

function draftDayTimeline(view, el) {
  if (!view) return el("p", { class: "empty" }, ["No events."]);
  const stageItems = (view.stages || []).map((span) => {
    const terminal = !view.live && span.to === null;
    return el("li", {}, [terminal ? span.stage : `${span.stage} ${span.durationText}`]);
  });
  const columns = ["Run", "Agent", "Started", "Duration", "Outcome"];
  const rows = (view.runs || []).map((run) => el("tr", {}, [
    el("td", {}, [run.label]),
    el("td", {}, [agentCell(run, el)]),
    el("td", {}, [startedClock(run.startedAt)]),
    el("td", {}, [run.durationText]),
    el("td", {}, [run.outcome]),
  ]));
  const events = stageGroups(view.entries || []).map((group) => el("li", {}, [
    el("h3", { class: "dd-stage-name" }, [group.stage]),
    el("ul", { class: "dd-stage-events" }, group.entries.map((entry) => eventItem(entry, el))),
  ]));
  return el("div", { class: "dd-log" }, [
    el("p", { class: "dd-summary" }, [view.summary]),
    el("div", { class: "dd-block" }, [
      el("h3", {}, ["Stages"]),
      el("ul", { class: "dd-stages", "aria-label": "Stages" }, stageItems),
    ]),
    el("div", { class: "dd-block" }, [
      el("h3", {}, ["Runs"]),
      el("div", { class: "dd-runs-scroll" }, [
        el("table", { "aria-label": "Runs" }, [
          el("thead", {}, [el("tr", {}, columns.map((name) => el("th", { scope: "col" }, [name])))]),
          el("tbody", {}, rows),
        ]),
      ]),
    ]),
    el("div", { class: "dd-block" }, [
      el("h3", {}, ["Events"]),
      el("ul", { class: "dd-events", "aria-label": "Events" }, events),
    ]),
  ]);
}

globalThis.draftDayTimeline = draftDayTimeline;
