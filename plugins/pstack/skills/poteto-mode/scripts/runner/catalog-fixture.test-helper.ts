import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  bindDescriptor,
  catalogToJson,
  formatCatalogJson,
  loadModelCatalog,
  nativeAgentsFor,
  parseModelCatalog,
  type ModelCatalog,
} from "./catalog.ts";

// The offerings this release added through `pstack-models add`. Tests that
// exercise the add path start from the tree as it was before them.
export const ADDED_OFFERING_IDS = [
  "codex-gpt-6-astra",
  "codex-gpt-5-6-terra",
  "claude-opus-long-context",
  "cursor-gpt-5-6-sol",
  "cursor-gpt-5-6-terra",
  "cursor-gpt-5-6-luna",
  "cursor-claude-fable-5-1-thinking",
  "claude-default",
  "claude-sonnet",
  "cursor-grok-4-7",
  "codex-gpt-6-luna",
  "cursor-claude-opus-5-5",
  "codex-gpt-6-1-sol",
  "cursor-claude-sonnet-5-5",
] as const;

export function baseCatalog(): ModelCatalog {
  const shipped = loadModelCatalog();
  return parseModelCatalog(
    catalogToJson({
      ...shipped,
      offerings: shipped.offerings.filter(
        (row) => !(ADDED_OFFERING_IDS as readonly string[]).includes(row.id)
      ),
    })
  );
}

// The shipped role defaults name added offerings, so the base tree runs those
// lanes as inherit-parent until the adds land.
export function baseRoleDefaultsText(): string {
  const base = baseCatalog();
  const shipped = JSON.parse(
    readFileSync(join(PLUGIN_ROOT, "catalog", "role-defaults.json"), "utf8")
  ) as { roles: Array<{ descriptors: string[] }> };
  const roles = shipped.roles.map((role) => ({
    ...role,
    descriptors: role.descriptors.map((descriptor) => {
      try {
        bindDescriptor(base, descriptor);
        return descriptor;
      } catch {
        return "inherit-parent";
      }
    }),
  }));
  return `${JSON.stringify({ ...shipped, roles }, null, 2)}\n`;
}

export function copyPluginTree(scratches: string[], prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(root);
  mkdirSync(join(root, "catalog"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  const base = baseCatalog();
  writeFileSync(join(root, "catalog", "models.json"), formatCatalogJson(catalogToJson(base)));
  writeFileSync(join(root, "catalog", "role-defaults.json"), baseRoleDefaultsText());
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    readFileSync(join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"))
  );
  const baseAgents = new Set(nativeAgentsFor(base).map((agent) => agent.filename));
  for (const name of readdirSync(join(PLUGIN_ROOT, "agents"))) {
    if (name.startsWith("pstack-") && !baseAgents.has(name)) continue;
    writeFileSync(join(root, "agents", name), readFileSync(join(PLUGIN_ROOT, "agents", name)));
  }
  return root;
}
