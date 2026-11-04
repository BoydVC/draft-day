# Draft Day: architecture

Boyd's software production engine. You give it an idea, it writes the scouting report, sends several Cursor cloud agents to the Combine to build competing versions, judges them on film, trades in the best plays from the runners-up, puts the winner through a physical, and announces it as a **draft** pull request. The War Room dashboard shows every pick live. Nothing merges without Boyd.

Written with pstack `architect` (usage first, design it twice, red-flag screen) and backed by `research/BRIEF.md`. Decision trail: `LOG.tsv`.

---

## 1. Problem

Boyd has spare Cursor and Grok Bot usage every week and no time to babysit agents. One coding agent on one try is a coin flip on quality, and a bad PR costs his attention, which is the scarcest thing he has. Research says the right answer is usually somewhere in a small pile of attempts (CodeFuse: 65.2% single vs 82.4% best-of-N oracle) and the hard part is choosing it with real evidence (BRIEF sections 3-4). @poteto's pstack has the pieces (arena, architect, verification skills, blast-radius, show-me-your-work), but they run inside one agent session. Boyd wants them as an engine: idea in, tested draft PR out, with a scoreboard he can glance at from his phone.

Non-goals for this week: auto-merge, deploys, multi-repo fan-out, anything KPD or collections-related, paid add-ons, a Cursor API key.

## 2. Usage (written before any types)

**From chat (main path).**
```
Boyd → Grok Bot: "draft day: add a dark-mode toggle to the War Room"
Grok Bot → box:  dd intake --source chat --target BoydVC/draft-day --idea "add a dark-mode toggle to the War Room"
                 → {"pickId":"p-20261017-01","status":"intake"}
Grok Bot:        dd next p-20261017-01 → {"kind":"write_scouting_report", ...}
                 (writes the report; dd record p-20261017-01 scouting_report_written --file report.json)
Grok Bot → Boyd: "In my words: you want ... 3 agents, about 6 agent runs. Go?"   (skipped when approval=auto)
Boyd:            "go"  → dd record p-... scouting_approved
Grok Bot:        dd next → launch_candidate c1/c2/c3 (each with a rendered brief)
                 CloudAgent launch ×3 → dd record p-... candidate_launched --cand c1 --agent bc-...
... revived when each agent finishes → dd record p-... candidate_finished --cand c1 --report final.md
dd next → launch_judge → ... → launch_graft → ... → launch_physical → ... → confirm_draft_pr
Grok Bot → Boyd: "Pick is in: <draft PR link>. Verified in the browser. Board: c2 base, 1 trade from c3."
```

**From the War Room button.**
```
Boyd opens http://<box>:4420 → "New pick" → idea + target + N → POST /api/intake
server appends to data/intake.jsonl, then (if a webhook key is configured) POSTs the Grok Bot
webhook routine; otherwise the next scheduled check (9:33 AM / 1:33 PM / 6:33 PM ET) picks it up.
Grok Bot: dd intake --from-inbox → same flow as chat.
```

**Watching.** War Room: the Big Board (all picks, status chips, cost so far), a pick page (scouting report, candidate cards with live status, scorecard table, trade list, physical verdict with screenshots, PR link), and the decision log rendered from events.

**Self-check.** `dd selftest` runs a whole pick end to end against a fake driver in a temp dir, including a failed candidate and a NOT_VERIFIED physical, and exits non-zero on any wrong transition.

## 3. Shape

### 3.1 The one deep module: `next(pick) → NextAction`

Everything hangs off one function. The box knows the state; Grok Bot (or a future REST driver) does the side effects. The CLI never spawns, waits, or wakes anything (pstack orchestrate playbook). This keeps the box testable with no network and lets the driver change later without touching the core.

```ts
// src/core/types.ts  (sketch; SPEC.md is the binding version)
type PickId = string & { readonly __brand: "PickId" };       // p-YYYYMMDD-NN
type CandId = "c1" | "c2" | "c3" | "c4" | "c5";
type TargetRepo = string & { readonly __brand: "TargetRepo" }; // only via parseTargetRepo()

type PickStatus =
  | "intake" | "scouting" | "awaiting_go" | "combine" | "judging"
  | "grafting" | "physical" | "drafted" | "failed" | "cancelled";

interface ScoutingReport {
  restatement: string;            // in-your-own-words
  acceptance: Ears[];             // "WHEN … THE SYSTEM SHALL …", each gradeable
  rubric: Criterion[];            // 3-6, hidden from candidates
  designSketch: string;           // usage-first sketch (architect)
  verifyPlan: string[];           // journeys the physical must drive
  safetyFact: string;             // the blast-radius fact to prove
  angles: string[];               // one per candidate, for diversity
  forbidden: string[];
}
interface Criterion { id: string; name: string; weight: 1 | 2 | 3; howToGrade: string }
interface Ears { id: string; when: string; shall: string }

interface Candidate {
  id: CandId; angle: string; agentId?: string; branch?: string; model?: string;
  status: "queued" | "running" | "finished" | "error" | "dropped";
  report?: CandidateReport; relaunches: 0 | 1;
}
interface CandidateReport {     // parsed from the agent's final ```dd-report``` block
  branch: string; headSha: string; summary: string;
  commands: { cmd: string; exit: number }[];   // what it actually ran
  tests: { added: number; passing: boolean };
  screenshots: string[]; risks: string[];
}

interface Scorecard {            // one per (candidate, judge pass)
  label: "A" | "B" | "C" | "D" | "E";   // anonymized; mapping lives only on the box
  gates: { build: Gate; tests: Gate; journey: Gate };
  crossTests: { passed: number; total: number };   // pooled-test matrix row
  scores: { criterionId: string; score: 0 | 1 | 2 | 3 | 4; evidence: string }[];
}
type Gate = "pass" | "fail" | "n/a";

interface Judgement {
  passes: { order: string[]; judgeModel?: string; cards: Scorecard[] }[];
  base: CandId; runnerUps: CandId[];
  trades: Trade[];               // at most 2 per runner-up
  swapConsistent: boolean | null; // null when only one pass ran
  secondRead: "agree" | "disagree"; note: string;
}
interface Trade { from: CandId; what: string; pointers: string[]; why: string }

type Verdict = "VERIFIED" | "NOT_VERIFIED" | "INCONCLUSIVE";
interface Physical {
  prNumber: number; headSha: string; verdict: Verdict;
  ledger: "live-ui-verified" | "unit-test-verified" | "type-check-only" | "verifier-blocked" | "verifier-failed";
  certainty: 1 | 2 | 3 | 4 | 5;  // blast-radius ladder
  evidence: string[]; fixLoops: 0 | 1 | 2;
}

type NextAction =
  | { kind: "write_scouting_report"; pickId: PickId; prompt: string }
  | { kind: "await_go"; pickId: PickId; message: string }
  | { kind: "launch_candidate"; pickId: PickId; cand: CandId; repo: TargetRepo; branch: string; title: string; brief: string }
  | { kind: "wait"; pickId: PickId; waitingOn: string[] }
  | { kind: "launch_judge"; pickId: PickId; repo: TargetRepo; title: string; brief: string }
  | { kind: "launch_graft"; pickId: PickId; repo: TargetRepo; startingRef: string; title: string; brief: string }
  | { kind: "launch_physical"; pickId: PickId; repo: TargetRepo; title: string; brief: string }
  | { kind: "reply_fix"; pickId: PickId; agentId: string; brief: string }
  | { kind: "confirm_draft_pr"; pickId: PickId; repo: TargetRepo; prNumber: number }
  | { kind: "announce"; pickId: PickId; message: string }
  | { kind: "none"; pickId: PickId; reason: string };
```

### 3.2 Data model and storage

- **Event log per pick** `data/picks/<pickId>/events.jsonl`. Append-only. Single writer: the `dd` CLI (it takes a lock file). Each line: `{seq, ts, type, by, payload}`.
- **Pick state** is never stored. `reduce(events) → Pick` derives it; the same reducer feeds the CLI, the dashboard and the tests. Replaying is idempotent: re-recording an identical event (same type + key) is a no-op, so a Grok Bot revival that fires twice cannot double-launch.
- **Intake inbox** `data/intake.jsonl`. Single writer: the War Room server. `dd intake --from-inbox` reads entries past a cursor stored as a `PickCreated.inboxOffset` payload, so there is no second writer.
- **Artifacts** `data/picks/<pickId>/artifacts/` (transcript dumps, screenshots copied by Grok Bot). Gitignored.
- **Config** `targets.json` (allowlist, starts as `["BoydVC/draft-day"]`), `draftday.config.json` (port, default N=3, cap 5, models per role default empty = account default, approval `ask|auto`).

Event types (one registry in `src/core/events.ts`, no hand-synced copies):
`pick_created, scouting_report_written, scouting_approved, candidate_launched, candidate_finished, candidate_failed, candidate_dropped, judge_launched, judgement_recorded, graft_launched, graft_recorded, physical_launched, verdict_recorded, fix_requested, draft_pr_confirmed, pick_failed, pick_cancelled, lesson_recorded`.

### 3.3 State flow

```
intake ─▶ scouting ─▶ awaiting_go ─(go)─▶ combine ─(≥2 finished, rest done/dropped)─▶ judging
   │          │             │(no / timeout 48h)          │ (<2 usable)                    │
   │          ▼             ▼                            ▼                                ▼
   └──policy refuse──▶ failed / cancelled ◀──────────── failed            grafting ─▶ physical
                                                                                         │
                         drafted ◀── confirm_draft_pr ◀── VERIFIED ◀─────────────────────┤
                                                                                         │
             fix loop (reply_fix to grafter, max 2) ◀── NOT_VERIFIED / INCONCLUSIVE ─────┘
             after 2 loops: failed (PR stays DRAFT, title prefixed "[not verified]")
```

Rules that live in `transitions.ts` (one table, tested exhaustively):
- A candidate in `error` gets one relaunch; a second error drops it. A dropout is a gap, never a pass (swarm).
- Judging needs at least 2 finished candidates; if only 1, it skips judging and grafting and goes straight to the physical with that one (logged as "walkover").
- If every candidate fails the hard gates, the pick fails with "re-frame" advice (arena: wild divergence means the spec was under-specified).
- If the top two weighted scores are within 10% and budget allows, `next` asks for a second judge pass with the order reversed; the base only counts if both passes agree, else the tie rule picks the smaller diff with cleaner boundaries (arena tie rule) and `swapConsistent=false` is shown on the board.

### 3.4 Module layout (engine repo `BoydVC/draft-day`)

```
src/
  core/      types.ts  events.ts  ids.ts  target.ts  policy.ts  transitions.ts  reducer.ts  next.ts  budget.ts  score.ts
  store/     eventlog.ts (append + lock + read)   inbox.ts (intake.jsonl reader with cursor)
  briefs/    render.ts  scout.md  candidate.md  judge.md  graft.md  physical.md   (templates use the pstack brief fields)
  report/    parse.ts  (extract and validate ```dd-report``` / ```dd-judgement``` / ```dd-verdict``` blocks)
  server/    http.ts (static, /api/board, /api/picks/:id, /api/events SSE, POST /api/intake)  relay.ts (optional webhook forward)
  ui/        index.html  app.js  styles.css   (War Room, no framework, no build step)
  cli/       dd.ts   (intake | next | record | show | board | brief | lessons | serve | doctor | selftest)
test/        *.test.ts with node:test, plus test/fixtures/fake-driver.ts
.cursor/skills/verify-draft-day/  SKILL.md + features/ (generated by create-verification-skill, executed once)
targets.json  draftday.config.json  README.md  AGENTS.md
```

Only `src/cli/dd.ts`, `src/server/http.ts` and `src/core/index.ts` are entry points. Everything else is internal (no deep imports from tests except through `core/index.ts`, enforced by a tiny import-boundary test).

### 3.5 What runs where

| Piece | Runs on | Why |
|---|---|---|
| Idea intake (chat) | Grok Bot chat | Boyd already talks to Grok Bot; no new app. |
| Idea intake (button) | War Room server on the box, then Grok Bot webhook routine (make-bot-ui pattern) | One tap from his phone. Falls back to the 3x/day check if no webhook key. |
| State, reducer, `next`, briefs, scoring math | `dd` CLI on the box | Deterministic work in code, not prompts (poteto). Testable offline. |
| Scouting report | Grok Bot (sharpen + architect + in-your-own-words), recorded via `dd record` | Cheap, fast, and Boyd can veto before any cloud spend. |
| Combine candidates | N Cursor cloud agents, one branch each `dd/<pickId>/<cand>`, push only, no PR | Separate before serializing; each has its own VM and browser. |
| Film Room judge | 1 cloud agent (agent-as-a-judge): checks out every branch, runs gates and the pooled cross-test matrix, scores the rubric per criterion with evidence | ~90% vs ~70% human agreement over a plain LLM judge (BRIEF 4). |
| Second read | Grok Bot, comparing scorecard vs diffs | pstack arena's "orchestrator re-read". |
| Trade (graft) | 1 cloud agent starting from the base branch, typed trade list, opens the **draft** PR | One mental model; hand-ported, not pasted. |
| Physical | 1 cloud agent, ideally another model family: runs the repo's verify skill, drives the journeys in its browser, proves the safety fact (blast-radius), reports a verdict keyed to head SHA | "CI green is an input, not a verdict." |
| Draft enforcement | Grok Bot via cursor-github `get_pull_request` / `set_pull_request_draft` | Belt and braces on Boyd's hard rule. |
| War Room | box, `dd serve` on port 4420, bound to 127.0.0.1 by default | Never public. LAN/Tailscale only if Boyd turns it on. |
| Lessons | `lesson_recorded` events, weekly gardener pass proposes one engine check | Correction order of value: architecture > checks > skills > human review. |

### 3.6 Guards (built into types and code, not just prompts)

- `parseTargetRepo()` is the only way to make a `TargetRepo`. It rejects anything not owner `BoydVC`, anything mentioning `kpd`/`kpdlawgroup`, and anything not in `targets.json`. Every launch-type `NextAction` carries a `TargetRepo`, so a bad target cannot type-check.
- `policy.ts` screens the idea text: collections/debt-collection/law-firm-targeting or KPD terms → refuse with a reason (Boyd's non-compete and the KPD boundary).
- Budget: N default 3, hard cap 5, max 1 relaunch per candidate, max 2 fix loops, max 1 extra judge pass. `budget.ts` refuses any action past the cap. The engine has no path that buys anything or turns on on-demand spend.
- Every brief includes FORBIDDEN: merge, deploy, force-push to main, touching other repos, secrets in code, non-draft PRs.

## 4. Synthesis decision (designed twice, then a third time)

**A. Grok Bot conducts, the box decides (chosen).** Box CLI = state machine + brief renderer; Grok Bot executes each `NextAction` with tools it already has (CloudAgent, cursor-github, chat) and records results. Pros: zero new credentials, revived on agent completion so no polling, deterministic core testable offline, matches the orchestrate playbook. Cons: Grok Bot's turn budget is part of the cost; progress between scheduled checks depends on revivals.

**B. A Cursor Project coordinator owns everything.** Launch one Project per pick with the scouting report; it spawns threads and returns a PR. Pros: least box code. Cons: no rubric/score record Boyd can see, harder to enforce draft-only and target allowlist in code, judging happens inside the same coordinator that made the work, nothing reusable.

**C. A box daemon calling the Cursor Cloud Agents REST API v1.** Pros: true live SSE streams on the dashboard, no dependence on Grok Bot turns. Cons: needs a `CURSOR_API_KEY` Boyd has not set up, v1 webhooks are "coming soon" so it polls or holds streams, and it is a second launcher with its own auth.

**Grafts into A:** from C, the `NextAction` contract is shaped like the v1 API (repo, startingRef, prompt, title) so a REST driver can execute the same actions later and stream into the War Room; from B, a `kind: "launch_project"` variant is reserved for big picks once the base flow is proven.

## 5. Tradeoffs

- **Diversity vs. the model rule.** The CloudAgent tool only sets a model when Boyd explicitly asks. Until Boyd names a model per role in `draftday.config.json`, diversity comes from **angles** (c1 "simplest thing that passes", c2 "extensibility first", c3 "tests first, then code"), and the judge and physical cannot be guaranteed a different model family. The board shows the model each run actually used.
- **Latency.** A pick takes hours, not minutes (agents run in parallel, but judge → graft → physical are serial). Fine for Boyd's async style.
- **Cost per pick.** About N+3 agent runs (3 candidates + judge + graft + physical), plus up to 2 fix replies. That is the point this week: spend Cursor Models usage before the Oct 20 reset.
- **Event log over a database.** Simple, inspectable, git-diffable; no concurrent writers by design. Would not scale to many users; it does not need to.

## 6. Alternatives considered and rejected

- Running the arena locally in worktrees (Cursor `/best-of-n`, Claude Squad): violates "never clone onto the box or Boyd's computers".
- One judge prompt over the diffs only: cheaper, but loses executed evidence and inherits position/verbosity bias (BRIEF 4).
- Auto-merge after N hours (poteto's last-mile flow): ruled out by Boyd's draft-only rule.
- SQLite store: unnecessary dependency for a single-writer log.

## 7. Open questions for Boyd

1. Create the empty private repo `BoydVC/draft-day` (with a README so `main` exists). The box has no GitHub write access and none of the connected tools can create repos.
2. Approval default: "ask before every Combine" (one tap) or "auto" for picks on the engine's own repo?
3. Models: leave Cursor's default for every role, or name models per role so the judge and physical run on a different family than the builders?
4. War Room button: should Grok Bot set up the webhook routine (needs Boyd to paste a sender key through a secret request), or is the 3x/day pickup enough?

## 8. Next step

Once the repo exists: launch one scaffold cloud agent with `SPEC.md` (plus this file, `PLAN.md` and `research/BRIEF.md` as attached files) to build the engine skeleton, `dd selftest`, the War Room shell and the verify skill, and open a **draft** PR. From Saturday, Draft Day builds Draft Day: its own features become its first picks (see `PLAN.md`).
