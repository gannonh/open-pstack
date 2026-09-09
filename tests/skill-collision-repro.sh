#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note() { printf '%s\n' "$*"; }

legacy_command_dir="$repo/plugins/pstack/commands"
if [ -e "$legacy_command_dir" ]; then
  note "FAIL: legacy command layer still exists: $legacy_command_dir"
  find "$legacy_command_dir" -mindepth 1 -print 2>/dev/null || true
  fail=1
else
  note "ok: native skills are the only user-facing workflow surface"
fi

bad_principle=""
for skill in "$repo"/plugins/pstack/skills/principle-*/SKILL.md; do
  if [ ! -f "$skill" ]; then
    bad_principle="no principle-* leaves found"$'\n'
    break
  fi
  front="$(sed -n '2,/^---$/p' "$skill")"
  printf '%s\n' "$front" | grep -q '^user-invocable: false$' || bad_principle="$bad_principle$skill (missing user-invocable: false)"$'\n'
  printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$' && bad_principle="$bad_principle$skill (still carries disable-model-invocation)"$'\n'
done
if [ -n "$bad_principle" ]; then
  note "FAIL: principle-* leaves must be user-invocable: false and model-readable:"
  note "$bad_principle"
  fail=1
else
  note "ok: all principle-* leaves request user-hidden and remain model-readable"
fi

principle_count="$(find "$repo/plugins/pstack/skills" -maxdepth 1 -type d -name 'principle-*' | wc -l | tr -d ' ')"
if [ "$principle_count" != "23" ]; then
  note "FAIL: expected 23 principle-* leaves, found $principle_count"
  fail=1
else
  note "ok: 23 principle-* leaves"
fi

if grep -Fq '"id": "how critics"' "$repo/plugins/pstack/catalog/role-defaults.json" \
  || grep -Fq 'how critics' "$repo/plugins/pstack/skills/how/SKILL.md" \
  || [ -e "$repo/plugins/pstack/skills/how/references/critic-prompt.md" ] \
  || [ -e "$repo/plugins/pstack/skills/how/references/critique-rubric.md" ]; then
  note "FAIL: how critique mode or how critics role is still present"
  fail=1
else
  note "ok: how critique mode and how critics role are gone"
fi

how_skill="$repo/plugins/pstack/skills/how/SKILL.md"
how_direct="$repo/plugins/pstack/skills/how/references/direct-explainer-prompt.md"
how_simple_bad=""
if grep -Fq 'without the explorer-findings section' "$how_skill"; then
  how_simple_bad="${how_simple_bad}simple /how path still strips explorer findings from explainer-prompt.md"$'\n'
fi
if ! grep -Fq 'references/direct-explainer-prompt.md' "$how_skill"; then
  how_simple_bad="${how_simple_bad}simple /how path does not use references/direct-explainer-prompt.md"$'\n'
fi
if [ ! -f "$how_direct" ]; then
  how_simple_bad="${how_simple_bad}direct explainer prompt is missing"$'\n'
else
  if ! grep -Eq 'Use Glob to find directories and files, Grep to find key symbols, and Read to understand' "$how_direct"; then
    how_simple_bad="${how_simple_bad}direct explainer prompt does not require Glob/Grep/Read"$'\n'
  fi
  if grep -Eq 'Multiple explorer agents have traced|The explorers did the work|shouldn.t need to re-explore' "$how_direct"; then
    how_simple_bad="${how_simple_bad}direct explainer prompt still assumes explorer findings"$'\n'
  fi
fi
if [ -n "$how_simple_bad" ]; then
  note "FAIL: simple /how path must explore without explorer findings:"
  note "$how_simple_bad"
  fail=1
else
  note "ok: simple /how path uses a dedicated Glob/Grep/Read prompt"
fi

graft="$repo/scripts/graft-0150-onto-ours.py"
graft_bad="$(
  python3 - "$graft" <<'PY'
import ast, pathlib, re, sys
path = pathlib.Path(sys.argv[1])
tree = ast.parse(path.read_text())
ns = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        name = node.targets[0].id
        if name in {"CONFLICTED", "TAKE_OURS", "OURS"}:
            ns[name] = ast.literal_eval(node.value)
problems = []
source = path.read_text()
if 'Path("/workspace")' in source or "Path('/workspace')" in source:
    problems.append("REPO is hardcoded to /workspace")
if "/tmp/ours-head" in source:
    problems.append("graft still requires /tmp/ours-head")
if "Path(__file__).resolve().parents[1]" not in source:
    problems.append("REPO is not derived from __file__")
conflicted = ns.get("CONFLICTED") or []
take_ours = ns.get("TAKE_OURS") or set()
babysit = "plugins/pstack/skills/poteto-mode/playbooks/babysit.md"
if babysit in conflicted:
    problems.append("babysit.md is still in CONFLICTED")
if babysit not in take_ours:
    problems.append("babysit.md is not recorded as TAKE-OURS")
ours = ns.get("OURS")
if not re.fullmatch(r"[0-9a-f]{40}", ours or ""):
    problems.append(f"OURS is not a full commit SHA: {ours!r}")
if "{OURS}:" not in source:
    problems.append("graft does not read the ours baseline from git")
print("\n".join(problems))
PY
)"
if [ -n "$graft_bad" ]; then
  note "FAIL: 0.15.0 graft replay is not self-contained:"
  note "$graft_bad"
  fail=1
else
  note "ok: 0.15.0 graft resolves the repo from __file__, reads ours from git, and skips babysit"
fi

verof() { { grep -m1 '"version"' "$1" || true; } | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'; }
vc="$(verof "$repo/plugins/pstack/.claude-plugin/plugin.json")"
vx="$(verof "$repo/plugins/pstack/.codex-plugin/plugin.json")"
vr="$(verof "$repo/plugins/pstack/.cursor-plugin/plugin.json")"
vm="$(verof "$repo/.claude-plugin/marketplace.json")"
vrm="$(verof "$repo/.cursor-plugin/marketplace.json")"
vu="$(sed -n 's/| open-pstack version | `\([^`]*\)` |/\1/p' "$repo/UPSTREAM.md")"
if [ -n "$vc" ] && [ "$vc" = "$vx" ] && [ "$vc" = "$vr" ] && [ "$vc" = "$vm" ] && [ "$vc" = "$vrm" ] && [ "$vc" = "$vu" ]; then
  note "ok: open-pstack version matches across UPSTREAM.md, the 3 plugin manifests, and the 2 versioned marketplaces ($vc)"
else
  note "FAIL: open-pstack version differs: upstream=$vu claude-plugin=$vc codex-plugin=$vx cursor-plugin=$vr claude-marketplace=$vm cursor-marketplace=$vrm"
  fail=1
fi

# The Cursor plugin is `open-pstack`, shares the tree, and selects its components
# explicitly so Cursor's folder discovery cannot load Claude-only agents or hooks.
# The Claude Code and Codex plugins keep their `pstack` identifiers.
cursor_bad="$(
  python3 - "$repo" <<'PY'
import json, pathlib, re, sys
repo = pathlib.Path(sys.argv[1])
plugin = repo / "plugins/pstack"
problems = []
def load(path):
    try:
        return json.loads(path.read_text())
    except Exception as error:
        problems.append(f"{path}: {error}")
        return {}
def relative_ok(value):
    return isinstance(value, str) and not value.startswith("/") and ".." not in value.split("/")
manifest = load(plugin / ".cursor-plugin/plugin.json")
if manifest.get("name") != "open-pstack":
    problems.append("Cursor plugin name must be open-pstack")
if manifest.get("skills") != "./skills/":
    problems.append("Cursor manifest must select the shared ./skills/ tree")
agents = manifest.get("agents")
if not isinstance(agents, list) or not agents:
    problems.append("Cursor manifest must list agents explicitly")
else:
    for entry in agents:
        if not relative_ok(entry) or not (plugin / entry).is_file():
            problems.append(f"Cursor agent path does not resolve: {entry}")
        if pathlib.Path(entry).name.startswith("pstack-"):
            problems.append(f"Cursor manifest selects a Claude-native model lane: {entry}")
        text = (plugin / entry).read_text() if (plugin / entry).is_file() else ""
        front = text.split("---")[1] if text.startswith("---") else ""
        if re.search(r"^(model|effort|background|disallowedTools):", front, re.M):
            problems.append(f"Cursor agent carries Claude-only frontmatter: {entry}")
rules = manifest.get("rules")
if not isinstance(rules, list) or not rules:
    problems.append("Cursor manifest must list rules explicitly")
else:
    for entry in rules:
        path = plugin / entry
        if not relative_ok(entry) or not path.is_file():
            problems.append(f"Cursor rule path does not resolve: {entry}")
            continue
        text = path.read_text()
        if not re.search(r"^alwaysApply: true$", text, re.M):
            problems.append(f"Cursor startup rule is not always applied: {entry}")
        for needle in ("poteto-mode", "cursor-tools.md", "provider-dispatch.md", "open-pstack-models.mdc", "pstack-models.mdc"):
            if needle not in text:
                problems.append(f"Cursor startup rule does not mention {needle}: {entry}")
        if len(text.splitlines()) > 40:
            problems.append(f"Cursor startup rule is long enough to be copying workflow content: {entry}")
hooks = manifest.get("hooks")
if hooks is None:
    problems.append("Cursor manifest must select hooks explicitly (folder discovery would load the Claude hooks.json)")
elif isinstance(hooks, str):
    if hooks.replace("./", "") == "hooks/hooks.json":
        problems.append("Cursor manifest points at the Claude Code hooks.json")
elif hooks != {"hooks": {}}:
    problems.append("Cursor manifest inline hooks must be empty; Cursor's startup surface is the rule")
if manifest.get("commands") not in (None, []):
    problems.append("Cursor manifest must not add a commands layer")
if "mcpServers" in manifest:
    problems.append("Cursor manifest must not add MCP servers")
logo = manifest.get("logo")
if not relative_ok(logo) or not (plugin / logo).is_file():
    problems.append(f"Cursor logo does not resolve: {logo}")
marketplace = load(repo / ".cursor-plugin/marketplace.json")
if marketplace.get("name") != "open-pstack":
    problems.append("Cursor marketplace name must be open-pstack")
entries = marketplace.get("plugins") or []
if len(entries) != 1 or entries[0].get("name") != "open-pstack" or entries[0].get("source") != "plugins/pstack":
    problems.append("Cursor marketplace must list exactly one plugin, open-pstack, sourced from plugins/pstack")
if load(plugin / ".claude-plugin/plugin.json").get("name") != "pstack":
    problems.append("Claude Code plugin identifier changed")
if load(plugin / ".codex-plugin/plugin.json").get("name") != "pstack":
    problems.append("Codex plugin identifier changed")
for path in (plugin / ".claude-plugin/plugin.json", plugin / ".codex-plugin/plugin.json"):
    if "rules" in load(path):
        problems.append(f"{path} must not declare Cursor rules")
claude_market = load(repo / ".claude-plugin/marketplace.json").get("plugins") or [{}]
codex_market = load(repo / ".agents/plugins/marketplace.json").get("plugins") or [{}]
if claude_market[0].get("name") != "pstack" or codex_market[0].get("name") != "pstack":
    problems.append("Claude Code or Codex marketplace plugin identifier changed")
print("\n".join(problems))
PY
)"
cursor_setup="$repo/plugins/pstack/skills/setup-pstack/SKILL.md"
cursor_tools="$repo/plugins/pstack/skills/poteto-mode/references/cursor-tools.md"
cursor_dispatch="$repo/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md"
grep -Fq '~/.cursor/rules/open-pstack-models.mdc' "$cursor_setup" || cursor_bad="${cursor_bad}"$'\n'"setup-pstack does not write ~/.cursor/rules/open-pstack-models.mdc"
grep -Fq 'alwaysApply: true' "$cursor_setup" || cursor_bad="${cursor_bad}"$'\n'"setup-pstack Cursor rule is not always applied"
grep -Fq 'Claude Code, Codex, or Cursor' "$cursor_setup" || cursor_bad="${cursor_bad}"$'\n'"setup-pstack does not treat Cursor as a parent"
grep -Eq 'Never read, migrate, overwrite, or delete .*pstack-models\.mdc' "$cursor_setup" || cursor_bad="${cursor_bad}"$'\n'"setup-pstack does not protect the original pstack-models.mdc"
[ -f "$cursor_tools" ] || cursor_bad="${cursor_bad}"$'\n'"cursor-tools.md is missing"
grep -Fq '| Cursor | external runner | external runner | external runner | `resolveCursorDescriptorRoute` |' "$cursor_dispatch" || cursor_bad="${cursor_bad}"$'\n'"provider-dispatch route table lacks the Cursor parent row"
grep -Fq -- '--parent <claude|codex|cursor>' "$cursor_dispatch" || cursor_bad="${cursor_bad}"$'\n'"provider-dispatch runner usage lacks the cursor parent"
grep -Fq 'cursor-tools.md' "$repo/plugins/pstack/skills/poteto-mode/SKILL.md" || cursor_bad="${cursor_bad}"$'\n'"poteto-mode does not point Cursor at cursor-tools.md"
for doc in "$repo/README.md" "$repo/docs/reference.md"; do
  grep -Fq 'open-pstack' "$doc" && grep -Eiq 'disabl(e|ing) .*original' "$doc" || cursor_bad="${cursor_bad}"$'\n'"$doc does not advise disabling the original pstack plugin"
done
cursor_bad="$(printf '%s' "$cursor_bad" | sed '/^$/d')"
if [ -n "$cursor_bad" ]; then
  note "FAIL: Cursor plugin packaging invariants:"
  note "$cursor_bad"
  fail=1
else
  note "ok: Cursor plugin open-pstack selects shared skills, compatible agents, an always-applied startup rule, and no Claude hooks; pstack identifiers unchanged"
fi

# Shipped Claude Fable/Opus configuration may name only cataloged selectors:
# the rolling aliases or an explicit version the catalog lists. Uncataloged
# predecessor pins fail. Tests may still mention them.
uncataloged_claude_pins() {
  python3 -c '
import json, pathlib, re, sys
catalog = json.loads(pathlib.Path(sys.argv[1]).read_text())
cataloged = {o["selector"] for o in catalog["offerings"] if o["provider"] == "claude"}
pin = re.compile(r"claude-(?:fable|opus)-[0-9][a-z0-9.-]*(?:\[[a-z0-9]+\])?")
for line in sys.stdin:
    if any(selector not in cataloged for selector in pin.findall(line)):
        sys.stdout.write(line)
' "$repo/plugins/pstack/catalog/models.json"
}
legacy_model_pins="$(
  grep -REn \
    --include='*.md' --include='*.ts' --include='*.sh' \
    --exclude='*.test.ts' --exclude='*.test.js' \
    'claude:claude-(fable|opus)-[0-9]|^model: claude-(fable|opus)-[0-9]|--model claude-(fable|opus)-[0-9]' \
    "$repo/plugins/pstack" "$repo/tests" "$repo/README.md" "$repo/docs" \
    2>/dev/null | uncataloged_claude_pins || true
)"
standalone_code_pins="$(
  grep -REn \
    --include='*.ts' --include='*.js' \
    --exclude='*.test.ts' --exclude='*.test.js' \
    "['\"]claude-(fable|opus)-[0-9]" \
    "$repo/plugins/pstack" \
    2>/dev/null | uncataloged_claude_pins || true
)"
if [ -n "$legacy_model_pins" ] || [ -n "$standalone_code_pins" ]; then
  note "FAIL: shipped Claude Fable or Opus configuration still pins an uncataloged revision:"
  [ -z "$legacy_model_pins" ] || note "$legacy_model_pins"
  [ -z "$standalone_code_pins" ] || note "$standalone_code_pins"
  fail=1
else
  note "ok: shipped Claude Fable and Opus configuration uses catalog selectors"
fi

# Workflow skills must not copy catalog role defaults. Canonical descriptors
# live in catalog/role-defaults.json.
setup="$repo/plugins/pstack/skills/setup-pstack/SKILL.md"
dispatch="$repo/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md"
catalog_roles="$repo/plugins/pstack/catalog/role-defaults.json"
workflow_slug_hits="$(
  grep -REn \
    --include='SKILL.md' --include='*.md' \
    '(claude|codex|grok|cursor):[][a-z0-9.-]+@[a-z][a-z0-9-]*' \
    "$repo/plugins/pstack/skills/arena" \
    "$repo/plugins/pstack/skills/architect" \
    "$repo/plugins/pstack/skills/how" \
    "$repo/plugins/pstack/skills/interrogate" \
    "$repo/plugins/pstack/skills/swarm" \
    "$repo/plugins/pstack/skills/setup-pstack" \
    "$repo/plugins/pstack/skills/poteto-mode/SKILL.md" \
    "$repo/plugins/pstack/skills/poteto-mode/references/codex-tools.md" \
    "$repo/plugins/pstack/skills/poteto-mode/playbooks/feature.md" \
    "$repo/plugins/pstack/skills/poteto-mode/playbooks/bug-fix.md" \
    "$repo/plugins/pstack/skills/poteto-mode/playbooks/perf-issue.md" \
    "$repo/plugins/pstack/skills/poteto-mode/playbooks/hillclimb.md" \
    "$repo/plugins/pstack/skills/poteto-mode/playbooks/refactoring.md" \
    2>/dev/null || true
)"
catalog_bad=""
if [ ! -f "$catalog_roles" ] || [ ! -f "$repo/plugins/pstack/catalog/models.json" ]; then
  catalog_bad="canonical catalog files are missing"$'\n'
fi
if ! grep -Fq 'catalog/models.json' "$dispatch" || ! grep -Fq 'catalog/role-defaults.json' "$dispatch"; then
  catalog_bad="${catalog_bad}$dispatch does not point at the canonical catalog"$'\n'
fi
if ! grep -Fq 'catalog/models.json' "$setup" || ! grep -Fq 'Which named roles or panel lanes do you want to change?' "$setup"; then
  catalog_bad="${catalog_bad}$setup is not catalog-driven"$'\n'
fi
if grep -Fq 'Ask exactly four effort questions' "$setup"; then
  catalog_bad="${catalog_bad}$setup still asks exactly four family questions"$'\n'
fi
if [ -n "$workflow_slug_hits" ]; then
  catalog_bad="${catalog_bad}workflow skills still copy model descriptors:"$'\n'"$workflow_slug_hits"$'\n'
fi
if [ -n "$catalog_bad" ]; then
  note "FAIL: model defaults are not catalog-owned:"
  note "$catalog_bad"
  fail=1
else
  note "ok: model offerings and role defaults live in the catalog; workflow skills do not copy slugs"
fi

plugin="$repo/plugins/pstack"
canon="$plugin/skills/poteto-mode/references/bugbot-triage.md"
skill="$plugin/skills/babysit/SKILL.md"
playbook="$plugin/skills/poteto-mode/playbooks/babysit.md"
bugbot_skill_rel="../poteto-mode/references/bugbot-triage.md"
bugbot_playbook_rel="../references/bugbot-triage.md"
bugbot_bad=""
if [ ! -f "$canon" ]; then
  bugbot_bad="${bugbot_bad}canonical rubric missing: $canon"$'\n'
fi
skill_op="$(grep -F 'Review-bot comments (Bugbot and similar automation):' "$skill" || true)"
skill_n="$(printf '%s\n' "$skill_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$skill_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}standalone babysit skill lost bugbot-triage operational line"$'\n'
else
  skill_dest="$(printf '%s\n' "$skill_op" | sed -n 's/.*](\([^)]*\)).*/\1/p')"
  if [ "$skill_dest" != "$bugbot_skill_rel" ]; then
    bugbot_bad="${bugbot_bad}standalone babysit Markdown destination is [$skill_dest], not [$bugbot_skill_rel]"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq 'classify as fix, dismiss, or ask'; then
    bugbot_bad="${bugbot_bad}standalone babysit lost fix/dismiss/ask classification"$'\n'
  fi
  if ! printf '%s\n' "$skill_op" | grep -Fq "Follow the rubric's Ask by default categories, including security, data, and high-severity findings."; then
    bugbot_bad="${bugbot_bad}standalone babysit lost ask-by-default escalation"$'\n'
  fi
fi
playbook_op="$(grep -E '^8\. \*\*Bugbot is triaged skeptically, always\.\*\*' "$playbook" || true)"
playbook_n="$(printf '%s\n' "$playbook_op" | awk 'NF { c++ } END { print c+0 }')"
if [ "$playbook_n" != "1" ]; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook lost step-8 Bugbot operational line"$'\n'
elif ! printf '%s\n' "$playbook_op" | grep -Fq "$bugbot_playbook_rel"; then
  bugbot_bad="${bugbot_bad}poteto-mode babysit playbook step 8 lost bugbot-triage binding ($bugbot_playbook_rel)"$'\n'
fi
copies="$(find "$plugin" -name 'bugbot-triage.md' ! -path '*/node_modules/*' -print 2>/dev/null || true)"
n="$(printf '%s\n' "$copies" | awk 'NF { c++ } END { print c+0 }')"
if [ "$n" != "1" ]; then
  bugbot_bad="${bugbot_bad}expected exactly 1 bugbot-triage.md under plugin, found $n"$'\n'
fi
if [ -n "$bugbot_bad" ]; then
  note "FAIL: babysit Bugbot binding on the packaged plugin"
  note "$bugbot_bad"
  fail=1
else
  note "ok: babysit Bugbot binding on the packaged plugin"
fi

forge_neutral_files=(
  "$plugin/skills/poteto-mode/playbooks/shipping.md"
  "$plugin/skills/poteto-mode/playbooks/babysit.md"
  "$plugin/skills/poteto-mode/playbooks/autopilot-full.md"
  "$plugin/skills/poteto-mode/playbooks/autopilot-stack.md"
  "$plugin/skills/poteto-mode/playbooks/opening-a-pr.md"
  "$plugin/skills/poteto-mode/playbooks/multi-phase-plan.md"
  "$plugin/skills/poteto-mode/references/bugbot-triage.md"
)
graphite_commands="$(grep -En 'gt (submit|track|restack|sync|merge|ls)' "${forge_neutral_files[@]}" || true)"
if [ -n "$graphite_commands" ]; then
  note "FAIL: forge-neutral stack playbooks still name Graphite commands:"
  note "$graphite_commands"
  fail=1
else
  note "ok: forge-neutral stack playbooks name no Graphite command"
fi

unsafe_shell_templates="$(perl -ne 'while (/`((?:git|gh|origin|skills\/poteto-mode\/scripts\/watch-pr\/watch-pr)[^`]*)`/g) { my $command = $1; print "$command\n" if $command =~ /<[^>]+>/ }' "${forge_neutral_files[@]}" | sort -u)"
if [ -n "$unsafe_shell_templates" ]; then
  note "FAIL: executable shell templates paste placeholder text into commands:"
  note "$unsafe_shell_templates"
  fail=1
else
  note "ok: forge-derived values stay quoted shell data"
fi

shipping="$plugin/skills/poteto-mode/playbooks/shipping.md"
autopilot_full="$plugin/skills/poteto-mode/playbooks/autopilot-full.md"
autopilot_stack="$plugin/skills/poteto-mode/playbooks/autopilot-stack.md"
opening_a_pr="$plugin/skills/poteto-mode/playbooks/opening-a-pr.md"
multi_phase_plan="$plugin/skills/poteto-mode/playbooks/multi-phase-plan.md"
shipping_safety_bad=""
grep -Fq 'watch-pr --owner "$base_owner" --repo "$base_name" --pr "$pr"' "$playbook" || shipping_safety_bad="${shipping_safety_bad}Babysit watcher does not pin the base repository and PR number"$'\n'
grep -Fq -- '--disable-auto' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm pre-existing auto-merge"$'\n'
grep -Fq 'Before launching any verifier' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm the frozen queue before independent verification"$'\n'
shipping_disarm_order="$(awk '/^2\. / { disarm = index($0, "Before launching any verifier"); verify = index($0, "One subagent per PR"); if (disarm == 0 || verify == 0 || disarm >= verify) print $0 }' "$shipping")"
if [ -n "$shipping_disarm_order" ]; then
  shipping_safety_bad="${shipping_safety_bad}Shipping does not confirm the frozen queue unarmed before launching verifiers"$'\n'
fi
grep -Fq 'current bottom and every descendant' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not disarm the frontier and descendants before mutation"$'\n'
grep -Fq 'Stop before any rebase, force-push, retarget, arm, or merge' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping can mutate the frontier before every merge request is confirmed off"$'\n'
grep -Fq 'skills/poteto-mode/scripts/watch-pr/watch-pr' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not use the installed-plugin watcher path"$'\n'
grep -Fq -- '--owner "$base_owner" --repo "$base_name"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not pin the GitHub watcher to the base repository"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind rewritten branch pushes to the captured SHA"$'\n'
grep -Fq 'git merge-base --is-ancestor "$landing_base_sha" "refs/heads/$branch"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not prove its recorded patch base is an ancestor before rebasing"$'\n'
grep -Fq 'git rebase --onto "$trunk_tip" "$landing_base_sha" -- "$branch"' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not drop a squash-merged parent with an option-safe onto rebase"$'\n'
grep -Fq 'return to step 5 and merge it' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not merge after an unarmed frontier becomes ready"$'\n'
grep -Fq 'any terminal, non-passing conclusion, regardless of whether auto-merge or a merge-queue entry is pending' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping lets pending merge state hide a terminal required-check failure"$'\n'
grep -Fq '`UNSTABLE` is not a failure by itself' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping treats advisory or pending status as a terminal failure"$'\n'
grep -Fq "return to step 4's guarded rebase and step 3's re-verification" "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not recover an armed stale or conflicted frontier"$'\n'
if grep -Fq 'origin pr merge "$pr" --squash' "$shipping"; then
  shipping_safety_bad="${shipping_safety_bad}Shipping passes GitHub's unsupported squash flag to Origin"$'\n'
fi
grep -Fq '<verdict-sha>' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not preserve the independent verdict head"$'\n'
grep -Fq 'set `<landing-sha>` to `<current-head>`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not capture the post-rewrite landing head"$'\n'
grep -Fq 'require the local branch tip to match it' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping compares or merges a published head that the local patch calculation did not inspect"$'\n'
if grep -Fq '<verified-sha>' "$shipping"; then
  shipping_safety_bad="${shipping_safety_bad}Shipping still conflates the verdict head with the current landing head"$'\n'
fi
grep -Fq '`gh pr merge "$pr" --squash --match-head-commit "$landing_sha" --repo "$base_repo"`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind an immediate GitHub merge to the current landing head and base repository"$'\n'
grep -Fq '`gh pr merge "$pr" --squash --auto --match-head-commit "$landing_sha" --repo "$base_repo"`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not bind GitHub auto-merge setup to the current landing head and base repository"$'\n'
grep -Fq 'required, SHA-scoped verification check for the independent verdict' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping allows armed auto-merge to outlive its independent verdict"$'\n'
grep -Fq -- '--json headRefOid,baseRefName,state,mergedAt,mergeStateStatus,statusCheckRollup,autoMergeRequest' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not observe the head SHA and base branch while watching"$'\n'
grep -Fq 'On any head or base change' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not invalidate an armed merge after a head or base change"$'\n'
shipping_step_2="$(grep -E '^2\. ' "$shipping" || true)"
shipping_step_4="$(grep -E '^4\. ' "$shipping" || true)"
shipping_step_5="$(grep -E '^5\. ' "$shipping" || true)"
shipping_step_8="$(grep -E '^8\. ' "$shipping" || true)"
printf '%s\n' "$shipping_step_2" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not inspect GitHub merge-queue state before verification"$'\n'
printf '%s\n' "$shipping_step_2" | grep -Fq '`dequeuePullRequest`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not dequeue GitHub merge-queue entries before verification"$'\n'
printf '%s\n' "$shipping_step_2" | grep -Fq 'both `autoMergeRequest` and `mergeQueueEntry` are null' || shipping_safety_bad="${shipping_safety_bad}Shipping treats a null auto-merge request as fully disarmed"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not dequeue the frontier and descendants before mutation"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq 'Re-read `baseRefName` after any retarget and require it to equal `<trunk>`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not verify the destination after retargeting"$'\n'
printf '%s\n' "$shipping_step_4" | grep -Fq 'Record `<trunk>` as `<landing-base-ref>`' || shipping_safety_bad="${shipping_safety_bad}Shipping conflates the destination branch with the patch-base commit"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq '`baseRefName` equals `<trunk>`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not require the intended destination immediately before merge"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq 'GitHub has no server-enforced expected-base precondition' || shipping_safety_bad="${shipping_safety_bad}Shipping does not state the GitHub base-guard limitation"$'\n'
printf '%s\n' "$shipping_step_5" | grep -Fq 'Run the GitHub merge immediately after the matching preflight' || shipping_safety_bad="${shipping_safety_bad}Shipping cannot execute its required GitHub merge after checking the destination"$'\n'
printf '%s\n' "$shipping_step_8" | grep -Fq '`baseRefName`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not monitor the destination branch during landing"$'\n'
printf '%s\n' "$shipping_step_8" | grep -Fq '`mergeQueueEntry`' || shipping_safety_bad="${shipping_safety_bad}Shipping does not monitor native merge-queue state during landing"$'\n'
github_pr_commands="$(grep -Eho '`gh pr (create|edit|view|ready|merge|checks)[^`]*`' "${forge_neutral_files[@]}" || true)"
github_pr_unscoped="$(printf '%s\n' "$github_pr_commands" | grep -Fv -- '--repo "$base_repo"' || true)"
if [ -n "$github_pr_unscoped" ]; then
  shipping_safety_bad="${shipping_safety_bad}GitHub PR commands do not all name the canonical base repository: ${github_pr_unscoped}"$'\n'
fi
for remote_file in "$shipping" "$autopilot_full" "$autopilot_stack"; do
  grep -Fq '<head-remote>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not resolve the head push remote independently"$'\n'
  grep -Fq '<head-url>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not bind its remote read to the head push repository"$'\n'
  grep -Fq '<base-remote>' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not resolve the base fetch remote independently"$'\n'
  grep -Fq 'git ls-remote -- "$head_url" "refs/heads/$branch"' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not read the published SHA from the head push repository"$'\n'
  grep -Fq '"$head_url" "HEAD:refs/heads/$branch"' "$remote_file" || shipping_safety_bad="${shipping_safety_bad}${remote_file} does not publish to the exact head URL whose SHA it captured"$'\n'
  if grep -Fq '<git-remote>' "$remote_file"; then
    shipping_safety_bad="${shipping_safety_bad}${remote_file} still couples base fetches and head pushes through one legacy placeholder"$'\n'
  fi
  if grep -Eq 'git (ls-remote|push)[^`]*[[:space:]]origin([[:space:]]|`)' "$remote_file"; then
    shipping_safety_bad="${shipping_safety_bad}${remote_file} hard-codes origin for a guarded Git operation"$'\n'
  fi
done
grep -Fq 'Fetch current trunk through `<base-remote>`' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping does not fetch trunk from the base repository"$'\n'
if [ "$(grep -Fc 'through `<base-remote>`' "$shipping")" -lt 2 ]; then
  shipping_safety_bad="${shipping_safety_bad}Shipping does not keep using the base repository after the first merge"$'\n'
fi
grep -Fq 'Fetch another stack branch directly through `<head-url>`' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not fetch a fork parent through the head push repository URL"$'\n'
if grep -Fq '<parent-remote>' "$autopilot_stack"; then
  shipping_safety_bad="${shipping_safety_bad}Autopilot-stack still fetches a parent through a remote name whose fetch and push repositories can differ"$'\n'
fi
grep -Fq 'When the head repository is a fork, keep the local child branch rebased onto its parent' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not retain local parent ancestry for fork heads"$'\n'
grep -Fq 'create or retarget every PR against `<trunk>` in the base repository' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack tries to use a fork-only branch as a PR base"$'\n'
grep -Fq 'never infer stack order from their equal base branches' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not preserve explicit fork stack order"$'\n'
grep -Fq 'git rebase --onto "$parent_tip" "$current_base_sha" -- "$branch"' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not move only child commits when a parent tip changes"$'\n'
grep -Fq "Shipping step 4's disarm-and-confirm rule to that child and every descendant" "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR can rewrite or retarget an armed existing stack"$'\n'
grep -Fq 'If repository instructions require a draft until named evidence exists' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR ignores repository-required draft evidence gates"$'\n'
grep -Fq 'Create every fork PR' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not bind a root fork PR to its explicit head repository"$'\n'
grep -Fq 'A fork child PR targets trunk while retaining local parent ancestry' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not model fork stack PR bases"$'\n'
for fork_file in "$autopilot_stack" "$opening_a_pr" "$multi_phase_plan"; do
  grep -Fq 'gh api --method POST "repos/$base_repo/pulls"' "$fork_file" || shipping_safety_bad="${shipping_safety_bad}${fork_file} does not create fork PRs through the organization-capable GitHub API"$'\n'
  grep -Fq -- '-f "head_repo=$head_name"' "$fork_file" || shipping_safety_bad="${shipping_safety_bad}${fork_file} does not identify the validated fork repository"$'\n'
done
grep -Fq 'Rebase each unmerged stack child onto its parent' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan flattens unmerged stack children onto trunk"$'\n'
grep -Fq 'An appended stack child keeps its recorded parent tip until that parent lands' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan rebases an unmerged stack child onto trunk before delivery"$'\n'
grep -Fq 'For fork heads, take the order from the verified local parent ancestry' "$shipping" || shipping_safety_bad="${shipping_safety_bad}Shipping tries to infer a fork stack from shared trunk bases"$'\n'
grep -Fq 'only the current bottom PR through Shipping, one at a time' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack offers merge-when-ready outside the current bottom frontier"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not bind its post-rebase push to the captured SHA"$'\n'
grep -Fq "A private-stack child fetches its parent's exact tip" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full rebases a private-stack child onto trunk instead of its parent"$'\n'
grep -Fq 'Record the selected exact commit as `<target-tip>`' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not record the exact rebase target"$'\n'
grep -Fq 'git rebase --onto "$target_tip" "$current_base_sha" -- "$branch"' "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not isolate child commits when changing a private-stack parent"$'\n'
grep -Fq 'git fetch -- "$head_url" "refs/heads/$branch"' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not refresh a fork head through its push repository URL"$'\n'
grep -Fq 'resolve and validate `<head-url>` through Shipping step 1, capture it as `head_url`' "$opening_a_pr" || shipping_safety_bad="${shipping_safety_bad}Opening a PR does not resolve its head URL before a shared-worktree refresh"$'\n'
grep -Fq 'git fetch -- "$head_url" "refs/heads/$head_branch"' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not fetch a live-lane head through its push repository URL"$'\n'
grep -Fq 'Resolve and validate `<head-url>` through Shipping step 1 and capture it as `head_url` for the live-lane fetch' "$multi_phase_plan" || shipping_safety_bad="${shipping_safety_bad}Multi-phase plan does not resolve its head URL before a live-lane fetch"$'\n'
autopilot_full_rewrite_order="$(awk '/^2\. / { capture = index($0, "git ls-remote"); rebase = index($0, "git rebase --onto"); if (capture == 0 || rebase == 0 || capture >= rebase) print $0 }' "$autopilot_full")"
if [ -n "$autopilot_full_rewrite_order" ]; then
  shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not capture the published head before rebasing"$'\n'
fi
grep -Fq "Shipping step 4's disarm-and-confirm rule" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full can rewrite an armed pull request"$'\n'
grep -Fq "Shipping step 5's server-enforced expected-head flow" "$autopilot_full" || shipping_safety_bad="${shipping_safety_bad}Autopilot-full does not bind owner merges to the current landing SHA"$'\n'
grep -Fq -- '--force-with-lease="refs/heads/$branch:$captured_sha"' "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack does not bind its topology push to the captured SHA"$'\n'
grep -Fq "Shipping step 4's disarm-and-confirm rule" "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack can rewrite an armed pull request"$'\n'
grep -Fq "step 6's captured-SHA lease flow" "$autopilot_stack" || shipping_safety_bad="${shipping_safety_bad}Autopilot-stack drift handling does not reuse its guarded push flow"$'\n'
if [ -n "$shipping_safety_bad" ]; then
  note "FAIL: forge-neutral landing safety rules regressed:"
  note "$shipping_safety_bad"
  fail=1
else
  note "ok: forge-neutral landing keeps head/base, auto-merge/queue, split-remote, fork-stack, rebase-push, and watch safety rules"
fi

excluded_skill="$plugin/skills/make-bot-ui"
if [ -e "$excluded_skill" ]; then
  note "FAIL: excluded upstream skill exists: $excluded_skill"
  fail=1
else
  note "ok: excluded upstream skills stay absent"
fi

routed_model_skills=(how why unslop typescript-best-practices)
routed_model_bad=""
for name in "${routed_model_skills[@]}"; do
  routed_skill="$plugin/skills/$name/SKILL.md"
  front="$(sed -n '2,/^---$/p' "$routed_skill")"
  if printf '%s\n' "$front" | grep -q '^disable-model-invocation: true$'; then
    routed_model_bad="${routed_model_bad}${routed_skill}"$'\n'
  fi
done
if [ -n "$routed_model_bad" ]; then
  note "FAIL: skills routed by name must stay model-invocable:"
  note "$routed_model_bad"
  fail=1
else
  note "ok: routed skills stay model-invocable"
fi

sol_descriptor="$(python3 -c '
import json, pathlib, sys
roles = json.loads(pathlib.Path(sys.argv[1]).read_text())
wanted = {}
for role in roles["roles"]:
    if role["id"] in ("bug-fix", "perf-issue", "hillclimb"):
        wanted[role["id"]] = role["descriptors"][0]
if len(wanted) != 3:
    raise SystemExit("missing solo code roles")
values = set(wanted.values())
if len(values) != 1:
    raise SystemExit("solo code roles diverged: " + ",".join(sorted(values)))
print(next(iter(values)))
' "$catalog_roles")"
solo_code_bad=""
if [ -z "$sol_descriptor" ]; then
  solo_code_bad="could not read solo code roles from $catalog_roles"$'\n'
fi
case "$sol_descriptor" in
  codex:gpt-5.6-sol@*) ;;
  *) solo_code_bad="${solo_code_bad}solo code roles are not on Sol: [$sol_descriptor]"$'\n' ;;
esac
for role in bug-fix perf-issue hillclimb; do
  role_playbook="$plugin/skills/poteto-mode/playbooks/$role.md"
  if grep -Eq '(claude|codex|grok|cursor):[][a-z0-9.-]+@[a-z][a-z0-9-]*' "$role_playbook"; then
    solo_code_bad="${solo_code_bad}${role_playbook} still copies a model descriptor"$'\n'
  fi
done
if [ -n "$solo_code_bad" ]; then
  note "FAIL: solo code roles must stay on the catalog Sol offering without copied slugs:"
  note "$solo_code_bad"
  fail=1
else
  note "ok: solo code roles stay on the catalog Sol offering ($sol_descriptor)"
fi

codex_manifest="$plugin/.codex-plugin/plugin.json"
logo_path="$(sed -n 's/^[[:space:]]*"logo":[[:space:]]*"\([^"]*\)".*/\1/p' "$codex_manifest")"
logo_bad=""
case "$logo_path" in
  "") logo_bad="interface.logo is missing from $codex_manifest" ;;
  /*) logo_bad="interface.logo must be plugin-relative: $logo_path" ;;
esac
logo_rel="${logo_path#./}"
case "/$logo_rel/" in
  */../*) logo_bad="interface.logo escapes the plugin root: $logo_path" ;;
esac
if [ -z "$logo_bad" ] && { [ ! -f "$plugin/$logo_rel" ] || [ -L "$plugin/$logo_rel" ]; }; then
  logo_bad="interface.logo does not name a regular file under the plugin root: $logo_path"
fi
if [ -n "$logo_bad" ]; then
  note "FAIL: codex logo path does not resolve"
  note "$logo_bad"
  fail=1
else
  note "ok: codex logo path resolves"
fi

# The shipped catalog, role defaults, canonical format, and generated
# Claude-native agents must agree. pstack-models validate never writes.
if command -v bun >/dev/null 2>&1; then
  if validate_out="$(bun "$plugin/skills/poteto-mode/scripts/runner/pstack-models" validate 2>&1)"; then
    note "ok: pstack-models validate ($validate_out)"
  else
    note "FAIL: pstack-models validate"
    note "$validate_out"
    fail=1
  fi
else
  note "FAIL: bun is required to run pstack-models validate"
  fail=1
fi

if [ "${PSTACK_STATIC_ONLY:-0}" = "1" ]; then
  exit "$fail"
fi

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/.claude-plugin" "$scratch/skills/foo"
printf '%s\n' '{"name": "testplug", "version": "0.0.1", "description": "native skill repro"}' \
  > "$scratch/.claude-plugin/plugin.json"
cat > "$scratch/skills/foo/SKILL.md" <<'EOF'
---
name: foo
description: collision test skill
---

Say exactly: SKILL-RAN
Then stop. Do not invoke any skill or tool.
EOF

run() {
  claude -p --plugin-dir "$scratch" --model fable --effort max --max-turns 3 "$1" < /dev/null 2>&1
}

check() { # $1 label, $2 expected marker, $3 output
  if printf '%s' "$3" | grep -q "$2"; then
    note "ok: $1 -> $2"
  else
    note "FAIL: $1 expected $2, got: $3"
    fail=1
  fi
}

invoke='Call the Skill tool with skill "testplug:foo" exactly once and follow what it says.'

check "model-initiated Skill-tool invocation" "SKILL-RAN" "$(run "$invoke")"
check "user /testplug:foo invocation" "SKILL-RAN" "$(run '/testplug:foo')"

exit "$fail"
