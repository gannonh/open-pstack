import {
  bindDescriptor,
  formatDescriptor,
  loadModelCatalog,
  loadRoleDefaults,
  migrateDescriptorText,
  parseDescriptorText,
  type MigrationRecord,
  type ModelCatalog,
  type ParsedDescriptor,
  type RoleDefault,
  type RoleDefaults,
} from "./catalog.ts";

export const SHEET_TITLE = "# pstack model configuration";

export interface SheetLane {
  readonly raw: string;
  readonly bound: ParsedDescriptor;
}

export interface SheetRole {
  readonly id: string;
  readonly kind: "scalar" | "panel";
  readonly lanes: readonly SheetLane[];
}

export interface ParsedSheet {
  readonly preamble: readonly string[];
  readonly roles: readonly SheetRole[];
  readonly migrations: readonly MigrationRecord[];
}

export interface SheetIssue {
  readonly roleId: string | null;
  readonly message: string;
  readonly line: string | null;
}

function splitLanes(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function overlayLoadedRoles(
  defaults: RoleDefaults,
  loaded: ReadonlyMap<string, readonly string[]>
): RoleDefaults {
  return {
    ...defaults,
    roles: defaults.roles.map((role) => {
      const replacement = loaded.get(role.id);
      if (replacement === undefined) return role;
      return { ...role, descriptors: replacement };
    }),
  };
}

export function parseSheet(
  text: string,
  catalog: ModelCatalog = loadModelCatalog(),
  defaults: RoleDefaults = loadRoleDefaults(catalog)
): {
  readonly sheet: ParsedSheet | null;
  readonly issues: readonly SheetIssue[];
} {
  const issues: SheetIssue[] = [];
  const migrations: MigrationRecord[] = [];
  const preamble: string[] = [];
  const seen = new Map<string, SheetRole>();
  const defaultById = new Map(defaults.roles.map((role) => [role.id, role]));
  const lines = text.split(/\r?\n/);
  let reachedRoles = false;

  for (const line of lines) {
    if (!reachedRoles) {
      if (line.includes(": ") && defaultById.has(line.slice(0, line.indexOf(": ")))) {
        reachedRoles = true;
      } else {
        preamble.push(line);
        continue;
      }
    }
    const trimmed = line.trimEnd();
    if (trimmed.trim().length === 0) continue;
    const idx = trimmed.indexOf(": ");
    if (idx < 0) {
      issues.push({
        roleId: null,
        message: `sheet line is not a role row: ${trimmed}`,
        line: trimmed,
      });
      continue;
    }
    const id = trimmed.slice(0, idx);
    const rawValue = trimmed.slice(idx + 2);
    const known = defaultById.get(id);
    if (known === undefined) {
      issues.push({
        roleId: id,
        message: `unknown role: ${id}`,
        line: trimmed,
      });
      continue;
    }
    if (seen.has(id)) {
      issues.push({
        roleId: id,
        message: `duplicate role: ${id}`,
        line: trimmed,
      });
      continue;
    }
    const lanes: SheetLane[] = [];
    for (const rawLane of splitLanes(rawValue)) {
      let candidate = rawLane;
      try {
        parseDescriptorText(rawLane);
      } catch (error) {
        issues.push({
          roleId: id,
          message: error instanceof Error ? error.message : String(error),
          line: trimmed,
        });
        continue;
      }
      const migrated = migrateDescriptorText(catalog, rawLane);
      if (migrated.migratedFrom !== null) {
        migrations.push({
          original: migrated.migratedFrom,
          migrated: migrated.descriptor,
        });
        candidate = migrated.descriptor;
      }
      try {
        lanes.push({ raw: candidate, bound: bindDescriptor(catalog, candidate) });
      } catch (error) {
        issues.push({
          roleId: id,
          message: error instanceof Error ? error.message : String(error),
          line: trimmed,
        });
      }
    }
    if (known.kind === "scalar" && lanes.length !== 1 && issues.length === 0) {
      issues.push({
        roleId: id,
        message: `scalar role ${id} must have exactly one descriptor`,
        line: trimmed,
      });
    }
    if (known.kind === "panel" && lanes.length === 0) {
      issues.push({
        roleId: id,
        message: `panel role ${id} must have at least one lane`,
        line: trimmed,
      });
    }
    seen.set(id, { id, kind: known.kind, lanes });
  }

  const roles: SheetRole[] = [];
  for (const role of defaults.roles) {
    const loaded = seen.get(role.id);
    if (loaded === undefined) {
      issues.push({
        roleId: role.id,
        message: `missing documented role: ${role.id}`,
        line: null,
      });
      continue;
    }
    roles.push(loaded);
  }

  if (issues.length > 0) {
    return { sheet: null, issues };
  }
  return {
    sheet: { preamble: preamble.length > 0 ? preamble : [...defaults.preamble], roles, migrations },
    issues,
  };
}

export function uniqueOfferingDescriptors(sheet: ParsedSheet): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const role of sheet.roles) {
    for (const lane of role.lanes) {
      if (lane.bound.kind !== "offering") continue;
      if (seen.has(lane.raw)) continue;
      seen.add(lane.raw);
      unique.push(lane.raw);
    }
  }
  return unique;
}

export function replaceRoleLanes(
  roles: readonly RoleDefault[],
  roleId: string,
  descriptors: readonly string[],
  catalog: ModelCatalog
): RoleDefault[] {
  const index = roles.findIndex((role) => role.id === roleId);
  if (index < 0) {
    throw new Error(`unknown role: ${roleId}`);
  }
  const role = roles[index];
  if (role.kind === "scalar" && descriptors.length !== 1) {
    throw new Error(`scalar role ${roleId} must have exactly one descriptor`);
  }
  if (role.kind === "panel" && descriptors.length === 0) {
    throw new Error(`panel role ${roleId} must have at least one lane`);
  }
  for (const descriptor of descriptors) {
    bindDescriptor(catalog, descriptor);
  }
  const next = [...roles];
  next[index] = { ...role, descriptors: [...descriptors] };
  return next;
}

export function replacePanelLane(
  roles: readonly RoleDefault[],
  roleId: string,
  laneIndex: number,
  descriptor: string,
  catalog: ModelCatalog
): RoleDefault[] {
  const role = roles.find((entry) => entry.id === roleId);
  if (role === undefined) {
    throw new Error(`unknown role: ${roleId}`);
  }
  if (role.kind !== "panel") {
    throw new Error(`${roleId} is not a panel role`);
  }
  if (laneIndex < 0 || laneIndex >= role.descriptors.length) {
    throw new Error(`${roleId} has no lane ${laneIndex + 1}`);
  }
  bindDescriptor(catalog, descriptor);
  const descriptors = [...role.descriptors];
  descriptors[laneIndex] = descriptor;
  return replaceRoleLanes(roles, roleId, descriptors, catalog);
}

export function parseLaneEdit(input: string): {
  readonly roleId: string;
  readonly laneIndex: number | null;
} {
  const match = /^(.*)\[(\d+)\]$/.exec(input.trim());
  if (match === null) {
    return { roleId: input.trim(), laneIndex: null };
  }
  const laneNumber = Number(match[2]);
  if (!Number.isInteger(laneNumber) || laneNumber < 1) {
    throw new Error(`panel lane index must be a 1-based integer: ${input}`);
  }
  return { roleId: match[1].trim(), laneIndex: laneNumber - 1 };
}

export function renderSheet(roles: RoleDefaults): string {
  const lines = [...roles.preamble, ""];
  for (const role of roles.roles) {
    lines.push(`${role.id}: ${role.descriptors.join(", ")}`);
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function descriptorsOf(role: SheetRole | RoleDefault): readonly string[] {
  if ("lanes" in role) {
    return role.lanes.map((lane) => lane.raw);
  }
  return role.descriptors;
}

export function preserveVerbatim(raw: string): string {
  const parsed = parseDescriptorText(raw);
  if (parsed.alias !== null) return parsed.raw;
  return formatDescriptor(
    parsed.provider as NonNullable<typeof parsed.provider>,
    parsed.selector as NonNullable<typeof parsed.selector>,
    parsed.effort as NonNullable<typeof parsed.effort>
  );
}

export function firstRunSheet(
  catalog: ModelCatalog = loadModelCatalog(),
  defaults: RoleDefaults = loadRoleDefaults(catalog)
): string {
  return renderSheet(defaults);
}
