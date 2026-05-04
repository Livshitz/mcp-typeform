# mcp-typeform Workflow

## Auth
Set `TYPEFORM_PERSONAL_TOKEN` env var (Personal Access Token from typeform.com/developers).

## Tool Reference

| Tool | When to use |
|------|-------------|
| `GET /typeform/forms` | Discover form IDs and titles |
| `GET /typeform/forms/:id` | Full form definition (fields, logic, settings) |
| `GET /typeform/forms/:id/responses` | Paginated responses; use `since`/`until` for date ranges |
| `GET /typeform/forms/:id/responses/:rid` | Single response by ID |
| `GET /typeform/forms/:id/insights` | Completion rate, avg time, total responses |
| `GET /typeform/forms/:id/webhooks` | List registered webhooks |
| `POST /typeform/forms/:id/webhooks/:tag` | Create/update webhook (tag = unique slug) |
| `DELETE /typeform/forms/:id/webhooks/:tag` | Remove a webhook |

## Common Flows

### Read responses
1. `GET /typeform/forms` → find form ID
2. `GET /typeform/forms/:id/responses?page_size=50` → get answers
3. Use `before`/`after` cursors for pagination

### Analyze a form
1. `GET /typeform/forms/:id` → understand field structure
2. `GET /typeform/forms/:id/insights` → response stats
3. `GET /typeform/forms/:id/responses?full=true` → raw data if needed

### Register a webhook
1. `POST /typeform/forms/:id/webhooks/my-tag` with `{ url, enabled: true }`
