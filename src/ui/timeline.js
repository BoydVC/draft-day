function startedLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
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

function eventItem(entry, el) {
  const children = [`+${entry.sinceStartText} ${entry.title}`];
  for (const link of entry.links) {
    children.push(" ");
    children.push(el("a", {
      href: link.href,
      target: "_blank",
      rel: "noopener noreferrer",
    }, [link.label]));
  }
  return el("div", { role: "listitem", class: "event-item" }, children);
}

function renderStrip(view, el) {
  const blocks = [];
  for (const span of view.stages) {
    if (!span.bars || span.bars.length === 0) continue;
    const lanes = span.bars.map((bar) => {
      const pill = el("div", {
        class: "run-bar",
        "data-role": bar.role,
        "data-outcome": bar.outcome,
        "aria-label": `${bar.label} ${bar.outcome}`,
      }, [bar.label]);
      pill.style.setProperty("--start", `${bar.startPct}%`);
      pill.style.setProperty("--width", `${bar.widthPct}%`);
      return el("div", { class: "run-lane" }, [pill]);
    });
    const caption = span.kind === "terminal" ? span.stage : `${span.stage} ${span.durationText}`;
    blocks.push(el("div", { class: "stage-strip" }, [
      el("p", { class: "strip-label" }, [caption]),
      el("div", { class: "stage-track" }, lanes),
    ]));
  }
  return el("div", { class: "timeline-strip", "aria-label": "Run bars" }, blocks);
}

function renderDecisionLog(pick, el) {
  const view = pick && pick.timeline;
  if (!view) return [el("p", { class: "empty" }, ["No events."])];
  const bySeq = new Map(view.entries.map((entry) => [entry.seq, entry]));
  const summary = el("p", { class: "timeline-summary" }, [view.summary]);
  const stages = el("ul", { "aria-label": "Stages", class: "stage-list" }, view.stages.map((span) => {
    const text = span.kind === "terminal" ? span.stage : `${span.stage} ${span.durationText}`;
    return el("li", {}, [text]);
  }));
  const rows = view.runs.length
    ? view.runs.map((run) => el("tr", {}, [
      el("td", {}, [run.label]),
      el("td", {}, [agentCell(run, el)]),
      el("td", {}, [startedLabel(run.startedAt)]),
      el("td", {}, [run.durationText]),
      el("td", {}, [run.outcome]),
    ]))
    : [el("tr", {}, [el("td", { colspan: "5", class: "empty" }, ["No runs."])])];
  const table = el("table", { "aria-label": "Runs" }, [
    el("caption", {}, ["Runs"]),
    el("thead", {}, [el("tr", {}, ["Run", "Agent", "Started", "Duration", "Outcome"].map((name) => el("th", {}, [name])))]),
    el("tbody", {}, rows),
  ]);
  const eventNodes = [];
  for (const span of view.stages) {
    const items = [];
    for (const seq of span.entrySeqs || []) {
      const entry = bySeq.get(seq);
      if (entry) items.push(eventItem(entry, el));
    }
    if (!items.length) continue;
    eventNodes.push(el("h3", { class: "event-stage" }, [span.stage]));
    for (const item of items) eventNodes.push(item);
  }
  const events = el("div", { role: "list", "aria-label": "Events", class: "event-groups" }, eventNodes);
  return [el("div", { class: "decision-log" }, [
    summary,
    el("h3", { class: "timeline-kicker" }, ["Stages"]),
    stages,
    el("div", { class: "runs-scroll" }, [table]),
    renderStrip(view, el),
    el("h3", { class: "timeline-kicker" }, ["Events"]),
    events,
  ])];
}
