#!/usr/bin/env node

import { runCli } from "./il-dolce-far-niente.js";

runCli(process.argv.slice(2), "global").catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
