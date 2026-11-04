# Agents in this repo

One way to do each task.

- Add an event: put it in `EVENT_TYPES` in `src/core/events.ts` and give it a key in `eventKey`. Then add a row to `TRANSITIONS` in `src/core/transitions.ts`. Do not keep a second list.
- Change a stage rule: edit `src/core/transitions.ts` and the reducer in `src/core/reducer.ts`. `next()` in `src/core/next.ts` is the only place that chooses the next action.
- Change a brief: edit the matching file in `src/briefs/` and the filler in `src/briefs/render.ts`. Candidate briefs never include the rubric. Judge briefs use labels A-E. The label map is written only on `judge_launched`.
- Parse an agent report: `src/report/parse.ts`. Invalid JSON or missing fields must exit 2 and write nothing.
- Record a result: `dd record`. The same event type and idempotency key is a no-op.
- Serve the War Room: `dd serve`. Static files are `src/ui/` and there is no build step.
- The only entry points are `src/cli/dd.ts`, `src/server/http.ts`, and `src/core/index.ts`. Tests import those, not internal files.
- The optional relay in `src/server/relay.ts` stays quiet unless `DD_WEBHOOK_URL` and `DD_WEBHOOK_KEY` are both set. Never log the key.

## Checks

```bash
npm test
npx tsc --noEmit
npm run dd -- selftest
npm run dd -- doctor
```

Targets come from `targets.json`. The owner has to be `BoydVC`, the repo has to be on that list, and the string cannot contain `kpd`. Ideas that match the policy screen are stored as failed picks with reason `policy`.

Do not merge, enable auto-merge, deploy, or push to `main`. Pull requests from this engine stay drafts.
