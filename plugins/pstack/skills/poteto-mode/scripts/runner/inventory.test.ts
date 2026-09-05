import { describe, expect, it } from "bun:test";
import { loadModelCatalog, parseModelCatalog } from "./catalog.ts";
import {
  copyableDescriptors,
  cursorEntriesFromListing,
  findInventoryEntry,
  membershipOf,
  parseInventory,
  renderInventory,
  type Inventory,
} from "./inventory.ts";

const catalog = loadModelCatalog();

describe("cursor listing composition", () => {
  it("groups composed ids by cataloged effort suffix and preserves originals", () => {
    const entries = cursorEntriesFromListing(
      [
        { id: "claude-fable-5-1-low", displayName: "Claude Fable 5.1 Low" },
        { id: "claude-fable-5-1-max", displayName: "Claude Fable 5.1 Max" },
        { id: "claude-fable-5-1-ultra", displayName: "Claude Fable 5.1 Ultra" },
        { id: "cursor-grok-4.6-xhigh", displayName: "Cursor Grok 4.6 Extra High" },
        { id: "auto", displayName: "Auto" },
        { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" },
      ],
      catalog
    );
    const fable = entries.find((entry) => entry.providerId === "claude-fable-5-1");
    expect(fable?.descriptor).toEqual({
      supported: true,
      selector: "claude-fable-5-1",
      selectorComposition: "effort-suffix",
      descriptorStem: "cursor:claude-fable-5-1",
    });
    expect(fable?.supportedEfforts).toEqual(["low", "max"]);
    expect(fable?.defaultEffort).toBeNull();
    expect(fable?.variants).toEqual(["claude-fable-5-1-low", "claude-fable-5-1-max"]);
    expect(fable?.displayName).toBe("Claude Fable 5.1");
    expect(fable?.membership?.offeringId).toBe("cursor-fable-5-1");
    expect(copyableDescriptors(fable!)).toEqual([
      "cursor:claude-fable-5-1@low",
      "cursor:claude-fable-5-1@medium",
      "cursor:claude-fable-5-1@high",
      "cursor:claude-fable-5-1@xhigh",
      "cursor:claude-fable-5-1@max",
    ]);

    const ultra = entries.find((entry) => entry.providerId === "claude-fable-5-1-ultra");
    expect(ultra?.descriptor.supported).toBe(false);
    expect(ultra?.supportedEfforts).toBeNull();
    expect(ultra?.membership).toBeNull();

    const grok = entries.find((entry) => entry.providerId === "cursor-grok-4.6");
    expect(grok?.membership?.offeringId).toBe("cursor-grok-4-6");
    expect(grok?.supportedEfforts).toEqual(["xhigh"]);

    for (const id of ["auto", "gpt-5.6-sol"]) {
      const entry = entries.find((row) => row.providerId === id);
      expect(entry?.descriptor.supported).toBe(false);
      expect(copyableDescriptors(entry!)).toEqual([]);
    }
  });

  it("does not invent efforts for a stem the catalog does not know", () => {
    const entries = cursorEntriesFromListing(
      [
        { id: "gpt-6-astra-medium", displayName: "GPT-6 Astra Medium" },
        { id: "gpt-6-astra-ultra", displayName: "GPT-6 Astra Ultra" },
      ],
      catalog
    );
    const astra = entries.find((entry) => entry.providerId === "gpt-6-astra");
    expect(astra?.supportedEfforts).toEqual(["medium"]);
    expect(astra?.membership).toBeNull();
    expect(copyableDescriptors(astra!)).toEqual([]);
    expect(entries.find((entry) => entry.providerId === "gpt-6-astra-ultra")?.descriptor.supported).toBe(
      false
    );
    const withUltra = parseModelCatalog({
      ...JSON.parse(JSON.stringify(catalog)),
      offerings: [
        ...catalog.offerings,
        {
          ...catalog.offerings[2],
          id: "codex-gpt-6-astra",
          selector: "gpt-6-astra",
          displayName: "GPT-6 Astra",
          family: "astra",
          supportedEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
          defaultEffort: "medium",
        },
      ],
    });
    const recognized = cursorEntriesFromListing(
      [{ id: "gpt-6-astra-ultra", displayName: "GPT-6 Astra Ultra" }],
      withUltra
    );
    expect(recognized[0]?.providerId).toBe("gpt-6-astra");
    expect(recognized[0]?.supportedEfforts).toEqual(["ultra"]);
    expect(recognized[0]?.membership).toBeNull();
  });
});

describe("inventory membership and rendering", () => {
  it("annotates cataloged members and reports unknowns explicitly", () => {
    expect(membershipOf(catalog, "claude", "fable")?.label).toBe("Fable (rolling alias)");
    expect(membershipOf(catalog, "codex", "gpt-6-astra")).toBeNull();
    const inventory: Inventory = {
      schemaVersion: 1,
      generatedAt: "2026-09-05T00:00:00.000Z",
      complete: false,
      providers: [
        {
          provider: "claude",
          status: "ok",
          executable: "/usr/bin/claude",
          source: { method: "claude initialize control request", argv: ["claude"], at: "2026-09-05T00:00:00.000Z" },
          error: null,
          entries: [
            {
              provider: "claude",
              providerId: "fable",
              displayName: "Fable 5.1",
              description: null,
              supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
              defaultEffort: null,
              hidden: null,
              isDefault: null,
              variants: ["claude-fable-5-1[1m]"],
              resolution: { resolvedModel: "claude-fable-5-1" },
              descriptor: { supported: true, selector: "fable", selectorComposition: "effort-flag", descriptorStem: "claude:fable" },
              membership: membershipOf(catalog, "claude", "fable"),
            },
          ],
        },
        {
          provider: "grok",
          status: "unavailable-cli",
          executable: null,
          source: { method: "grok models", argv: ["grok", "models"], at: "2026-09-05T00:00:00.000Z" },
          error: { message: "grok executable not found", evidence: "" },
          entries: [],
        },
      ],
    };
    const text = renderInventory(inventory);
    expect(text).toContain("INCOMPLETE");
    expect(text).toContain("advertised resolution: claude-fable-5-1");
    expect(text).toContain("default effort: unknown");
    expect(text).toContain("membership: claude-fable (Fable (rolling alias)");
    expect(text).toContain("grok: unavailable-cli");
    expect(text).toContain("copyable: claude:fable@low");
    expect(parseInventory(JSON.parse(JSON.stringify(inventory))).complete).toBe(false);
    expect(() => parseInventory({ schemaVersion: 2 })).toThrow("schemaVersion");
    expect(findInventoryEntry(inventory, "claude", "fable")?.providerId).toBe("fable");
    expect(findInventoryEntry(inventory, "claude", "opus")).toBeNull();
  });
});
