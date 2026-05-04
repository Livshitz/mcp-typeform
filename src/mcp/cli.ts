#!/usr/bin/env bun
import { createTypeformMcp } from '../app.ts';

const argv = process.argv.slice(2);
const isStdio = argv.includes('--stdio');
const portIdx = argv.indexOf('--port');
const port = portIdx >= 0 ? parseInt(argv[portIdx + 1] ?? '3841', 10) || 3841 : 3841;

const { mcp, httpFetch } = createTypeformMcp();

if (isStdio) {
  await mcp.serveStdio();
} else {
  const server = Bun.serve({ port, fetch: httpFetch });
  console.error(`[mcp-typeform] http+mcp listening on http://127.0.0.1:${server.port}`);
  console.error(`[mcp-typeform] MCP JSON-RPC: POST http://127.0.0.1:${server.port}/mcp`);
}
