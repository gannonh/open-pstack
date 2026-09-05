import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import {
  PLUGIN_ROOT,
  SELECTOR_COMPOSITIONS,
  SELECTOR_RE,
  descriptorStem,
  formatDescriptor,
  offeringById,
  offeringLabel,
  parseRoleDefaults,
  proposeNativeAgentStem,
  type ModelCatalog,
  type ModelOffering,
  type SelectorComposition,
} from "./catalog.ts";
import {
  findInventoryEntry,
  parseInventory,
  renderInventory,
  type Inventory,
} from "./inventory.ts";
import { PROVIDERS, type Provider } from "./types.ts";
import {
  adapterProposal,
  agentsDirectory,
  applyProposal,
  catalogFilePath,
  completeOffering,
  isEffortList,
  proposeAdd,
  proposeEdit,
  proposeFromInventory,
  proposeRemove,
  readCatalogFile,
  roleDefaultsFilePath,
  validateTree,
  type OfferingInput,
  type Proposal,
} from "./catalog-edit.ts";

export type Io = {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly isTTY: () => boolean;
  readonly prompt: (question: string) => Promise<string>;
  readonly pluginRoot: string;
};

type ReceiptObservation = {
  readonly provider: Provider;
  readonly model: string;
  readonly reportedModel: string;
  readonly completedAt: string;
};

class CliFailure extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

const PROVIDER_HELP = "claude|codex|cursor|grok";

export async function main(
  argv: readonly string[],
  io: Io = defaultIo()
): Promise<number> {
  const state = { exitCode: 0 };
  const program = buildProgram(io, state);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CliFailure) {
      if (error.message.length > 0) io.stderr(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 64;
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message}\n`);
    return 1;
  }
}

function defaultIo(): Io {
  return {
    stdout: (value) => {
      process.stdout.write(value);
    },
    stderr: (value) => {
      process.stderr.write(value);
    },
    isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompt: defaultPrompt,
    pluginRoot: PLUGIN_ROOT,
  };
}

async function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function buildProgram(io: Io, state: { exitCode: number }): Command {
  const program = new Command("pstack-models")
    .description(
      "Discover provider models and manage shared pstack catalog membership."
    )
    .exitOverride()
    .configureOutput({
      writeOut: (value) => io.stdout(value),
      writeErr: (value) => io.stderr(value),
    });

  program.action(() => {
    io.stderr(program.helpInformation());
    state.exitCode = 64;
  });

  program
    .command("discover")
    .description("List models advertised by provider CLIs without changing the catalog.")
    .option(
      `--provider <${PROVIDER_HELP}>`,
      "limit to a provider; repeatable",
      collectProvider
    )
    .option("--json", "print inventory JSON")
    .option("--output <file>", "write inventory JSON to a new file")
    .option("--timeout <seconds>", "end-to-end deadline; default none", parsePositiveNumber)
    .action(async (opts: {
      provider?: Provider[];
      json?: boolean;
      output?: string;
      timeout?: number;
    }) => {
      const selected = opts.provider ?? [];
      const requested = selected.length === 0 ? [...PROVIDERS] : uniqueProviders(selected);
      const { discover: runDiscover } = await import("./discover.ts");
      const catalog = readCatalogFile(catalogFilePath(io.pluginRoot)).catalog;
      const inventory = await runDiscover({
        providers: requested,
        catalog,
        env: process.env,
        cwd: process.cwd(),
        timeoutMs: opts.timeout === undefined ? null : opts.timeout * 1_000,
        clientVersion: pluginVersion(io.pluginRoot),
      });
      if (opts.output !== undefined) {
        if (existsSync(opts.output)) {
          throw new CliFailure(1, `refusing to overwrite ${opts.output}`);
        }
        writeFileSync(opts.output, `${JSON.stringify(inventory, null, 2)}\n`);
      }
      io.stdout(
        opts.json === true
          ? `${JSON.stringify(inventory, null, 2)}\n`
          : renderInventory(inventory)
      );
      state.exitCode = inventory.complete ? 0 : 3;
    });

  program
    .command("list")
    .description("Print catalog membership, copyable descriptors, and supplied evidence.")
    .option("--json", "print JSON")
    .option("--from <inventory.json>", "discovery inventory")
    .option("--receipt <runner-receipt.json>", "runner receipt with observed model", collectString)
    .action((opts: { json?: boolean; from?: string; receipt?: string[] }) => {
      const catalog = readCatalogFile(catalogFilePath(io.pluginRoot)).catalog;
      const inventory = opts.from === undefined ? null : loadInventory(opts.from);
      const receipts = (opts.receipt ?? []).map(loadReceipt);
      if (opts.json === true) {
        io.stdout(`${JSON.stringify(listPayload(catalog, inventory, receipts), null, 2)}\n`);
        return;
      }
      io.stdout(renderList(catalog, inventory, receipts));
    });

  const add = program
    .command("add")
    .description("Add a catalog offering from a provider:selector stem.")
    .argument("<provider:selector>", "provider and selector", parseProviderSelector)
    .option("--from <inventory.json>", "fill fields from a discovery inventory")
    .option("--yes", "apply without confirmation");
  addFieldOptions(add);
  add.action(
    async (
      spec: { provider: Provider; selector: string },
      opts: { from?: string; yes?: boolean }
    ) => {
      const tree = loadTree(io.pluginRoot);
      let partial: Partial<OfferingInput> = adapterProposal(spec.provider, spec.selector);
      if (opts.from !== undefined) {
        const inventory = loadInventory(opts.from);
        const entry = findInventoryEntry(inventory, spec.provider, spec.selector);
        if (entry === null) {
          throw new CliFailure(1, `${spec.provider}:${spec.selector} is not in the inventory`);
        }
        if (!entry.descriptor.supported) {
          throw new CliFailure(
            1,
            `${spec.provider}:${spec.selector} is unsupported: ${entry.descriptor.reason}`
          );
        }
        const source = inventory.providers.find((row) => row.provider === entry.provider)?.source;
        if (source === undefined) {
          throw new CliFailure(1, `inventory is missing source for ${spec.provider}`);
        }
        partial = proposeFromInventory(entry, tree.catalog, source).proposal;
      }
      Object.assign(partial, fieldPatch(add));
      partial = fillClaudeDefaults(partial);
      const completed = await completeWithPrompts(partial, io);
      const proposal = proposeAdd(tree.catalog, completed, io.pluginRoot);
      state.exitCode = await applyMutate(proposal, opts.yes === true, io);
    }
  );

  const edit = program
    .command("edit")
    .description("Patch a catalog offering by id.")
    .argument("<offering-id>", "catalog offering id")
    .option("--yes", "apply without confirmation");
  addFieldOptions(edit);
  edit.action(async (offeringId: string, opts: { yes?: boolean }) => {
    const tree = loadTree(io.pluginRoot);
    const existing = offeringById(tree.catalog, offeringId);
    if (existing === null) throw new CliFailure(1, `offering not found: ${offeringId}`);
    let patch = fieldPatch(edit);
    if (Object.keys(patch).length === 0) {
      if (!io.isTTY()) {
        throw new CliFailure(1, "edit requires a field flag without a TTY");
      }
      patch = await promptAllFields(existing, io);
    }
    const proposal = proposeEdit(tree.catalog, offeringId, patch, io.pluginRoot);
    state.exitCode = await applyMutate(proposal, opts.yes === true, io);
  });

  program
    .command("remove")
    .description("Remove a catalog offering that nothing references.")
    .argument("<offering-id>", "catalog offering id")
    .option("--yes", "apply without confirmation")
    .action(async (offeringId: string, opts: { yes?: boolean }) => {
      const tree = loadTree(io.pluginRoot);
      const proposal = proposeRemove(
        tree.catalog,
        offeringId,
        tree.roles,
        io.pluginRoot
      );
      state.exitCode = await applyMutate(proposal, opts.yes === true, io);
    });

  program
    .command("validate")
    .description("Check catalog, role defaults, canonical JSON, and generated agents.")
    .option("--json", "print { ok, problems }")
    .action((opts: { json?: boolean }) => {
      const result = validateTree(io.pluginRoot);
      if (opts.json === true) {
        io.stdout(`${JSON.stringify({ ok: result.ok, problems: result.problems }, null, 2)}\n`);
      } else if (result.ok) {
        io.stdout("ok\n");
      } else {
        for (const problem of result.problems) io.stderr(`${problem}\n`);
      }
      state.exitCode = result.ok ? 0 : 1;
    });

  return program;
}

function addFieldOptions(command: Command): void {
  command
    .option("--id <slug>", "offering id")
    .option("--family <slug>", "family slug")
    .option("--display-name <text>", "display name")
    .option("--efforts <a,b,c>", "supported efforts in catalog order")
    .option("--default-effort <effort>", "default effort")
    .addOption(
      new Option("--composition <effort-flag|effort-suffix>", "selector composition").choices(
        [...SELECTOR_COMPOSITIONS]
      )
    )
    .option("--native-agent-stem <stem>", "Claude native agent stem")
    .option("--native-agent-title <text>", "Claude native agent title")
    .addOption(new Option("--rolling-alias", "mark as a rolling alias"))
    .addOption(new Option("--no-rolling-alias", "do not mark as a rolling alias"))
    .addOption(new Option("--deprecated", "mark as deprecated"))
    .addOption(new Option("--no-deprecated", "do not mark as deprecated"))
    .option(
      "--successor <offering-id>",
      "successor offering id; pass null to clear"
    )
    .option("--notes <text>", "notes");
}

function fieldPatch(command: Command): Partial<OfferingInput> {
  const opts = command.opts<{
    id?: string;
    family?: string;
    displayName?: string;
    efforts?: string;
    defaultEffort?: string;
    composition?: SelectorComposition;
    nativeAgentStem?: string;
    nativeAgentTitle?: string;
    rollingAlias?: boolean;
    deprecated?: boolean;
    successor?: string;
    notes?: string;
  }>();
  const patch: Partial<OfferingInput> = {};
  if (command.getOptionValueSource("id") === "cli") patch.id = opts.id;
  if (command.getOptionValueSource("family") === "cli") patch.family = opts.family;
  if (command.getOptionValueSource("displayName") === "cli") patch.displayName = opts.displayName;
  if (command.getOptionValueSource("efforts") === "cli") {
    const efforts = isEffortList(opts.efforts ?? "");
    if (efforts === null) {
      throw new CliFailure(1, "efforts must be a comma-separated list of identifiers");
    }
    patch.supportedEfforts = efforts;
  }
  if (command.getOptionValueSource("defaultEffort") === "cli") patch.defaultEffort = opts.defaultEffort;
  if (command.getOptionValueSource("composition") === "cli") {
    patch.selectorComposition = opts.composition;
  }
  if (command.getOptionValueSource("nativeAgentStem") === "cli") {
    patch.nativeAgentStem = opts.nativeAgentStem ?? null;
  }
  if (command.getOptionValueSource("nativeAgentTitle") === "cli") {
    patch.nativeAgentTitle = opts.nativeAgentTitle ?? null;
  }
  if (command.getOptionValueSource("rollingAlias") === "cli") {
    patch.rollingAlias = Boolean(opts.rollingAlias);
  }
  if (command.getOptionValueSource("deprecated") === "cli") {
    patch.deprecated = Boolean(opts.deprecated);
  }
  if (command.getOptionValueSource("successor") === "cli") {
    const successor = opts.successor;
    patch.successorId =
      successor === undefined || successor === "null" ? null : successor;
  }
  if (
    command.getOptionValueSource("deprecated") === "cli" &&
    patch.deprecated === false
  ) {
    patch.successorId = null;
  }
  if (command.getOptionValueSource("notes") === "cli") patch.notes = opts.notes ?? null;
  return patch;
}

async function completeWithPrompts(
  partial: Partial<OfferingInput>,
  io: Io
): Promise<OfferingInput> {
  let completed = completeOffering(partial);
  if ("offering" in completed) return completed.offering;
  if (!io.isTTY()) {
    throw new CliFailure(1, `missing required fields: ${completed.missing.join(", ")}`);
  }
  const next: Partial<OfferingInput> = { ...partial };
  for (const key of completed.missing) {
    if (key === "nativeAgentStem" || key === "nativeAgentTitle") continue;
    const answer = (await io.prompt(`${key}: `)).trim();
    if (answer.length === 0) continue;
    assignField(next, key, answer);
  }
  const filled = fillClaudeDefaults(next);
  completed = completeOffering(filled);
  if ("missing" in completed) {
    throw new CliFailure(1, `missing required fields: ${completed.missing.join(", ")}`);
  }
  return completed.offering;
}

function fillClaudeDefaults(partial: Partial<OfferingInput>): Partial<OfferingInput> {
  if (partial.provider !== "claude") return partial;
  const next = { ...partial };
  if (next.nativeAgentStem === undefined && typeof next.selector === "string") {
    next.nativeAgentStem = proposeNativeAgentStem(next.selector);
  }
  if (next.nativeAgentTitle === undefined && typeof next.displayName === "string") {
    next.nativeAgentTitle = `pstack ${next.displayName} lane`;
  }
  return next;
}

function assignField(target: Partial<OfferingInput>, key: string, value: string): void {
  switch (key) {
    case "id":
    case "family":
    case "displayName":
    case "selector":
    case "defaultEffort":
    case "nativeAgentStem":
    case "nativeAgentTitle":
      (target as Record<string, unknown>)[key] = value;
      return;
    case "supportedEfforts": {
      const efforts = isEffortList(value);
      if (efforts === null) {
        throw new CliFailure(1, "efforts must be a comma-separated list of identifiers");
      }
      target.supportedEfforts = efforts;
      return;
    }
    case "selectorComposition":
      if (!(SELECTOR_COMPOSITIONS as readonly string[]).includes(value)) {
        throw new CliFailure(1, `composition must be one of: ${SELECTOR_COMPOSITIONS.join(", ")}`);
      }
      target.selectorComposition = value as SelectorComposition;
      return;
    default:
      (target as Record<string, unknown>)[key] = value;
  }
}

async function promptAllFields(
  current: ModelOffering,
  io: Io
): Promise<Partial<OfferingInput>> {
  const patch: Partial<OfferingInput> = {};
  const ask = async (label: string, currentValue: string): Promise<string> =>
    (await io.prompt(`${label} [${currentValue}]: `)).trim();
  const id = await ask("id", current.id);
  if (id.length > 0) patch.id = id;
  const family = await ask("family", current.family);
  if (family.length > 0) patch.family = family;
  const displayName = await ask("display name", current.displayName);
  if (displayName.length > 0) patch.displayName = displayName;
  const composition = await ask("composition", current.selectorComposition);
  if (composition.length > 0) {
    if (!(SELECTOR_COMPOSITIONS as readonly string[]).includes(composition)) {
      throw new CliFailure(1, `composition must be one of: ${SELECTOR_COMPOSITIONS.join(", ")}`);
    }
    patch.selectorComposition = composition as SelectorComposition;
  }
  const efforts = await ask("efforts", current.supportedEfforts.join(","));
  if (efforts.length > 0) {
    const parsed = isEffortList(efforts);
    if (parsed === null) {
      throw new CliFailure(1, "efforts must be a comma-separated list of identifiers");
    }
    patch.supportedEfforts = parsed;
  }
  const defaultEffort = await ask("default effort", current.defaultEffort);
  if (defaultEffort.length > 0) patch.defaultEffort = defaultEffort;
  const stem = await ask("native agent stem", current.nativeAgentStem ?? "null");
  if (stem.length > 0) patch.nativeAgentStem = stem === "null" ? null : stem;
  const title = await ask("native agent title", current.nativeAgentTitle ?? "null");
  if (title.length > 0) patch.nativeAgentTitle = title === "null" ? null : title;
  const rolling = await ask("rolling alias", String(current.rollingAlias));
  if (rolling.length > 0) patch.rollingAlias = parseBool(rolling);
  const deprecated = await ask("deprecated", String(current.deprecated));
  if (deprecated.length > 0) patch.deprecated = parseBool(deprecated);
  const successor = await ask("successor", current.successorId ?? "null");
  if (successor.length > 0) patch.successorId = successor === "null" ? null : successor;
  const notes = await ask("notes", current.notes ?? "null");
  if (notes.length > 0) patch.notes = notes === "null" ? null : notes;
  return patch;
}

async function applyMutate(proposal: Proposal, yes: boolean, io: Io): Promise<number> {
  if (proposal.kind === "no-op") {
    io.stdout(`${proposal.message}\n`);
    return 0;
  }
  if (proposal.kind === "rejected") {
    io.stderr(`${proposal.message}\n`);
    return 1;
  }
  io.stdout(proposal.diff);
  if (!yes) {
    if (!io.isTTY()) {
      io.stderr("refusing to write without --yes or a TTY\n");
      return 1;
    }
    const answer = (await io.prompt("Apply this change? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      io.stderr("aborted\n");
      return 1;
    }
  }
  const applied = applyProposal(proposal, {
    catalogPath: catalogFilePath(io.pluginRoot),
    agentsDir: agentsDirectory(io.pluginRoot),
  });
  if (!applied.ok) {
    io.stderr(`${applied.message}\n`);
    return 1;
  }
  return 0;
}

function renderList(
  catalog: ModelCatalog,
  inventory: Inventory | null,
  receipts: readonly ReceiptObservation[]
): string {
  const families: string[] = [];
  for (const offering of catalog.offerings) {
    if (!families.includes(offering.family)) families.push(offering.family);
  }
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`family: ${family}`);
    for (const offering of catalog.offerings.filter((row) => row.family === family)) {
      lines.push(`  ${offeringLabel(offering)}`);
      lines.push(`    id: ${offering.id}`);
      lines.push(`    selector: ${descriptorStem(offering)}`);
      lines.push(
        `    efforts: ${offering.supportedEfforts.join(", ")} (default ${offering.defaultEffort})`
      );
      if (offering.rollingAlias) lines.push("    rolling alias");
      if (offering.deprecated) {
        lines.push(
          offering.successorId === null
            ? "    deprecated"
            : `    deprecated; successor ${offering.successorId}`
        );
      }
      lines.push(
        `    copyable: ${offering.supportedEfforts
          .map((effort) => formatDescriptor(offering.provider, offering.selector, effort))
          .join(", ")}`
      );
      const resolution = resolutionLine(offering, inventory);
      if (resolution !== null) lines.push(`    ${resolution}`);
      for (const observation of receipts) {
        if (observation.provider !== offering.provider || observation.model !== offering.selector) {
          continue;
        }
        lines.push(
          `    observed at execution: ${observation.reportedModel} (${observation.completedAt})`
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function resolutionLine(offering: ModelOffering, inventory: Inventory | null): string | null {
  if (inventory === null) {
    return offering.rollingAlias
      ? "advertised resolution: unknown (no inventory supplied)"
      : null;
  }
  const entry = findInventoryEntry(inventory, offering.provider, offering.selector);
  const source = inventory.providers.find((row) => row.provider === offering.provider)?.source;
  if (entry === null || source === undefined) {
    return offering.rollingAlias
      ? "advertised resolution: unknown (no inventory supplied)"
      : null;
  }
  const resolved = entry.resolution?.resolvedModel ?? "unknown";
  return `advertised resolution: ${resolved} (${source.method} at ${source.at})`;
}

function listPayload(
  catalog: ModelCatalog,
  inventory: Inventory | null,
  receipts: readonly ReceiptObservation[]
): unknown {
  return {
    offerings: catalog.offerings.map((offering) => ({
      id: offering.id,
      family: offering.family,
      label: offeringLabel(offering),
      selector: descriptorStem(offering),
      supportedEfforts: offering.supportedEfforts,
      defaultEffort: offering.defaultEffort,
      rollingAlias: offering.rollingAlias,
      deprecated: offering.deprecated,
      successorId: offering.successorId,
      copyable: offering.supportedEfforts.map((effort) =>
        formatDescriptor(offering.provider, offering.selector, effort)
      ),
      advertisedResolution: resolutionLine(offering, inventory),
      observed: receipts
        .filter(
          (row) => row.provider === offering.provider && row.model === offering.selector
        )
        .map((row) => `observed at execution: ${row.reportedModel} (${row.completedAt})`),
    })),
  };
}

function loadTree(pluginRoot: string) {
  const loaded = readCatalogFile(catalogFilePath(pluginRoot));
  const roles = parseRoleDefaults(
    JSON.parse(readFileSync(roleDefaultsFilePath(pluginRoot), "utf8")),
    loaded.catalog
  );
  return { catalog: loaded.catalog, roles };
}

function loadInventory(path: string): Inventory {
  if (!existsSync(path)) throw new CliFailure(1, `inventory not found: ${path}`);
  try {
    return parseInventory(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new CliFailure(1, error instanceof Error ? error.message : String(error));
  }
}

function loadReceipt(path: string): ReceiptObservation {
  if (!existsSync(path)) throw new CliFailure(1, `receipt not found: ${path}`);
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("receipt must be an object");
    }
    const record = raw as Record<string, unknown>;
    const provider = record.provider;
    if (typeof provider !== "string" || !(PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error("receipt provider is invalid");
    }
    if (typeof record.model !== "string") throw new Error("receipt model is missing");
    if (typeof record.reportedModel !== "string") {
      throw new Error("receipt reportedModel is missing");
    }
    if (typeof record.completedAt !== "string") throw new Error("receipt completedAt is missing");
    return {
      provider: provider as Provider,
      model: record.model,
      reportedModel: record.reportedModel,
      completedAt: record.completedAt,
    };
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    throw new CliFailure(1, error instanceof Error ? error.message : String(error));
  }
}

function pluginVersion(pluginRoot: string): string {
  const raw: unknown = JSON.parse(
    readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
  );
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("plugin.json must be an object");
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("plugin.json version is missing");
  }
  return version;
}

function parseProviderSelector(value: string): { provider: Provider; selector: string } {
  const colon = value.indexOf(":");
  if (colon <= 0) {
    throw new InvalidArgumentError("expected <provider:selector>");
  }
  const provider = value.slice(0, colon);
  const selector = value.slice(colon + 1);
  if (!(PROVIDERS as readonly string[]).includes(provider)) {
    throw new InvalidArgumentError(`provider must be one of: ${PROVIDERS.join(", ")}`);
  }
  if (!SELECTOR_RE.test(selector)) {
    throw new InvalidArgumentError(`selector is invalid: ${selector}`);
  }
  return { provider: provider as Provider, selector };
}

function collectProvider(value: string, previous: Provider[] | undefined): Provider[] {
  if (!(PROVIDERS as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`must be one of: ${PROVIDER_HELP}`);
  }
  return [...(previous ?? []), value as Provider];
}

function collectString(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a number greater than zero");
  }
  return parsed;
}

function uniqueProviders(values: readonly Provider[]): Provider[] {
  const seen = new Set<Provider>();
  const out: Provider[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function parseBool(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "y" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "n" || normalized === "no") return false;
  throw new CliFailure(1, `expected true or false: ${value}`);
}
