---
name: update-catalog
description: Update the shared Open Pstack model catalog and publish a plugin release. Use when adding or editing Claude, Codex, Cursor, or Grok offerings, when setup rejects a descriptor as uncataloged, or when asked to bump or publish the plugin version.
---

# Update catalog and publish

Maintainer workflow for this checkout (`gannonh/open-pstack`). One catalog (`plugins/pstack/catalog/models.json`) feeds the Claude Code, Codex, and Cursor plugins. There is no personal overlay. An offering is selectable in setup only after it is cataloged and operators have installed the release that contains it.

Read [`docs/models.md`](../../../docs/models.md) for discovery adapters, field flags, and inventory rules. Follow the repo lifecycle for the Linear issue, isolated worktree, and PR.

## Do not

- Hand-edit `models.json`. Use `pstack-models`.
- Invent a selector, effort list, or replacement for an unsupported discovery row.
- Catalog a stale name (`gpt-6-terra`) when discover advertised a different id (`gpt-5.6-terra`).
- Add a `legacyMigrations` entry or change `role-defaults.json` unless the issue says so.
- Bump the six lockstep version files in the catalog PR. The Release workflow does that.
- Edit Arena, Architect, How, Interrogate, setup control flow, or runner provider switch cases. Those read the catalog.

## 1. Discover

```shell
plugins/pstack/skills/poteto-mode/scripts/runner/pstack-models discover \
  --provider <claude|codex|cursor|grok> \
  --output /tmp/inventory.json
```

Repeat `--provider` to query more than one. Default with no flag is all four.

The inventory entry must be `supported` and `membership: not cataloged`. Copy selector, efforts, default effort, and display name from that row. Codex does not advertise a family; pass `--family`.

## 2. Add or edit

```shell
plugins/pstack/skills/poteto-mode/scripts/runner/pstack-models add \
  <provider:selector> --from /tmp/inventory.json --family <slug> --yes
```

Use `edit <offering-id>` to change fields of an existing offering. `remove` refuses while role defaults, a successor, or a migration still point at it.

Claude offerings also regenerate `plugins/pstack/agents/pstack-<stem>-<effort>.md`. Codex, Cursor, and Grok offerings do not.

## 3. Tests that pin membership

If the shipped offering list changed, update:

- `catalog.test.ts` expected ids and `provider:selector` rows
- `ADDED_OFFERING_IDS` in `catalog-fixture.test-helper.ts`
- the provenance test that rebuilds the shipped catalog through `proposeAdd`

Write a `CHANGES.md` heading for the next version. Leave the six lockstep version files alone.

## 4. Verify

```shell
plugins/pstack/skills/poteto-mode/scripts/runner/pstack-models validate
```

Then from `plugins/pstack/skills/poteto-mode/scripts`: `bun run test` and `bun run typecheck`. From the repo root: `bun test scripts/release-version.test.ts` and `PSTACK_STATIC_ONLY=1 bash tests/skill-collision-repro.sh`.

`pstack-models list` must show copyable `provider:selector@effort` values for each new offering.

## 5. PR, then Release

Open one PR that names the Linear issue. Do not put a version bump in that PR.

After it is on `main`, publish:

```shell
gh workflow run Release --ref main
```

Empty `version` patch-bumps (`1.6.2` → `1.6.3`). Pass `-f version=X.Y.Z` to set the version. The workflow refuses a non-`main` ref, an invalid or non-increasing version, and an existing `vX.Y.Z` tag. It updates the six lockstep files, tags, and creates the GitHub release.

```shell
gh run watch --workflow=Release
```

Confirm `plugins/pstack/.claude-plugin/plugin.json` on `origin/main` and the GitHub release match.

## 6. Operators pick it up

A new Codex task (or Claude / Cursor session) after:

```shell
codex plugin marketplace upgrade open-pstack
codex plugin add pstack@open-pstack
```

```shell
claude plugin marketplace update open-pstack
```

```shell
cursor-agent plugin marketplace update gannonh-open-pstack
```

Then rerun setup in that harness. Setup accepts the new descriptors only from the installed plugin cache, not from this checkout.
