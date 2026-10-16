# Research brief: a personal software production engine

Prepared Fri Oct 16, 2026 for Boyd (BoydVC / @xristafer). Every claim below carries a link to something read today. Where a source is secondary (someone else's write-up), it says so. Where something could not be checked, it says that too.

Contents
1. What @poteto actually does (and what to borrow)
2. Cursor Cloud Agents: how to launch and watch them from code
3. Arena / best-of-N: does running several agents pay off?
4. Judging: LLM-as-judge, agent-as-judge, and their known biases
5. Grafting: combining the best parts of several candidates
6. Verification loops: tests, browser driving, screenshots
7. Spec-driven development tools
8. Comparable open-source pipelines
9. What this means for Draft Day (design implications)
10. Open questions and things not verified

---

## 1. What @poteto actually does

Primary sources (her own posts, from Boyd's bookmarks; full list in `POTETO-BOOKMARKS.md`):

- The order of value for any correction you keep making: fix it in architecture or data structures first, then a lint rule or test, then a skill or rule, and human review last ("ngmi"). https://x.com/poteto/status/2089067865098113024
- pstack 0.15.9 ships `/correct` (find repeated agent mistakes, fix them with architecture, types and checks) and an `/architect` update for agent-friendly architecture. Her sample prompt asks a Project agent to "answer its own open questions by prototyping rather than defer to me" and to "come back to me with a plan backed by real data". https://x.com/poteto/status/2106542593656111276
- "restate in your own words what you think my goals are and what the problem i'm trying to solve is", later shipped as `/in-your-own-words`. https://x.com/poteto/status/2104744961904394699 and https://x.com/poteto/status/2110047236369547621
- pstack tutorial: `/setup-pstack` (choose a budget), prefix `/poteto-mode`, ask `/poteto-help`. https://x.com/poteto/status/2110757066709356851
- "here's how i shipped 2,500 PRs last month to production" (talk). https://x.com/poteto/status/2102050467505430555 . Not watched in this run.

Primary sources (the installed pstack skills, read today from `/home/box/agent-data/plugins/pstack/pstack/skills/`):

- **arena**: same prompt to N candidates, a rubric of 3-6 gradeable criteria that only the picker sees, separate output locations, a readonly cross-judge on a different model family, score criterion by criterion (not holistic feel), pick the base a maintainer can extend most easily, graft one or two things per loser by hand, then verify. Wild divergence means the framing was under-specified: re-frame and re-run, do not average.
- **architect**: usage first, then types; design it twice with structurally distinct candidates; screen against red flags (shallow module, information leakage, temporal decomposition, pass-through, split ownership, two ways to do one task, importable internals, hand-synced lists).
- **swarm**: frame a done predicate, choose partition vs race (declare `first pass`, `rank all` or `best-of` up front), workers report `PASS`, `ISSUES` or `BLOCKED` with evidence; a dropout is a gap, never a pass.
- **create-verification-skill / maintain-verification-skill**: generate `.cursor/skills/verify-<app>/` with Launch, Doctor, Drive, Evidence, Cleanup, Helpers and a feature map; the skill must be executed once end to end before it counts; maintenance is a periodic pass that ships at most one PR of proven corrections.
- **blast-radius**: find the one fact a change is safe because of, and prove it by running real code (a 5-rung "how sure are you" ladder from "you said so" to "reproduced in the running app").
- **show-me-your-work**: one append-only TSV decision log; evidence is a pointer, never prose.
- **orchestrate playbook**: coordinator never writes code; one writer per file; "the CLI never spawns, waits, or wakes anything"; a ledger keyed by PR + head SHA with verdicts `live-ui-verified | unit-test-verified | type-check-only | verifier-blocked | verifier-failed`; "CI green is an input to a verdict, not a verdict".

Secondary sources (write-ups of her talk and essays, not her own words unless quoted):

- Matt Pocock interview summary: verification is "the most important capability" because it gives the agent "hands and eyes"; the trust ladder cannot be skipped; deterministic work belongs in tools (her verification CLI wraps Playwright and the Chrome DevTools Protocol); she prefers a "Michelin kitchen" to a "software factory"; inner loop (coding agents) vs outer loop (Slack, Linear, X, email routed by Grok Bot into Cursor Projects); much of the 2,500 PRs was "gardening"; she reviews by sampling and turns repeated mistakes into lint rules, skills or checks. https://intelligentartifact.com/posts/how-lauren-tan-ships-thousands-of-prs-a-month/
- Barnaby Robson's pstack essay (Oct 5, 2026): six mental models (Michelin Kitchen, Trust Ladder, Inner and Outer Loops, Gardener, Hands/eyes/map, Measure a hundred times). Describes her "last mile" flow: Slack feedback, Linear ticket, cloud agent reproduces with pstack, fix PR, fuzz with a small swarm, ping, auto-merge after an hour unless she objects. Also describes the Benny automation pack in pstack. https://barnabyrobson.org/on-pstack/

**What to borrow, and what not to.** Borrow: the arena contract, verification as the gate, one-writer state, the correction order of value, in-your-own-words before spending. Do not borrow: auto-merge. Boyd's rules are draft PRs only and nothing merges without him, so Draft Day sits on the rung below full autopilot on purpose.

## 2. Cursor Cloud Agents: launching and watching them from code

Three ways exist today. All were confirmed from docs or tool schemas read today.

**a) The CloudAgent tool inside Grok Bot (what this project should use first).** It is a first-party tool in this bot (not an MCP namespace: `GetDynamicTools` search for "cloud|agent" returned no cursor namespace entry). Its schema supports `launch` (prompt, repo URL, starting_ref, model, title, environment, files, images, secret_names), `get`, `list`, `dump` (full transcript to a JSONL file), `reply` (queue / steer / interrupt), `watch`, `cancel`, `archive`, `list_artifacts`, and `find_by_pr`. Authentication is handled for the signed-in user, so no API key is needed. The bot is revived automatically when a launched agent finishes, so no polling loop is required.

**b) Cloud Agents REST API v1 (public beta).** https://cursor.com/docs/cloud-agent/api/endpoints.md
- `POST /v1/agents` creates a durable agent and enqueues its first run. Body: `prompt.text`, optional `model {id, params}`, `repos[{url, startingRef | prUrl}]`, `workOnCurrentBranch`, `autoCreatePR`, `envVars`, `mcpServers`, `customSubagents`, `mode` (`plan` or `agent`), and a client-supplied `agentId` for idempotent creates (`409 agent_id_conflict` on repeat).
- Agents have status `ACTIVE | IDLE | ARCHIVED`; runs carry execution status (`CREATING`, `RUNNING`, `FINISHED`, `ERROR`, `CANCELLED`, `EXPIRED`), `durationMs`, final `result` text, and `git.branches[{repoUrl, branch, prUrl}]`.
- `POST /v1/agents/{id}/runs` sends a follow-up; only one active run per agent (`409 agent_busy`).
- `GET /v1/agents/{id}/runs/{runId}/stream` is Server-Sent Events: `status`, `assistant`, `thinking`, `tool_call`, `result`, `heartbeat`, `error`, `done`; resumable with `Last-Event-ID`; `410 stream_expired` after the retention window.
- `GET /v1/agents/{id}/usage` gives per-run token usage. `GET /v1/agents/{id}/artifacts` lists screenshots/videos; download via 15-minute presigned URL.
- Auth: user API key from Cursor Dashboard, Basic or Bearer. Webhooks are "coming soon" for v1.
- Legacy v0 supports a per-agent `webhook {url, secret>=32 chars}` that POSTs `statusChange` for `FINISHED` or `ERROR`, signed with `X-Webhook-Signature: sha256=...`. https://cursor.com/docs/cloud-agent/api/webhooks

**c) Cursor SDK** (`npm install @cursor/sdk`), the same agent runtime in TypeScript, local or cloud. https://cursor.com/changelog/sdk-release

**What a cloud agent can do once launched** (https://cursor.com/docs/cloud-agent/capabilities):
- Its own VM with a desktop and browser ("computer use"), so it can start the app, click through flows and verify before pushing.
- Artifacts (screenshots, videos, logs) attached to the PR; optional embedding in PR descriptions behind a dashboard setting.
- Subscriptions: wait for PR comments, CI results, Slack replies, Linear changes or timers, then continue in the same conversation.
- Automatic CI-failure fixing on PRs it created (Teams only today).
- A built-in "Cursor Cloud MCP" for run info, related runs, transcripts and diff metadata.
- Environments via `.cursor/environment.json` (install/start commands, snapshot or Dockerfile). https://cursor.com/docs/cloud-agent

**Cursor's own best-of-N.** Cursor 3 has `/best-of-n model1,model2,...` running one prompt across models in separate worktrees, with a parent agent comparing results; `/best-of-n` does not merge, `/apply-worktree` applies a winner. https://cursor.com/docs/configuration/worktrees and https://forum.cursor.com/t/cursor-3-worktrees-best-of-n/156507 . Draft Day differs by running in the cloud from a phone-sized idea, scoring against a written rubric with executed evidence, grafting, gating on verification, and recording every run.

## 3. Arena / best-of-N: does it pay off?

- **Correct answers are usually in the pile; picking them is the problem.** CodeFuse-Agent reports a single rollout at 65.2% on SWE-bench Verified vs an 82.4% best-of-N oracle, a 17-point gap, and closes part of it by pooling every rollout's self-written tests and picking the patch with the highest pass rate. https://github.com/codefuse-ai/CodeFuse-Agent/blob/refs/heads/main/tech_report.md
- **Verifier reranking helps.** SWE-Gym trains an outcome verifier over trajectories; Best@16 reaches 32.0% on SWE-bench Verified (+11.4 points). https://arxiv.org/html/2412.21139
- **Use the learned/LLM judge as a filter, not the sole ranker.** EntroPO pairs a learned verifier with model-free signals (tests passing, trajectory length) and argues self-evaluation is unreliable when used alone; gains depend on candidate diversity. https://arxiv.org/html/2509.12434v2
- **For long agent runs, compare summaries in small groups.** "Scaling Test-Time Compute for Agentic Coding" converts each rollout into a structured summary and runs Recursive Tournament Voting over small groups; reported Claude-4.5-Opus going from 70.9% to 77.6% on SWE-bench Verified (mini-SWE-agent). https://arxiv.org/abs/2604.16529
- **Cluster by behavior to keep diversity.** AlphaCode filters on public examples, generates new inputs, clusters programs with identical outputs, and submits one per cluster from largest down. https://arxiv.org/abs/2203.07814

Takeaway for Draft Day: N=3 diverse candidates (different model families) is the sweet spot for a personal budget; selection must lead with executed evidence (build, tests, cross-candidate tests, verify-skill journeys) and use the LLM judge on top of that.

## 4. Judging

- **LLM-as-judge biases are measured.** Zheng et al. found position bias (GPT-4 consistent after swapping order in 65% of hard cases; Claude-v1 23.8%) and verbosity bias; mitigation: judge both orders and count a win only when both agree, else a tie. https://arxiv.org/abs/2306.05685
- **Agent-as-a-Judge beats LLM-as-a-Judge on code tasks.** An agentic evaluator that can read the workspace, search, and inspect trajectories reached about 90% agreement with human consensus vs about 70% for LLM-as-a-Judge on DevAI (55 tasks, 365 hierarchical requirements), at about 3% of the human cost. https://arxiv.org/abs/2410.10934 ; code: https://github.com/metauto-ai/agent-as-a-judge
- **pstack's arena** already encodes the remaining guards: rubric hidden from candidates, judge on a different family, criterion-by-criterion scoring, a second reader (the orchestrator) whose agreement confirms the pick.

Takeaway: the Draft Day judge is a cloud agent (agent-as-judge, so it can run each branch), candidates are anonymized and order-shuffled, rubric scoring is per criterion with a pointer to evidence, and Grok Bot is the second reader. Disagreement is logged and broken by the arena tie rule (cleaner boundary, smaller API).

## 5. Grafting

- **Rank then fuse.** LLM-Blender ranks candidates pairwise, keeps the top K, then generates a fused output conditioned on them. https://arxiv.org/html/2306.02561v3
- **Layered refinement.** Mixture-of-Agents feeds earlier outputs to later agents as context. https://arxiv.org/html/2406.04692
- **pstack's stance** (arena Phase E): pick one base, port one or two things per loser by hand so the result keeps one mental model, never paste mechanically; convergence means ship the consensus with no graft.

Takeaway: Draft Day grafts with a single cloud agent that starts from the winning branch, receives a short typed graft list (source candidate, file pointers, why), and must re-run the full gate after grafting.

## 6. Verification loops

- Cursor cloud agents can drive a browser on their own VM and attach screenshots and video to PRs. https://cursor.com/docs/cloud-agent/capabilities and https://cursor.com/blog/agent-computer-use
- Playwright MCP drives browsers from accessibility snapshots with element refs instead of pixels; refs go stale after navigation, so re-snapshot. https://playwright.dev/mcp/introduction and https://github.com/microsoft/playwright-mcp
- pstack `create-verification-skill` defines the project-local verify skill format; `maintain-verification-skill` keeps the feature map honest. Read from the installed plugin.
- poteto's verification CLI wraps Playwright and CDP (secondary: Pocock interview summary above).
- Box check today: Node v20.19.2, Python 3.13.5, `/usr/bin/google-chrome` present, no Playwright package installed. Cloud agents bring their own toolchain.

Takeaway: the engine repo ships its own `verify-draft-day` skill (launch dashboard on a free port with a temp data dir, doctor, drive with Chrome via CDP or Playwright, capture screenshots), generated and executed by the scaffold agent. Every target repo gets the same treatment before its first arena.

## 7. Spec-driven development tools

- **GitHub Spec Kit**: constitution once, then specify (what/why) → plan (stack, architecture) → tasks → implement → converge (re-check against the artifacts until "Converged"); optional gates clarify, checklist, analyze. https://github.com/github/spec-kit and https://github.com/github/spec-kit/blob/main/docs/quickstart.md
- **AWS Kiro**: `.kiro/specs/<feature>/requirements.md` (user stories + acceptance criteria in EARS: "WHEN [event] THE SYSTEM SHALL [behavior]"), `design.md`, `tasks.md`; requirements-first or design-first. https://kiro.dev/docs/specs/ and https://kiro.dev/docs/specs/feature-specs/requirements-first/
- **pstack sharpen**: ask how a top expert would do it, what the user is really after, whether the task is over- or under-specified, keep one outside check. Read from the installed plugin.

Takeaway: Draft Day's Scouting Report merges these: in-your-own-words restatement, EARS acceptance criteria (each one gradeable, so it doubles as rubric), a usage-first design sketch (architect), a verify plan, and a "converge" check run by the judge.

## 8. Comparable pipelines

| Tool | What it is | Gap Draft Day fills |
|---|---|---|
| Cursor `/best-of-n` | Same prompt across models in local worktrees, parent compares. https://cursor.com/docs/configuration/worktrees | Local only, no rubric, no recorded scoring, no verification gate, no dashboard. |
| Claude Squad | tmux + worktree session manager for CLI agents (AGPL-3.0). https://github.com/smtg-ai/claude-squad | Human compares by hand. |
| Vibe Kanban | Local kanban + worktrees, MCP card creation; community-maintained since Bloop shut down Apr 2026. https://github.com/BloopAI/vibe-kanban | No arena/judge. |
| Bernstein | Goal → planner → task graph → parallel agents → "Janitor" verify → merge; deterministic scheduler, `.sdd/` state. Described in https://www.augmentcode.com/tools/open-source-agent-orchestrators | Partitions work rather than racing candidates; merges automatically. |
| Agent Orchestrator (ex-Composio) | Per-session worktrees and PRs, CI retry loops. Same source as above. | No competing candidates. |
| OpenHands resolver | Tag an issue, agent opens a PR (GitHub Action or local). https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues | Single attempt. |
| CodeJoust | "Pit AI coding agents against the same bug", score tests, diff, cost, time. https://github.com/he-yufeng/CodeJoust | Closest idea; tiny project (0 stars when fetched), local worktrees. |

None of these combine cloud agents, a written rubric, an agent-judge with executed evidence, grafting, a verification gate, and a phone-friendly dashboard that Grok Bot drives from a chat message.

## 9. Design implications for Draft Day

1. Grok Bot is the coordinator because it already holds CloudAgent auth and gets woken on completion; the box never needs a Cursor API key in v1.
2. Box code is a deterministic state machine plus a CLI that prints the next action and records results; it never spawns or waits (orchestrate playbook).
3. Each candidate is its own cloud agent on its own branch (`dd/<pick>/<cand>`): separate-before-serializing by construction.
4. Selection order: hard gates (build/tests/verify journey) → cross-candidate test matrix → anonymized rubric judge agent → Grok Bot second read. Ties go to the smaller, cleaner base.
5. Graft is a single agent from the base branch with a typed graft list, then the full gate again.
6. Verification gate = generated verify skill + blast-radius proof by a verifier agent on a different model family; verdicts land in a ledger keyed by PR and head SHA.
7. Draft PR is enforced twice: the brief says draft, and Grok Bot flips it with `set_pull_request_draft` and checks `draft: true`.
8. Lessons from repeated judge/verifier findings become engine checks (the correction order of value), not longer prompts.

## 10. Open questions and not verified

- Did not watch the 2,500 PRs talk; points attributed to it come from secondary summaries.
- The pstack guide link in bookmark #11 fetched as an empty file on GitHub today (https://github.com/cursor/plugins/blob/main/pstack/docs/guide/README.md); it may have moved.
- The CloudAgent tool has no explicit draft-PR or `autoCreatePR` parameter; draft state is enforced through the brief plus the cursor-github tool afterward.
- Whether a cloud agent can launch on a brand-new repo with zero commits is untested. Boyd should create the repo with a README so `main` exists.
- `x` public search for more poteto posts hit a shared 429 rate limit today; bookmark coverage is the 11 posts listed.
