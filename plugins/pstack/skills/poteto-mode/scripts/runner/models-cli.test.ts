import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PLUGIN_ROOT } from "./catalog.ts";
import { membershipOf, supportedDescriptor, type Inventory } from "./inventory.ts";
import {
  agentsDirectory,
  catalogFilePath,
  readCatalogFile,
  roleDefaultsFilePath,
} from "./catalog-edit.ts";
import { main, type Io } from "./models-cli.ts";
import { copyPluginTree as copyBaseTree } from "./catalog-fixture.test-helper.ts";

let scratches: string[] = [];

afterEach(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
  scratches = [];
});

function copyPluginTree(): string {
  return copyBaseTree(scratches, "pstack-models-cli-");
}

function harness(
  pluginRoot: string = PLUGIN_ROOT,
  extra: Partial<Io> = {}
): { stdout: string[]; stderr: string[]; io: Io } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (value) => {
        stdout.push(value);
      },
      stderr: (value) => {
        stderr.push(value);
      },
      isTTY: () => false,
      prompt: async () => {
        throw new Error("unexpected prompt");
      },
      pluginRoot,
      ...extra,
    },
  };
}

function astraInventory(): Inventory {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-05T12:00:00.000Z",
    complete: true,
    providers: [
      {
        provider: "codex",
        status: "ok",
        executable: "/usr/bin/codex",
        source: {
          method: "codex app-server model/list",
          argv: ["codex", "app-server"],
          at: "2026-09-05T12:00:00.000Z",
        },
        error: null,
        entries: [
          {
            provider: "codex",
            providerId: "gpt-6-astra",
            displayName: "GPT-6 Astra",
            description: null,
            supportedEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
            defaultEffort: "medium",
            hidden: false,
            isDefault: false,
            variants: [],
            resolution: null,
            descriptor: supportedDescriptor("codex", "gpt-6-astra", "effort-flag"),
            membership: null,
          },
        ],
      },
    ],
  };
}

function fableInventory(): Inventory {
  const catalog = readCatalogFile(catalogFilePath(PLUGIN_ROOT)).catalog;
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-05T00:00:00.000Z",
    complete: true,
    providers: [
      {
        provider: "claude",
        status: "ok",
        executable: "/usr/bin/claude",
        source: {
          method: "claude initialize control request",
          argv: ["claude"],
          at: "2026-09-05T00:00:00.000Z",
        },
        error: null,
        entries: [
          {
            provider: "claude",
            providerId: "fable",
            displayName: "Fable",
            description: null,
            supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
            defaultEffort: null,
            hidden: null,
            isDefault: null,
            variants: [],
            resolution: { resolvedModel: "claude-fable-5-1" },
            descriptor: supportedDescriptor("claude", "fable", "effort-flag"),
            membership: membershipOf(catalog, "claude", "fable"),
          },
        ],
      },
    ],
  };
}

function writeJson(dir: string, name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

describe("pstack-models validate", () => {
  it("exits 0 on the real plugin tree", async () => {
    const { stdout, stderr, io } = harness();
    expect(await main(["validate"], io)).toBe(0);
    expect(stdout.join("")).toBe("ok\n");
    expect(stderr).toEqual([]);
  });
});

describe("pstack-models add", () => {
  it("refuses to write without a TTY or --yes", async () => {
    const root = copyPluginTree();
    const beforeCatalog = readFileSync(catalogFilePath(root));
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const inventoryPath = writeJson(root, "inventory.json", astraInventory());
    const { stdout, stderr, io } = harness(root);
    const code = await main(
      [
        "add",
        "codex:gpt-6-astra",
        "--from",
        inventoryPath,
        "--family",
        "astra",
      ],
      io
    );
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("refusing to write without --yes or a TTY");
    expect(stdout.join("")).toContain("--- a/models.json");
    expect(readFileSync(catalogFilePath(root)).equals(beforeCatalog)).toBe(true);
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
  });

  it("add --yes writes Astra and list shows copyable ultra", async () => {
    const root = copyPluginTree();
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const inventoryPath = writeJson(root, "inventory.json", astraInventory());
    const { io } = harness(root);
    const code = await main(
      [
        "add",
        "codex:gpt-6-astra",
        "--from",
        inventoryPath,
        "--family",
        "astra",
        "--yes",
      ],
      io
    );
    expect(code).toBe(0);
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
    const listed = harness(root);
    expect(await main(["list"], listed.io)).toBe(0);
    const text = listed.stdout.join("");
    expect(text).toContain("codex:gpt-6-astra@ultra");
    expect(text).toContain("codex:gpt-6-astra@medium");
  });

  it("adds claude-fable-5-1[1m] with native agents", async () => {
    const root = copyPluginTree();
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const { io } = harness(root);
    const code = await main(
      [
        "add",
        "claude:claude-fable-5-1[1m]",
        "--display-name",
        "Fable 5.1",
        "--family",
        "fable",
        "--efforts",
        "low,medium,high,xhigh,max",
        "--default-effort",
        "max",
        "--yes",
      ],
      io
    );
    expect(code).toBe(0);
    const catalog = readCatalogFile(catalogFilePath(root)).catalog;
    const offering = catalog.offerings.find((row) => row.selector === "claude-fable-5-1[1m]");
    expect(offering?.nativeAgentStem).toBe("fable-5-1-1m");
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      const path = join(agentsDirectory(root), `pstack-fable-5-1-1m-${effort}.md`);
      expect(readFileSync(path, "utf8")).toContain("model: claude-fable-5-1[1m]");
    }
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
  });

  it("scripted TTY answers apply an add", async () => {
    const root = copyPluginTree();
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const inventoryPath = writeJson(root, "inventory.json", astraInventory());
    const answers = ["astra", "y"];
    const { io } = harness(root, {
      isTTY: () => true,
      prompt: async () => answers.shift() ?? "",
    });
    const code = await main(
      ["add", "codex:gpt-6-astra", "--from", inventoryPath],
      io
    );
    expect(code).toBe(0);
    expect(answers).toEqual([]);
    expect(readCatalogFile(catalogFilePath(root)).catalog.offerings.some((row) => row.id === "codex-gpt-6-astra")).toBe(
      true
    );
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
  });
});

describe("pstack-models edit", () => {
  it("clears successorId with --successor null or --no-deprecated", async () => {
    const root = copyPluginTree();
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const deprecateIo = harness(root);
    expect(
      await main(
        [
          "edit",
          "claude-fable",
          "--deprecated",
          "--successor",
          "codex-gpt-5-6-sol",
          "--yes",
        ],
        deprecateIo.io
      )
    ).toBe(0);
    let offering = readCatalogFile(catalogFilePath(root)).catalog.offerings.find(
      (row) => row.id === "claude-fable"
    );
    expect(offering?.deprecated).toBe(true);
    expect(offering?.successorId).toBe("codex-gpt-5-6-sol");

    const clearSuccessorIo = harness(root);
    expect(
      await main(
        ["edit", "claude-fable", "--successor", "null", "--yes"],
        clearSuccessorIo.io
      )
    ).toBe(0);
    offering = readCatalogFile(catalogFilePath(root)).catalog.offerings.find(
      (row) => row.id === "claude-fable"
    );
    expect(offering?.successorId).toBeNull();

    const undeprecateIo = harness(root);
    expect(
      await main(["edit", "claude-fable", "--no-deprecated", "--yes"], undeprecateIo.io)
    ).toBe(0);
    offering = readCatalogFile(catalogFilePath(root)).catalog.offerings.find(
      (row) => row.id === "claude-fable"
    );
    expect(offering?.deprecated).toBe(false);
    expect(offering?.successorId).toBeNull();
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
  });
});

describe("pstack-models list", () => {
  it("prints unknown advertised resolution without inventory", async () => {
    const { stdout, io } = harness();
    expect(await main(["list"], io)).toBe(0);
    expect(stdout.join("")).toContain(
      "advertised resolution: unknown (no inventory supplied)"
    );
  });

  it("prints inventory resolution with method and time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-models-list-"));
    scratches.push(dir);
    const from = writeJson(dir, "inventory.json", fableInventory());
    const { stdout, io } = harness();
    expect(await main(["list", "--from", from], io)).toBe(0);
    const text = stdout.join("");
    expect(text).toContain("advertised resolution: claude-fable-5-1");
    expect(text).toContain("claude initialize control request");
    expect(text).toContain("2026-09-05T00:00:00.000Z");
  });

  it("renders observed model from a receipt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-models-receipt-"));
    scratches.push(dir);
    const receipt = writeJson(dir, "receipt.json", {
      provider: "claude",
      model: "fable",
      reportedModel: "claude-fable-5-1",
      completedAt: "2026-09-05T12:34:56.000Z",
      modelEvidence: "provider-report",
    });
    const { stdout, io } = harness();
    expect(await main(["list", "--receipt", receipt], io)).toBe(0);
    expect(stdout.join("")).toContain(
      "observed at execution: claude-fable-5-1 (2026-09-05T12:34:56.000Z)"
    );
  });
});

describe("pstack-models usage", () => {
  it("rejects unknown subcommands and flags with exit 64", async () => {
    const unknownCommand = harness();
    expect(await main(["nope"], unknownCommand.io)).toBe(64);
    expect(unknownCommand.stderr.join("")).toContain("error:");
    const unknownFlag = harness();
    expect(await main(["list", "--bogus"], unknownFlag.io)).toBe(64);
    expect(unknownFlag.stderr.join("")).toContain("error:");
  });

  it("renders discover --help", async () => {
    const { stdout, stderr, io } = harness();
    expect(await main(["discover", "--help"], io)).toBe(0);
    const text = stdout.join("");
    expect(text).toContain("Usage: pstack-models discover");
    expect(text).toContain("--provider");
    expect(text).toContain("--json");
    expect(text).toContain("--output");
    expect(text).toContain("--timeout");
    expect(stderr).toEqual([]);
  });

  it("rejects unknown discover providers with exit 64", async () => {
    const { stdout, stderr, io } = harness();
    expect(await main(["discover", "--provider", "openai"], io)).toBe(64);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("must be one of: claude|codex|cursor|grok");
  });

  it("discover writes an incomplete inventory, exits 3, and leaves the catalog untouched", async () => {
    const root = copyPluginTree();
    const bin = mkdtempSync(join(tmpdir(), "pstack-models-bin-"));
    scratches.push(bin);
    writeFileSync(
      join(bin, "grok"),
      `#!/usr/bin/env bun
console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.6 (default)\\n  * grok-5");
`
    );
    chmodSync(join(bin, "grok"), 0o755);
    const previousPath = process.env.PATH;
    // Keep bun resolvable for the fake's shebang; cursor-agent stays absent
    // because no real provider CLI is installed where the suite runs.
    process.env.PATH = `${bin}:${dirname(process.execPath)}`;
    const before = readFileSync(catalogFilePath(root));
    const output = join(bin, "inventory.json");
    try {
      const { stdout, io } = harness(root);
      expect(
        await main(["discover", "--provider", "grok", "--provider", "cursor", "--output", output], io)
      ).toBe(3);
      const text = stdout.join("");
      expect(text).toContain("INCOMPLETE");
      expect(text).toContain("grok: ok");
      expect(text).toContain("cursor: unavailable-cli");
      expect(text).toContain("membership: grok-grok-4-6");
      expect(text).toContain("pstack-models add grok:grok-5 --from <inventory>");
      const inventory = JSON.parse(readFileSync(output, "utf8")) as Inventory;
      expect(inventory.complete).toBe(false);
      expect(inventory.providers.map((row) => row.status)).toEqual(["ok", "unavailable-cli"]);
      expect(readFileSync(catalogFilePath(root)).equals(before)).toBe(true);

      const again = harness(root);
      expect(await main(["discover", "--provider", "grok", "--output", output], again.io)).toBe(1);
      expect(again.stderr.join("")).toContain("refusing to overwrite");
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

describe("pstack-models remove", () => {
  it("rejects a referenced offering and lists the references", async () => {
    const beforeRoles = readFileSync(roleDefaultsFilePath(PLUGIN_ROOT));
    const { stderr, io } = harness();
    expect(await main(["remove", "claude-fable"], io)).toBe(1);
    expect(stderr.join("")).toContain("how critics[1] claude:fable@max");
    expect(readFileSync(roleDefaultsFilePath(PLUGIN_ROOT)).equals(beforeRoles)).toBe(true);
  });
});

describe("role-defaults immutability", () => {
  it("leaves role-defaults.json bytes unchanged across mutating commands", async () => {
    const root = copyPluginTree();
    const beforeRoles = readFileSync(roleDefaultsFilePath(root));
    const inventoryPath = writeJson(root, "inventory.json", astraInventory());
    const addIo = harness(root);
    await main(
      ["add", "codex:gpt-6-astra", "--from", inventoryPath, "--family", "astra", "--yes"],
      addIo.io
    );
    const editIo = harness(root);
    await main(
      [
        "edit",
        "codex-gpt-6-astra",
        "--efforts",
        "low,medium,high,xhigh,max,ultra",
        "--default-effort",
        "high",
        "--yes",
      ],
      editIo.io
    );
    const removeIo = harness(root);
    await main(["remove", "codex-gpt-6-astra", "--yes"], removeIo.io);
    await main(["validate"], harness(root).io);
    expect(readFileSync(roleDefaultsFilePath(root)).equals(beforeRoles)).toBe(true);
    expect(existsSync(join(agentsDirectory(root), "pstack-fable-max.md"))).toBe(true);
  });
});
