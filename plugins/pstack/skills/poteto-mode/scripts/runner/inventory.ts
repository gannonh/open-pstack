import {
  catalogEffortVocabulary,
  findOffering,
  formatDescriptor,
  offeringLabel,
  type ModelCatalog,
  type ModelOffering,
  type SelectorComposition,
} from "./catalog.ts";
import type { Effort, Provider } from "./types.ts";

// A discovery inventory is evidence about what providers advertise at one
// point in time. It is never runtime authority; membership lives in the
// catalog. Missing provider metadata stays null (unknown), never guessed.

export type InventoryStatus = "ok" | "unavailable-cli" | "unauthenticated" | "failed";

export interface AdvertisedResolution {
  readonly resolvedModel: string;
}

export type InventoryDescriptor =
  | {
      readonly supported: true;
      readonly selector: string;
      readonly selectorComposition: SelectorComposition;
      readonly descriptorStem: string;
    }
  | {
      readonly supported: false;
      readonly reason: string;
    };

export interface InventoryMembership {
  readonly offeringId: string;
  readonly label: string;
  readonly supportedEfforts: readonly Effort[];
  readonly defaultEffort: Effort;
  readonly rollingAlias: boolean;
  readonly deprecated: boolean;
}

export interface InventoryEntry {
  readonly provider: Provider;
  // The exact id the provider reported.
  readonly providerId: string;
  readonly displayName: string | null;
  readonly description: string | null;
  // null means the provider did not report efforts.
  readonly supportedEfforts: readonly Effort[] | null;
  readonly defaultEffort: Effort | null;
  readonly hidden: boolean | null;
  readonly isDefault: boolean | null;
  // Provider-specific ids and hints preserved verbatim (composed Cursor ids,
  // Codex upgrade hints, Claude context variants).
  readonly variants: readonly string[];
  readonly resolution: AdvertisedResolution | null;
  readonly descriptor: InventoryDescriptor;
  readonly membership: InventoryMembership | null;
}

export interface InventorySource {
  readonly method: string;
  readonly argv: readonly string[];
  readonly at: string;
}

export interface ProviderInventory {
  readonly provider: Provider;
  readonly status: InventoryStatus;
  readonly executable: string | null;
  readonly source: InventorySource;
  readonly error: { readonly message: string; readonly evidence: string } | null;
  readonly entries: readonly InventoryEntry[];
}

export interface Inventory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly complete: boolean;
  readonly providers: readonly ProviderInventory[];
}

export function membershipOf(
  catalog: ModelCatalog,
  provider: Provider,
  selector: string
): InventoryMembership | null {
  const offering = findOffering(catalog, provider, selector);
  return offering === null ? null : membershipFor(offering);
}

function membershipFor(offering: ModelOffering): InventoryMembership {
  return {
    offeringId: offering.id,
    label: offeringLabel(offering),
    supportedEfforts: offering.supportedEfforts,
    defaultEffort: offering.defaultEffort,
    rollingAlias: offering.rollingAlias,
    deprecated: offering.deprecated,
  };
}

export function supportedDescriptor(
  provider: Provider,
  selector: string,
  selectorComposition: SelectorComposition
): InventoryDescriptor {
  return {
    supported: true,
    selector,
    selectorComposition,
    descriptorStem: `${provider}:${selector}`,
  };
}

export function unsupportedDescriptor(reason: string): InventoryDescriptor {
  return { supported: false, reason };
}

export interface CursorListing {
  readonly id: string;
  readonly displayName: string | null;
}

// Cursor lists composed `<selector>-<effort>` ids. An id yields a descriptor
// only when its trailing token is an effort the catalog already defines, so
// the exact CLI id can be reproduced through the effort-suffix rule. Other ids
// are reported unsupported under their original id; a new tier is declared
// explicitly through `pstack-models edit`.
export function cursorEntriesFromListing(
  listing: readonly CursorListing[],
  catalog: ModelCatalog
): InventoryEntry[] {
  const vocabulary = catalogEffortVocabulary(catalog);
  const groups = new Map<
    string,
    { efforts: Effort[]; ids: string[]; displayNames: string[] }
  >();
  const entries: InventoryEntry[] = [];
  for (const row of listing) {
    const split = row.id.lastIndexOf("-");
    const stem = split > 0 ? row.id.slice(0, split) : "";
    const token = split > 0 ? row.id.slice(split + 1) : "";
    if (stem.length === 0 || !vocabulary.has(token)) {
      entries.push({
        provider: "cursor",
        providerId: row.id,
        displayName: row.displayName,
        description: null,
        supportedEfforts: null,
        defaultEffort: null,
        hidden: null,
        isDefault: null,
        variants: [],
        resolution: null,
        descriptor: unsupportedDescriptor(
          `no cataloged effort suffix; Cursor offerings compose <selector>-<effort>. Declare a new effort explicitly with pstack-models edit.`
        ),
        membership: null,
      });
      continue;
    }
    const group = groups.get(stem) ?? { efforts: [], ids: [], displayNames: [] };
    group.efforts.push(token);
    group.ids.push(row.id);
    if (row.displayName !== null) group.displayNames.push(row.displayName);
    groups.set(stem, group);
  }
  for (const [stem, group] of groups) {
    entries.push({
      provider: "cursor",
      providerId: stem,
      displayName: commonDisplayName(group.displayNames, group.efforts),
      description: null,
      supportedEfforts: group.efforts,
      defaultEffort: null,
      hidden: null,
      isDefault: null,
      variants: group.ids,
      resolution: null,
      descriptor: supportedDescriptor("cursor", stem, "effort-suffix"),
      membership: membershipOf(catalog, "cursor", stem),
    });
  }
  return entries;
}

// "Claude Fable 5.1 Max" and "Claude Fable 5.1 Low" share the stem
// "Claude Fable 5.1". Anything else stays unknown.
function commonDisplayName(
  displayNames: readonly string[],
  efforts: readonly Effort[]
): string | null {
  if (displayNames.length === 0) return null;
  const words = displayNames.map((name) => name.split(/\s+/));
  const shortest = Math.min(...words.map((entry) => entry.length));
  let common = 0;
  while (
    common < shortest &&
    words.every((entry) => entry[common] === words[0]?.[common])
  ) {
    common += 1;
  }
  if (common === 0) return null;
  const stem = words[0]?.slice(0, common).join(" ") ?? null;
  return stem !== null && efforts.length > 0 ? stem : null;
}

// Only cataloged members yield copyable descriptors. A discovery-only entry
// is not selectable until `pstack-models add` catalogs it.
export function copyableDescriptors(entry: InventoryEntry): readonly string[] {
  if (!entry.descriptor.supported || entry.membership === null) return [];
  const selector = entry.descriptor.selector;
  return entry.membership.supportedEfforts.map((effort) =>
    formatDescriptor(entry.provider, selector, effort)
  );
}

function renderEntry(entry: InventoryEntry): string[] {
  const lines: string[] = [];
  const label = entry.displayName ?? "(display name unknown)";
  lines.push(`  ${entry.providerId}  ${label}`);
  if (entry.description !== null) lines.push(`    description: ${entry.description}`);
  lines.push(
    `    efforts: ${entry.supportedEfforts === null ? "unknown" : entry.supportedEfforts.join(", ") || "(none reported)"}`
  );
  lines.push(`    default effort: ${entry.defaultEffort ?? "unknown"}`);
  if (entry.hidden === true) lines.push("    hidden: true");
  if (entry.isDefault === true) lines.push("    provider default: true");
  if (entry.variants.length > 0) lines.push(`    variants: ${entry.variants.join(", ")}`);
  lines.push(
    `    advertised resolution: ${entry.resolution === null ? "unknown" : entry.resolution.resolvedModel}`
  );
  if (entry.descriptor.supported) {
    lines.push(`    descriptor stem: ${entry.descriptor.descriptorStem}`);
    const copyable = copyableDescriptors(entry);
    if (copyable.length > 0) lines.push(`    copyable: ${copyable.join(", ")}`);
  } else {
    lines.push(`    unsupported: ${entry.descriptor.reason}`);
  }
  if (entry.membership === null) {
    lines.push(
      entry.descriptor.supported
        ? `    membership: not cataloged (pstack-models add ${entry.descriptor.descriptorStem} --from <inventory>)`
        : "    membership: not cataloged"
    );
  } else {
    const membership = entry.membership;
    lines.push(
      `    membership: ${membership.offeringId} (${membership.label}; efforts ${membership.supportedEfforts.join(", ")}; default ${membership.defaultEffort}${membership.deprecated ? "; deprecated" : ""})`
    );
  }
  return lines;
}

export function renderInventory(inventory: Inventory): string {
  const lines: string[] = [
    `pstack discovery inventory (${inventory.generatedAt})`,
    inventory.complete
      ? "complete: every requested provider answered"
      : "INCOMPLETE: at least one provider failed; successful listings are still shown",
  ];
  for (const provider of inventory.providers) {
    lines.push("");
    lines.push(
      `${provider.provider}: ${provider.status}  [${provider.source.method}; ${provider.source.at}]`
    );
    lines.push(`  executable: ${provider.executable ?? "not found"}`);
    if (provider.error !== null) {
      lines.push(`  error: ${provider.error.message}`);
      if (provider.error.evidence.length > 0) {
        for (const line of provider.error.evidence.split("\n")) lines.push(`    ${line}`);
      }
    }
    if (provider.entries.length === 0 && provider.status === "ok") {
      lines.push("  (no models listed)");
    }
    for (const entry of provider.entries) lines.push(...renderEntry(entry));
  }
  return `${lines.join("\n")}\n`;
}

export function parseInventory(value: unknown): Inventory {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("inventory must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error("inventory schemaVersion must be 1");
  if (typeof record.generatedAt !== "string") throw new Error("inventory generatedAt is missing");
  if (typeof record.complete !== "boolean") throw new Error("inventory complete flag is missing");
  if (!Array.isArray(record.providers)) throw new Error("inventory providers must be an array");
  return record as unknown as Inventory;
}

export function findInventoryEntry(
  inventory: Inventory,
  provider: Provider,
  selector: string
): InventoryEntry | null {
  for (const providerInventory of inventory.providers) {
    if (providerInventory.provider !== provider) continue;
    for (const entry of providerInventory.entries) {
      if (entry.descriptor.supported && entry.descriptor.selector === selector) return entry;
      if (entry.providerId === selector) return entry;
    }
  }
  return null;
}
