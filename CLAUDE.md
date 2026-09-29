<!-- begin global rules -->
## Subagent delegation

- Delegate independent, bounded tasks when parallel work can save time or improve quality. Follow configured role assignments and give each agent the context, scope, and expected result. Keep dependent work sequential and avoid overlapping edits.
- Keep agent messages readable, with proper spacing. Review and integrate delegated results, then verify the combined outcome before reporting completion.

## Verifying work

- Tests alone do not prove a slice. Before a PR leaves draft, run the app, drive the changed screen in a browser, and record or screenshot the result.
- Unit tests call the code the way its users do and assert literal expected values.
- Live TypeSafe and LLM calls cost money, and TypeSafe has no sandbox. Tests use the recorded judge backend. Make live calls only in named live checks.
- Live browser checks per PR: 10 scenarios when the slice changes a screen, 4 when it does not. Scenario 1 runs the same flow on `main` and on the branch. Each Linear issue lists its scenarios.
- A PR that changes a screen carries screenshots and a 30 to 60 second video for Human Review.
<!-- end global rules -->

<!-- pstack:models:begin -->
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: claude:opus@high
bug-fix: claude:opus@high
perf-issue: claude:opus@high
hillclimb: claude:opus@low
judgment and prose: claude:opus@high
hardest tasks: claude:opus@xhigh
how explorer: claude:opus@high
how explainer: claude:opus@high
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: claude:fable@medium, claude:opus@xhigh, codex:gpt-6.1-sol@medium, cursor:grok-4.7@xhigh
arena cross-judge pool: claude:fable@medium, claude:opus@xhigh, codex:gpt-6.1-sol@medium, cursor:grok-4.7@xhigh
swarm workers: claude:opus@high
architect runners: claude:fable@medium, claude:opus@xhigh, codex:gpt-6.1-sol@medium, cursor:grok-4.7@xhigh
interrogate reviewers: claude:fable@medium, claude:opus@xhigh, codex:gpt-6.1-sol@medium, cursor:grok-4.7@xhigh
<!-- pstack:models:end -->
