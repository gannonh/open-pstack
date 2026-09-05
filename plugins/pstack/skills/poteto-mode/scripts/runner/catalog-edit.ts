import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  bindDescriptor,
  catalogToJson,
  findOffering,
  formatCatalogJson,
  nativeAgentsFor,
  offeringById,
  offeringToJson,
  parseModelCatalog,
  parseRoleDefaults,
  proposeNativeAgentStem,
  type ModelCatalog,
  type ModelOffering,
  type RoleDefaults,
  type SelectorComposition,
} from "./catalog.ts";
import type {
  InventoryEntry,
  InventorySource,
} from "./inventory.ts";
import { isEffortIdentifier, type Effort, type Provider } from "./types.ts";

export type OfferingInput = {
  id: string;
  family: string;
  displayName: string;
  provider: Provider;
  selector: string;
  selectorComposition: SelectorComposition;
  supportedEfforts: readonly Effort[];
  defaultEffort: Effort;
  nativeAgentStem: string | null;
  nativeAgentTitle: string | null;
  rollingAlias: boolean;
  deprecated: boolean;
  successorId: string | null;
  notes: string | null;
};

export type Proposal =
  | {
      readonly kind: "change";
      readonly catalog: ModelCatalog;
      readonly catalogText: string;
      readonly agents: ReadonlyMap<string, string>;
      readonly diff: string;
    }
  | { readonly kind: "no-op"; readonly message: string }
  | { readonly kind: "rejected"; readonly message: string };

export type CatalogFs = {
  readonly readFileSync: (path: string) => Buffer | string;
  readonly writeFileSync: (path: string, data: string | Buffer) => void;
  readonly unlinkSync: (path: string) => void;
  readonly existsSync: (path: string) => boolean;
  readonly mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
};

const REQUIRED_OFFERING_KEYS = [
  "id",
  "family",
  "displayName",
  "provider",
  "selector",
  "selectorComposition",
  "supportedEfforts",
  "defaultEffort",
] as const satisfies readonly (keyof OfferingInput)[];

const defaultFs: CatalogFs = {
  readFileSync: (path) => readFileSync(path),
  writeFileSync: (path, data) => writeFileSync(path, data),
  unlinkSync: (path) => unlinkSync(path),
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => {
    mkdirSync(path, options);
  },
};

export function catalogFilePath(pluginRoot: string = PLUGIN_ROOT): string {
  return join(pluginRoot, "catalog", "models.json");
}

export function roleDefaultsFilePath(pluginRoot: string = PLUGIN_ROOT): string {
  return join(pluginRoot, "catalog", "role-defaults.json");
}

export function agentsDirectory(pluginRoot: string = PLUGIN_ROOT): string {
  return join(pluginRoot, "agents");
}

export function readCatalogFile(path: string): {
  text: string;
  raw: unknown;
  catalog: ModelCatalog;
} {
  const text = readFileSync(path, "utf8");
  const raw: unknown = JSON.parse(text);
  return { text, raw, catalog: parseModelCatalog(raw) };
}

export function offeringIdSlug(provider: Provider, selector: string): string {
  return `${provider}-${slugToken(selector)}`;
}

export function adapterProposal(
  provider: Provider,
  selector: string
): Partial<OfferingInput> {
  const rolling = provider === "claude" && !/[0-9]/.test(selector);
  const proposal: Partial<OfferingInput> = {
    id: offeringIdSlug(provider, selector),
    provider,
    selector,
    selectorComposition: provider === "cursor" ? "effort-suffix" : "effort-flag",
    rollingAlias: rolling,
    deprecated: false,
    successorId: null,
  };
  if (rolling) proposal.family = selector;
  if (provider === "claude") {
    proposal.nativeAgentStem = proposeNativeAgentStem(selector);
  } else {
    proposal.nativeAgentStem = null;
    proposal.nativeAgentTitle = null;
  }
  return proposal;
}

export function proposeFromInventory(
  entry: InventoryEntry,
  _catalog: ModelCatalog,
  source: InventorySource
): {
  proposal: Partial<OfferingInput>;
  missing: readonly (keyof OfferingInput)[];
} {
  const notes = `Discovered via ${source.method} on ${source.at}.`;
  if (!entry.descriptor.supported) {
    const proposal: Partial<OfferingInput> = {
      provider: entry.provider,
      displayName: entry.displayName ?? undefined,
      notes,
      deprecated: false,
      successorId: null,
      rollingAlias: false,
    };
    if (entry.provider !== "claude") {
      proposal.nativeAgentStem = null;
      proposal.nativeAgentTitle = null;
    }
    return { proposal, missing: missingKeys(proposal) };
  }
  const proposal: Partial<OfferingInput> = {
    ...adapterProposal(entry.provider, entry.descriptor.selector),
    selector: entry.descriptor.selector,
    selectorComposition: entry.descriptor.selectorComposition,
    notes,
  };
  if (entry.displayName !== null) {
    proposal.displayName = entry.displayName;
    if (entry.provider === "claude") {
      proposal.nativeAgentTitle = `pstack ${entry.displayName} lane`;
    }
  }
  if (entry.supportedEfforts !== null) proposal.supportedEfforts = entry.supportedEfforts;
  if (entry.defaultEffort !== null) proposal.defaultEffort = entry.defaultEffort;
  return { proposal, missing: missingKeys(proposal) };
}

export function completeOffering(
  partial: Partial<OfferingInput>
): { offering: OfferingInput } | { missing: readonly string[] } {
  const provider = partial.provider;
  const rollingAlias = partial.rollingAlias ?? false;
  const deprecated = partial.deprecated ?? false;
  const successorId = partial.successorId === undefined ? null : partial.successorId;
  const notes = partial.notes === undefined ? null : partial.notes;
  let nativeAgentStem = partial.nativeAgentStem;
  let nativeAgentTitle = partial.nativeAgentTitle;
  if (provider !== undefined && provider !== "claude") {
    if (nativeAgentStem === undefined) nativeAgentStem = null;
    if (nativeAgentTitle === undefined) nativeAgentTitle = null;
  }
  if (
    provider === "claude" &&
    nativeAgentTitle === undefined &&
    typeof partial.displayName === "string"
  ) {
    nativeAgentTitle = `pstack ${partial.displayName} lane`;
  }
  const filled: Partial<OfferingInput> = {
    ...partial,
    rollingAlias,
    deprecated,
    successorId,
    notes,
    nativeAgentStem,
    nativeAgentTitle,
  };
  const missing = missingKeys(filled);
  if (missing.length > 0) return { missing };
  return { offering: filled as OfferingInput };
}

export function proposeAdd(
  current: ModelCatalog,
  offering: OfferingInput,
  pluginRoot: string = PLUGIN_ROOT
): Proposal {
  const existing = findOffering(current, offering.provider, offering.selector);
  if (existing !== null) {
    if (offeringsEqual(existing, offering)) {
      return {
        kind: "no-op",
        message: `${offering.provider}:${offering.selector} is already cataloged as ${existing.id}`,
      };
    }
    return {
      kind: "rejected",
      message: `already cataloged as ${existing.id} with different fields; use \`pstack-models edit ${existing.id}\``,
    };
  }
  const idClash = offeringById(current, offering.id);
  if (idClash !== null) {
    return { kind: "rejected", message: `id already cataloged: ${offering.id}` };
  }
  const stemClash = stemOwner(current, offering.nativeAgentStem);
  if (stemClash !== null) {
    return {
      kind: "rejected",
      message: `nativeAgentStem already cataloged: ${offering.nativeAgentStem}`,
    };
  }
  return validateProposed(
    current,
    {
      schemaVersion: 1,
      offerings: [...current.offerings, offering],
      legacyMigrations: current.legacyMigrations,
    },
    pluginRoot
  );
}

export function proposeEdit(
  current: ModelCatalog,
  offeringId: string,
  patch: Partial<OfferingInput>,
  pluginRoot: string = PLUGIN_ROOT
): Proposal {
  const existing = offeringById(current, offeringId);
  if (existing === null) {
    return { kind: "rejected", message: `offering not found: ${offeringId}` };
  }
  const merged = mergeOffering(existing, patch);
  if (offeringsEqual(existing, merged)) {
    return { kind: "no-op", message: `${offeringId} is unchanged` };
  }
  const selectorClash = findOffering(current, merged.provider, merged.selector);
  if (selectorClash !== null && selectorClash.id !== existing.id) {
    return {
      kind: "rejected",
      message: `already cataloged as ${selectorClash.id} with different fields; use \`pstack-models edit ${selectorClash.id}\``,
    };
  }
  if (merged.id !== existing.id && offeringById(current, merged.id) !== null) {
    return { kind: "rejected", message: `id already cataloged: ${merged.id}` };
  }
  const stemClash = stemOwner(current, merged.nativeAgentStem);
  if (stemClash !== null && stemClash.id !== existing.id) {
    return {
      kind: "rejected",
      message: `nativeAgentStem already cataloged: ${merged.nativeAgentStem}`,
    };
  }
  const offerings = current.offerings.map((row) =>
    row.id === offeringId ? merged : row
  );
  return validateProposed(
    current,
    { schemaVersion: 1, offerings, legacyMigrations: current.legacyMigrations },
    pluginRoot
  );
}

export function proposeRemove(
  current: ModelCatalog,
  offeringId: string,
  roleDefaults: RoleDefaults,
  pluginRoot: string = PLUGIN_ROOT
): Proposal {
  const existing = offeringById(current, offeringId);
  if (existing === null) {
    return { kind: "rejected", message: `offering not found: ${offeringId}` };
  }
  const refs = referencesTo(current, roleDefaults, offeringId);
  if (refs.length > 0) {
    return {
      kind: "rejected",
      message: `cannot remove ${offeringId}; referenced by:\n${refs.join("\n")}`,
    };
  }
  return validateProposed(
    current,
    {
      schemaVersion: 1,
      offerings: current.offerings.filter((row) => row.id !== offeringId),
      legacyMigrations: current.legacyMigrations,
    },
    pluginRoot
  );
}

export function unifiedDiff(before: string, after: string, label: string): string {
  const a = linesOf(before);
  const b = linesOf(after);
  const body = lcsLineDiff(a, b);
  return [`--- a/${label}`, `+++ b/${label}`, ...body].join("\n") + "\n";
}

export function applyProposal(
  proposal: Proposal,
  paths: { catalogPath: string; agentsDir: string },
  fs: CatalogFs = defaultFs
):
  | { ok: true; written: string[]; deleted: string[] }
  | { ok: false; message: string; restored: string[] } {
  if (proposal.kind !== "change") {
    return { ok: false, message: proposal.message, restored: [] };
  }
  const currentAgents = generatedAgentNames(paths.catalogPath, fs);
  const targets = new Set<string>([paths.catalogPath]);
  for (const name of new Set([...currentAgents, ...proposal.agents.keys()])) {
    targets.add(join(paths.agentsDir, name));
  }
  const snapshots = new Map<string, Buffer | null>();
  for (const path of targets) {
    snapshots.set(path, fs.existsSync(path) ? toBuffer(fs.readFileSync(path)) : null);
  }
  const written: string[] = [];
  const deleted: string[] = [];
  const restore = (): string[] => {
    const restored: string[] = [];
    for (const [path, original] of snapshots) {
      if (original === null) {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
          restored.push(path);
        }
      } else {
        fs.writeFileSync(path, original);
        restored.push(path);
      }
    }
    return restored;
  };
  try {
    fs.mkdirSync(paths.agentsDir, { recursive: true });
    fs.writeFileSync(paths.catalogPath, proposal.catalogText);
    written.push(paths.catalogPath);
    for (const [name, contents] of proposal.agents) {
      const path = join(paths.agentsDir, name);
      fs.writeFileSync(path, contents);
      written.push(path);
    }
    for (const name of currentAgents) {
      if (proposal.agents.has(name)) continue;
      const path = join(paths.agentsDir, name);
      if (fs.existsSync(path)) {
        fs.unlinkSync(path);
        deleted.push(path);
      }
    }
    const expected = new Map<string, Buffer>([
      [paths.catalogPath, Buffer.from(proposal.catalogText)],
    ]);
    for (const [name, contents] of proposal.agents) {
      expected.set(join(paths.agentsDir, name), Buffer.from(contents));
    }
    for (const [path, bytes] of expected) {
      if (!fs.existsSync(path)) {
        throw new Error(`readback missing: ${path}`);
      }
      if (!toBuffer(fs.readFileSync(path)).equals(bytes)) {
        throw new Error(`readback mismatch: ${path}`);
      }
    }
    for (const path of deleted) {
      if (fs.existsSync(path)) throw new Error(`readback still present: ${path}`);
    }
    return { ok: true, written, deleted };
  } catch (error) {
    const restored = restore();
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message, restored };
  }
}

export function validateTree(
  pluginRoot: string = PLUGIN_ROOT
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const catalogPath = catalogFilePath(pluginRoot);
  const rolesPath = roleDefaultsFilePath(pluginRoot);
  const agentsDir = agentsDirectory(pluginRoot);
  let catalog: ModelCatalog;
  try {
    const loaded = readCatalogFile(catalogPath);
    catalog = loaded.catalog;
    const canonical = formatCatalogJson(catalogToJson(catalog));
    if (loaded.text !== canonical) problems.push("models.json is not in canonical format");
  } catch (error) {
    return {
      ok: false,
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
  try {
    parseRoleDefaults(JSON.parse(readFileSync(rolesPath, "utf8")), catalog);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const expected = new Map(
    nativeAgentsFor(catalog).map((agent) => [agent.filename, agent.contents])
  );
  const actualNames = existsSync(agentsDir)
    ? readdirSync(agentsDir).filter((name) => name.startsWith("pstack-") && name.endsWith(".md"))
    : [];
  for (const name of actualNames) {
    if (!expected.has(name)) {
      problems.push(`extra agent file: ${name}`);
      continue;
    }
    const contents = readFileSync(join(agentsDir, name), "utf8");
    if (contents !== expected.get(name)) problems.push(`changed agent file: ${name}`);
  }
  for (const name of expected.keys()) {
    if (!actualNames.includes(name)) problems.push(`missing agent file: ${name}`);
  }
  return { ok: problems.length === 0, problems };
}

export function isEffortList(value: string): Effort[] | null {
  const parts = value.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (!parts.every(isEffortIdentifier)) return null;
  return parts;
}

function slugToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function missingKeys(partial: Partial<OfferingInput>): (keyof OfferingInput)[] {
  const missing: (keyof OfferingInput)[] = [];
  for (const key of REQUIRED_OFFERING_KEYS) {
    const value = partial[key];
    if (value === undefined) missing.push(key);
    else if (typeof value === "string" && value.length === 0) missing.push(key);
    else if (Array.isArray(value) && value.length === 0) missing.push(key);
  }
  if (partial.provider === "claude") {
    if (typeof partial.nativeAgentStem !== "string" || partial.nativeAgentStem.length === 0) {
      missing.push("nativeAgentStem");
    }
    if (typeof partial.nativeAgentTitle !== "string" || partial.nativeAgentTitle.length === 0) {
      missing.push("nativeAgentTitle");
    }
  }
  return missing;
}

function offeringsEqual(a: OfferingInput, b: OfferingInput): boolean {
  return JSON.stringify(offeringToJson(a)) === JSON.stringify(offeringToJson(b));
}

function mergeOffering(
  current: ModelOffering,
  patch: Partial<OfferingInput>
): OfferingInput {
  return {
    id: patch.id ?? current.id,
    family: patch.family ?? current.family,
    displayName: patch.displayName ?? current.displayName,
    provider: patch.provider ?? current.provider,
    selector: patch.selector ?? current.selector,
    selectorComposition: patch.selectorComposition ?? current.selectorComposition,
    supportedEfforts: patch.supportedEfforts ?? current.supportedEfforts,
    defaultEffort: patch.defaultEffort ?? current.defaultEffort,
    nativeAgentStem:
      patch.nativeAgentStem === undefined ? current.nativeAgentStem : patch.nativeAgentStem,
    nativeAgentTitle:
      patch.nativeAgentTitle === undefined ? current.nativeAgentTitle : patch.nativeAgentTitle,
    rollingAlias: patch.rollingAlias ?? current.rollingAlias,
    deprecated: patch.deprecated ?? current.deprecated,
    successorId: patch.successorId === undefined ? current.successorId : patch.successorId,
    notes: patch.notes === undefined ? current.notes : patch.notes,
  };
}

function stemOwner(
  catalog: ModelCatalog,
  stem: string | null
): ModelOffering | null {
  if (stem === null) return null;
  return catalog.offerings.find((row) => row.nativeAgentStem === stem) ?? null;
}

function validateProposed(
  current: ModelCatalog,
  proposedRaw: {
    schemaVersion: 1;
    offerings: readonly OfferingInput[];
    legacyMigrations: ModelCatalog["legacyMigrations"];
  },
  pluginRoot: string
): Proposal {
  const json = catalogToJson({
    schemaVersion: 1,
    offerings: proposedRaw.offerings as ModelOffering[],
    legacyMigrations: proposedRaw.legacyMigrations,
  });
  let catalog: ModelCatalog;
  try {
    catalog = parseModelCatalog(json);
  } catch (error) {
    return {
      kind: "rejected",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const rolesRaw = JSON.parse(readFileSync(roleDefaultsFilePath(pluginRoot), "utf8"));
  try {
    parseRoleDefaults(rolesRaw, catalog);
  } catch {
    const rows = failingRoleRows(rolesRaw, catalog);
    return {
      kind: "rejected",
      message:
        rows.length > 0
          ? `proposed catalog breaks role defaults:\n${rows.join("\n")}`
          : "proposed catalog breaks role defaults",
    };
  }
  const catalogText = formatCatalogJson(catalogToJson(catalog));
  const agents = new Map(
    nativeAgentsFor(catalog).map((agent) => [agent.filename, agent.contents])
  );
  return {
    kind: "change",
    catalog,
    catalogText,
    agents,
    diff: renderProposalDiff(current, catalogText, agents),
  };
}

function failingRoleRows(rolesRaw: unknown, catalog: ModelCatalog): string[] {
  if (typeof rolesRaw !== "object" || rolesRaw === null || Array.isArray(rolesRaw)) {
    return [];
  }
  const roles = (rolesRaw as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return [];
  const rows: string[] = [];
  for (const role of roles) {
    if (typeof role !== "object" || role === null) continue;
    const id = (role as { id?: unknown }).id;
    const descriptors = (role as { descriptors?: unknown }).descriptors;
    if (typeof id !== "string" || !Array.isArray(descriptors)) continue;
    descriptors.forEach((descriptor, index) => {
      if (typeof descriptor !== "string") return;
      try {
        bindDescriptor(catalog, descriptor);
      } catch {
        rows.push(`${id}[${index + 1}] ${descriptor}`);
      }
    });
  }
  return rows;
}

function referencesTo(
  catalog: ModelCatalog,
  roles: RoleDefaults,
  offeringId: string
): string[] {
  const refs: string[] = [];
  for (const role of roles.roles) {
    role.descriptors.forEach((descriptor, index) => {
      try {
        const bound = bindDescriptor(catalog, descriptor);
        if (bound.offering?.id === offeringId) {
          refs.push(`${role.id}[${index + 1}] ${descriptor}`);
        }
      } catch {
        // Special aliases do not bind to an offering.
      }
    });
  }
  for (const offering of catalog.offerings) {
    if (offering.successorId === offeringId) {
      refs.push(`successorId of ${offering.id}`);
    }
  }
  catalog.legacyMigrations.forEach((migration, index) => {
    if (migration.targetOfferingId === offeringId) {
      refs.push(
        `legacyMigrations[${index + 1}] ${migration.provider} ${migration.selectorPattern}`
      );
    }
  });
  return refs;
}

function renderProposalDiff(
  current: ModelCatalog,
  catalogText: string,
  proposedAgents: ReadonlyMap<string, string>
): string {
  const beforeText = formatCatalogJson(catalogToJson(current));
  const parts = [unifiedDiff(beforeText, catalogText, "models.json").trimEnd()];
  const currentAgents = new Map(
    nativeAgentsFor(current).map((agent) => [agent.filename, agent.contents])
  );
  const names = [...new Set([...currentAgents.keys(), ...proposedAgents.keys()])].sort();
  for (const name of names) {
    const before = currentAgents.get(name);
    const after = proposedAgents.get(name);
    if (before === undefined && after !== undefined) {
      parts.push(`added ${name}`);
      parts.push(unifiedDiff("", after, name).trimEnd());
    } else if (before !== undefined && after === undefined) {
      parts.push(`removed ${name}`);
      parts.push(unifiedDiff(before, "", name).trimEnd());
    } else if (before !== undefined && after !== undefined && before !== after) {
      parts.push(`changed ${name}`);
      parts.push(unifiedDiff(before, after, name).trimEnd());
    }
  }
  return `${parts.join("\n")}\n`;
}

function linesOf(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (partsEndsWithEmpty(lines)) lines.pop();
  return lines;
}

function partsEndsWithEmpty(lines: string[]): boolean {
  return lines.length > 0 && lines[lines.length - 1] === "";
}

function lcsLineDiff(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${a[i]}`);
      i += 1;
    } else {
      out.push(`+${b[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`-${a[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+${b[j]}`);
    j += 1;
  }
  return out;
}

function toBuffer(value: Buffer | string): Buffer {
  return typeof value === "string" ? Buffer.from(value) : value;
}

function generatedAgentNames(catalogPath: string, fs: CatalogFs): readonly string[] {
  if (!fs.existsSync(catalogPath)) return [];
  try {
    const catalog = parseModelCatalog(
      JSON.parse(toBuffer(fs.readFileSync(catalogPath)).toString("utf8"))
    );
    return nativeAgentsFor(catalog).map((agent) => agent.filename);
  } catch {
    return [];
  }
}
