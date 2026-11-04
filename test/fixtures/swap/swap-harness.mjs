// Swap-bias harness for SPEC 010 (Pick 9). Zero dependencies, plain JavaScript, no network.
// The binding swap-bias rule written as code, independent of src/: it re-derives every Film Room pass winner
// straight from dd event logs (gates, cross-test contenders, weighted rubric mean, tie keys), so it can check
// src/core/bigboard.ts without sharing a line with it. Tests import it; nothing edits it.
//
//   readLogs(jsonlText)               -> PickLog[] ({"pickId","event"} lines, grouped, sorted by pickId)
//   swapOracle(logs, window?, nowMs)  -> SwapStats (the shape SPEC 010 binds for bigBoardStats(...).swap)
//   swapFor(swap)                     -> the comparable projection stored in expected.json
//   swapText(swap)                    -> the binding "Swap bias" text block (lines joined with \n)
//   swapHeadline(swap) / swapStrictLine(swap) -> the two binding sentences the view shows
//   judgeModelName / judgeModelKey / pairOf / ratio / percentText / constants

export const EXCLUDED_SOURCES = ["selftest"];
export const DEFAULT_MODEL = "account default";
export const MODEL_NAME_MAX = 48;
export const SWAP_STATES = ["single", "consistent", "flipped"];
const CANDS = ["c1", "c2", "c3", "c4", "c5"];
const LABELS = ["A", "B", "C", "D", "E"];
const PICK_ID = /^p-\d{8}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const str = (v, f = "") => (typeof v === "string" ? v : f);
const num = (v, f = 0) => (typeof v === "number" && Number.isFinite(v) ? v : f);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function ratio(n, d) {
  return { num: n, den: d, rate: d ? Math.round((n / d) * 1000) / 1000 : null };
}
export function percentText(rate) {
  return rate === null || rate === undefined ? "\u2014" : `${Math.round(rate * 100)}%`;
}
// judgeModel is untrusted text from a judge report. Non-string or blank -> "account default".
// Whitespace runs -> one space, trim, then every C0/C1 control and U+2028/U+2029 -> U+FFFD, then cap at 48 code points.
export function judgeModelName(value) {
  if (typeof value !== "string") return DEFAULT_MODEL;
  const name = value.replace(/\s+/g, " ").trim().replace(CONTROL, "\ufffd");
  if (!name) return DEFAULT_MODEL;
  const chars = Array.from(name);
  return chars.length > MODEL_NAME_MAX ? chars.slice(0, MODEL_NAME_MAX).join("").trimEnd() : name;
}
export function judgeModelKey(value) {
  return judgeModelName(value).toLowerCase();
}
// The judge pair of a two-pass pick: pass 1 and pass 2 models. Same key -> that model; else "a + b".
export function pairOf(first, second) {
  const k1 = judgeModelKey(first), k2 = judgeModelKey(second);
  const n1 = judgeModelName(first), n2 = judgeModelName(second);
  return k1 === k2 ? { key: k1, name: n1 } : { key: `${k1} + ${k2}`, name: `${n1} + ${n2}` };
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

// ---------- Film Room, re-derived ----------
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
      cand, label: card.label,
      gatePass: g.build !== "fail" && g.tests !== "fail" && g.journey !== "fail",
      rate: total === 0 ? null : (card.crossTests.passed ?? 0) / total,
      weighted: weighted(card, rubric), diff: card.diff,
      risks: candidates.find((c) => c.id === cand)?.report?.risks?.length ?? 0,
      rank: null, contender: false,
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
function lastLine(drafts, cand) {
  for (let i = drafts.length - 1; i >= 0; i--) { const f = drafts[i].find((l) => l.cand === cand); if (f) return f; }
  return undefined;
}
// One judged pick -> its swap facts, or null when the Film Room has no base (no judgement).
function swapOfPick(rawPasses, candidates, rubric) {
  if (!rawPasses.length) return null;
  const ordered = [...rawPasses].sort((a, b) => a.pass - b.pass);
  const drafts = ordered.map((p) => rankLines(p, candidates, rubric));
  const winners = drafts.map((lines) => lines.find((l) => l.rank === 1) ?? null);
  let base = winners[0]?.cand ?? null;
  let swap = "single";
  let tieRule = false;
  if (drafts.length >= 2) {
    const left = winners[0]?.cand ?? null, right = winners[1]?.cand ?? null;
    if (left && right && left === right) { base = left; swap = "consistent"; }
    else if (left && right) {
      const a = lastLine(drafts, left), b = lastLine(drafts, right);
      base = a && b ? tieWinner(a, b) : left;
      tieRule = Boolean(a && b);
      swap = "flipped";
    } else { base = left ?? right; swap = "flipped"; }
  }
  if (!base) return null;
  return {
    swap, base, tieRule,
    winners: winners.map((w) => w?.cand ?? null),
    labels: drafts.map((lines, i) => ({ winner: winners[i]?.label ?? null, shown: lines.map((l) => l.label) })),
    models: ordered.map((p) => judgeModelName(p.judgeModel)),
    rawModels: ordered.map((p) => p.judgeModel),
  };
}
function judgedPick(events) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const created = ordered.find((e) => e.type === "pick_created");
  const s = { approval: created?.payload?.approval === "auto" ? "auto" : "ask", n: Math.min(5, Math.max(1, num(created?.payload?.n, 3))),
    report: null, approved: false, finished: new Map(), judgeLaunches: [], rawPasses: [] };
  for (const e of ordered) {
    const p = e.payload ?? {};
    switch (e.type) {
      case "scouting_report_written": s.report = p.report ?? p; break;
      case "scouting_approved": s.approved = true; break;
      case "candidate_finished": if (CANDS.includes(str(p.cand))) s.finished.set(p.cand, p.report); break;
      case "judge_launched": {
        const labels = {};
        if (p.labels && typeof p.labels === "object") for (const [l, c] of Object.entries(p.labels)) if (CANDS.includes(String(c)) && LABELS.includes(l)) labels[l] = c;
        s.judgeLaunches.push({ pass: num(p.pass, s.judgeLaunches.length + 1), labels });
        break;
      }
      case "judgement_recorded": {
        const pass = num(p.pass, s.rawPasses.length + 1);
        const launch = s.judgeLaunches.find((j) => j.pass === pass) ?? s.judgeLaunches[s.rawPasses.length];
        s.rawPasses.push({ pass, cards: p.cards ?? [], labels: launch?.labels ?? {}, judgeModel: str(p.judgeModel) || undefined });
        break;
      }
      default: break;
    }
  }
  if (!s.report) return null;
  const ready = s.approved || s.approval === "auto";
  const candidates = ready ? CANDS.slice(0, s.n).map((id) => ({ id, report: s.finished.get(id) })) : [];
  return swapOfPick(s.rawPasses, candidates, s.report.rubric ?? []);
}
function windowOk(ts, w) {
  if (!w.since && !w.until) return true;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return false;
  if (w.since && t < Date.parse(`${w.since}T00:00:00Z`)) return false;
  if (w.until && t >= Date.parse(`${w.until}T00:00:00Z`)) return false;
  return true;
}

export function swapOracle(logs, window, nowMs) {
  void nowMs; // swap facts do not depend on the clock (kept for signature parity with bigBoardStats)
  const w = { since: window?.since ?? null, until: window?.until ?? null };
  const rows = [];
  for (const log of [...logs].sort((a, b) => cmp(String(a.pickId), String(b.pickId)))) {
    if (!PICK_ID.test(String(log.pickId)) || !Array.isArray(log.events)) continue;
    const created = [...log.events].sort((a, b) => a.seq - b.seq).find((e) => e?.type === "pick_created");
    if (!created || (created.payload ?? {}).id !== log.pickId) continue;
    if (!windowOk(typeof created.ts === "string" ? created.ts : "", w)) continue;
    if (EXCLUDED_SOURCES.includes(str(created.payload?.source))) continue;
    const facts = judgedPick(log.events);
    if (facts) rows.push({ pickId: log.pickId, ...facts });
  }
  const twoPass = rows.filter((r) => r.swap !== "single");
  const flipped = twoPass.filter((r) => r.swap === "flipped");
  const labelAcc = new Map();
  for (const r of rows) for (const pass of r.labels) {
    if (!pass.winner) continue;
    for (const label of pass.shown) {
      if (!labelAcc.has(label)) labelAcc.set(label, { label, wins: 0, passes: 0 });
      labelAcc.get(label).passes += 1;
    }
    labelAcc.get(pass.winner).wins += 1;
  }
  const modelAcc = new Map();
  for (const r of twoPass) {
    const pair = pairOf(r.rawModels[0], r.rawModels[1]);
    if (!modelAcc.has(pair.key)) modelAcc.set(pair.key, { key: pair.key, name: pair.name, picks: 0, flipped: 0, pickIds: [] });
    const acc = modelAcc.get(pair.key);
    acc.picks += 1;
    if (r.swap === "flipped") acc.flipped += 1;
    acc.pickIds.push(r.pickId);
  }
  return {
    judged: rows.length,
    single: rows.length - twoPass.length,
    twoPass: twoPass.length,
    consistent: twoPass.length - flipped.length,
    flipped: flipped.length,
    rate: ratio(flipped.length, twoPass.length).rate,
    tieRule: flipped.filter((r) => r.tieRule).length,
    strict: flipped.map((r) => r.pickId),
    labels: LABELS.filter((l) => labelAcc.has(l)).map((l) => { const a = labelAcc.get(l); return { label: l, wins: a.wins, passes: a.passes, rate: ratio(a.wins, a.passes).rate }; }),
    models: [...modelAcc.values()].map((a) => ({ key: a.key, name: a.name, picks: a.picks, flipped: a.flipped, rate: ratio(a.flipped, a.picks).rate, pickIds: a.pickIds }))
      .sort((a, b) => b.picks - a.picks || cmp(a.key, b.key)),
    rows: rows.map((r) => ({ pickId: r.pickId, swap: r.swap, winners: r.winners, base: r.base, models: r.models })),
  };
}

export function swapFor(swap) {
  return {
    judged: swap.judged, single: swap.single, twoPass: swap.twoPass, consistent: swap.consistent, flipped: swap.flipped,
    rate: swap.rate, tieRule: swap.tieRule, strict: swap.strict,
    labels: swap.labels.map((r) => [r.label, r.wins, r.passes]),
    models: swap.models.map((r) => [r.key, r.name, r.picks, r.flipped]),
    rows: swap.rows.map((r) => [r.pickId, r.swap, r.winners, r.base, r.models]),
  };
}

export function swapHeadline(swap) {
  if (swap.judged === 0) return "No judged picks yet";
  if (swap.twoPass === 0) return "No two-pass picks yet";
  return `Reversed pass flipped ${swap.flipped} of ${swap.twoPass} two-pass picks (${percentText(swap.rate)})`;
}
export function swapStrictLine(swap) {
  return `Strict rule (tie unless both passes agree): no base for ${swap.strict.length ? swap.strict.join(", ") : "none"}`;
}
export function swapText(swap) {
  if (swap.judged === 0) return ["Swap bias", "  no judged picks"].join("\n");
  const lines = ["Swap bias"];
  lines.push(`  two-pass ${swap.twoPass} \u00b7 flipped ${swap.flipped} (${percentText(swap.rate)}) \u00b7 single ${swap.single}`);
  lines.push(`  tie rule settled ${swap.tieRule}`);
  lines.push(`  ${swapStrictLine(swap)}`);
  lines.push(`  label wins ${swap.labels.length ? swap.labels.map((r) => `${r.label} ${r.wins}/${r.passes} ${percentText(r.rate)}`).join(" \u00b7 ") : "\u2014"}`);
  for (const m of swap.models) lines.push(`  ${m.name} flipped ${m.flipped}/${m.picks} ${percentText(m.rate)}`);
  return lines.join("\n");
}
