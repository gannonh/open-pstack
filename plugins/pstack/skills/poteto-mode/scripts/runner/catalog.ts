import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EFFORTS,
  PROVIDERS,
  UsageError,
  type Effort,
  type Provider,
} from "./types.ts";

export const SELECTOR_COMPOSITIONS = ["effort-flag", "effort-suffix"] as const;
export type SelectorComposition = (typeof SELECTOR_COMPOSITIONS)[number];

export const ROLE_KINDS = ["scalar", "panel"] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export const SPECIAL_ALIASES = ["inherit-parent", "auto"] as const;
export type SpecialAlias = (typeof SPECIAL_ALIASES)[number];

export const PLUGIN_ROOT = resolve(
  process.env.PSTACK_PLUGIN_ROOT ?? join(import.meta.dir, "../../../..")
);
export const CATALOG_DIR = join(PLUGIN_ROOT, "catalog");
export const MODELS_CATALOG_PATH = join(CATALOG_DIR, "models.json");
export const ROLE_DEFAULTS_PATH = join(CATALOG_DIR, "role-defaults.json");

export interface ModelOffering {
  readonly id: string;
  readonly family: string;
  readonly displayName: string;
  readonly provider: Provider;
  readonly selector: string;
  readonly selectorComposition: SelectorComposition;
  readonly supportedEfforts: readonly Effort[];
  readonly defaultEffort: Effort;
  readonly nativeAgentStem: string | null;
  readonly nativeAgentTitle: string | null;
  readonly rollingAlias: boolean;
  readonly deprecated: boolean;
  readonly successorId: string | null;
  readonly notes: string | null;
}

export interface LegacyMigration {
  readonly provider: Provider;
  readonly selectorPattern: string;
  readonly targetOfferingId: string;
}

export interface ModelCatalog {
  readonly schemaVersion: 1;
  readonly offerings: readonly ModelOffering[];
  readonly legacyMigrations: readonly LegacyMigration[];
}

export interface RoleDefault {
  readonly id: string;
  readonly kind: RoleKind;
  readonly descriptors: readonly string[];
}

export interface RoleDefaults {
  readonly schemaVersion: 1;
  readonly preamble: readonly string[];
  readonly roles: readonly RoleDefault[];
}

export interface ParsedDescriptor {
  readonly raw: string;
  readonly kind: "alias" | "offering";
  readonly alias: SpecialAlias | null;
  readonly provider: Provider | null;
  readonly selector: string | null;
  readonly effort: Effort | null;
  readonly offering: ModelOffering | null;
}

export interface MigrationRecord {
  readonly original: string;
  readonly migrated: string;
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const FAMILY_RE = /^[a-z][a-z0-9-]*$/;
const SELECTOR_RE = /^[a-z0-9][a-z0-9.-]*$/;
const STEM_RE = /^[a-z0-9-]+$/;
const DESCRIPTOR_RE =
  /^(claude|codex|grok|cursor):([a-z0-9][a-z0-9.-]*)@(low|medium|high|xhigh|max)$/;

let cachedModels: ModelCatalog | undefined;
let cachedRoles: RoleDefaults | undefined;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a string or null`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function asEffort(value: unknown, label: string): Effort {
  const effort = asString(value, label);
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new Error(`${label} is not an effort: ${effort}`);
  }
  return effort as Effort;
}

function asProvider(value: unknown, label: string): Provider {
  const provider = asString(value, label);
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(`${label} is not a predefined provider: ${provider}`);
  }
  return provider as Provider;
}

function asComposition(value: unknown, label: string): SelectorComposition {
  const composition = asString(value, label);
  if (!(SELECTOR_COMPOSITIONS as readonly string[]).includes(composition)) {
    throw new Error(`${label} is not a selector composition: ${composition}`);
  }
  return composition as SelectorComposition;
}

export function isSpecialAlias(value: string): value is SpecialAlias {
  return (SPECIAL_ALIASES as readonly string[]).includes(value);
}

export function parseDescriptorText(raw: string): {
  readonly raw: string;
  readonly alias: SpecialAlias | null;
  readonly provider: Provider | null;
  readonly selector: string | null;
  readonly effort: Effort | null;
} {
  const trimmed = raw.trim();
  if (isSpecialAlias(trimmed)) {
    return {
      raw: trimmed,
      alias: trimmed,
      provider: null,
      selector: null,
      effort: null,
    };
  }
  const match = DESCRIPTOR_RE.exec(trimmed);
  if (match === null) {
    throw new Error(`invalid descriptor: ${raw}`);
  }
  return {
    raw: trimmed,
    alias: null,
    provider: match[1] as Provider,
    selector: match[2],
    effort: match[3] as Effort,
  };
}

export function formatDescriptor(
  provider: Provider,
  selector: string,
  effort: Effort
): string {
  return `${provider}:${selector}@${effort}`;
}

function parseOffering(
  value: unknown,
  index: number
): ModelOffering {
  if (!isObject(value)) {
    throw new Error(`offering ${index} must be an object`);
  }
  const id = asString(value.id, `offerings[${index}].id`);
  if (!ID_RE.test(id)) {
    throw new Error(`offerings[${index}].id is not a slug: ${id}`);
  }
  const family = asString(value.family, `offerings[${index}].family`);
  if (!FAMILY_RE.test(family)) {
    throw new Error(`offerings[${index}].family is not a slug: ${family}`);
  }
  const provider = asProvider(value.provider, `offerings[${index}].provider`);
  const selector = asString(value.selector, `offerings[${index}].selector`);
  if (!SELECTOR_RE.test(selector)) {
    throw new Error(`offerings[${index}].selector is invalid: ${selector}`);
  }
  if (!Array.isArray(value.supportedEfforts) || value.supportedEfforts.length === 0) {
    throw new Error(`offerings[${index}].supportedEfforts must be a non-empty array`);
  }
  const supportedEfforts = value.supportedEfforts.map((effort, effortIndex) =>
    asEffort(effort, `offerings[${index}].supportedEfforts[${effortIndex}]`)
  );
  const uniqueEfforts = new Set(supportedEfforts);
  if (uniqueEfforts.size !== supportedEfforts.length) {
    throw new Error(`offerings[${index}].supportedEfforts contains duplicates`);
  }
  if (
    EFFORTS.filter((effort) => uniqueEfforts.has(effort)).join(" ") !==
    supportedEfforts.join(" ")
  ) {
    throw new Error(
      `offerings[${index}].supportedEfforts must be listed in canonical effort order`
    );
  }
  const defaultEffort = asEffort(
    value.defaultEffort,
    `offerings[${index}].defaultEffort`
  );
  if (!uniqueEfforts.has(defaultEffort)) {
    throw new Error(`offerings[${index}].defaultEffort is not selectable`);
  }
  const nativeAgentStem = asNullableString(
    value.nativeAgentStem,
    `offerings[${index}].nativeAgentStem`
  );
  const nativeAgentTitle = asNullableString(
    value.nativeAgentTitle,
    `offerings[${index}].nativeAgentTitle`
  );
  if ((provider === "claude") !== (nativeAgentStem !== null)) {
    throw new Error(
      `offerings[${index}] nativeAgentStem must be present iff provider is claude`
    );
  }
  if (nativeAgentStem !== null && !STEM_RE.test(nativeAgentStem)) {
    throw new Error(`offerings[${index}].nativeAgentStem is invalid`);
  }
  if ((nativeAgentStem !== null) !== (nativeAgentTitle !== null)) {
    throw new Error(
      `offerings[${index}] nativeAgentTitle must be present iff nativeAgentStem is present`
    );
  }
  const successorId = asNullableString(
    value.successorId,
    `offerings[${index}].successorId`
  );
  const deprecated = asBoolean(value.deprecated, `offerings[${index}].deprecated`);
  if (!deprecated && successorId !== null) {
    throw new Error(`offerings[${index}].successorId requires deprecated: true`);
  }
  const rollingAlias = asBoolean(value.rollingAlias, `offerings[${index}].rollingAlias`);
  if (rollingAlias && provider !== "claude") {
    throw new Error(`offerings[${index}].rollingAlias requires provider claude`);
  }
  return {
    id,
    family,
    displayName: asString(value.displayName, `offerings[${index}].displayName`),
    provider,
    selector,
    selectorComposition: asComposition(
      value.selectorComposition,
      `offerings[${index}].selectorComposition`
    ),
    supportedEfforts,
    defaultEffort,
    nativeAgentStem,
    nativeAgentTitle,
    rollingAlias,
    deprecated,
    successorId,
    notes: asNullableString(value.notes, `offerings[${index}].notes`),
  };
}

function parseLegacyMigration(
  value: unknown,
  index: number
): LegacyMigration {
  if (!isObject(value)) {
    throw new Error(`legacyMigrations[${index}] must be an object`);
  }
  const selectorPattern = asString(
    value.selectorPattern,
    `legacyMigrations[${index}].selectorPattern`
  );
  try {
    new RegExp(selectorPattern);
  } catch {
    throw new Error(`legacyMigrations[${index}].selectorPattern is not a regex`);
  }
  return {
    provider: asProvider(value.provider, `legacyMigrations[${index}].provider`),
    selectorPattern,
    targetOfferingId: asString(
      value.targetOfferingId,
      `legacyMigrations[${index}].targetOfferingId`
    ),
  };
}

export function parseModelCatalog(value: unknown): ModelCatalog {
  if (!isObject(value)) {
    throw new Error("model catalog must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("model catalog schemaVersion must be 1");
  }
  if (!Array.isArray(value.offerings) || value.offerings.length === 0) {
    throw new Error("model catalog offerings must be a non-empty array");
  }
  const offerings = value.offerings.map(parseOffering);
  const ids = new Set<string>();
  const selectorKeys = new Set<string>();
  const stems = new Set<string>();
  for (const offering of offerings) {
    if (ids.has(offering.id)) {
      throw new Error(`duplicate offering id: ${offering.id}`);
    }
    ids.add(offering.id);
    const selectorKey = `${offering.provider}:${offering.selector}`;
    if (selectorKeys.has(selectorKey)) {
      throw new Error(`duplicate provider selector: ${selectorKey}`);
    }
    selectorKeys.add(selectorKey);
    if (offering.nativeAgentStem !== null) {
      if (stems.has(offering.nativeAgentStem)) {
        throw new Error(`duplicate nativeAgentStem: ${offering.nativeAgentStem}`);
      }
      stems.add(offering.nativeAgentStem);
    }
  }
  const migrations = Array.isArray(value.legacyMigrations)
    ? value.legacyMigrations.map(parseLegacyMigration)
    : [];
  for (const migration of migrations) {
    if (!ids.has(migration.targetOfferingId)) {
      throw new Error(
        `legacy migration target is missing: ${migration.targetOfferingId}`
      );
    }
    const target = offerings.find((row) => row.id === migration.targetOfferingId);
    if (target !== undefined && target.provider !== migration.provider) {
      throw new Error(
        `legacy migration ${migration.targetOfferingId} provider mismatch`
      );
    }
  }
  for (const offering of offerings) {
    if (offering.successorId !== null && !ids.has(offering.successorId)) {
      throw new Error(`successorId is missing: ${offering.successorId}`);
    }
  }
  return { schemaVersion: 1, offerings, legacyMigrations: migrations };
}

export function parseRoleDefaults(
  value: unknown,
  catalog: ModelCatalog
): RoleDefaults {
  if (!isObject(value)) {
    throw new Error("role defaults must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("role defaults schemaVersion must be 1");
  }
  if (!Array.isArray(value.preamble) || value.preamble.length === 0) {
    throw new Error("role defaults preamble must be a non-empty array");
  }
  const preamble = value.preamble.map((line, index) =>
    typeof line === "string"
      ? line
      : (() => {
          throw new Error(`preamble[${index}] must be a string`);
        })()
  );
  if (!Array.isArray(value.roles) || value.roles.length === 0) {
    throw new Error("role defaults roles must be a non-empty array");
  }
  const roles: RoleDefault[] = value.roles.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`roles[${index}] must be an object`);
    }
    const id = asString(entry.id, `roles[${index}].id`);
    const kindRaw = asString(entry.kind, `roles[${index}].kind`);
    if (!(ROLE_KINDS as readonly string[]).includes(kindRaw)) {
      throw new Error(`roles[${index}].kind is invalid: ${kindRaw}`);
    }
    const kind = kindRaw as RoleKind;
    if (!Array.isArray(entry.descriptors) || entry.descriptors.length === 0) {
      throw new Error(`roles[${index}].descriptors must be a non-empty array`);
    }
    if (kind === "scalar" && entry.descriptors.length !== 1) {
      throw new Error(`roles[${index}] scalar roles must have exactly one descriptor`);
    }
    const descriptors = entry.descriptors.map((descriptor, descriptorIndex) => {
      if (typeof descriptor !== "string") {
        throw new Error(`roles[${index}].descriptors[${descriptorIndex}] must be a string`);
      }
      bindDescriptor(catalog, descriptor);
      return descriptor;
    });
    return { id, kind, descriptors };
  });
  const ids = new Set<string>();
  for (const role of roles) {
    if (ids.has(role.id)) {
      throw new Error(`duplicate role id: ${role.id}`);
    }
    ids.add(role.id);
  }
  return { schemaVersion: 1, preamble, roles };
}

export function findOffering(
  catalog: ModelCatalog,
  provider: Provider,
  selector: string
): ModelOffering | null {
  return (
    catalog.offerings.find(
      (offering) => offering.provider === provider && offering.selector === selector
    ) ?? null
  );
}

export function offeringById(
  catalog: ModelCatalog,
  id: string
): ModelOffering | null {
  return catalog.offerings.find((offering) => offering.id === id) ?? null;
}

export function migrateSelector(
  catalog: ModelCatalog,
  provider: Provider,
  selector: string
): { selector: string; migratedFrom: string | null } {
  if (findOffering(catalog, provider, selector) !== null) {
    return { selector, migratedFrom: null };
  }
  for (const migration of catalog.legacyMigrations) {
    if (migration.provider !== provider) continue;
    if (!new RegExp(migration.selectorPattern).test(selector)) continue;
    const target = offeringById(catalog, migration.targetOfferingId);
    if (target === null) {
      throw new Error(`legacy migration target missing: ${migration.targetOfferingId}`);
    }
    return { selector: target.selector, migratedFrom: selector };
  }
  return { selector, migratedFrom: null };
}

export function migrateDescriptorText(
  catalog: ModelCatalog,
  raw: string
): { descriptor: string; migratedFrom: string | null } {
  const parsed = parseDescriptorText(raw);
  if (parsed.alias !== null || parsed.provider === null || parsed.selector === null) {
    return { descriptor: parsed.raw, migratedFrom: null };
  }
  const migrated = migrateSelector(catalog, parsed.provider, parsed.selector);
  if (migrated.migratedFrom === null) {
    return { descriptor: parsed.raw, migratedFrom: null };
  }
  return {
    descriptor: formatDescriptor(
      parsed.provider,
      migrated.selector,
      parsed.effort as Effort
    ),
    migratedFrom: parsed.raw,
  };
}

export function bindDescriptor(
  catalog: ModelCatalog,
  raw: string
): ParsedDescriptor {
  const parsed = parseDescriptorText(raw);
  if (parsed.alias !== null) {
    return {
      raw: parsed.raw,
      kind: "alias",
      alias: parsed.alias,
      provider: null,
      selector: null,
      effort: null,
      offering: null,
    };
  }
  const offering = findOffering(
    catalog,
    parsed.provider as Provider,
    parsed.selector as string
  );
  if (offering === null) {
    throw new Error(
      `${parsed.raw} is not a cataloged offering. Add it to catalog/models.json or pick a listed provider/model/effort.`
    );
  }
  const effort = parsed.effort as Effort;
  if (!offering.supportedEfforts.includes(effort)) {
    throw new Error(
      `${parsed.raw} uses unsupported effort ${effort}; supported: ${offering.supportedEfforts.join(", ")}`
    );
  }
  return {
    raw: parsed.raw,
    kind: "offering",
    alias: null,
    provider: offering.provider,
    selector: offering.selector,
    effort,
    offering,
  };
}

export function composedCliModel(offering: ModelOffering, effort: Effort): string {
  if (!offering.supportedEfforts.includes(effort)) {
    throw new UsageError(
      `effort ${effort} is not supported for ${offering.provider}:${offering.selector}`
    );
  }
  return offering.selectorComposition === "effort-suffix"
    ? `${offering.selector}-${effort}`
    : offering.selector;
}

export function catalogLaneError(
  catalog: ModelCatalog,
  provider: Provider,
  model: string,
  effort: Effort
): string | null {
  const offering = findOffering(catalog, provider, model);
  if (offering === null) {
    return `model ${model} is not a cataloged ${provider} offering`;
  }
  if (!offering.supportedEfforts.includes(effort)) {
    return `effort ${effort} is not supported for ${provider}:${model}; supported: ${offering.supportedEfforts.join(", ")}`;
  }
  return null;
}

export function requireCatalogedLane(
  catalog: ModelCatalog,
  provider: Provider,
  model: string,
  effort: Effort
): ModelOffering {
  const error = catalogLaneError(catalog, provider, model, effort);
  if (error !== null) throw new UsageError(error);
  return findOffering(catalog, provider, model)!;
}

export function nativeAgentName(offering: ModelOffering, effort: Effort): string {
  if (offering.nativeAgentStem === null) {
    throw new Error(`${offering.id} has no Claude-native agent stem`);
  }
  return `pstack-${offering.nativeAgentStem}-${effort}`;
}

export function renderNativeAgent(offering: ModelOffering, effort: Effort): string {
  const name = nativeAgentName(offering, effort);
  const title = offering.nativeAgentTitle ?? `pstack ${offering.displayName} lane`;
  return `---
name: ${name}
description: Native Claude lane for pstack roles configured as ${offering.provider}:${offering.selector}@${effort}.
model: ${offering.selector}
effort: ${effort}
background: true
disallowedTools: Agent, Task
---

# ${title}

Execute only the task and path scope the parent assigns. Read the grounding artifacts by path. Do not choose another model, spawn another agent, or start a pstack workflow. If the assignment is read-only, do not modify files. Return the requested artifact or verdict plus a concise rationale.
`;
}

export function nativeAgentsFor(catalog: ModelCatalog): readonly {
  readonly filename: string;
  readonly contents: string;
}[] {
  const agents: { filename: string; contents: string }[] = [];
  for (const offering of catalog.offerings) {
    if (offering.nativeAgentStem === null) continue;
    for (const effort of offering.supportedEfforts) {
      agents.push({
        filename: `${nativeAgentName(offering, effort)}.md`,
        contents: renderNativeAgent(offering, effort),
      });
    }
  }
  return agents;
}

export function setupOfferingChoices(catalog: ModelCatalog): readonly {
  readonly id: string;
  readonly family: string;
  readonly displayName: string;
  readonly descriptorStem: string;
  readonly provider: Provider;
  readonly selector: string;
  readonly supportedEfforts: readonly Effort[];
  readonly defaultEffort: Effort;
  readonly deprecated: boolean;
}[] {
  return catalog.offerings.map((offering) => ({
    id: offering.id,
    family: offering.family,
    displayName: offering.displayName,
    descriptorStem: `${offering.provider}:${offering.selector}`,
    provider: offering.provider,
    selector: offering.selector,
    supportedEfforts: offering.supportedEfforts,
    defaultEffort: offering.defaultEffort,
    deprecated: offering.deprecated,
  }));
}

export function loadModelCatalog(path: string = MODELS_CATALOG_PATH): ModelCatalog {
  if (cachedModels !== undefined && path === MODELS_CATALOG_PATH) {
    return cachedModels;
  }
  const catalog = parseModelCatalog(JSON.parse(readFileSync(path, "utf8")));
  if (path === MODELS_CATALOG_PATH) cachedModels = catalog;
  return catalog;
}

export function loadRoleDefaults(
  catalog: ModelCatalog = loadModelCatalog(),
  path: string = ROLE_DEFAULTS_PATH
): RoleDefaults {
  if (cachedRoles !== undefined && path === ROLE_DEFAULTS_PATH) {
    return cachedRoles;
  }
  const roles = parseRoleDefaults(JSON.parse(readFileSync(path, "utf8")), catalog);
  if (path === ROLE_DEFAULTS_PATH) cachedRoles = roles;
  return roles;
}

export function resetCatalogCache(): void {
  cachedModels = undefined;
  cachedRoles = undefined;
}

export function defaultPanelDescriptors(roles: RoleDefaults): readonly string[] {
  const panel = roles.roles.find((role) => role.id === "arena runners");
  if (panel === undefined) {
    throw new Error("role defaults are missing arena runners");
  }
  return panel.descriptors;
}
