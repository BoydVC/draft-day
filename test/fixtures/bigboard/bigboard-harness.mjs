// Big Board stats harness for SPEC 008 (Pick 7). Zero dependencies, plain JavaScript, no network.
// This is the binding stats rule written as code, independent of src/: it re-derives every number straight
// from dd event logs (status per event prefix, the Film Room base, trades, verdicts and stage spans), so
// it can check src/core/bigboard.ts without sharing a line with it. Tests import it; nothing edits it.
//
//   readLogs(jsonlText)                   -> PickLog[] (from {"pickId","event"} lines, sorted by pickId)
//   bigBoardOracle(logs, window?, nowMs)  -> BigBoardStats (same shape SPEC 008 binds for bigBoardStats)
//   expectedFor(stats)                    -> the comparable projection stored in expected.json
//   angleName / angleKey / median / ratio / percentText / STAGE_ORDER / ANGLE_NAME_MAX / EXCLUDED_SOURCES

export const STAGE_ORDER = ["Intake", "Scouting Report", "Combine", "Film Room", "Trade", "Physical"];
export const ANGLE_NAME_MAX = 48;
export const EXCLUDED_SOURCES = ["selftest"];
const CANDS = ["c1", "c2", "c3", "c4", "c5"];
const LABELS = ["A", "B", "C", "D", "E"];
const DEFAULT_ANGLES = ["simplest thing that passes", "extensibility first", "tests first, then code", "failure modes first", "smallest diff that passes"];
const GO_TIMEOUT_MS = 48 * 60 * 60 * 1000;
const PICK_ID = /^p-\d{8}-\d{2}$/;
const TERMINAL = new Set(["drafted", "failed", "cancelled"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ---------- small binding helpers ----------
export function angleName(text) {
  const raw = typeof text === "string" ? text : "";
  const colon = raw.indexOf(":");
  const head = colon >= 0 ? raw.slice(0, colon) : raw.split(/[.;]/)[0];
  const name = head.replace(/\s+/g, " ").trim();
  if (!name) return "(no angle)";
  const chars = Array.from(name);
  return chars.length > ANGLE_NAME_MAX ? chars.slice(0, ANGLE_NAME_MAX).join("").trimEnd() : name;
}
export function angleKey(text) {
  return angleName(text).toLowerCase();
}
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}
export function ratio(num, den) {
  return { num, den, rate: den ? Math.round((num / den) * 1000) / 1000 : null };
}
export function percentText(rate) {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
export function readLogs(text) {
  const byPick = new Map();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!byPick.has(row.pickId)) byPick.set(row.pickId, []);
    byPick.get(row.pickId).push(row.event);
  }
  return [...byPick.keys()].sort().map((pickId) => ({ pickId, events: byPick.get(pickId) }));
}

// ---------- reduce-lite: only what the stats need ----------
const str = (v, f = "") => (typeof v === "string" ? v : f);
const num = (v, f = 0) => (typeof v === "number" && Number.isFinite(v) ? v : f);

function weighted(card, rubric) {
  const by = new Map();
  for (const s of card.scores ?? []) if (!by.has(s.criterionId)) by.set(s.criterionId, s.score);
  let sum = 0, w = 0;
  for (const c of rubric) { w += c.weight; sum += (by.get(c.id) ?? 0) * c.weight; }
  return w === 0 ? 0 : sum / w;
}
function tieWinner(a, b) {
  const keys = [
    [(x) => (x.diff ? x.diff.added + x.diff.removed : null), true],
    [(x) => (x.diff ? x.diff.files : null), true],
    [(x) => x.risks, false],
  ];
  for (const [measure, missingLoses] of keys) {
    const l = measure(a), r = measure(b);
    if (l === null && r === null) continue;
    if (l === null || r === null) { if (!missingLoses) continue; return l === null ? b.cand : a.cand; }
    if (l !== r) return l < r ? a.cand : b.cand;
  }
  return a.cand <= b.cand ? a.cand : b.cand;
}
function rankLines(pass, candidates, rubric) {
  const lines = [];
  const seen = new Set();
  for (const card of pass.cards) {
    const cand = pass.labels[card.label];
    if (!cand || seen.has(cand)) continue;
    seen.add(cand);
    const total = card.crossTests?.total ?? 0;
    const g = card.gates ?? {};
    lines.push({
      cand,
      gatePass: g.build !== "fail" && g.tests !== "fail" && g.journey !== "fail",
      rate: total === 0 ? null : (card.crossTests.passed ?? 0) / total,
      weighted: weighted(card, rubric),
      diff: card.diff,
      risks: candidates.find((c) => c.id === cand)?.report?.risks?.length ?? 0,
      rank: null,
      contender: false,
    });
  }
  const passers = lines.filter((l) => l.gatePass);
  const rates = passers.map((l) => l.rate).filter((r) => r !== null);
  const best = rates.length ? Math.max(...rates) : null;
  for (const l of passers) l.contender = l.rate === null || best === null || l.rate + 1e-9 >= best - 0.1;
  const ranked = [...passers].sort((a, b) => {
    if (a.contender !== b.contender) return a.contender ? -1 : 1;
    if (Math.abs(a.weighted - b.weighted) >= 1e-9) return b.weighted - a.weighted;
    return tieWinner(a, b) === a.cand ? -1 : 1;
  });
  ranked.forEach((l, i) => (l.rank = i + 1));
  return lines;
}
function filmRoomBase(rawPasses, candidates, rubric) {
  if (!rawPasses.length) return null;
  const ordered = [...rawPasses].sort((a, b) => a.pass - b.pass);
  const drafts = ordered.map((p) => rankLines(p, candidates, rubric));
  const winnerOf = (lines) => lines.find((l) => l.rank === 1)?.cand ?? null;
  let base = winnerOf(drafts[0]);
  if (drafts.length >= 2) {
    const left = winnerOf(drafts[0]), right = winnerOf(drafts[1]);
    if (left && right && left !== right) {
      const find = (cand) => { for (let i = drafts.length - 1; i >= 0; i--) { const f = drafts[i].find((l) => l.cand === cand); if (f) return f; } return undefined; };
      const a = find(left), b = find(right);
      base = a && b ? tieWinner(a, b) : left;
    } else if (!(left && right)) base = left ?? right;
  }
  if (!base) return null;
  const final = drafts[drafts.length - 1];
  const runnerUps = new Set(final.filter((l) => l.rank !== null && l.cand !== base).map((l) => l.cand));
  const latest = ordered[ordered.length - 1];
  const counts = new Map();
  let trades = 0;
  for (const t of latest.trades) {
    const from = latest.labels[t.from];
    if (!from || from === base || !runnerUps.has(from)) continue;
    const used = counts.get(from) ?? 0;
    if (used >= 2) continue;
    counts.set(from, used + 1);
    trades += 1;
  }
  return { base, trades };
}

function statusOf(state, now) {
  const ready = state.approved || (state.approval === "auto" && state.report);
  let status = "intake";
  if (state.failReason) status = state.cancelled && state.failReason === "cancelled" ? "cancelled" : "failed";
  else if (state.cancelled) status = "cancelled";
  else if (state.confirmed) status = "drafted";
  else if (state.physicalLaunched || state.verdicts.length) status = "physical";
  else if (state.graftLaunched) status = "grafting";
  else if (state.judgeLaunches.length) status = "judging";
  else if (ready) status = "combine";
  else if (state.report && state.approval === "ask") status = "awaiting_go";
  if (status === "awaiting_go" && state.reportAt && now - Date.parse(state.reportAt) >= GO_TIMEOUT_MS) status = "cancelled";
  return status;
}
function stageLabel(status) {
  return { intake: "Intake", scouting: "Scouting Report", awaiting_go: "Scouting Report", combine: "Combine", judging: "Film Room",
    grafting: "Trade", physical: "Physical", drafted: "Draft Pick", failed: "Failed", cancelled: "Cancelled" }[status];
}
function fold(ordered) {
  const created = ordered.find((e) => e.type === "pick_created");
  const s = { approval: created?.payload?.approval === "auto" ? "auto" : "ask", n: Math.min(5, Math.max(1, num(created?.payload?.n, 3))),
    report: null, reportAt: null, approved: false, launches: new Map(), failures: new Map(), dropped: new Set(), finished: new Map(),
    judgeLaunches: [], rawPasses: [], graftLaunched: false, graftRecorded: false, physicalLaunched: false, walkoverFlag: false,
    verdicts: [], fixLoops: 0, confirmed: false, failReason: null, cancelled: false };
  for (const e of ordered) {
    const p = e.payload ?? {};
    switch (e.type) {
      case "scouting_report_written": s.report = p.report ?? p; s.reportAt = e.ts; break;
      case "scouting_approved": s.approved = true; break;
      case "candidate_launched": if (CANDS.includes(str(p.cand))) s.launches.set(p.cand, (s.launches.get(p.cand) ?? 0) + 1); break;
      case "candidate_finished": if (CANDS.includes(str(p.cand))) s.finished.set(p.cand, p.report); break;
      case "candidate_failed": if (CANDS.includes(str(p.cand))) s.failures.set(p.cand, (s.failures.get(p.cand) ?? 0) + 1); break;
      case "candidate_dropped": if (CANDS.includes(str(p.cand))) s.dropped.add(p.cand); break;
      case "judge_launched": {
        const labels = {};
        if (p.labels && typeof p.labels === "object") for (const [l, c] of Object.entries(p.labels)) if (CANDS.includes(String(c)) && LABELS.includes(l)) labels[l] = c;
        s.judgeLaunches.push({ pass: num(p.pass, s.judgeLaunches.length + 1), labels });
        break;
      }
      case "judgement_recorded": {
        const pass = num(p.pass, s.rawPasses.length + 1);
        const launch = s.judgeLaunches.find((j) => j.pass === pass) ?? s.judgeLaunches[s.rawPasses.length];
        s.rawPasses.push({ pass, cards: p.cards ?? [], trades: Array.isArray(p.trades) ? p.trades : [], labels: launch?.labels ?? {} });
        break;
      }
      case "graft_launched": s.graftLaunched = true; break;
      case "graft_recorded": s.graftRecorded = true; break;
      case "physical_launched": s.physicalLaunched = true; if (p.walkover === true) s.walkoverFlag = true; break;
      case "verdict_recorded": s.verdicts.push(p.physical); break;
      case "fix_requested": s.fixLoops += 1; break;
      case "draft_pr_confirmed": s.confirmed = true; break;
      case "pick_failed": s.failReason = str(p.reason, "failed"); break;
      case "pick_cancelled": s.cancelled = true; s.failReason = s.failReason ?? "cancelled"; break;
      default: break;
    }
  }
  return s;
}
function pickOf(events, now) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  if (!ordered.some((e) => e.type === "pick_created")) return null;
  const s = fold(ordered);
  const status = statusOf(s, now);
  const ready = s.approved || (s.approval === "auto" && s.report);
  const candidates = [];
  if (ready && s.report) {
    CANDS.slice(0, s.n).forEach((id, index) => {
      const launches = s.launches.get(id) ?? 0, failures = s.failures.get(id) ?? 0;
      let st = "queued";
      if (s.dropped.has(id)) st = "dropped";
      else if (s.finished.has(id)) st = "finished";
      else if (failures > 0 && launches <= failures) st = "error";
      else if (launches > 0) st = "running";
      candidates.push({ id, status: st, angle: (s.report.angles ?? [])[index] || DEFAULT_ANGLES[index] || id, report: s.finished.get(id) });
    });
  }
  const room = s.report ? filmRoomBase(s.rawPasses, candidates, s.report.rubric ?? []) : null;
  const finishedCount = candidates.filter((c) => c.status === "finished").length;
  const walkover = s.walkoverFlag || (s.physicalLaunched && s.judgeLaunches.length === 0 && finishedCount === 1);
  return { status, candidates, base: room?.base ?? null, trades: room?.trades ?? 0, graftRecorded: s.graftRecorded,
    verdicts: s.verdicts.filter(Boolean), fixLoops: Math.min(2, s.fixLoops), walkover, reportAt: s.reportAt };
}
// Stage spans exactly as the Decision log draws them: stage of each event = stage of the status after it.
function stageSpans(events, now) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const times = [];
  let prev = 0;
  ordered.forEach((e, i) => { const t = Date.parse(e.ts); const ok = Number.isFinite(t); const at = i === 0 ? (ok ? t : 0) : ok ? Math.max(prev, t) : prev; times.push(at); prev = at; });
  const entries = [];
  let before = null;
  for (let i = 0; i < ordered.length; i++) {
    const after = pickOf(ordered.slice(0, i + 1), times[i]);
    const status = after?.status ?? before ?? "intake";
    entries.push({ stage: stageLabel(status), status, at: times[i] });
    if (after) before = after.status;
  }
  const final = pickOf(ordered, now);
  const groups = [];
  for (const e of entries) { const last = groups[groups.length - 1]; if (!last || last.stage !== e.stage) groups.push({ stage: e.stage, at: e.at }); }
  const spans = groups.map((g, i) => ({ stage: g.stage, closed: i + 1 < groups.length, ms: i + 1 < groups.length ? Math.max(0, groups[i + 1].at - g.at) : 0 }));
  const live = !TERMINAL.has(final.status);
  let endedAt = null;
  if (!live) {
    const t = entries.find((e) => TERMINAL.has(e.status));
    if (t) endedAt = t.at;
    else if (final.reportAt && Number.isFinite(Date.parse(final.reportAt))) endedAt = Date.parse(final.reportAt) + GO_TIMEOUT_MS;
  }
  const last = spans[spans.length - 1];
  if (last && stageLabel(final.status) !== last.stage && endedAt !== null) {
    last.closed = true;
    last.ms = Math.max(0, endedAt - groups[groups.length - 1].at);
  }
  return spans.filter((sp) => sp.closed);
}

function windowOk(ts, w) {
  if (!w.since && !w.until) return true;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  if (w.since && t < Date.parse(`${w.since}T00:00:00Z`)) return false;
  if (w.until && t >= Date.parse(`${w.until}T00:00:00Z`)) return false;
  return true;
}

export function bigBoardOracle(logs, window, nowMs) {
  const w = { since: window?.since ?? null, until: window?.until ?? null };
  const now = Number.isFinite(nowMs) ? nowMs : Date.parse("2026-10-19T00:00:00.000Z");
  const skipped = [];
  const picks = { total: 0, drafted: 0, failed: 0, cancelled: 0, live: 0 };
  const excluded = { selftest: 0 };
  const angleRows = new Map(), slotRows = new Map();
  const tradeRows = [];
  const verify = { picks: 0, first: 0, final: 0, fixLoops: 0, verdicts: { VERIFIED: 0, NOT_VERIFIED: 0, INCONCLUSIVE: 0 } };
  const stageValues = new Map(STAGE_ORDER.map((s) => [s, []]));
  const row = (map, key, name) => { if (!map.has(key)) map.set(key, { key, name, entries: 0, wins: 0, walkovers: 0, picks: new Set() }); return map.get(key); };
  for (const log of [...logs].sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0))) {
    if (!PICK_ID.test(String(log.pickId))) { skipped.push({ pickId: String(log.pickId), reason: "bad pick id" }); continue; }
    if (!Array.isArray(log.events)) { skipped.push({ pickId: log.pickId, reason: "unreadable" }); continue; }
    const created = [...log.events].sort((a, b) => a.seq - b.seq).find((e) => e?.type === "pick_created");
    if (!created) { skipped.push({ pickId: log.pickId, reason: "no pick_created" }); continue; }
    if ((created.payload ?? {}).id !== log.pickId) { skipped.push({ pickId: log.pickId, reason: "id mismatch" }); continue; }
    if (!windowOk(typeof created.ts === "string" ? created.ts : "", w)) continue;
    if (EXCLUDED_SOURCES.includes(str(created.payload?.source))) { excluded.selftest += 1; continue; }
    const pick = pickOf(log.events, now);
    picks.total += 1;
    if (pick.status === "drafted" || pick.status === "failed" || pick.status === "cancelled") picks[pick.status] += 1;
    else picks.live += 1;
    for (const c of pick.candidates) {
      if (c.status !== "finished") continue;
      const a = row(angleRows, angleKey(c.angle), angleName(c.angle));
      const sl = row(slotRows, c.id, c.id);
      for (const r of [a, sl]) {
        if (pick.base) { r.entries += 1; r.picks.add(log.pickId); if (pick.base === c.id) r.wins += 1; }
        else if (pick.walkover) { r.walkovers += 1; r.picks.add(log.pickId); }
      }
    }
    if (pick.graftRecorded) tradeRows.push({ pickId: log.pickId, base: pick.base, trades: pick.trades });
    if (pick.verdicts.length) {
      verify.picks += 1;
      if (pick.verdicts[0].verdict === "VERIFIED") verify.first += 1;
      if (pick.verdicts[pick.verdicts.length - 1].verdict === "VERIFIED") verify.final += 1;
      verify.fixLoops += pick.fixLoops;
      for (const v of pick.verdicts) if (v.verdict in verify.verdicts) verify.verdicts[v.verdict] += 1;
    }
    if (TERMINAL.has(pick.status)) {
      const per = new Map();
      for (const sp of stageSpans(log.events, now)) if (stageValues.has(sp.stage)) per.set(sp.stage, (per.get(sp.stage) ?? 0) + sp.ms);
      for (const [stage, ms] of per) stageValues.get(stage).push(ms);
    }
  }
  const finish = (r) => ({ key: r.key, name: r.name, entries: r.entries, wins: r.wins, walkovers: r.walkovers,
    rate: ratio(r.wins, r.entries).rate, picks: [...r.picks].sort() });
  const angles = [...angleRows.values()].map(finish).sort((a, b) =>
    (a.rate === null) - (b.rate === null) || (b.rate ?? 0) - (a.rate ?? 0) || b.wins - a.wins || b.entries - a.entries || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const slots = CANDS.filter((c) => slotRows.has(c)).map((c) => finish(slotRows.get(c)));
  const tradeTotal = tradeRows.reduce((s, r) => s + r.trades, 0);
  const trades = { picks: tradeRows.length, total: tradeTotal, mean: tradeRows.length ? Math.round((tradeTotal / tradeRows.length) * 100) / 100 : null, rows: tradeRows };
  const v = { picks: verify.picks, firstTry: ratio(verify.first, verify.picks), final: ratio(verify.final, verify.picks), fixLoops: verify.fixLoops, verdicts: verify.verdicts };
  const stages = STAGE_ORDER.map((stage) => {
    const values = stageValues.get(stage);
    const medianMs = median(values);
    return { stage, picks: values.length, medianMs, medianText: values.length ? formatDuration(medianMs) : "—", totalMs: values.reduce((s, x) => s + x, 0) };
  });
  skipped.sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : 0));
  return { window: w, summary: summaryOf(picks, v, trades), picks, excluded, skipped, angles, slots, trades, verify: v, stages };
}

export function summaryOf(picks, verify, trades) {
  if (picks.total === 0) return "No picks yet";
  const s = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${s(picks.total, "pick")} · ${picks.drafted} drafted · verified ${verify.final.num}/${verify.final.den} (${verify.firstTry.num} first try) · ${s(trades.total, "trade")} grafted`;
}

export function expectedFor(stats) {
  const win = (r) => [r.key, r.wins, r.entries, r.walkovers];
  return {
    summary: stats.summary,
    picks: stats.picks,
    excluded: stats.excluded,
    skipped: stats.skipped.map((s) => [s.pickId, s.reason]),
    angles: stats.angles.map(win),
    slots: stats.slots.map(win),
    trades: { picks: stats.trades.picks, total: stats.trades.total, mean: stats.trades.mean, rows: stats.trades.rows.map((r) => [r.pickId, r.base, r.trades]) },
    verify: { picks: stats.verify.picks, firstTry: [stats.verify.firstTry.num, stats.verify.firstTry.den], final: [stats.verify.final.num, stats.verify.final.den], fixLoops: stats.verify.fixLoops, verdicts: stats.verify.verdicts },
    stages: stats.stages.map((r) => [r.stage, r.picks, r.medianMs]),
  };
}

export function windowOf(since, until) {
  const day = (v) => (v === undefined || v === null || v === "" ? null : typeof v === "string" && DAY.test(v) ? v : false);
  return { since: day(since), until: day(until) };
}
