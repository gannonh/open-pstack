# Open Pstack

[![CI](https://github.com/gannonh/open-pstack/actions/workflows/ci.yml/badge.svg)](https://github.com/gannonh/open-pstack/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/gannonh/open-pstack)](https://github.com/gannonh/open-pstack/releases/latest)
[![MIT license](https://img.shields.io/github/license/gannonh/open-pstack)](LICENSE)

Open Pstack is one repository with one shared skill tree and catalog, and three installable plugins. The repo is `gannonh/open-pstack`. The marketplace name is `open-pstack`.

- Cursor plugin id: `open-pstack`. Distinct from Lauren Tan's official Cursor plugin `pstack`.
- Claude Code plugin id: `pstack` via marketplace `open-pstack`.
- Codex plugin id: `pstack` via marketplace `open-pstack`.

The shared tree is `plugins/pstack/skills/` plus `plugins/pstack/catalog/`.

Open Pstack brings [Lauren Tan (@poteto)](https://x.com/poteto)'s [pstack](https://github.com/cursor/plugins/tree/main/pstack) to Cursor, Claude Code, and Codex. Its job is to stay as close to her original work as possible while translating the parts that depend on one app.

Lauren built pstack from the skills she uses to ship code at Cursor. In a [55-minute interview with Denis Labelle](https://x.com/DenisLabelle/status/2091337807939706928), she says that she shipped 1,000 pull requests in one month after steadily improving how her agents work and verify their results.

> If you want to go fast, go deep first.

Open Pstack is an unofficial community project. If you want Lauren's Cursor-native experience with Cursor-only features, use [her original pstack](https://github.com/cursor/plugins/tree/main/pstack). If you want one skill tree and one model sheet format across Cursor, Claude Code, and Codex, use this repository.

## Product facts

**Grok runs through Cursor's CLI.** The external model runner includes a `cursor` provider, so the Grok family can run through `cursor-agent` on a Cursor subscription. The descriptor is `cursor:cursor-grok-4.6@<effort>`. The runner invokes `cursor-agent -p --model cursor-grok-4.6-<effort>`. It proves availability through the `cursor-agent models` listing before the model starts. It verifies the served model from the CLI's stream-json init event. Cursor serves no `max` tier for that stem, so selectable efforts stop at `xhigh`. The standalone `grok` provider still works when that CLI is installed and authenticated.

**Model routing is catalog-driven.** Offerings and first-run role assignments live in `plugins/pstack/catalog/`. Setup can assign any cataloged provider, model, and effort per role. That includes Cursor Fable 5.1 (`cursor:claude-fable-5-1`) alongside Claude's rolling `fable` selector. See [docs/models.md](docs/models.md).

**Cursor is a supported parent.** The `open-pstack` Cursor plugin loads the same skills from the same plugin root. In Cursor, `cursor:*` descriptors run as native subagents. Claude, Codex, and Grok descriptors run through the same external runner the other parents use. Setup writes `~/.cursor/rules/open-pstack-models.mdc` and leaves the original plugin's `pstack-models.mdc` alone.

The Cursor provider change is recorded in [CHANGES.md](CHANGES.md) under 1.3.0 and 1.3.1. Catalog-driven routing is 1.4.0 and 1.5.0. The Cursor plugin is 1.6.0. The Why and Reflect role-map split is 1.6.1.

## What pstack does

pstack is a plugin for coding agents. It gives your agent engineering rules, step-by-step workflows for different kinds of work, focused skills, and small local tools.

The normal entry point is `poteto-mode`. You give it a task in plain language. It then:

- reads the task and chooses a workflow that fits;
- learns how the current system works before changing it;
- compares designs when the choice matters;
- favors small, simple changes over extra machinery;
- asks several models to challenge important decisions when useful;
- runs the code and checks real behavior instead of stopping at "the tests pass"; and
- carries the work through review, continuous integration (CI), and a ready-to-merge pull request when asked.

![How pstack routes a task through focused skills, real-app proof, and a review-ready pull request](assets/pstack-workflow.png)

pstack does not ask you to trust an agent on day one. It helps the agent leave evidence you can inspect. Start with supervised work. Let it run more work in parallel only after its checks have earned that trust in your own repositories.

## Install

You need a current Cursor, Claude Code, or Codex installation. For the full four-model review, install and sign in to the Claude Code, Codex, and `cursor-agent` command-line tools. [Bun](https://bun.sh) runs the small local tool that starts models outside the app you are using. You can still use the core workflows with fewer models.

### Cursor

The Cursor plugin is named `open-pstack` to tell it apart from Lauren's original `pstack` plugin. Both ship skills with the same names, including `poteto-mode` and `arena`. Disable the original `pstack` plugin while `open-pstack` is enabled. Otherwise two copies of `/poteto-mode` compete. Two model sheets give the agent conflicting instructions. Open Pstack never reads or changes `~/.cursor/rules/pstack-models.mdc`.

Register this repository as a plugin marketplace:

```shell
cursor-agent plugin marketplace add https://github.com/gannonh/open-pstack
```

Install `open-pstack` from Cursor plugin settings (**Settings > Plugins**). One install serves the IDE and the CLI. Cursor CLI 2026.09.02 has no `plugin install` subcommand.

Update the marketplace index:

```shell
cursor-agent plugin marketplace update open-pstack
```

To try a checkout in the CLI without installing, pass the plugin root directly:

```shell
cursor-agent --plugin-dir /path/to/open-pstack/plugins/pstack
```

The plugin directory must sit outside the workspace. The CLI drops a plugin's skills when the plugin directory is inside the workspace. `--plugin-dir` does not apply the startup rule. Invoke `/poteto-mode` yourself. An installed plugin applies the rule.

The CLI also limits subagents to a short list of models that can differ from `cursor-agent models`. `resolveCursorDescriptorRoute` maps catalog composed ids onto that list (`claude-fable-5-1-xhigh` to `claude-fable-5-1-thinking-xhigh`) and uses print-mode `cursor-agent` with the composed id when the mapped slug is absent. pstack does not swap in a `-fast` neighbour.

Uninstall from the same plugin settings page.

### Claude Code

Run these commands inside Claude Code:

```text
/plugin marketplace add gannonh/open-pstack
/plugin install pstack@open-pstack
/reload-plugins
```

Or from your shell:

```shell
claude plugin marketplace add gannonh/open-pstack
claude plugin install pstack@open-pstack
```

The shell path has no reload step. The plugin loads when the next Claude Code session starts.

### Codex

Run these commands in your shell:

```shell
codex plugin marketplace add gannonh/open-pstack 
codex plugin add pstack@open-pstack
```

Update:

```shell
codex plugin marketplace upgrade gannonh/open-pstack 
```



Turn on Codex subagents in `~/.codex/config.toml` so pstack can compare work in parallel:

```toml
[features]
multi_agent = true
```

Start a new Codex task after installation so it can discover the new skills and setting.

## Get started

Lauren's original setup has two steps. Open Pstack keeps the same flow.

### 1. Set up the models

In Cursor, run:

```text
/setup-pstack
```

In Claude Code, run:

```text
/pstack:setup-pstack
```

In Codex, ask:

```text
Use pstack:setup-pstack to configure pstack.
```

Setup checks the models you can actually run. It shows cataloged offerings, including alternate providers for the same logical model. It asks before saving the choices. The current default group uses Fable, GPT-5.6 Sol, Grok 4.6 through Cursor, and Opus. You can assign Cursor Fable 5.1, or another cataloged offering, to any role. See [docs/models.md](docs/models.md).

An older model sheet starts using cataloged rolling aliases in memory as soon as this release is installed. Uncataloged predecessor version pins migrate without losing role assignments. A cataloged explicit version is left unchanged. Run setup once after updating if you want that migration written to disk.

### 2. Use poteto-mode

Start any task that needs careful engineering with `poteto-mode`.

In Cursor:

```text
/poteto-mode Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

In Claude Code:

```text
/pstack:poteto-mode Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

In Codex:

```text
Use pstack:poteto-mode. Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

For that feature, poteto-mode should first understand how search works today. It should decide how the data should be represented before writing code, implement the smallest complete version, run the feature the way a user would, review the result, and prepare the pull request.

That is the main workflow. The other skills are there when poteto-mode needs them or when you want to call one directly.

## Useful skills

| Skill | Use it when |
| --- | --- |
| `how` | You want a clear explanation of how part of the system works. |
| `why` | You want evidence for why the system was built that way. |
| `architect` | A change crosses a function or module boundary and the design needs to be settled first. |
| `arena` | You want several complete attempts, followed by a comparison of their best parts. |
| `interrogate` | You want different models to try to break a design or diff. |
| `create-verification-skill` | Your project has no repeatable way for an agent to prove real behavior. |
| `maintain-verification-skill` | The project's verification instructions no longer match the product. |
| `babysit` | A pull request needs CI failures and review comments handled until it is ready. |
| `reflect` | A hard task is finished and its lessons should improve the next run. |

In Cursor, skills carry no prefix: `/architect`. Plugin skills include `pstack:` in their name in Claude Code and Codex. In Claude Code, invoke a native skill such as `/pstack:architect`. In Codex, ask for the skill, such as `Use pstack:architect for this design.` See the [technical reference](docs/reference.md) for the full list.

## Models and token use

Some pstack workflows use one model. Skills such as `architect`, `arena`, and `interrogate` can run several models in parallel. Each model run uses the subscription and token allowance of its own command-line tool.

`setup-pstack` lets you choose provider, model, and effort per role or panel lane from the catalog. A model from the app you are using runs inside that app. Other models run through their own command-line tools. Open Pstack does not quietly replace a failed model with a weaker one.

## Cursor, Claude Code, and Codex

All three apps read the same pstack skills. Only the way they start those skills and models is different.

| | Cursor | Claude Code | Codex |
| --- | --- | --- | --- |
| Start poteto-mode | The installed plugin's always-applied rule routes non-trivial work into it. You can also run `/poteto-mode` yourself. | Claude loads a small startup instruction that can route non-trivial work into it. You can also run `/pstack:poteto-mode` yourself. | Ask for `pstack:poteto-mode` by name. Codex does not load the Claude startup instruction. |
| Runs inside the app | `cursor:*` models (Grok 4.6, Cursor Fable 5.1) run as Cursor subagents. | Claude models stay inside Claude Code. | The Sol model stays inside Codex. |
| Other models | Claude and Codex run through their signed-in CLIs. | Codex runs through its signed-in CLI; Grok runs through the signed-in Cursor CLI. | Claude runs through its signed-in CLI; Grok runs through the signed-in Cursor CLI. |
| Model sheet | `~/.cursor/rules/open-pstack-models.mdc`, an always-applied rule. | `~/.claude/pstack-models.md`, included from `CLAUDE.md`. | `~/.codex/pstack-models.md`, mirrored into `AGENTS.md`. |
| Skills and workflows | Shared. | Shared. | Shared. |

A `cursor:*` descriptor names a model Cursor serves. The `cursor` provider is a model lane, and Cursor the app is also a parent that can run pstack. Cursor may replace a subagent's configured model under team or plan restrictions; pstack checks the served model against the request and reports a mismatch as a failed lane rather than accepting the substitute. The standalone Grok Build CLI can still take part in a multi-model review, but you cannot use it as the main app running pstack.

## Learn from the original

Lauren's [pstack guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide) walks through a real task, verification, and longer unattended runs. It uses Cursor's interface, and the ideas are the same everywhere. Use the translated skill invocations above in Cursor, Claude Code, or Codex.

This repository also keeps:

- [the original README](README-UPSTREAM.md), unchanged;
- [the technical reference](docs/reference.md) for every skill, dependency, and Cursor, Claude Code, or Codex detail;
- [the model catalog and routing guide](docs/models.md);
- [the upstream sync record](UPSTREAM.md) and update process;
- [the change record](CHANGES.md) for every adaptation; and
- [the attribution record](NOTICE.md) for pstack and the imported Cursor Team Kit skills.

## Staying close to Lauren's pstack

Open Pstack 1.6.1 tracks pstack 0.14.8 at Cursor commit [`7314f723a487ec406b6369fe5865ba034cfed166`](https://github.com/cursor/plugins/commit/7314f723a487ec406b6369fe5865ba034cfed166).

The two projects have separate version numbers. The pstack version identifies Lauren's upstream content. The Open Pstack version identifies the Cursor, Claude Code, and Codex package built from it.

In this repository, "upstream" means Lauren's Cursor pstack. Open Pstack does not promise instant updates. It records the exact version it follows and reviews new changes in order. It changes only what Cursor, Claude Code, and Codex require. New pstack behavior belongs in Lauren's official Cursor plugin first whenever possible.

## Lineage

Open Pstack began as Michael Denyer's [`pstack-claude`](https://github.com/michael-denyer/pstack-claude) port of Lauren's pstack. [`ericlitman/open-pstack`](https://github.com/ericlitman/open-pstack) later became the canonical distribution. That event is recorded under 1.1.0 in [CHANGES.md](CHANGES.md).

This repository is `gannonh/open-pstack`. Soft-fork tracking of `ericlitman/open-pstack` ended 2026-09-06. Cursor pstack is the only content-sync source. The optional `ericlitman` git remote is an archive. Never merge from it. Do not name a remote `upstream` that points at ericlitman.

## Contributing

Product work stays in Linear project Open Pstack and in this repository. GitHub Issues are inbound reports only. Do not use them for planning. Do not file product issues on `ericlitman/open-pstack` by default. If a change belongs in Lauren's official Cursor plugin `pstack`, send it there.

Read [UPSTREAM.md](UPSTREAM.md) before changing content brought over from Lauren's pstack. Pull requests must keep one shared skill tree for Cursor, Claude Code, and Codex. They must pass the repository's tests, type checks, plugin validation, and static checks.

## License

MIT. pstack was created by Lauren Tan. Open Pstack includes history from Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and attributed MIT-licensed work from Cursor Team Kit and Superpowers. See [NOTICE.md](NOTICE.md) and the preserved license files for details.
