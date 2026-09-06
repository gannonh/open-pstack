import { describe, expect, it } from "bun:test";
import { loadModelCatalog, loadRoleDefaults } from "./catalog.ts";
import { firstRunSheet, parseSheet, renderSheet, uniqueOfferingDescriptors } from "./sheet.ts";

// The Cursor sheet is `~/.cursor/rules/open-pstack-models.mdc`: the frontmatter
// setup-pstack documents, followed by the shared sheet bytes. The shared parser
// must read it back without a Cursor-specific code path.
const CURSOR_RULE_FRONTMATTER = [
  "---",
  "description: Open PStack per-role model choices (overrides skill defaults)",
  "alwaysApply: true",
  "---",
].join("\n");

const catalog = loadModelCatalog();
const roles = loadRoleDefaults(catalog);

function cursorRule(sheet: string = firstRunSheet(catalog, roles)): string {
  return `${CURSOR_RULE_FRONTMATTER}\n${sheet}`;
}

// Setup renders a rerun from the catalog preamble plus the loaded roles, then
// prefixes the Cursor frontmatter; the parsed preamble is readback evidence.
function rerenderCursorRule(parsed: ReturnType<typeof parseSheet>): string {
  return cursorRule(
    renderSheet({
      ...roles,
      roles: parsed.sheet!.roles.map((role) => ({
        id: role.id,
        kind: role.kind,
        descriptors: role.lanes.map((lane) => lane.raw),
      })),
    })
  );
}

describe("Cursor always-applied model rule", () => {
  it("parses the first-run rule and reads the frontmatter back", () => {
    const rule = cursorRule();
    const parsed = parseSheet(rule, catalog, roles);
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheet).not.toBeNull();
    expect(parsed.sheet?.preamble.slice(0, 4).join("\n")).toBe(CURSOR_RULE_FRONTMATTER);
    expect(parsed.sheet?.preamble).toContain("alwaysApply: true");
    expect(parsed.sheet?.preamble).toContain("# pstack model configuration");
    expect(rerenderCursorRule(parsed)).toBe(rule);
  });

  it("keeps a hand-edited descriptor's provider, model, and effort intact", () => {
    const edited = cursorRule().replace(
      "judgment and prose: claude:fable@max",
      "judgment and prose: cursor:claude-fable-5-1@high"
    );
    const parsed = parseSheet(edited, catalog, roles);
    expect(parsed.issues).toEqual([]);
    const lane = parsed.sheet?.roles.find((role) => role.id === "judgment and prose")?.lanes[0];
    expect(lane?.raw).toBe("cursor:claude-fable-5-1@high");
    expect(lane?.bound.provider).toBe("cursor");
    expect(lane?.bound.selector).toBe("claude-fable-5-1");
    expect(lane?.bound.effort).toBe("high");
    expect(lane?.bound.offering?.id).toBe("cursor-fable-5-1");
    expect(uniqueOfferingDescriptors(parsed.sheet!)).toContain("cursor:claude-fable-5-1@high");
  });

  it("rejects an invalid descriptor so setup has nothing to write", () => {
    const unsupportedEffort = cursorRule().replace(
      "feature, refactoring: cursor:cursor-grok-4.6@xhigh",
      "feature, refactoring: cursor:cursor-grok-4.6@max"
    );
    const parsed = parseSheet(unsupportedEffort, catalog, roles);
    expect(parsed.sheet).toBeNull();
    expect(parsed.issues.map((issue) => issue.roleId)).toContain("feature, refactoring");

    const bareSlug = cursorRule().replace(
      "swarm workers: cursor:cursor-grok-4.6@xhigh",
      "swarm workers: cursor-grok-4.6-xhigh"
    );
    expect(parseSheet(bareSlug, catalog, roles).sheet).toBeNull();
  });

  it("preserves an edited rule, including panel order, across an unchanged rerun", () => {
    const first = cursorRule()
      .replace(
        "hardest tasks: claude:fable@max",
        "hardest tasks: cursor:claude-fable-5-1@max"
      )
      .replace(
        "arena runners: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh",
        "arena runners: cursor:cursor-grok-4.6@xhigh, codex:gpt-5.6-sol@high, claude:opus@xhigh, claude:fable@max"
      );
    const parsed = parseSheet(first, catalog, roles);
    expect(parsed.issues).toEqual([]);
    const rerun = rerenderCursorRule(parsed);
    expect(rerun).toBe(first);
    expect(parseSheet(rerun, catalog, roles).issues).toEqual([]);
  });
});
