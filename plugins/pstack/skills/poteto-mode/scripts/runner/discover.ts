import type { ModelCatalog } from "./catalog.ts";
import {
  cursorEntriesFromListing,
  membershipOf,
  supportedDescriptor,
  type CursorListing,
  type Inventory,
  type InventoryEntry,
  type InventorySource,
  type ProviderInventory,
} from "./inventory.ts";
import { AUTH_FAILURE_RE, childEnvironment, evidence } from "./run.ts";
import type { Effort, Provider } from "./types.ts";

const TERMINATE_GRACE_MS = 1_000;
// setTimeout delay is a 32-bit signed int; longer waits must be re-armed.
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const SOURCE_METHOD = {
  claude: "claude initialize control request",
  codex: "codex app-server model/list",
  cursor: "cursor-agent models",
  grok: "grok models",
} as const;

export interface DiscoverOptions {
  readonly providers: readonly Provider[];
  readonly catalog: ModelCatalog;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly timeoutMs?: number | null;
  readonly clientVersion: string;
  readonly now?: () => Date;
}

export interface LineTransport {
  writeLine(line: string): Promise<void>;
  readLine(): Promise<string | null>;
}

class DeadlineElapsedError extends Error {
  constructor() {
    super("explicit deadline elapsed");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function requireRow(value: unknown, label: string): Record<string, unknown> {
  const row = asRecord(value);
  if (row === null) throw new Error(`${label} is not an object`);
  return row;
}

function jsonErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const record = asRecord(error);
  if (record !== null && typeof record.message === "string") return record.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "error";
  }
}

export function parseCursorModelsListing(stdout: string): CursorListing[] {
  const listing: CursorListing[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\S+)\s+-\s+(.+?)\s*$/.exec(line);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    listing.push({ id: match[1], displayName: match[2] });
  }
  return listing;
}

export function parseGrokModelsListing(
  stdout: string
): { readonly id: string; readonly isDefault: boolean }[] {
  const rows: { readonly id: string; readonly isDefault: boolean }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*\*\s*(\S+)(\s*\(default\))?/.exec(line);
    if (match === null || match[1] === undefined) continue;
    rows.push({ id: match[1], isDefault: match[2] !== undefined });
  }
  return rows;
}

export function codexEntriesFromModelList(
  rows: readonly unknown[],
  catalog: ModelCatalog
): InventoryEntry[] {
  return rows.map((value, index) => {
    const row = requireRow(value, `codex model/list row ${index}`);
    if (typeof row.id !== "string") {
      throw new Error(`codex model/list row ${index} is missing id`);
    }
    const id = row.id;
    const efforts = row.supportedReasoningEfforts;
    let supportedEfforts: Effort[] | null = null;
    if (efforts !== undefined && efforts !== null) {
      if (!Array.isArray(efforts)) {
        throw new Error(`codex model/list row ${index} supportedReasoningEfforts is not an array`);
      }
      supportedEfforts = [];
      for (const item of efforts) {
        const effortRow = asRecord(item);
        if (effortRow === null) continue;
        if (typeof effortRow.reasoningEffort === "string") {
          supportedEfforts.push(effortRow.reasoningEffort);
        }
      }
    }
    const variants: string[] = [];
    if (typeof row.model === "string" && row.model !== id) variants.push(row.model);
    if (typeof row.upgrade === "string" && row.upgrade.length > 0) {
      variants.push(`upgrade:${row.upgrade}`);
    }
    return {
      provider: "codex",
      providerId: id,
      displayName: optionalString(row.displayName),
      description: null,
      supportedEfforts,
      defaultEffort: optionalString(row.defaultReasoningEffort),
      hidden: optionalBoolean(row.hidden),
      isDefault: optionalBoolean(row.isDefault),
      variants,
      resolution: null,
      descriptor: supportedDescriptor("codex", id, "effort-flag"),
      membership: membershipOf(catalog, "codex", id),
    };
  });
}

export function claudeEntriesFromInitialize(
  models: readonly unknown[],
  catalog: ModelCatalog
): InventoryEntry[] {
  return models.map((value, index) => {
    const row = requireRow(value, `claude initialize model ${index}`);
    if (typeof row.value !== "string") {
      throw new Error(`claude initialize model ${index} is missing value`);
    }
    const id = row.value;
    const levels = row.supportedEffortLevels;
    let supportedEfforts: Effort[] | null = null;
    if (levels !== undefined && levels !== null) {
      if (!Array.isArray(levels)) {
        throw new Error(`claude initialize model ${index} supportedEffortLevels is not an array`);
      }
      supportedEfforts = levels.filter((item): item is string => typeof item === "string");
    }
    const resolvedModel = optionalString(row.resolvedModel);
    return {
      provider: "claude",
      providerId: id,
      displayName: optionalString(row.displayName),
      description: optionalString(row.description),
      supportedEfforts,
      defaultEffort: null,
      hidden: null,
      isDefault: null,
      variants: [],
      resolution: resolvedModel === null ? null : { resolvedModel },
      descriptor: supportedDescriptor("claude", id, "effort-flag"),
      membership: membershipOf(catalog, "claude", id),
    };
  });
}

async function readRpcMessage(
  transport: LineTransport,
  id: number
): Promise<unknown> {
  while (true) {
    const line = await transport.readLine();
    if (line === null) throw new Error("codex app-server closed stdout before json-rpc response");
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("codex app-server emitted malformed JSON");
    }
    const record = asRecord(parsed);
    if (record === null || recId(record) !== id) continue;
    if (record.error !== undefined && record.error !== null) {
      throw new Error(jsonErrorMessage(record.error));
    }
    return record.result;
  }
}

function recId(record: Record<string, unknown>): unknown {
  return record.id;
}

export async function exchangeCodexModelList(
  transport: LineTransport,
  clientVersion: string
): Promise<unknown[]> {
  await transport.writeLine(
    JSON.stringify({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "pstack-models",
          title: "pstack models",
          version: clientVersion,
        },
      },
    })
  );
  await readRpcMessage(transport, 0);
  await transport.writeLine(JSON.stringify({ method: "initialized", params: {} }));
  const rows: unknown[] = [];
  let nextId = 1;
  let cursor: string | undefined;
  while (true) {
    const params: Record<string, unknown> = { limit: 50, includeHidden: true };
    if (cursor !== undefined) params.cursor = cursor;
    const id = nextId;
    nextId += 1;
    await transport.writeLine(JSON.stringify({ method: "model/list", id, params }));
    const result = await readRpcMessage(transport, id);
    const record = asRecord(result);
    if (record === null) throw new Error("codex model/list result is not an object");
    if (!Array.isArray(record.data)) throw new Error("codex model/list result.data is not an array");
    rows.push(...record.data);
    if (record.nextCursor === null || record.nextCursor === undefined) break;
    if (typeof record.nextCursor !== "string") {
      throw new Error("codex model/list nextCursor is not a string");
    }
    cursor = record.nextCursor;
  }
  return rows;
}

export async function exchangeClaudeInitialize(
  transport: LineTransport
): Promise<unknown[]> {
  await transport.writeLine(
    JSON.stringify({
      type: "control_request",
      request_id: "pstack-models-init",
      request: { subtype: "initialize" },
    })
  );
  while (true) {
    const line = await transport.readLine();
    if (line === null) throw new Error("missing control_response");
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("claude emitted malformed JSON");
    }
    const envelope = asRecord(parsed);
    if (envelope === null || envelope.type !== "control_response") continue;
    const response = asRecord(envelope.response);
    if (response === null || response.request_id !== "pstack-models-init") continue;
    if (response.subtype === "error") throw new Error(jsonErrorMessage(response.error));
    if (response.subtype !== "success") continue;
    const inner = asRecord(response.response);
    if (inner === null || !Array.isArray(inner.models)) {
      throw new Error("claude initialize control_response is missing models");
    }
    return inner.models;
  }
}

function cliName(provider: Provider): string {
  return provider === "cursor" ? "cursor-agent" : provider;
}

function discoveryArgs(provider: Provider): readonly string[] {
  switch (provider) {
    case "claude":
      return ["--output-format", "stream-json", "--verbose", "--input-format", "stream-json"];
    case "codex":
      return ["app-server"];
    case "cursor":
    case "grok":
      return ["models"];
  }
}

function sourceOf(
  provider: Provider,
  executable: string | null,
  at: string
): InventorySource {
  const args = discoveryArgs(provider);
  return {
    method: SOURCE_METHOD[provider],
    argv: [executable ?? cliName(provider), ...args],
    at,
  };
}

function inventory(
  provider: Provider,
  status: ProviderInventory["status"],
  executable: string | null,
  source: InventorySource,
  error: ProviderInventory["error"],
  entries: readonly InventoryEntry[] = []
): ProviderInventory {
  return { provider, status, executable, source, error, entries };
}

async function terminate(child: Bun.Subprocess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let exited = false;
  try {
    exited = await Promise.race([
      child.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        graceTimer = setTimeout(() => resolve(false), TERMINATE_GRACE_MS);
      }),
    ]);
  } finally {
    if (graceTimer !== null) clearTimeout(graceTimer);
  }
  if (!exited) {
    try {
      child.kill("SIGKILL");
    } catch {
      return;
    }
    await child.exited;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return text + decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader already released after cancel
    }
  }
}

function lineReader(stream: ReadableStream<Uint8Array>): {
  readLine(): Promise<string | null>;
  cancel(): Promise<void>;
} {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pending: string[] = [];
  let done = false;

  async function pull(): Promise<void> {
    while (pending.length === 0 && !done) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        buffer += decoder.decode();
        if (buffer.length > 0) pending.push(buffer);
        buffer = "";
        return;
      }
      buffer += decoder.decode(next.value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        pending.push(buffer.slice(0, idx).replace(/\r$/, ""));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
      }
    }
  }

  return {
    async readLine() {
      try {
        await pull();
      } catch {
        return pending.shift() ?? null;
      }
      return pending.shift() ?? null;
    },
    async cancel() {
      try {
        await reader.cancel();
      } catch {
        // stream already closed
      }
    },
  };
}

async function raceDeadline<T>(work: Promise<T>, deadlineAt: number | null): Promise<T> {
  if (deadlineAt === null) return work;
  if (Date.now() >= deadlineAt) {
    await Promise.allSettled([work]);
    throw new DeadlineElapsedError();
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        const arm = (): void => {
          const remaining = deadlineAt - Date.now();
          if (remaining <= 0) {
            reject(new DeadlineElapsedError());
            return;
          }
          timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
        };
        arm();
      }),
    ]);
  } catch (error) {
    if (Date.now() >= deadlineAt) throw new DeadlineElapsedError();
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

interface CapturedProcess {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

async function runCommand(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  deadlineAt: number | null
): Promise<CapturedProcess> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutP = readAll(child.stdout);
  const stderrP = readAll(child.stderr);
  try {
    const timedOut = await raceDeadline(
      child.exited.then(() => false),
      deadlineAt
    ).catch((error: unknown) => {
      if (error instanceof DeadlineElapsedError) return true;
      throw error;
    });
    if (timedOut === true) await terminate(child);
    const [stdout, stderr] = await Promise.all([stdoutP, stderrP]);
    return {
      exitCode: await child.exited,
      stdout,
      stderr,
      timedOut: timedOut === true || (deadlineAt !== null && Date.now() >= deadlineAt),
    };
  } catch (error) {
    await terminate(child);
    throw error;
  }
}

async function withPipedChild<T>(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  deadlineAt: number | null,
  fn: (transport: LineTransport) => Promise<T>
): Promise<T> {
  const child = Bun.spawn([executable, ...args], {
    cwd,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = lineReader(child.stdout);
  const stderrP = readAll(child.stderr);
  const stdin = child.stdin;
  if (typeof stdin !== "object" || stdin === null || !("write" in stdin)) {
    await terminate(child);
    throw new Error("child stdin pipe was not created");
  }
  const transport: LineTransport = {
    async writeLine(line: string) {
      stdin.write(`${line}\n`);
      const flushed = stdin.flush();
      if (flushed instanceof Promise) await flushed;
    },
    readLine: () => stdout.readLine(),
  };
  const work = fn(transport);
  try {
    return await raceDeadline(work, deadlineAt);
  } finally {
    try {
      await stdin.end();
    } catch {
      // already closed
    }
    await stdout.cancel();
    await terminate(child);
    await Promise.allSettled([work, stderrP]);
  }
}

function combinedOutput(result: CapturedProcess): string {
  return `${result.stdout}\n${result.stderr}`;
}

function failedPreflight(
  provider: Provider,
  executable: string,
  source: InventorySource,
  result: CapturedProcess
): ProviderInventory {
  const output = combinedOutput(result);
  return inventory(
    provider,
    "unauthenticated",
    executable,
    source,
    { message: "authentication preflight failed", evidence: evidence(output) }
  );
}

async function discoverCodex(
  executable: string,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
  deadlineAt: number | null,
  source: InventorySource
): Promise<ProviderInventory> {
  const preflight = await runCommand(executable, ["login", "status"], env, cwd, deadlineAt);
  if (preflight.timedOut) throw new DeadlineElapsedError();
  const output = combinedOutput(preflight);
  if (AUTH_FAILURE_RE.test(output) || preflight.exitCode !== 0 || !/logged in/i.test(output)) {
    return failedPreflight("codex", executable, source, preflight);
  }
  const rows = await withPipedChild(
    executable,
    ["app-server"],
    env,
    cwd,
    deadlineAt,
    (transport) => exchangeCodexModelList(transport, options.clientVersion)
  );
  return inventory(
    "codex",
    "ok",
    executable,
    source,
    null,
    codexEntriesFromModelList(rows, options.catalog)
  );
}

async function discoverClaude(
  executable: string,
  options: DiscoverOptions,
  env: NodeJS.ProcessEnv,
  cwd: string,
  deadlineAt: number | null,
  source: InventorySource
): Promise<ProviderInventory> {
  const preflight = await runCommand(
    executable,
    ["auth", "status", "--json"],
    env,
    cwd,
    deadlineAt
  );
  if (preflight.timedOut) throw new DeadlineElapsedError();
  let loggedIn = false;
  try {
    const value: unknown = JSON.parse(preflight.stdout);
    const record = asRecord(value);
    loggedIn = record !== null && record.loggedIn === true;
  } catch {
    loggedIn = false;
  }
  if (preflight.exitCode !== 0 || !loggedIn) {
    return failedPreflight("claude", executable, source, preflight);
  }
  const models = await withPipedChild(
    executable,
    discoveryArgs("claude"),
    env,
    cwd,
    deadlineAt,
    (transport) => exchangeClaudeInitialize(transport)
  );
  return inventory(
    "claude",
    "ok",
    executable,
    source,
    null,
    claudeEntriesFromInitialize(models, options.catalog)
  );
}

async function discoverListing(
  provider: "cursor" | "grok",
  executable: string,
  catalog: ModelCatalog,
  env: NodeJS.ProcessEnv,
  cwd: string,
  deadlineAt: number | null,
  source: InventorySource
): Promise<ProviderInventory> {
  const result = await runCommand(executable, ["models"], env, cwd, deadlineAt);
  if (result.timedOut) throw new DeadlineElapsedError();
  const output = combinedOutput(result);
  if (AUTH_FAILURE_RE.test(output)) {
    return failedPreflight(provider, executable, source, result);
  }
  if (provider === "grok" && !/logged in/i.test(output)) {
    return failedPreflight(provider, executable, source, result);
  }
  if (result.exitCode !== 0) {
    return inventory(provider, "failed", executable, source, {
      message: `child exited with status ${result.exitCode}`,
      evidence: evidence(output),
    });
  }
  const entries =
    provider === "cursor"
      ? cursorEntriesFromListing(parseCursorModelsListing(result.stdout), catalog)
      : parseGrokModelsListing(result.stdout).map((row) => ({
          provider: "grok" as const,
          providerId: row.id,
          displayName: null,
          description: null,
          supportedEfforts: null,
          defaultEffort: null,
          hidden: null,
          isDefault: row.isDefault,
          variants: [],
          resolution: null,
          descriptor: supportedDescriptor("grok", row.id, "effort-flag"),
          membership: membershipOf(catalog, "grok", row.id),
        }));
  return inventory(provider, "ok", executable, source, null, entries);
}

export async function discoverProvider(
  provider: Provider,
  options: DiscoverOptions
): Promise<ProviderInventory> {
  const cwd = options.cwd ?? process.cwd();
  const env = childEnvironment(provider, options.env ?? process.env);
  const at = (options.now ?? (() => new Date()))().toISOString();
  const command = cliName(provider);
  const executable = Bun.which(command, { PATH: env.PATH, cwd });
  const source = sourceOf(provider, executable, at);
  const deadlineAt = options.timeoutMs == null ? null : Date.now() + options.timeoutMs;
  if (executable === null) {
    return inventory(provider, "unavailable-cli", null, source, {
      message: `${command} executable not found`,
      evidence: "",
    });
  }
  try {
    switch (provider) {
      case "codex":
        return await discoverCodex(executable, options, env, cwd, deadlineAt, source);
      case "claude":
        return await discoverClaude(executable, options, env, cwd, deadlineAt, source);
      case "cursor":
      case "grok":
        return await discoverListing(
          provider,
          executable,
          options.catalog,
          env,
          cwd,
          deadlineAt,
          source
        );
    }
  } catch (error) {
    if (error instanceof DeadlineElapsedError) {
      return inventory(provider, "failed", executable, source, {
        message: "explicit deadline elapsed",
        evidence: "explicit deadline elapsed",
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = AUTH_FAILURE_RE.test(message) ? "unauthenticated" : "failed";
    return inventory(provider, status, executable, source, {
      message,
      evidence: evidence(message),
    });
  }
}

export async function discover(options: DiscoverOptions): Promise<Inventory> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const providers = await Promise.all(
    options.providers.map((provider) => discoverProvider(provider, options))
  );
  return {
    schemaVersion: 1,
    generatedAt,
    complete: providers.every((item) => item.status === "ok"),
    providers,
  };
}
