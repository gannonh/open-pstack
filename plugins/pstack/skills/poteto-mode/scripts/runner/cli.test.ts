import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "./cli.ts";

function argv(extra: readonly string[] = []): string[] {
  return [
    "--parent",
    "claude",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "max",
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(["--timeout", "5400"]))?.timeoutMs).toBe(5_400_000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });

  it("accepts any catalog effort identifier and leaves membership to the catalog", () => {
    const args = argv();
    args[args.indexOf("--effort") + 1] = "ultra";
    expect(parseArgs(args)?.effort).toBe("ultra");
    args[args.indexOf("--effort") + 1] = "Max!";
    expect(() => parseArgs(args)).toThrow("catalog effort identifier");
    args[args.indexOf("--model") + 1] = "claude-fable-5-1[1m]";
    args[args.indexOf("--effort") + 1] = "max";
    expect(parseArgs(args)?.model).toBe("claude-fable-5-1[1m]");
  });
});
