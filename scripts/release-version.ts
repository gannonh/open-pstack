import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;

export const VERSION_FILES = [
  "plugins/pstack/.claude-plugin/plugin.json",
  "plugins/pstack/.codex-plugin/plugin.json",
  "plugins/pstack/.cursor-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".cursor-plugin/marketplace.json",
  "UPSTREAM.md",
] as const;

export function parseVersion(value: string): [number, number, number] {
  const match = VERSION_RE.exec(value);
  if (match === null) throw new Error(`invalid version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const [lMajor, lMinor, lPatch] = parseVersion(left);
  const [rMajor, rMinor, rPatch] = parseVersion(right);
  if (lMajor !== rMajor) return lMajor - rMajor;
  if (lMinor !== rMinor) return lMinor - rMinor;
  return lPatch - rPatch;
}

export function patchBump(current: string): string {
  const [major, minor, patch] = parseVersion(current);
  return `${major}.${minor}.${patch + 1}`;
}

export function resolveReleaseVersion(current: string, requested: string | undefined): string {
  const trimmed = requested?.trim() ?? "";
  const next = trimmed === "" ? patchBump(current) : trimmed;
  parseVersion(next);
  if (compareVersions(next, current) <= 0) {
    throw new Error(`release version ${next} is not greater than ${current}`);
  }
  return next;
}

export function readLockstepVersion(repoRoot: string): string {
  const plugin = JSON.parse(
    readFileSync(join(repoRoot, "plugins/pstack/.claude-plugin/plugin.json"), "utf8")
  ) as { version?: unknown };
  if (typeof plugin.version !== "string") {
    throw new Error("plugins/pstack/.claude-plugin/plugin.json has no version string");
  }
  parseVersion(plugin.version);
  return plugin.version;
}

function replaceOnce(path: string, current: string, next: string, needle: string, label: string): void {
  const before = readFileSync(path, "utf8");
  const matches = before.split(needle).length - 1;
  if (matches !== 1) {
    throw new Error(`${label}: expected exactly one ${current} marker, found ${matches}`);
  }
  writeFileSync(path, before.replace(needle, needle.replace(current, next)));
}

export function applyReleaseVersion(repoRoot: string, current: string, next: string): void {
  parseVersion(current);
  parseVersion(next);
  for (const relative of VERSION_FILES) {
    const path = join(repoRoot, relative);
    if (relative === "UPSTREAM.md") {
      replaceOnce(
        path,
        current,
        next,
        `| open-pstack version | \`${current}\` |`,
        relative
      );
      continue;
    }
    replaceOnce(path, current, next, `"version": "${current}"`, relative);
  }
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

export function main(argv: readonly string[] = process.argv.slice(2)): string {
  const repo = argValue(argv, "--repo") ?? process.cwd();
  const requested = argValue(argv, "--requested");
  const current = readLockstepVersion(repo);
  const next = resolveReleaseVersion(current, requested);
  if (argv.includes("--apply")) applyReleaseVersion(repo, current, next);
  return next;
}

if (import.meta.main) {
  try {
    process.stdout.write(`${main()}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
