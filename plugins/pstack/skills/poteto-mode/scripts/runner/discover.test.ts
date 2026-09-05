import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadModelCatalog } from "./catalog.ts";
import {
  claudeEntriesFromInitialize,
  codexEntriesFromModelList,
  discover,
  discoverProvider,
  parseCursorModelsListing,
  parseGrokModelsListing,
  type DiscoverOptions,
} from "./discover.ts";
import type { Provider } from "./types.ts";

const catalog = loadModelCatalog();
const FIXED_NOW = () => new Date("2026-09-05T00:00:00.000Z");

const CODEX_PAGE_1 = [
  {
    id: "gpt-5.6-sol",
    model: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "medium", description: "Medium" },
      { reasoningEffort: "high", description: "High" },
      { reasoningEffort: "xhigh", description: "Extra high" },
      { reasoningEffort: "max", description: "Max" },
      { reasoningEffort: "ultra", description: "Ultra" },
    ],
  },
  {
    id: "gpt-5.4-mini",
    model: "gpt-mini",
    displayName: "GPT Mini",
    hidden: true,
    isDefault: false,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Low" }],
    upgrade: "gpt-5.6-sol",
  },
];

const CODEX_PAGE_2 = [
  {
    id: "gpt-6-astra",
    model: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
  },
  {
    id: "no-efforts-model",
    model: "no-efforts-model",
    displayName: "No Efforts",
    hidden: false,
    isDefault: false,
  },
];

const CLAUDE_MODELS = [
  {
    value: "fable",
    displayName: "Fable",
    description: "Fable rolling alias",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    resolvedModel: "claude-fable-5-1",
  },
  {
    value: "opus",
    displayName: "Opus",
    description: "Opus rolling alias",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    resolvedModel: "claude-opus-4-6",
  },
  {
    value: "claude-fable-5-1[1m]",
    displayName: "Fable 5.1 1m",
    description: "1m context",
    supportedEffortLevels: ["low", "max"],
    resolvedModel: "claude-fable-5-1",
  },
  {
    value: "mystery",
    displayName: "Mystery",
    description: "No efforts advertised",
  },
];

const CURSOR_LISTING = `Available models

cursor-grok-4.6-xhigh - Cursor Grok 4.6 Extra High
claude-fable-5-1-max - Claude Fable 5.1 Max
claude-fable-5-1-turbo - Claude Fable 5.1 Turbo
auto - Auto`;

const GROK_LISTING = `You are logged in with grok.com.
Available models:
  * grok-4.6 (default)
  * grok-4.5`;

let scratch = "";
let bin = "";
let previousPath: string | undefined;

function install(name: string, source: string): string {
  const path = join(bin, name);
  writeFileSync(path, source);
  chmodSync(path, 0o755);
  return path;
}

function opts(providers: readonly Provider[], extra: Partial<DiscoverOptions> = {}): DiscoverOptions {
  return {
    providers,
    catalog,
    cwd: scratch,
    clientVersion: "test",
    now: FIXED_NOW,
    ...extra,
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function methodsFrom(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const CODEX_HAPPY = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
const logPath = process.env.FAKE_METHOD_LOG;
const page1 = ${JSON.stringify(CODEX_PAGE_1)};
const page2 = ${JSON.stringify(CODEX_PAGE_2)};
let lists = 0;
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (line.trim().length === 0) continue;
  const msg = JSON.parse(line);
  if (typeof msg.method === "string" && logPath) appendFileSync(logPath, msg.method + "\\n");
  if (msg.method === "initialize") {
    console.log(JSON.stringify({ id: msg.id, result: {} }));
    continue;
  }
  if (msg.method === "initialized") continue;
  if (msg.method === "model/list") {
    lists += 1;
    const data = lists === 1 ? page1 : page2;
    const nextCursor = lists === 1 ? "page-2" : null;
    console.log(JSON.stringify({ id: msg.id, result: { data, nextCursor } }));
  }
}
`;

const CLAUDE_HAPPY = `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const logPath = process.env.FAKE_CLAUDE_LOG;
const models = ${JSON.stringify(CLAUDE_MODELS)};
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (logPath) appendFileSync(logPath, line + "\\n");
  const msg = JSON.parse(line);
  if (msg.type === "control_request" && msg.request?.subtype === "initialize") {
    console.log(JSON.stringify({ type: "system", subtype: "init" }));
    console.log(JSON.stringify({
      type: "control_response",
      response: {
        request_id: msg.request_id,
        subtype: "success",
        response: { models },
      },
    }));
  }
}
`;

const CURSOR_HAPPY = `#!/usr/bin/env bun
console.log(${JSON.stringify(CURSOR_LISTING)});
process.exit(0);
`;

const GROK_HAPPY = `#!/usr/bin/env bun
console.log(${JSON.stringify(GROK_LISTING)});
process.exit(0);
`;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-discover-"));
  bin = join(scratch, "bin");
  mkdirSync(bin);
  previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  delete process.env.FAKE_METHOD_LOG;
  delete process.env.FAKE_CLAUDE_LOG;
  delete process.env.FAKE_PID_PATH;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.FAKE_METHOD_LOG;
  delete process.env.FAKE_CLAUDE_LOG;
  delete process.env.FAKE_PID_PATH;
  rmSync(scratch, { recursive: true, force: true });
});

describe("parseCursorModelsListing", () => {
  it("parses composed ids and skips headers", () => {
    const listing = parseCursorModelsListing(CURSOR_LISTING);
    expect(listing).toEqual([
      { id: "cursor-grok-4.6-xhigh", displayName: "Cursor Grok 4.6 Extra High" },
      { id: "claude-fable-5-1-max", displayName: "Claude Fable 5.1 Max" },
      { id: "claude-fable-5-1-turbo", displayName: "Claude Fable 5.1 Turbo" },
      { id: "auto", displayName: "Auto" },
    ]);
  });
});

describe("parseGrokModelsListing", () => {
  it("parses starred ids and the default marker", () => {
    expect(parseGrokModelsListing(GROK_LISTING)).toEqual([
      { id: "grok-4.6", isDefault: true },
      { id: "grok-4.5", isDefault: false },
    ]);
  });
});

describe("codexEntriesFromModelList", () => {
  it("preserves fields, effort order, upgrade variants, and membership", () => {
    const entries = codexEntriesFromModelList([...CODEX_PAGE_1, ...CODEX_PAGE_2], catalog);
    const sol = entries.find((entry) => entry.providerId === "gpt-5.6-sol");
    expect(sol?.displayName).toBe("GPT-5.6 Sol");
    expect(sol?.hidden).toBe(false);
    expect(sol?.isDefault).toBe(true);
    expect(sol?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(sol?.defaultEffort).toBe("medium");
    expect(sol?.membership?.offeringId).toBe("codex-gpt-5-6-sol");
    expect(sol?.variants).toEqual([]);

    const upgraded = entries.find((entry) => entry.providerId === "gpt-5.4-mini");
    expect(upgraded?.variants).toEqual(["gpt-mini", "upgrade:gpt-5.6-sol"]);
    expect(upgraded?.hidden).toBe(true);

    const astra = entries.find((entry) => entry.providerId === "gpt-6-astra");
    expect(astra?.membership?.offeringId).toBe("codex-gpt-6-astra");
    expect(astra?.membership?.supportedEfforts).toContain("ultra");

    const bare = entries.find((entry) => entry.providerId === "no-efforts-model");
    expect(bare?.supportedEfforts).toBeNull();
    expect(bare?.defaultEffort).toBeNull();
  });

  it("tolerates missing fields and rejects non-object rows", () => {
    const [entry] = codexEntriesFromModelList([{ id: "only-id" }], catalog);
    expect(entry?.displayName).toBeNull();
    expect(entry?.supportedEfforts).toBeNull();
    expect(entry?.defaultEffort).toBeNull();
    expect(entry?.hidden).toBeNull();
    expect(entry?.isDefault).toBeNull();
    expect(() => codexEntriesFromModelList(["nope"], catalog)).toThrow(/not an object/);
  });
});

describe("claudeEntriesFromInitialize", () => {
  it("preserves advertised fields and membership", () => {
    const entries = claudeEntriesFromInitialize(CLAUDE_MODELS, catalog);
    const fable = entries.find((entry) => entry.providerId === "fable");
    expect(fable?.displayName).toBe("Fable");
    expect(fable?.description).toBe("Fable rolling alias");
    expect(fable?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(fable?.resolution).toEqual({ resolvedModel: "claude-fable-5-1" });
    expect(fable?.membership?.offeringId).toBe("claude-fable");
    expect(entries.find((entry) => entry.providerId === "opus")?.membership?.offeringId).toBe(
      "claude-opus"
    );
    expect(entries.find((entry) => entry.providerId === "claude-fable-5-1[1m]")?.providerId).toBe(
      "claude-fable-5-1[1m]"
    );
    expect(entries.find((entry) => entry.providerId === "mystery")?.supportedEfforts).toBeNull();
  });

  it("rejects non-object rows", () => {
    expect(() => claudeEntriesFromInitialize([null], catalog)).toThrow(/not an object/);
  });
});

describe("discoverProvider codex", () => {
  it("pages model/list, preserves rows, and sends no thread or turn methods", async () => {
    const methodLog = join(scratch, "codex-methods.log");
    process.env.FAKE_METHOD_LOG = methodLog;
    install("codex", CODEX_HAPPY);
    const result = await discoverProvider("codex", opts(["codex"]));
    expect(result.status).toBe("ok");
    expect(result.source.method).toBe("codex app-server model/list");
    const sol = result.entries.find((entry) => entry.providerId === "gpt-5.6-sol");
    expect(sol?.displayName).toBe("GPT-5.6 Sol");
    expect(sol?.hidden).toBe(false);
    expect(sol?.isDefault).toBe(true);
    expect(sol?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(sol?.membership?.offeringId).toBe("codex-gpt-5-6-sol");
    expect(result.entries.find((entry) => entry.providerId === "gpt-5.4-mini")?.variants).toEqual([
      "gpt-mini",
      "upgrade:gpt-5.6-sol",
    ]);
    expect(
      result.entries.find((entry) => entry.providerId === "gpt-6-astra")?.membership?.offeringId
    ).toBe("codex-gpt-6-astra");
    const bare = result.entries.find((entry) => entry.providerId === "no-efforts-model");
    expect(bare?.supportedEfforts).toBeNull();
    expect(bare?.defaultEffort).toBeNull();
    const methods = methodsFrom(methodLog);
    expect(methods).toEqual(["initialize", "initialized", "model/list", "model/list"]);
    expect(methods.some((method) => /thread|turn/.test(method))).toBe(false);
  });

  it("marks JSON-RPC errors as failed with the error message", async () => {
    install(
      "codex",
      `#!/usr/bin/env bun
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    console.log(JSON.stringify({ id: msg.id, result: {} }));
    continue;
  }
  if (msg.method === "model/list") {
    console.log(JSON.stringify({ id: msg.id, error: { code: -32000, message: "model list exploded" } }));
  }
}
`
    );
    const result = await discoverProvider("codex", opts(["codex"]));
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("model list exploded");
    expect(result.entries).toEqual([]);
  });

  it("marks a failed login preflight as unauthenticated", async () => {
    install(
      "codex",
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "login") {
  console.error("Not logged in");
  process.exit(1);
}
await Bun.sleep(30_000);
`
    );
    const result = await discoverProvider("codex", opts(["codex"]));
    expect(result.status).toBe("unauthenticated");
    expect(result.error?.evidence).toMatch(/Not logged in/);
  });

  it("marks a missing executable as unavailable-cli", async () => {
    const result = await discoverProvider("codex", opts(["codex"]));
    expect(result).toMatchObject({
      status: "unavailable-cli",
      executable: null,
      error: { message: "codex executable not found", evidence: "" },
      entries: [],
    });
  });
});

describe("discoverProvider claude", () => {
  it("parses initialize control_response and sends no user message", async () => {
    const logPath = join(scratch, "claude-stdin.log");
    process.env.FAKE_CLAUDE_LOG = logPath;
    install("claude", CLAUDE_HAPPY);
    const result = await discoverProvider("claude", opts(["claude"]));
    expect(result.status).toBe("ok");
    expect(result.source.method).toBe("claude initialize control request");
    const fable = result.entries.find((entry) => entry.providerId === "fable");
    expect(fable?.displayName).toBe("Fable");
    expect(fable?.description).toBe("Fable rolling alias");
    expect(fable?.supportedEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(fable?.resolution).toEqual({ resolvedModel: "claude-fable-5-1" });
    expect(fable?.membership?.offeringId).toBe("claude-fable");
    expect(result.entries.find((entry) => entry.providerId === "opus")?.membership?.offeringId).toBe(
      "claude-opus"
    );
    expect(result.entries.find((entry) => entry.providerId === "claude-fable-5-1[1m]")?.providerId).toBe(
      "claude-fable-5-1[1m]"
    );
    expect(result.entries.find((entry) => entry.providerId === "mystery")?.supportedEfforts).toBeNull();
    const received = methodsFrom(logPath).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "control_request",
      request_id: "pstack-models-init",
      request: { subtype: "initialize" },
    });
    expect(received.some((row) => row.type === "user")).toBe(false);
  });

  it("marks loggedIn false as unauthenticated", async () => {
    install(
      "claude",
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: false }));
  process.exit(0);
}
await Bun.sleep(30_000);
`
    );
    const result = await discoverProvider("claude", opts(["claude"]));
    expect(result.status).toBe("unauthenticated");
  });

  it("marks control_response subtype error as failed", async () => {
    install(
      "claude",
      `#!/usr/bin/env bun
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  const msg = JSON.parse(line);
  if (msg.type === "control_request") {
    console.log(JSON.stringify({
      type: "control_response",
      response: {
        request_id: msg.request_id,
        subtype: "error",
        error: "initialize failed",
      },
    }));
  }
}
`
    );
    const result = await discoverProvider("claude", opts(["claude"]));
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("initialize failed");
  });
});

describe("discoverProvider cursor", () => {
  it("groups listing ids and reports an unrecognized suffix as unsupported", async () => {
    install("cursor-agent", CURSOR_HAPPY);
    const result = await discoverProvider("cursor", opts(["cursor"]));
    expect(result.status).toBe("ok");
    expect(result.source.method).toBe("cursor-agent models");
    const grok = result.entries.find((entry) => entry.providerId === "cursor-grok-4.6");
    expect(grok?.membership?.offeringId).toBe("cursor-grok-4-6");
    const turbo = result.entries.find((entry) => entry.providerId === "claude-fable-5-1-turbo");
    expect(turbo?.descriptor.supported).toBe(false);
    expect(turbo?.membership).toBeNull();
  });

  it("marks a Not logged in listing as unauthenticated", async () => {
    install(
      "cursor-agent",
      `#!/usr/bin/env bun
console.error("Not logged in");
process.exit(1);
`
    );
    const result = await discoverProvider("cursor", opts(["cursor"]));
    expect(result.status).toBe("unauthenticated");
  });
});

describe("discoverProvider grok", () => {
  it("parses starred models with isDefault and membership", async () => {
    install("grok", GROK_HAPPY);
    const result = await discoverProvider("grok", opts(["grok"]));
    expect(result.status).toBe("ok");
    expect(result.source.method).toBe("grok models");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      providerId: "grok-4.6",
      isDefault: true,
      supportedEfforts: null,
      membership: { offeringId: "grok-grok-4-6" },
    });
    expect(result.entries[1]).toMatchObject({
      providerId: "grok-4.5",
      isDefault: false,
      supportedEfforts: null,
      membership: null,
    });
  });

  it("marks Not logged in as unauthenticated", async () => {
    install(
      "grok",
      `#!/usr/bin/env bun
console.error("Not logged in");
process.exit(1);
`
    );
    const result = await discoverProvider("grok", opts(["grok"]));
    expect(result.status).toBe("unauthenticated");
  });
});

describe("discover", () => {
  it("keeps successful entries when one provider is missing", async () => {
    install("codex", CODEX_HAPPY);
    install("claude", CLAUDE_HAPPY);
    install("cursor-agent", CURSOR_HAPPY);
    const result = await discover(opts(["claude", "codex", "cursor", "grok"]));
    expect(result.complete).toBe(false);
    expect(result.providers.map((item) => item.provider)).toEqual([
      "claude",
      "codex",
      "cursor",
      "grok",
    ]);
    expect(result.providers.find((item) => item.provider === "grok")?.status).toBe(
      "unavailable-cli"
    );
    expect(result.providers.find((item) => item.provider === "claude")?.status).toBe("ok");
    expect(result.providers.find((item) => item.provider === "codex")?.status).toBe("ok");
    expect(result.providers.find((item) => item.provider === "cursor")?.status).toBe("ok");
    expect(
      result.providers.find((item) => item.provider === "claude")?.entries.length
    ).toBeGreaterThan(0);
    expect(
      result.providers.find((item) => item.provider === "codex")?.entries.length
    ).toBeGreaterThan(0);
    expect(
      result.providers.find((item) => item.provider === "cursor")?.entries.length
    ).toBeGreaterThan(0);
  });

  it("sets complete when every requested provider is ok", async () => {
    install("codex", CODEX_HAPPY);
    install("claude", CLAUDE_HAPPY);
    install("cursor-agent", CURSOR_HAPPY);
    install("grok", GROK_HAPPY);
    const result = await discover(opts(["claude", "codex", "cursor", "grok"]));
    expect(result.complete).toBe(true);
    expect(result.providers.every((item) => item.status === "ok")).toBe(true);
  });
});

describe("discover timeout", () => {
  it("fails with explicit deadline elapsed and terminates the child", async () => {
    const pidPath = join(scratch, "app-server.pid");
    process.env.FAKE_PID_PATH = pidPath;
    install(
      "codex",
      `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
writeFileSync(process.env.FAKE_PID_PATH, String(process.pid));
await Bun.sleep(30_000);
`
    );
    const result = await discoverProvider("codex", opts(["codex"], { timeoutMs: 400 }));
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("explicit deadline elapsed");
    expect(result.error?.evidence).toContain("explicit deadline elapsed");
    expect(existsSync(pidPath)).toBe(true);
    const pid = Number(readFileSync(pidPath, "utf8"));
    expect(Number.isInteger(pid)).toBe(true);
    expect(processIsAlive(pid)).toBe(false);
  });
});
