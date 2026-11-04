# Film Room scorecard

The Scorecard is the first thing on a judged pick page. It tells Boyd, from a phone, who the base is and why. Columns are finished candidates. Pass 1 and Pass 2 are buttons when a second pass ran.

## Sub-features

- `film-room-read` opens the close pick and reads the base, the swap chip, the close-call chip, and the tie-rule sentence.
- `film-room-pass` presses Pass 1 and shows that pass's ranks.
- `film-room-phone` lays the same scorecard out at 390×844.
- `film-room-single` opens the happy pick and reads Single pass.
- `film-room-live` paints a new scorecard after `judgement_recorded` without a reload.
- `film-room-disagree` shows the judge sentence and the second-read note.

## How to get to it (user POV)

- On the Big Board, choose the pick whose idea is `Show the scorecard pass toggle on the pick page`.
- Or paste `#/picks/<id>` onto the War Room origin.

## Driving it with the browser

Preconditions:

- `control.sh doctor` passes.
- `dd selftest --keep` has seeded the close pick (`drafted`, two judge passes, `swap: flipped`).

- **Read the close scorecard.** Open that pick. The region named `Scorecard` is on the page. It shows a chip `Swap: flipped`, a chip `Close call`, and the text `BASE` on the base column. The reason sentence names the split and the tie rule (`diff_lines`). Each column heading is `<cand> · <label>` and shows that candidate's angle. Rows read `Gates`, `Cross-tests`, `<name> ×<weight>`, `Weighted`, `Rank`, and `Diff`.
- **Proof.** Scroll `#scorecard` into view. Screenshot `/opt/cursor/artifacts/war-room/film-room-flipped.png` at 1280×800. The shot shows `BASE`, `Swap: flipped`, `Close call`, and the tie-rule sentence.
- **Pass 1.** Press the button named `Pass 1`. It reports `aria-pressed` true, and `Pass 2` reports false. The status reads `Showing pass 1.` Rank 1 on this pass is not the same candidate as rank 1 on pass 2. Screenshot `/opt/cursor/artifacts/war-room/film-room-pass1.png`.
- **Phone.** Set the viewport to 390×844, still on the Scorecard. The columns stack in one column, the base column leads, and the reason stays readable without a horizontal scrollbar. Screenshot `/opt/cursor/artifacts/war-room/film-room-phone.png`.
- **Single pass.** Open the happy-path pick (`Add a status legend to the War Room`). The Scorecard chip reads `Single pass`. There are no Pass 1 / Pass 2 buttons. Screenshot `/opt/cursor/artifacts/war-room/film-room-single.png`.
- **Live and disagree.** Source `/tmp/dd-verify/state.env`. A literal `dd intake` is GNU dd and exits 1, and these records do nothing useful without `--data "$DATA"`. `candidate_finished` needs `--cand` and one `dd-report` fence. `judgement_recorded` needs one `dd-judgement` fence. Before that record the Scorecard text is `Film Room has not scored this pick.` The same judgement names a `base` label that fails a gate, and the record passes `--second-read disagree --note "The judge named the gate-failer."`. Within 2 seconds, without a reload, the Scorecard shows `The judge preferred <cand>, but <cand> failed a gate, so <cand> (passed every gate) is the base.` and the note. Screenshot `/opt/cursor/artifacts/war-room/film-room-live.png` and `/opt/cursor/artifacts/war-room/film-room-disagree.png`.

````bash
set -a; source /tmp/dd-verify/state.env; set +a
CLI=(node --experimental-strip-types src/cli/dd.ts)
id=$("${CLI[@]}" intake --idea "Score a pick live for the Film Room" --source chat --target BoydVC/draft-day --n 3 --approval ask --data "$DATA" --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["pickId"])')
python3 - <<'PY'
import json
from pathlib import Path
Path("/tmp/dd-film-report.json").write_text(json.dumps({
  "restatement": "You want a scorecard that appears live.",
  "acceptance": [{"id": "show", "when": "the pick is open", "shall": "show the scorecard"}],
  "rubric": [
    {"id": "clarity", "name": "Clarity", "weight": 3, "howToGrade": "read"},
    {"id": "safety", "name": "Safety", "weight": 2, "howToGrade": "prove"},
    {"id": "tests", "name": "Tests", "weight": 1, "howToGrade": "run"},
  ],
  "designSketch": "A scorecard.",
  "verifyPlan": ["Open the pick."],
  "safetyFact": "A gate failure cannot become the base.",
  "angles": ["simplest thing that passes", "extensibility first", "tests first, then code"],
  "forbidden": ["Do not merge."],
}))
PY
"${CLI[@]}" record "$id" scouting_report_written --file /tmp/dd-film-report.json --data "$DATA"
"${CLI[@]}" record "$id" scouting_approved --data "$DATA"
python3 - "$id" <<'PY'
import json, sys
from pathlib import Path
pick = sys.argv[1]
for cand, sha in {"c1": "a"*40, "c2": "b"*40, "c3": "c"*40}.items():
    body = {"branch": f"dd/{pick}/{cand}", "headSha": sha, "summary": cand, "commands": [{"cmd": "npm test", "exit": 0}], "tests": {"added": 1, "passing": True}, "screenshots": [], "risks": []}
    Path(f"/tmp/dd-film-{cand}.md").write_text("```dd-report\n" + json.dumps(body) + "\n```\n")
PY
for cand in c1 c2 c3; do
  "${CLI[@]}" record "$id" candidate_finished --cand "$cand" --file "/tmp/dd-film-$cand.md" --data "$DATA"
done
"${CLI[@]}" record "$id" judge_launched --data "$DATA"
python3 - "$id" <<'PY'
import json, os, subprocess, pathlib, sys
data = os.environ["DATA"]
pick = sys.argv[1]
shown = json.loads(subprocess.check_output(["node", "--experimental-strip-types", "src/cli/dd.ts", "show", pick, "--json", "--data", data], text=True))
labels = shown["labels"]
failer = next(k for k, v in labels.items() if v == "c1")
others = [k for k, v in labels.items() if v != "c1"]
def card(label, journey, score, evidence):
    return {"label": label, "gates": {"build": "pass", "tests": "pass", "journey": journey}, "crossTests": {"passed": 4 if journey == "fail" else 3, "total": 4}, "diff": {"files": 1, "added": 10, "removed": 1}, "scores": [{"criterionId": cid, "score": score, "evidence": evidence} for cid in ("clarity", "safety", "tests")]}
body = {"passes": [{"order": [failer, *others], "cards": [card(failer, "fail", 4, "failed journey")] + [card(label, "pass", 1, "passes the gate") for label in others]}], "base": failer, "runnerUps": others, "trades": [], "swapConsistent": None}
pathlib.Path("/tmp/dd-film-judgement.md").write_text("```dd-judgement\n" + json.dumps(body) + "\n```\n")
PY
"${CLI[@]}" record "$id" judgement_recorded --file /tmp/dd-film-judgement.md --second-read disagree --note "The judge named the gate-failer." --data "$DATA"
````

## Gotchas

- The walkover pick is drafted and has no scorecard. The close pick is the one with the pass toggle.
- Pass buttons are in the group named `Judge pass`. A reload is not the toggle.
- On a phone the base column is ordered first. The accessible names of the columns stay `<cand> · <label>`.
- Cleanup does not delete `/opt/cursor/artifacts/war-room/`.
