# Draft Day: build plan, Fri Oct 16 to Thu Oct 22, 2026

All times ET. Usage clocks:
- **Cursor Models pool** (pays for cloud agents): about 3% used. Billing period ends Oct 20 UTC, so treat the reset as possibly **Mon Oct 19 ~8:00 PM ET**. Front-load every arena before then.
- **Grok Bot weekly pool** (pays for the coordinator, research, writing, verification reading): resets **Thu Oct 22 ~7:42 PM ET**. Target about 95% used by then; finish the build by 5:00 PM Thu.
- Scheduled checks: 9:33 AM, 1:33 PM, 6:33 PM daily, plus automatic revivals when any cloud agent finishes. Thursday 5:41 PM safety net stays on.

Rules for every day: draft PRs only, never merge, nothing KPD or collections-related, no on-demand spend, no clones on the box or Boyd's computers, send nothing to anyone except Boyd's own chat.

## Fri Oct 16 (today): research and architecture. DONE locally
- research/BRIEF.md, research/POTETO-BOOKMARKS.md, ARCHITECTURE.md, SPEC.md, PLAN.md, LOG.tsv.
- **Blocked:** no tool here can create `BoydVC/draft-day` (box `gh` not signed in; GitHub connector is read and PR-edit only; Origin has no namespace). Boyd action: create the empty private repo with a README. As soon as it exists, Grok Bot launches the scaffold agent (SPEC 001) with the four docs attached.

## Sat Oct 17: scaffold, then the first real arena
| When | What | Agents |
|---|---|---|
| 9:33 AM check | If repo exists and scaffold not launched: launch SPEC 001 scaffold (1 agent, branch `dd/scaffold`, draft PR). | 1 |
| On scaffold finish | Grok Bot reviews: runs nothing locally (no clone); reads the PR diff through the GitHub connector, reads screenshots, confirms `draft: true`. Logs verdict. | 0 |
| 1:33 PM | **Pick 1: Film Room scorecards** (weighted per-criterion scoring, swap-consistency flag, tie rule, scorecard table in War Room). First full Draft Day run *by hand*: Grok Bot follows `dd next` against the scaffold branch as `startingRef`. N=3. | 3 + judge + graft + physical = 6 |
| 6:33 PM | **Pick 2: Pick timeline** (events rendered as a readable decision log with agent links, durations, run counts). N=3. | 6 |

Until Boyd merges the scaffold (his call), every pick starts from the newest draft branch in the stack and says so in its PR body.

## Sun Oct 18: the engine runs itself
| When | What | Agents |
|---|---|---|
| 9:33 AM | **Pick 3: Lessons + gardener** (`dd lessons` groups repeated judge/verifier findings; proposes one engine check per group; correction order of value). | 6 |
| 1:33 PM | **Pick 4: Phone War Room** (mobile layout, dark mode, big status chips, "New pick" form usable on an iPhone). | 6 |
| 6:33 PM | **Pick 5: Replay mode** (scrub a finished pick's events like game film; this becomes the demo video's backbone). | 6 |

## Mon Oct 19: last arena day before the Cursor reset
| When | What | Agents |
|---|---|---|
| 9:33 AM | **Pick 6: Scouting Report linter** (checks every rubric criterion is gradeable, every EARS line has a test or journey, angles are distinct). | 6 |
| 1:33 PM | **Pick 7: Boyd's choice.** Ask Boyd for one idea (any BoydVC repo he adds to `targets.json`, nothing KPD). If no answer by 3 PM, run "Big Board stats" (win rate by angle, trades per pick, verify pass rate). | 6 |
| by 6:00 PM | No new arenas after this. Remaining Cursor usage goes to fix replies on open draft PRs. | as needed |

Expected Cursor spend Sat-Mon: about 7 picks x 6 runs + scaffold + fix loops ≈ 45-50 agent runs.

## Tue Oct 20: verify everything
- Physical re-run on every open Draft Day PR at its current head SHA; ledger table in the War Room.
- `maintain-verification-skill` pass on `verify-draft-day` (one PR of proven corrections at most).
- `blast-radius` on the riskiest change of the week (likely the transition table or the reducer).
- Fix loops where verdicts are NOT_VERIFIED.

## Wed Oct 21: polish and demo video
- README with the glossary, a 60-second "how a pick works", screenshots.
- Demo video: record the War Room replaying a real pick (box Chrome screen capture, cut to about 90 seconds). Store under `out/` on the box; nothing published.
- Rehearse the final report message.

## Thu Oct 22: finish by 5:00 PM
- 9:33 AM: last fixes only.
- 1:33 PM: freeze. Every Draft Day PR still a draft, each with a verdict.
- by 5:00 PM: final reveal to Boyd (in his Grok Bot chat): what Draft Day is, links to the draft PRs, the scoreboard, the video, and what he should look at first.
- 5:41 PM safety net: if anything is behind, ship what passes and report the rest.

## Risks and fallbacks
| Risk | Fallback |
|---|---|
| Repo not created by Sat noon | Keep running the design locally: Grok Bot builds a box prototype of the War Room and `dd` from SPEC 001 under `/workspace/tokenmax/poteto-pipeline/proto/` (box files only, no clone), so the week's Grok Bot usage still lands. Cloud arenas wait for the repo. |
| A cloud agent ignores "draft" | Grok Bot flips it with the GitHub connector right after and logs it as a lesson. |
| Candidates all fail the same way | Arena rule: re-frame the scouting report, rerun once, never average. |
| Judge and builders share a model family | Board shows it; Boyd can name per-role models in config (the bot only sets models he names). |
| Cursor reset arrives earlier than Mon 8 PM | Saturday and Sunday already carry most picks. |
