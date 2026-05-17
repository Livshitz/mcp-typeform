# mcp-typeform

MCP server for the Typeform API — forms, responses, insights, and webhooks.

## Usage

```bash
bun run src/mcp/cli.ts --stdio     # stdio mode (for MCP integration)
bun run src/mcp/cli.ts --port 3841 # HTTP mode
```

## Env Vars

| Variable | Required | Description |
|----------|----------|-------------|
| `TYPEFORM_PERSONAL_TOKEN` | Yes | Personal Access Token from typeform.com/developers |
| `MCP_CACHE_DIR` | No | Cache directory (default: `.mcp-typeform/cache`) |

## Tools

| Tool | Method | Description |
|------|--------|-------------|
| `/typeform/forms` | GET | List forms (filterable by workspace, searchable) |
| `/typeform/forms/:id` | GET | Get form details |
| `/typeform/forms/:id/responses` | GET | Get form responses (paginated, filterable) |
| `/typeform/forms/:id/responses/:rid` | GET | Get single response by ID |
| `/typeform/forms/:id/insights` | GET | Get form analytics/insights |
| `/typeform/forms/:id/webhooks` | GET | List webhooks for a form |
| `/typeform/forms/:id/webhooks/:tag` | POST | Create/update webhook |
| `/typeform/forms/:id/webhooks/:tag` | DELETE | Delete webhook |

## Notes

- Responses cached to disk by default — tool returns `{ file, total_items, preview }`
- Pass `full=true` for inline JSON instead of file spooling
- Pagination via `before`/`after` params; never mix `sort` with `before`/`after`
- Use `response_type` and `since`/`until` for filtering
- Recent submissions may lag ~30min — use webhooks for realtime

## Architecture

Built on `edge.libx.js` RouterWrapper + `describeMCP`. FileCache for disk-based result caching. Dual-mode: stdio or HTTP.
