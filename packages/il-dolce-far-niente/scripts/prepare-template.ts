import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const templateRoot = path.join(packageRoot, "template");

const entries: readonly string[] = ["AGENTS.md", "CLAUDE.md", ".agents", ".claude", "blueprint"];

// Developer-local or generated files that must never ship in the template,
// even when they exist in this checkout.
const excludedPaths: readonly string[] = [
  ".claude/settings.local.json",
  "blueprint/.state/run.json",
  "blueprint/config.local.json"
];

function isExcluded(source: string): boolean {
  const relative = path.relative(repoRoot, source).split(path.sep).join("/");
  return excludedPaths.includes(relative);
}

async function copyEntry(entry: string): Promise<void> {
  const source = path.join(repoRoot, entry);
  const target = path.join(templateRoot, entry);
  await fs.cp(source, target, {
    recursive: true,
    filter: (sourcePath) => !isExcluded(sourcePath)
  });
}

async function main(): Promise<void> {
  await fs.rm(templateRoot, { recursive: true, force: true });
  await fs.mkdir(templateRoot, { recursive: true });

  for (const entry of entries) {
    await copyEntry(entry);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
