#!/usr/bin/env node
import { main } from '../src/cli.mjs';
import { output } from '../src/output.mjs';
import { GatewayError } from '../src/errors.mjs';

try { await main(process.argv.slice(2)); }
catch (error) {
  const known = error instanceof GatewayError;
  output({ error: known ? error.code : 'INTERNAL', message: known ? error.message : 'An unexpected error occurred.', help: known ? error.hint : 'Run proxyup doctor; check private config and file permissions.' }, process.argv.includes('--json'));
  process.exitCode = known && error.code === 'USAGE' ? 2 : 1;
}
