import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearSandboxEntries, listSandboxEntries } from "./clear-sandbox.js";

test("lists and clears only direct sandbox entries", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-clear-sandbox-"));
  const sandboxRoot = path.join(workspace, ".sandbox");

  try {
    await fs.mkdir(path.join(sandboxRoot, "run-one", "project"), { recursive: true });
    await fs.mkdir(path.join(sandboxRoot, "run-two"), { recursive: true });
    await fs.writeFile(path.join(sandboxRoot, "run-one", "project", "index.html"), "");

    const entries = await listSandboxEntries(sandboxRoot);
    assert.deepEqual(entries, ["run-one", "run-two"]);

    await clearSandboxEntries(sandboxRoot, entries);
    assert.deepEqual(await listSandboxEntries(sandboxRoot), []);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("treats a missing sandbox as empty and rejects unsafe entries", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-clear-missing-"));
  const sandboxRoot = path.join(workspace, ".sandbox");

  try {
    assert.deepEqual(await listSandboxEntries(sandboxRoot), []);
    await assert.rejects(
      clearSandboxEntries(sandboxRoot, ["../outside"]),
      /Unsafe sandbox entry/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("rejects a symbolic-link sandbox root", async (context) => {
  if (process.platform === "win32") {
    context.skip("Directory symlinks require additional Windows privileges.");
    return;
  }

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "blueprint-clear-link-"));
  const realRoot = path.join(workspace, "real");
  const sandboxRoot = path.join(workspace, ".sandbox");

  try {
    await fs.mkdir(realRoot);
    await fs.symlink(realRoot, sandboxRoot, "dir");
    await assert.rejects(listSandboxEntries(sandboxRoot), /must be a real directory/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
