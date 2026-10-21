import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST_PATH = path.join("blueprint", ".state", "manifest.json");

async function findProjectRoot(startPath: string = process.cwd()): Promise<string | null> {
  const resolvedStart = await fs.realpath(startPath);
  const stats = await fs.stat(resolvedStart);
  let currentDir = stats.isDirectory()
    ? resolvedStart
    : path.dirname(resolvedStart);

  while (true) {
    if (await isBlueprintProjectRoot(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

async function isBlueprintProjectRoot(directory: string): Promise<boolean> {
  const blueprintDir = path.join(directory, "blueprint");

  if (!(await isDirectory(blueprintDir))) {
    return false;
  }

  return (
    (await hasInstallManifest(directory)) ||
    (await isFile(path.join(directory, "AGENTS.md")))
  );
}

async function hasInstallManifest(directory: string): Promise<boolean> {
  const stateDir = path.join(directory, "blueprint", ".state");
  return (
    (await isDirectory(stateDir)) &&
    (await isFile(path.join(directory, MANIFEST_PATH)))
  );
}

async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    return (await fs.lstat(targetPath)).isDirectory();
  } catch (error: unknown) {
    const code = getErrorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }

    throw error;
  }
}

async function isFile(targetPath: string): Promise<boolean> {
  try {
    return (await fs.lstat(targetPath)).isFile();
  } catch (error: unknown) {
    const code = getErrorCode(error);

    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }

    throw error;
  }
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export {
  findProjectRoot,
  isBlueprintProjectRoot
};
