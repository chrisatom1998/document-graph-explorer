#!/usr/bin/env node
import { main } from './subagentCore.mjs';

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
