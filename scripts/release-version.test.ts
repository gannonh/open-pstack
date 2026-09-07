import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION_FILES,
  applyReleaseVersion,
  main,
  readLockstepVersion,
  resolveReleaseVersion,
} from "./release-version.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const scratches: string[] = [];

afterEach(() => {
  for (const path of scratches.splice(0)) rmSync(path, { recursive: true, force: true });
});

function copyLockstepTree(): string {
  const root = mkdtempSync(join(tmpdir(), "open-pstack-release-"));
  scratches.push(root);
  for (const relative of VERSION_FILES) {
    const dest = join(root, relative);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(join(repoRoot, relative)));
  }
  return root;
}

describe("resolveReleaseVersion", () => {
  it("patch-bumps when no version is requested", () => {
    expect(resolveReleaseVersion("1.6.1", "")).toBe("1.6.2");
    expect(resolveReleaseVersion("1.6.1", "   ")).toBe("1.6.2");
    expect(resolveReleaseVersion("1.6.1", undefined)).toBe("1.6.2");
  });

  it("uses an explicit greater version", () => {
    expect(resolveReleaseVersion("1.6.1", "1.7.0")).toBe("1.7.0");
    expect(resolveReleaseVersion("1.6.1", "2.0.0")).toBe("2.0.0");
  });

  it("refuses invalid or non-increasing versions", () => {
    expect(() => resolveReleaseVersion("1.6.1", "1.6.1")).toThrow("not greater than");
    expect(() => resolveReleaseVersion("1.6.1", "1.6.0")).toThrow("not greater than");
    expect(() => resolveReleaseVersion("1.6.1", "v1.6.2")).toThrow("invalid version");
    expect(() => resolveReleaseVersion("1.6.1", "1.6")).toThrow("invalid version");
  });
});

describe("applyReleaseVersion", () => {
  it("updates the six lockstep files and leaves other text alone", () => {
    const root = copyLockstepTree();
    const current = readLockstepVersion(root);
    const next = resolveReleaseVersion(current, "");
    applyReleaseVersion(root, current, next);
    expect(readLockstepVersion(root)).toBe(next);
    expect(main(["--repo", root])).toBe(resolveReleaseVersion(next, ""));
    const upstream = readFileSync(join(root, "UPSTREAM.md"), "utf8");
    expect(upstream).toContain(`| open-pstack version | \`${next}\` |`);
    expect(upstream).not.toContain(`| open-pstack version | \`${current}\` |`);
  });
});
