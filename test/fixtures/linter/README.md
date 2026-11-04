# test/fixtures/linter (SPEC 007, Pick 6 Scouting Report linter)

Commit every file here byte-identical. Tests read them; nothing edits them.

## What the linter checks
`linter-harness.mjs` is the binding oracle (`lintScoutingReport`). It grades a
LintDocument (a ScoutingReport plus optional `checks` map):

1. **Rubric gradeability** — each criterion's `howToGrade` needs a pointer
   (test path, journey, cdp-shot, npm test, git diff / touch map, file:line, or
   an R/L/W/T id) and a 0-4 scale. Missing pointer or empty text = **hard**.
   Pointer without a scale, or under 40 characters = **soft**.
2. **EARS coverage** — every acceptance id must appear in `checks` with a ref
   matching `test/<file>:<name>`, `journey:<id>`, or `npm-test+VERIFY`. Else
   **MISSING** = **hard**.
3. **Angle distinctness** — pairwise Jaccard on tokenized angles. Collision when
   identical after normalize, one contains the other (≥12 chars), or
   Jaccard ≥ 0.45. Any collision = **hard**.

`ok` is true only when `hard` is empty. Soft warnings never flip `ok`.

## Fixtures (measured against the harness)
| File | Role | Expected summary |
|---|---|---|
| `good-replay.json` | Clean LintDocument shaped like SPEC 006 | `pass` |
| `good-lessons.json` | Clean LintDocument shaped like SPEC 004 | `pass` |
| `good-markdown.md` | Markdown scout with → check bindings | `pass` (via `parseMarkdownScout`) |
| `hostile-collide-angles.json` | Angles 0 and 1 overlap (jaccard 0.75) | `fail · 1 hard` (`angles:0-1`) |
| `hostile-missing-ears.json` | Only R1 bound; R2/R5/R14/R19/R20 MISSING | `fail · 5 hard` |
| `hostile-ungradeable.json` | Empty / vague howToGrade on three criteria | `fail · 3 hard` |
| `hostile-markup.json` | Markup and `javascript:` in text fields; still structurally pass | `pass` (UI must keep text as text) |
| `hostile-soft.json` | One short howToGrade (tests) | `pass with 1 soft warning` |
| `expected.json` | Oracle rows for every fixture above | machine-readable |

## Harness
`linter-harness.mjs` (+ `linter-harness.d.mts`) exports `lintScoutingReport`,
`parseMarkdownScout`, `gradeCriterion`, `anglePairs`, `earsCoverage`,
`loadFixture`, and `expectedFor`. No DOM. No network. Zero deps.
