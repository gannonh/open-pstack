import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  catalogToJson,
  formatCatalogJson,
  loadModelCatalog,
  nativeAgentsFor,
  parseModelCatalog,
  type ModelCatalog,
} from "./catalog.ts";

// The offerings this release added through `pstack-models add`. Tests that
// exercise the add path start from the tree as it was before them.
export const ADDED_OFFERING_IDS = ["codex-gpt-6-astra", "claude-claude-fable-5-1-1m"] as const;

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

export function copyPluginTree(scratches: string[], prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratches.push(root);
  mkdirSync(join(root, "catalog"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  const base = baseCatalog();
  writeFileSync(join(root, "catalog", "models.json"), formatCatalogJson(catalogToJson(base)));
  writeFileSync(
    join(root, "catalog", "role-defaults.json"),
    readFileSync(join(PLUGIN_ROOT, "catalog", "role-defaults.json"))
  );
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
