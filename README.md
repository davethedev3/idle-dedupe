# idle-dedupe

A Claude Code mod that stops a subagent's completion from arriving twice. A subagent that reports to the main conversation by `SendMessage` is followed by the engine's `idle_notification`, whose result restates the same report; a late message can also wake a finished agent for one more turn and a second notice. This mod keeps such a repeat's name and `idleReason` and cuts its result to one line that begins with the first 120 characters of the final text.

A notice is cut only when all of these hold:

- the agent sent a report to `main`, or already delivered an idle result, within the last 15 minutes;
- the main conversation hasn't messaged the agent since then, so a reply to a follow-up question arrives whole;
- its `idleReason` is absent or `available`, so errors are never cut.

## Install

From the [davesmods](https://github.com/davethedev3/davesmods) marketplace:

```sh
claude plugin marketplace add davethedev3/davesmods
claude plugin install idle-dedupe@davesmods
```

Function-hooks mods are an early-access Claude Code feature (written against 2.1.302). To run from a checkout instead, load the folder with `claude --plugin-dir /path/to/idle-dedupe`, or list it in `CLAUDE_CODE_PLUGIN_DIRS` (colon-separated) to load it in every session. The engine writes the plugin API's type declarations to `.claude-plugin/types/` when it loads the mod; they are not part of this repo.

Checks: `claude plugin validate .` and `claude plugin test .` from this folder. The `SendMessage` path can't be raised from the test kit, so it was verified with a live subagent.
