# mcp-typeform Workflow

## Auth
Set `TYPEFORM_PERSONAL_TOKEN` env var (Personal Access Token from typeform.com/developers).

## Tool Reference

| Tool | When to use |
|------|-------------|
| `GET /typeform/forms` | Discover form IDs; use **`full=true`** for `settings` (e.g. `is_public`), pagination, **`workspace_id`**, **`sort_by`**, **`order_by`** |
| `GET /typeform/forms/:id` | Full form definition (fields, logic, settings) |
| `GET /typeform/forms/:id/responses` | Paginated responses; **`since`/`until`**; **`response_type`** (started, partial, completed); **`query`**, **`fields`**, **`answered_fields`**, ID filters; **`total_items`** in slim mode |
| `GET /typeform/forms/:id/responses/:rid` | Single response by ID |
| `GET /typeform/forms/:id/insights` | Completion rate, avg time, total responses |
| `GET /typeform/forms/:id/webhooks` | List registered webhooks |
| `POST /typeform/forms/:id/webhooks/:tag` | Create/update webhook (tag = unique slug) |
| `DELETE /typeform/forms/:id/webhooks/:tag` | Remove a webhook |

## Responses API rules

- **Do not combine `sort` with `before` or `after`** — MCP returns HTTP 400; Typeform forbids this.
- **`completed`** query param still passes through (deprecated upstream); prefer **`response_type`** (comma-separated).
- **`response_type`** changes which timestamp **`since`** / **`until`** apply to (`submitted_at` vs `landed_at` / `staged_at` — per Typeform docs).
- **Latency**: submissions from roughly the last ~30 minutes may be missing from list responses; use **webhooks** for realtime ingestion.
- **Privacy**: **`query`** matches across answers, hidden fields, and variables — treat responses as sensitive.

## Common Flows

### Read responses
1. `GET /typeform/forms` → find form ID (paginate via `page` / `page_count`)
2. `GET /typeform/forms/:id/responses?page_size=50` → answers; **`total_items`** for counts
3. Use **`before`/`after`** cursors OR **`sort=submitted_at,desc`** — never both

### Recent activity counts (single form)
1. `GET .../responses?since=YYYY-MM-DDT00:00:00Z&page_size=1` → **`total_items`** is count in window; first item **`submitted_at`** ≈ newest (when `completed` / `response_type` default aligns with completions)

### Account-wide recent activity (no aggregate endpoint)
1. Paginate **`GET /typeform/forms`** until all IDs collected
2. For each ID, same **`since`** + **`page_size=1`** call; discard forms where **`total_items===0`** — beware rate limits and many forms.

### Analyze a form
1. `GET /typeform/forms/:id` → field structure + refs (**`fields`** / **`answered_fields`** filters use refs)
2. `GET /typeform/forms/:id/insights` → stats
3. `GET /typeform/forms/:id/responses?full=true` → raw payloads if needed

### Register a webhook
1. `POST /typeform/forms/:id/webhooks/my-tag` with `{ url, enabled: true }`
