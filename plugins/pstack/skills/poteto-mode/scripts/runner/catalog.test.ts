import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MODELS_CATALOG_PATH,
  PLUGIN_ROOT,
  bindDescriptor,
  catalogEffortVocabulary,
  catalogToJson,
  composedCliModel,
  findOffering,
  formatCatalogJson,
  formatDescriptor,
  loadModelCatalog,
  loadRoleDefaults,
  migrateDescriptorText,
  nativeAgentsFor,
  offeringLabel,
  parseModelCatalog,
  parseRoleDefaults,
  proposeNativeAgentStem,
  renderNativeAgent,
  requireCatalogedLane,
  setupOfferingChoices,
} from "./catalog.ts";
import {
  firstRunSheet,
  parseLaneEdit,
  parseSheet,
  replacePanelLane,
  replaceRoleLanes,
  renderSheet,
  uniqueOfferingDescriptors,
} from "./sheet.ts";
import { UsageError } from "./types.ts";

const FIVE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const SETUP_PATH = join(PLUGIN_ROOT, "skills/setup-pstack/SKILL.md");
const DISPATCH_PATH = join(
  PLUGIN_ROOT,
  "skills/poteto-mode/references/provider-dispatch.md"
);
const WORKFLOW_SLUG_PATHS = [
  "skills/arena/SKILL.md",
  "skills/architect/SKILL.md",
  "skills/how/SKILL.md",
  "skills/interrogate/SKILL.md",
  "skills/swarm/SKILL.md",
  "skills/setup-pstack/SKILL.md",
  "skills/poteto-mode/SKILL.md",
  "skills/poteto-mode/references/codex-tools.md",
  "skills/poteto-mode/playbooks/feature.md",
  "skills/poteto-mode/playbooks/bug-fix.md",
  "skills/poteto-mode/playbooks/perf-issue.md",
  "skills/poteto-mode/playbooks/hillclimb.md",
  "skills/poteto-mode/playbooks/refactoring.md",
] as const;
const DESCRIPTOR_RE =
  /(claude|codex|grok|cursor):[a-z0-9.\[\]-]+@[a-z][a-z0-9-]*/g;

function cloneCatalog(): {
  schemaVersion: number;
  offerings: Array<Record<string, unknown>>;
  legacyMigrations: Array<Record<string, unknown>>;
} {
  return JSON.parse(JSON.stringify(loadModelCatalog())) as {
    schemaVersion: number;
    offerings: Array<Record<string, unknown>>;
    legacyMigrations: Array<Record<string, unknown>>;
  };
}

describe("model catalog", () => {
  const catalog = loadModelCatalog();
  const roles = loadRoleDefaults(catalog);

  it("accepts the checked-in catalog and default role map", () => {
    expect(catalog.schemaVersion).toBe(1);
    expect(roles.schemaVersion).toBe(1);
    expect(catalog.offerings.map((row) => row.id)).toEqual([
      "claude-fable",
      "cursor-fable-5-1",
      "codex-gpt-5-6-sol",
      "cursor-grok-4-6",
      "grok-grok-4-6",
      "claude-opus",
      "codex-gpt-6-astra",
      "claude-claude-fable-5-1-1m",
    ]);
    expect(
      catalog.offerings.map((row) => `${row.provider}:${row.selector}`)
    ).toEqual([
      "claude:fable",
      "cursor:claude-fable-5-1",
      "codex:gpt-5.6-sol",
      "cursor:cursor-grok-4.6",
      "grok:grok-4.6",
      "claude:opus",
      "codex:gpt-6-astra",
      "claude:claude-fable-5-1[1m]",
    ]);
  });

  it("catalogs GPT-6 Astra with ultra and the explicit Fable 5.1 [1m] pin without touching role defaults", () => {
    const astra = findOffering(catalog, "codex", "gpt-6-astra");
    expect(astra?.displayName).toBe("GPT-6 Astra");
    expect(astra?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(astra?.defaultEffort).toBe("medium");
    expect(bindDescriptor(catalog, "codex:gpt-6-astra@ultra").offering?.id).toBe("codex-gpt-6-astra");
    expect(() => bindDescriptor(catalog, "codex:gpt-5.6-sol@ultra")).toThrow("unsupported effort ultra");

    const pin = findOffering(catalog, "claude", "claude-fable-5-1[1m]");
    expect(pin?.displayName).toBe("Fable 5.1");
    expect(pin?.rollingAlias).toBe(false);
    expect(pin?.nativeAgentStem).toBe("fable-5-1-1m");
    expect(offeringLabel(pin!)).toBe("Fable 5.1");
    expect(bindDescriptor(catalog, "claude:claude-fable-5-1[1m]@max").selector).toBe(
      "claude-fable-5-1[1m]"
    );

    const defaultDescriptors = new Set(roles.roles.flatMap((role) => role.descriptors));
    expect([...defaultDescriptors].sort()).toEqual([
      "claude:fable@max",
      "claude:opus@xhigh",
      "codex:gpt-5.6-sol@max",
      "cursor:cursor-grok-4.6@xhigh",
      "inherit-parent",
    ]);
  });

  it("preserves currently supported descriptors and adds Cursor Fable 5.1", () => {
    expect(
      formatDescriptor(
        "claude",
        "fable",
        findOffering(catalog, "claude", "fable")?.defaultEffort ?? "low"
      )
    ).toBe("claude:fable@max");
    expect(
      formatDescriptor(
        "claude",
        "opus",
        findOffering(catalog, "claude", "opus")?.defaultEffort ?? "low"
      )
    ).toBe("claude:opus@xhigh");
    expect(
      formatDescriptor(
        "codex",
        "gpt-5.6-sol",
        findOffering(catalog, "codex", "gpt-5.6-sol")?.defaultEffort ?? "low"
      )
    ).toBe("codex:gpt-5.6-sol@max");
    expect(
      formatDescriptor(
        "cursor",
        "cursor-grok-4.6",
        findOffering(catalog, "cursor", "cursor-grok-4.6")?.defaultEffort ?? "low"
      )
    ).toBe("cursor:cursor-grok-4.6@xhigh");
    const cursorFable = findOffering(catalog, "cursor", "claude-fable-5-1");
    expect(cursorFable).not.toBeNull();
    expect(cursorFable?.displayName).toBe("Fable 5.1");
    expect(cursorFable?.selector).toBe("claude-fable-5-1");
    expect(cursorFable?.supportedEfforts).toEqual(FIVE_EFFORTS);
    const claudeFable = findOffering(catalog, "claude", "fable");
    expect(claudeFable?.displayName).toBe("Fable");
    expect(claudeFable?.selector).toBe("fable");
    expect(claudeFable?.displayName).not.toBe(claudeFable?.selector);
  });

  it("labels rolling aliases as rolling and rejects a revision in their label", () => {
    const fable = findOffering(catalog, "claude", "fable");
    const opus = findOffering(catalog, "claude", "opus");
    expect(offeringLabel(fable!)).toBe("Fable (rolling alias)");
    expect(offeringLabel(opus!)).toBe("Opus (rolling alias)");
    expect(offeringLabel(findOffering(catalog, "cursor", "claude-fable-5-1")!)).toBe(
      "Fable 5.1"
    );
    const revisionLabel = cloneCatalog();
    revisionLabel.offerings[0] = { ...revisionLabel.offerings[0], displayName: "Fable 5.1" };
    expect(() => parseModelCatalog(revisionLabel)).toThrow(
      "must not name a revision for a rolling alias"
    );
  });

  it("defines efforts per offering, preserves their order, and rejects unsafe tokens", () => {
    const extra = cloneCatalog();
    extra.offerings.push({
      ...extra.offerings[2],
      id: "codex-gpt-7-test",
      selector: "gpt-7-test",
      displayName: "GPT-7 Test",
      family: "test",
      supportedEfforts: ["minimal", "low", "turbo"],
      defaultEffort: "turbo",
    });
    const parsed = parseModelCatalog(extra);
    const offering = findOffering(parsed, "codex", "gpt-7-test");
    expect(offering?.supportedEfforts).toEqual(["minimal", "low", "turbo"]);
    expect(bindDescriptor(parsed, "codex:gpt-7-test@turbo").effort).toBe("turbo");
    expect(bindDescriptor(parsed, "codex:gpt-7-test@minimal").offering?.id).toBe(
      "codex-gpt-7-test"
    );
    expect(() => bindDescriptor(parsed, "codex:gpt-5.6-sol@turbo")).toThrow(
      "unsupported effort turbo"
    );
    expect(catalogEffortVocabulary(parsed).has("turbo")).toBe(true);
    expect(catalogEffortVocabulary(catalog).has("turbo")).toBe(false);
    expect(catalogEffortVocabulary(catalog).has("ultra")).toBe(true);

    const reordered = cloneCatalog();
    reordered.offerings[2] = {
      ...reordered.offerings[2],
      supportedEfforts: ["max", "low"],
      defaultEffort: "max",
    };
    expect(parseModelCatalog(reordered).offerings[2]?.supportedEfforts).toEqual(["max", "low"]);

    const unsafe = cloneCatalog();
    unsafe.offerings[2] = { ...unsafe.offerings[2], supportedEfforts: ["low", "Max!"] };
    expect(() => parseModelCatalog(unsafe)).toThrow("not a safe effort identifier");
    const emptyToken = cloneCatalog();
    emptyToken.offerings[2] = { ...emptyToken.offerings[2], supportedEfforts: ["low", ""] };
    expect(() => parseModelCatalog(emptyToken)).toThrow("non-empty string");
    const duplicate = cloneCatalog();
    duplicate.offerings[2] = { ...duplicate.offerings[2], supportedEfforts: ["low", "low"] };
    expect(() => parseModelCatalog(duplicate)).toThrow("contains duplicates");
    const unlistedDefault = cloneCatalog();
    unlistedDefault.offerings[2] = { ...unlistedDefault.offerings[2], defaultEffort: "ultra" };
    expect(() => parseModelCatalog(unlistedDefault)).toThrow("defaultEffort is not selectable");
    expect(() => bindDescriptor(catalog, "codex:gpt-5.6-sol@Max")).toThrow("invalid descriptor");
  });

  it("carries a Claude contextual selector unchanged through parsing, sheet, argv, and agents", () => {
    expect(proposeNativeAgentStem("claude-fable-5-1[1m]")).toBe("fable-5-1-1m");
    expect(proposeNativeAgentStem("claude-opus-5[1m]")).toBe("opus-5-1m");
    expect(proposeNativeAgentStem("fable")).toBe("fable");
    const offering = findOffering(catalog, "claude", "claude-fable-5-1[1m]");
    expect(offering?.nativeAgentStem).toBe("fable-5-1-1m");
    const bound = bindDescriptor(catalog, "claude:claude-fable-5-1[1m]@max");
    expect(bound.selector).toBe("claude-fable-5-1[1m]");
    expect(bound.offering?.id).toBe("claude-claude-fable-5-1-1m");
    expect(migrateDescriptorText(catalog, "claude:claude-fable-5-1[1m]@max")).toEqual({
      descriptor: "claude:claude-fable-5-1[1m]@max",
      migratedFrom: null,
    });
    expect(composedCliModel(offering!, "max")).toBe("claude-fable-5-1[1m]");
    const agent = renderNativeAgent(offering!, "max");
    expect(agent).toContain("name: pstack-fable-5-1-1m-max");
    expect(agent).toContain("model: claude-fable-5-1[1m]");
    expect(agent).toContain("claude:claude-fable-5-1[1m]@max");

    const edited = renderSheet({
      ...roles,
      roles: replaceRoleLanes(
        roles.roles,
        "judgment and prose",
        ["claude:claude-fable-5-1[1m]@high"],
        catalog
      ),
    });
    expect(edited).toContain("judgment and prose: claude:claude-fable-5-1[1m]@high");
    const reparsed = parseSheet(edited, catalog, roles);
    expect(reparsed.issues).toEqual([]);
    expect(
      reparsed.sheet?.roles.find((role) => role.id === "judgment and prose")?.lanes[0]?.raw
    ).toBe("claude:claude-fable-5-1[1m]@high");
    expect(uniqueOfferingDescriptors(reparsed.sheet!)).toContain(
      "claude:claude-fable-5-1[1m]@high"
    );
    expect(() => bindDescriptor(catalog, "claude:claude-fable-5-1[1m][2m]@high")).toThrow(
      "invalid descriptor"
    );
    expect(() => bindDescriptor(catalog, "claude:claude-fable-5-2[1m]@high")).toThrow(
      "not a cataloged offering"
    );
  });

  it("keeps the checked-in catalog in canonical format", () => {
    const text = readFileSync(MODELS_CATALOG_PATH, "utf8");
    expect(formatCatalogJson(catalogToJson(parseModelCatalog(JSON.parse(text))))).toBe(text);
  });

  it("rejects duplicate ids and provider selectors", () => {
    const duplicateId = cloneCatalog();
    duplicateId.offerings.push({ ...duplicateId.offerings[0], selector: "other" });
    expect(() => parseModelCatalog(duplicateId)).toThrow("duplicate offering id");
    const duplicateSelector = cloneCatalog();
    duplicateSelector.offerings.push({
      ...duplicateSelector.offerings[0],
      id: "other-id",
    });
    expect(() => parseModelCatalog(duplicateSelector)).toThrow(
      "duplicate provider selector"
    );
  });

  it("rejects unsupported efforts and unknown providers", () => {
    expect(() => bindDescriptor(catalog, "cursor:cursor-grok-4.6@max")).toThrow(
      "unsupported effort max"
    );
    expect(() => bindDescriptor(catalog, "claude:fable@nope")).toThrow(
      "unsupported effort nope"
    );
    const badProvider = cloneCatalog();
    badProvider.offerings[0] = {
      ...badProvider.offerings[0],
      provider: "anthropic",
    };
    expect(() => parseModelCatalog(badProvider)).toThrow(
      "not a predefined provider"
    );
    const rollingOnCursor = cloneCatalog();
    rollingOnCursor.offerings[0] = {
      ...rollingOnCursor.offerings[0],
      provider: "cursor",
      nativeAgentStem: null,
      nativeAgentTitle: null,
      rollingAlias: true,
    };
    expect(() => parseModelCatalog(rollingOnCursor)).toThrow(
      "rollingAlias requires provider claude"
    );
  });

  it("composes provider-specific CLI selectors from catalog data", () => {
    const claude = findOffering(catalog, "claude", "fable");
    const cursorFable = findOffering(catalog, "cursor", "claude-fable-5-1");
    const cursorGrok = findOffering(catalog, "cursor", "cursor-grok-4.6");
    expect(claude).not.toBeNull();
    expect(cursorFable).not.toBeNull();
    expect(cursorGrok).not.toBeNull();
    expect(composedCliModel(claude!, "max")).toBe("fable");
    expect(composedCliModel(cursorFable!, "max")).toBe("claude-fable-5-1-max");
    expect(composedCliModel(cursorGrok!, "xhigh")).toBe("cursor-grok-4.6-xhigh");
    expect(() =>
      requireCatalogedLane(catalog, "cursor", "missing-model", "xhigh")
    ).toThrow(UsageError);
  });

  it("migrates uncataloged predecessor pins and preserves cataloged explicit versions", () => {
    expect(migrateDescriptorText(catalog, "claude:claude-fable-5@max")).toEqual({
      descriptor: "claude:fable@max",
      migratedFrom: "claude:claude-fable-5@max",
    });
    expect(migrateDescriptorText(catalog, "claude:claude-opus-4-6@xhigh")).toEqual({
      descriptor: "claude:opus@xhigh",
      migratedFrom: "claude:claude-opus-4-6@xhigh",
    });
    expect(migrateDescriptorText(catalog, "claude:fable@max")).toEqual({
      descriptor: "claude:fable@max",
      migratedFrom: null,
    });
    expect(migrateDescriptorText(catalog, "cursor:claude-fable-5-1@high")).toEqual({
      descriptor: "cursor:claude-fable-5-1@high",
      migratedFrom: null,
    });
    const withExplicitClaude = cloneCatalog();
    const fable = withExplicitClaude.offerings[0];
    withExplicitClaude.offerings.push({
      ...fable,
      id: "claude-fable-5-1-explicit",
      displayName: "Fable 5.1",
      selector: "claude-fable-5-1",
      rollingAlias: false,
      nativeAgentStem: "claude-fable-5-1",
      nativeAgentTitle: "pstack Fable 5.1 lane",
    });
    const parsed = parseModelCatalog(withExplicitClaude);
    expect(migrateDescriptorText(parsed, "claude:claude-fable-5-1@max")).toEqual({
      descriptor: "claude:claude-fable-5-1@max",
      migratedFrom: null,
    });
  });

  it("preserves a 1.3.1 sheet including mixed per-role efforts", () => {
    const sheetText = `${roles.preamble.join("\n")}

feature, refactoring: cursor:cursor-grok-4.6@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@high
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:fable@high
hardest tasks: claude:fable@max
how explorer: cursor:cursor-grok-4.6@xhigh
how explainer: claude:fable@max
how critics: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: auto
arena runners: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh
arena cross-judge pool: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh
swarm workers: cursor:cursor-grok-4.6@xhigh
architect runners: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh
interrogate reviewers: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh
`;
    const parsed = parseSheet(sheetText, catalog, roles);
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheet).not.toBeNull();
    const judgment = parsed.sheet?.roles.find((role) => role.id === "judgment and prose");
    const hardest = parsed.sheet?.roles.find((role) => role.id === "hardest tasks");
    expect(judgment?.lanes[0]?.raw).toBe("claude:fable@high");
    expect(hardest?.lanes[0]?.raw).toBe("claude:fable@max");
    expect(parsed.sheet?.roles.find((role) => role.id === "perf-issue")?.lanes[0]?.raw).toBe(
      "codex:gpt-5.6-sol@high"
    );
    expect(
      parsed.sheet?.roles.find((role) => role.id === "reflect tooling, judgment, divergent, synthesizer")
        ?.lanes[0]?.raw
    ).toBe("auto");
  });

  it("accepts a direct catalog edit and keeps descriptors verbatim", () => {
    const base = firstRunSheet(catalog, roles);
    const edited = base.replace(
      "judgment and prose: claude:fable@max",
      "judgment and prose: cursor:claude-fable-5-1@high"
    );
    const parsed = parseSheet(edited, catalog, roles);
    expect(parsed.issues).toEqual([]);
    const role = parsed.sheet?.roles.find((entry) => entry.id === "judgment and prose");
    expect(role?.lanes[0]?.raw).toBe("cursor:claude-fable-5-1@high");
    expect(role?.lanes[0]?.bound.offering?.id).toBe("cursor-fable-5-1");
    expect(uniqueOfferingDescriptors(parsed.sheet!)).toContain(
      "cursor:claude-fable-5-1@high"
    );
  });

  it("migrates a 1.3.1 predecessor sheet without losing roles, order, or effort", () => {
    const stale = firstRunSheet(catalog, roles)
      .replaceAll("claude:fable@max", "claude:claude-fable-5@max")
      .replaceAll("claude:opus@xhigh", "claude:claude-opus-4-6@xhigh");
    const parsed = parseSheet(stale, catalog, roles);
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheet?.migrations.length).toBeGreaterThan(0);
    const arena = parsed.sheet?.roles.find((role) => role.id === "arena runners");
    expect(arena?.lanes.map((lane) => lane.raw)).toEqual([
      "claude:fable@max",
      "codex:gpt-5.6-sol@max",
      "cursor:cursor-grok-4.6@xhigh",
      "claude:opus@xhigh",
    ]);
  });

  it("can change a named panel lane without rewriting the others", () => {
    const changed = replacePanelLane(
      [...roles.roles],
      "how critics",
      0,
      "cursor:claude-fable-5-1@max",
      catalog
    );
    const critics = changed.find((role) => role.id === "how critics");
    expect(critics?.descriptors[0]).toBe("cursor:claude-fable-5-1@max");
    expect(critics?.descriptors.slice(1)).toEqual([
      "codex:gpt-5.6-sol@max",
      "cursor:cursor-grok-4.6@xhigh",
      "claude:opus@xhigh",
    ]);
    expect(parseLaneEdit("how critics[3]")).toEqual({
      roleId: "how critics",
      laneIndex: 2,
    });
    expect(
      replaceRoleLanes(
        [...roles.roles],
        "judgment and prose",
        ["cursor:claude-fable-5-1@medium"],
        catalog
      ).find((role) => role.id === "judgment and prose")?.descriptors
    ).toEqual(["cursor:claude-fable-5-1@medium"]);
  });

  it("enumerates setup choices from catalog data without a fixed family count", () => {
    const choices = setupOfferingChoices(catalog);
    expect(choices).toHaveLength(catalog.offerings.length);
    expect(choices.map((choice) => choice.id).sort()).toEqual(
      catalog.offerings.map((row) => row.id).sort()
    );
    const extra = cloneCatalog();
    extra.offerings.push({
      ...extra.offerings[2],
      id: "codex-gpt-extra",
      selector: "gpt-extra",
      displayName: "GPT Extra",
    });
    const parsed = parseModelCatalog(extra);
    expect(setupOfferingChoices(parsed).map((choice) => choice.id)).toContain(
      "codex-gpt-extra"
    );
  });

  it("rejects an invalid hand-edited descriptor without producing a sheet", () => {
    const edited = firstRunSheet(catalog, roles).replace(
      "bug-fix: codex:gpt-5.6-sol@max",
      "bug-fix: claude:not-a-model@max"
    );
    const parsed = parseSheet(edited, catalog, roles);
    expect(parsed.sheet).toBeNull();
    expect(parsed.issues.some((issue) => issue.message.includes("not a cataloged offering"))).toBe(
      true
    );
  });

  it("keeps role-default descriptors bound to catalog offerings", () => {
    expect(() => parseRoleDefaults(roles, catalog)).not.toThrow();
    const broken = JSON.parse(JSON.stringify(roles)) as {
      schemaVersion: number;
      preamble: string[];
      roles: Array<{ id: string; kind: string; descriptors: string[] }>;
    };
    broken.roles[0] = {
      ...broken.roles[0],
      descriptors: ["claude:missing@max"],
    };
    expect(() => parseRoleDefaults(broken, catalog)).toThrow("not a cataloged offering");
  });
});

describe("catalog-driven native agents and skill invariants", () => {
  const catalog = loadModelCatalog();
  const roles = loadRoleDefaults(catalog);
  const setup = readFileSync(SETUP_PATH, "utf8");
  const dispatch = readFileSync(DISPATCH_PATH, "utf8");

  it("ships generated Claude-native agents for every cataloged Claude offering", () => {
    const expected = nativeAgentsFor(catalog);
    const shipped = readdirSync(AGENTS_DIR)
      .filter((name) => name.startsWith("pstack-") && name.endsWith(".md"))
      .sort();
    expect(shipped).toEqual(expected.map((agent) => agent.filename).sort());
    for (const agent of expected) {
      expect(readFileSync(join(AGENTS_DIR, agent.filename), "utf8")).toBe(agent.contents);
    }
  });

  it("makes setup catalog-driven instead of four hard-coded family questions", () => {
    expect(setup).toContain("catalog/models.json");
    expect(setup).toContain("catalog/role-defaults.json");
    expect(setup).toContain("Which named roles or panel lanes do you want to change?");
    expect(setup).toContain("how critics[3]");
    expect(setup).not.toContain("Ask exactly four effort questions");
    expect(setup).not.toContain("one requested effort per family");
    expect(setup).not.toContain("Probe only the four selected");
    expect(setup).not.toContain("Run one probe per family");
    expect(setup).not.toMatch(/```markdown\n# pstack model configuration/);
  });

  it("points dispatch at the catalog instead of a closed four-row matrix", () => {
    expect(dispatch).toContain("catalog/models.json");
    expect(dispatch).toContain("catalog/role-defaults.json");
    expect(dispatch).not.toContain("## Model matrix");
    expect(dispatch).toContain("Do not rewrite a valid cataloged descriptor into another model");
    expect(dispatch).toContain("nativeAgentStem");
  });

  it("keeps workflow skills from copying model defaults", () => {
    for (const relative of WORKFLOW_SLUG_PATHS) {
      const text = readFileSync(join(PLUGIN_ROOT, relative), "utf8");
      const hits = text.match(DESCRIPTOR_RE) ?? [];
      expect({ relative, hits }).toEqual({ relative, hits: [] });
    }
  });

  it("renders first-run defaults from the role map", () => {
    const sheet = firstRunSheet(catalog, roles);
    expect(sheet).toContain("feature, refactoring: cursor:cursor-grok-4.6@xhigh");
    expect(sheet).toContain(
      "arena runners: claude:fable@max, codex:gpt-5.6-sol@max, cursor:cursor-grok-4.6@xhigh, claude:opus@xhigh"
    );
    expect(sheet).toContain("why investigators, synthesizer: inherit-parent");
  });
});
