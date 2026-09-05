#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLUGIN_ROOT,
  loadModelCatalog,
  nativeAgentsFor,
} from "./catalog.ts";

const agentsDir = join(PLUGIN_ROOT, "agents");
const catalog = loadModelCatalog();
mkdirSync(agentsDir, { recursive: true });
for (const agent of nativeAgentsFor(catalog)) {
  writeFileSync(join(agentsDir, agent.filename), agent.contents);
}
