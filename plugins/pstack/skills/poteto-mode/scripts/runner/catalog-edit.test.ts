import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  loadModelCatalog,
  loadRoleDefaults,
  nativeAgentsFor,
} from "./catalog.ts";
import { supportedDescriptor, type InventoryEntry, type InventorySource } from "./inventory.ts";
import {
  adapterProposal,
  agentsDirectory,
  applyProposal,
  catalogFilePath,
  completeOffering,
  proposeAdd,
  proposeEdit,
  proposeFromInventory,
  proposeRemove,
  readCatalogFile,
  roleDefaultsFilePath,
  unifiedDiff,
  validateTree,
  type CatalogFs,
  type OfferingInput,
} from "./catalog-edit.ts";

const ASTRA_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
const FIVE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

let scratches: string[] = [];

afterEach(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
  scratches = [];
});

function copyPluginTree(): string {
  const root = mkdtempSync(join(tmpdir(), "pstack-catalog-edit-"));
  scratches.push(root);
  mkdirSync(join(root, "catalog"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(root, "catalog", "models.json"),
    readFileSync(catalogFilePath(PLUGIN_ROOT))
  );
  writeFileSync(
    join(root, "catalog", "role-defaults.json"),
    readFileSync(roleDefaultsFilePath(PLUGIN_ROOT))
  );
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"))
  );
  for (const name of readdirSync(agentsDirectory(PLUGIN_ROOT))) {
    writeFileSync(join(root, "agents", name), readFileSync(join(PLUGIN_ROOT, "agents", name)));
  }
  return root;
}

function astraEntry(): InventoryEntry {
  return {
    provider: "codex",
    providerId: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    description: null,
    supportedEfforts: [...ASTRA_EFFORTS],
    defaultEffort: "medium",
    hidden: false,
    isDefault: false,
    variants: [],
    resolution: null,
    descriptor: supportedDescriptor("codex", "gpt-6-astra", "effort-flag"),
    membership: null,
  };
}

function astraSource(): InventorySource {
  return {
    method: "codex app-server model/list",
    argv: ["codex", "app-server"],
    at: "2026-09-05T12:00:00.000Z",
  };
}

function completeAstra(): OfferingInput {
  const catalog = loadModelCatalog();
  const { proposal } = proposeFromInventory(astraEntry(), catalog, astraSource());
  const completed = completeOffering({ ...proposal, family: "astra" });
  if (!("offering" in completed)) throw new Error(completed.missing.join(", "));
  return completed.offering;
}

function completeFable1m(): OfferingInput {
  const completed = completeOffering({
    ...adapterProposal("claude", "claude-fable-5-1[1m]"),
    displayName: "Fable 5.1",
    family: "fable",
    supportedEfforts: [...FIVE_EFFORTS],
    defaultEffort: "max",
  });
  if (!("offering" in completed)) throw new Error(completed.missing.join(", "));
  return completed.offering;
}

describe("proposeFromInventory", () => {
  it("builds a GPT-6 Astra offering that accepts ultra and records the source", () => {
    const catalog = loadModelCatalog();
    const { proposal, missing } = proposeFromInventory(
      astraEntry(),
      catalog,
      astraSource()
    );
    expect(missing).toEqual(["family"]);
    expect(proposal.id).toBe("codex-gpt-6-astra");
    expect(proposal.selector).toBe("gpt-6-astra");
    expect(proposal.selectorComposition).toBe("effort-flag");
    expect(proposal.supportedEfforts).toEqual([...ASTRA_EFFORTS]);
    expect(proposal.defaultEffort).toBe("medium");
    expect(proposal.displayName).toBe("GPT-6 Astra");
    expect(proposal.nativeAgentStem).toBeNull();
    expect(proposal.notes).toBe(
      "Discovered via codex app-server model/list on 2026-09-05T12:00:00.000Z."
    );
    const completed = completeOffering({ ...proposal, family: "astra" });
    expect("offering" in completed).toBe(true);
    if (!("offering" in completed)) return;
    expect(completed.offering.supportedEfforts).toContain("ultra");
    const added = proposeAdd(catalog, completed.offering);
    expect(added.kind).toBe("change");
    if (added.kind !== "change") return;
    const astra = added.catalog.offerings.find((row) => row.id === "codex-gpt-6-astra");
    expect(astra?.supportedEfforts).toEqual([...ASTRA_EFFORTS]);
    expect(astra?.defaultEffort).toBe("medium");
  });
});

describe("proposeAdd", () => {
  it("adds claude-fable-5-1[1m] with stem fable-5-1-1m and five native agents", () => {
    const offering = completeFable1m();
    expect(offering.nativeAgentStem).toBe("fable-5-1-1m");
    expect(offering.nativeAgentTitle).toBe("pstack Fable 5.1 lane");
    const proposal = proposeAdd(loadModelCatalog(), offering);
    expect(proposal.kind).toBe("change");
    if (proposal.kind !== "change") return;
    const added = [...proposal.agents.keys()].filter((name) =>
      name.startsWith("pstack-fable-5-1-1m-")
    );
    expect(added.sort()).toEqual(
      FIVE_EFFORTS.map((effort) => `pstack-fable-5-1-1m-${effort}.md`).sort()
    );
    for (const name of added) {
      expect(proposal.agents.get(name)).toContain("model: claude-fable-5-1[1m]");
    }
    expect(proposal.diff).toContain("added pstack-fable-5-1-1m-max.md");
  });

  it("treats an identical re-add as a no-op", () => {
    const catalog = loadModelCatalog();
    const existing = catalog.offerings[0];
    if (existing === undefined) throw new Error("empty catalog");
    const proposal = proposeAdd(catalog, { ...existing });
    expect(proposal.kind).toBe("no-op");
  });

  it("rejects a conflicting duplicate with edit guidance", () => {
    const catalog = loadModelCatalog();
    const existing = catalog.offerings[0];
    if (existing === undefined) throw new Error("empty catalog");
    const proposal = proposeAdd(catalog, { ...existing, displayName: "Other Fable" });
    expect(proposal.kind).toBe("rejected");
    if (proposal.kind !== "rejected") return;
    expect(proposal.message).toContain("already cataloged as claude-fable with different fields");
    expect(proposal.message).toContain("pstack-models edit claude-fable");
  });

  it("rejects an id collision", () => {
    const offering = completeAstra();
    const proposal = proposeAdd(loadModelCatalog(), { ...offering, id: "claude-fable" });
    expect(proposal.kind).toBe("rejected");
    if (proposal.kind !== "rejected") return;
    expect(proposal.message).toContain("id already cataloged: claude-fable");
  });
});

describe("proposeEdit", () => {
  it("changes efforts and default", () => {
    const proposal = proposeEdit(loadModelCatalog(), "codex-gpt-5-6-sol", {
      supportedEfforts: [...ASTRA_EFFORTS],
      defaultEffort: "ultra",
    });
    expect(proposal.kind).toBe("change");
    if (proposal.kind !== "change") return;
    const edited = proposal.catalog.offerings.find((row) => row.id === "codex-gpt-5-6-sol");
    expect(edited?.supportedEfforts).toEqual([...ASTRA_EFFORTS]);
    expect(edited?.defaultEffort).toBe("ultra");
  });

  it("rejects an edit that makes the default unlisted", () => {
    const proposal = proposeEdit(loadModelCatalog(), "codex-gpt-5-6-sol", {
      defaultEffort: "ultra",
    });
    expect(proposal.kind).toBe("rejected");
    if (proposal.kind !== "rejected") return;
    expect(proposal.message).toContain("defaultEffort is not selectable");
  });
});

describe("proposeRemove", () => {
  it("rejects claude-fable and lists role rows including how critics[1]", () => {
    const catalog = loadModelCatalog();
    const proposal = proposeRemove(catalog, "claude-fable", loadRoleDefaults(catalog));
    expect(proposal.kind).toBe("rejected");
    if (proposal.kind !== "rejected") return;
    expect(proposal.message).toContain("how critics[1] claude:fable@max");
    expect(proposal.message).toContain("judgment and prose[1] claude:fable@max");
    expect(proposal.message).toContain("legacyMigrations");
  });

  it("removes an unreferenced offering and deletes its agent files", () => {
    const root = copyPluginTree();
    const catalogPath = catalogFilePath(root);
    const agentsDir = agentsDirectory(root);
    const offering = completeFable1m();
    const added = proposeAdd(readCatalogFile(catalogPath).catalog, offering, root);
    expect(added.kind).toBe("change");
    if (added.kind !== "change") return;
    const written = applyProposal(added, { catalogPath, agentsDir });
    expect(written.ok).toBe(true);
    for (const effort of FIVE_EFFORTS) {
      expect(existsSync(join(agentsDir, `pstack-fable-5-1-1m-${effort}.md`))).toBe(true);
    }
    const afterAdd = readCatalogFile(catalogPath);
    const removed = proposeRemove(
      afterAdd.catalog,
      offering.id,
      loadRoleDefaults(afterAdd.catalog, roleDefaultsFilePath(root)),
      root
    );
    expect(removed.kind).toBe("change");
    if (removed.kind !== "change") return;
    expect(removed.diff).toContain("removed pstack-fable-5-1-1m-max.md");
    const applied = applyProposal(removed, { catalogPath, agentsDir });
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.deleted.length).toBe(5);
    for (const effort of FIVE_EFFORTS) {
      expect(existsSync(join(agentsDir, `pstack-fable-5-1-1m-${effort}.md`))).toBe(false);
    }
  });
});

describe("applyProposal rollback", () => {
  it("restores every original byte and removes files that did not exist", () => {
    const root = copyPluginTree();
    const catalogPath = catalogFilePath(root);
    const agentsDir = agentsDirectory(root);
    const originalCatalog = readFileSync(catalogPath);
    const originalAgents = new Map(
      readdirSync(agentsDir).map((name) => [name, readFileSync(join(agentsDir, name))] as const)
    );
    const offering = completeFable1m();
    const proposal = proposeAdd(readCatalogFile(catalogPath).catalog, offering, root);
    expect(proposal.kind).toBe("change");
    if (proposal.kind !== "change") return;
    let corrupted = false;
    const fs: CatalogFs = {
      readFileSync: (path) => readFileSync(path),
      writeFileSync: (path, data) => {
        if (path === catalogPath && !corrupted) {
          corrupted = true;
          writeFileSync(path, "CORRUPT\n");
        } else {
          writeFileSync(path, data);
        }
      },
      unlinkSync,
      existsSync,
      mkdirSync: (path, options) => {
        mkdirSync(path, options);
      },
    };
    const result = applyProposal(proposal, { catalogPath, agentsDir }, fs);
    expect(result.ok).toBe(false);
    expect(readFileSync(catalogPath).equals(originalCatalog)).toBe(true);
    for (const [name, bytes] of originalAgents) {
      expect(readFileSync(join(agentsDir, name)).equals(bytes)).toBe(true);
    }
    for (const effort of FIVE_EFFORTS) {
      expect(existsSync(join(agentsDir, `pstack-fable-5-1-1m-${effort}.md`))).toBe(false);
    }
  });
});

describe("validateTree", () => {
  it("passes on the real plugin tree", () => {
    expect(validateTree(PLUGIN_ROOT)).toEqual({ ok: true, problems: [] });
  });

  it("reports extra, changed, missing, and non-canonical files", () => {
    const root = copyPluginTree();
    writeFileSync(join(agentsDirectory(root), "pstack-extra.md"), "extra\n");
    const extra = validateTree(root);
    expect(extra.ok).toBe(false);
    expect(extra.problems.some((problem) => problem.includes("extra agent file: pstack-extra.md"))).toBe(
      true
    );

    const rootChanged = copyPluginTree();
    writeFileSync(join(agentsDirectory(rootChanged), "pstack-fable-max.md"), "changed\n");
    const changed = validateTree(rootChanged);
    expect(changed.ok).toBe(false);
    expect(
      changed.problems.some((problem) => problem.includes("changed agent file: pstack-fable-max.md"))
    ).toBe(true);

    const rootMissing = copyPluginTree();
    unlinkSync(join(agentsDirectory(rootMissing), "pstack-fable-max.md"));
    const missing = validateTree(rootMissing);
    expect(missing.ok).toBe(false);
    expect(
      missing.problems.some((problem) => problem.includes("missing agent file: pstack-fable-max.md"))
    ).toBe(true);

    const rootFormat = copyPluginTree();
    const catalogPath = catalogFilePath(rootFormat);
    writeFileSync(catalogPath, `${JSON.stringify(JSON.parse(readFileSync(catalogPath, "utf8")), null, 4)}\n`);
    const format = validateTree(rootFormat);
    expect(format.ok).toBe(false);
    expect(format.problems).toContain("models.json is not in canonical format");
  });
});

describe("unifiedDiff", () => {
  it("emits a/b labels and line prefixes", () => {
    const diff = unifiedDiff("a\nb\n", "a\nc\n", "models.json");
    expect(diff).toContain("--- a/models.json");
    expect(diff).toContain("+++ b/models.json");
    expect(diff).toContain(" a");
    expect(diff).toContain("-b");
    expect(diff).toContain("+c");
  });
});

describe("nativeAgentsFor fixture", () => {
  it("still matches the checked-in plugin agents", () => {
    const expected = nativeAgentsFor(loadModelCatalog()).map((agent) => agent.filename).sort();
    const shipped = readdirSync(agentsDirectory(PLUGIN_ROOT))
      .filter((name) => name.startsWith("pstack-") && name.endsWith(".md"))
      .sort();
    expect(shipped).toEqual(expected);
  });
});
