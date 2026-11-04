# Scout: toy feature

## GOAL
Build a tiny toy that proves the linter reads markdown scouting reports.

## ACCEPTANCE (EARS)
- **T1** WHEN the linter reads this file THE SYSTEM SHALL return ok with zero hard findings. → `test/linter.test.ts:T1`
- **T2** WHEN angles are pairwise compared THE SYSTEM SHALL report no collisions. → `test/linter.test.ts:T2`
- **T3** WHEN the verify skill runs THE SYSTEM SHALL capture the linter panel screenshot. → journeys "linter-panel"

## HIDDEN RUBRIC
| id | Criterion | Weight | How to grade |
|---|---|---|---|
| `core` | Lint fidelity | 3 | Run T1-T2 against fixtures/linter/*. 4 = exact expectedFor(). 2 = one wrong soft. 0 = muttered scores. Evidence: test/linter.test.ts:T1. |
| `screen` | Panel screens | 2 | Run cdp-shot.mjs on the linter panel at 390 and 1280. 4 = ok:true and readable. 2 = one cramped screen. 0 = sideways scroll. Screenshots required for 3 or 4. |
| `stack` | Clean stack | 2 | Touch map only. Zero runtime deps. Score 0-4 from git diff --name-only START...HEAD. |

### Design sketch
```
Boyd pastes a scout markdown, taps Lint, sees PASS.
```

## VERIFY
1. npm test green
2. cdp-shot on the linter panel
3. Safety fact proof

## FORBIDDEN
- Draft PRs only
- Nothing KPD

## ARENA ANGLES
| Cand | Branch | Angle | What |
|---|---|---|---|
| c1 | `dd/toy-a` | **Rule ledger.** Pure function first. | clean |
| c2 | `dd/toy-b` | **Scout checklist.** UI checklist first. | clean |
| c3 | `dd/toy-c` | **Coverage matrix.** Matrices first. | clean |
