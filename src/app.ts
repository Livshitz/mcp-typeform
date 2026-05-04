import { resolve } from 'node:path';
import { json } from 'itty-router';
import { RouterWrapper } from 'edge.libx.js/build/main.js';
import { augmentMcpWithSkillResource } from './mcp/with-skill-resource.ts';
import { requireToken, typeformApi } from './typeform-api.ts';
import { slimForms, slimResponse, slimResponses } from './slim.ts';
import { FileCache } from './file-cache.ts';

type Rec = Record<string, unknown>;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function errStatus(e: unknown): number {
  return (e as { status?: number })?.status ?? 500;
}

function qp(req: { url: string; query?: Record<string, unknown> }, key: string): string | undefined {
  const q = req.query?.[key];
  if (q !== undefined && q !== null && String(q) !== '') return String(q);
  try { return new URL(req.url, 'http://_').searchParams.get(key) ?? undefined; } catch { return undefined; }
}

function qpForward(
  req: { url: string; query?: Record<string, unknown> },
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = qp(req, k);
    if (v) out[k] = v;
  }
  return out;
}

function params(req: unknown): Record<string, string> {
  return ((req as { params?: Record<string, string> })?.params) ?? {};
}

export function createTypeformMcp() {
  const cache = new FileCache();
  const base = RouterWrapper.getNew('', {
    origin: '*',
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  });
  const { router } = base;

  // --- List forms ---
  base.describeMCP('/typeform/forms', 'GET', {
    description: 'List all Typeform forms for the account.',
    params: {
      page: { description: 'Page number (default 1)', type: 'string' },
      page_size: { description: 'Items per page (default 10, max 200)', type: 'string' },
      search: { description: 'Search by title', type: 'string' },
      workspace_id: { description: 'Limit to workspace UUID', type: 'string' },
      sort_by: { description: 'Sort field: created_at | last_updated_at', type: 'string' },
      order_by: { description: 'Order: asc | desc', type: 'string' },
      full: { description: 'If true, return full form objects', type: 'string' },
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms', async (req) => {
    try {
      const token = requireToken();
      const page = parseInt(qp(req, 'page') ?? '1', 10) || 1;
      const page_size = Math.min(200, parseInt(qp(req, 'page_size') ?? '10', 10) || 10);
      const search = qp(req, 'search');
      const full = qp(req, 'full') === 'true';
      const fwd = qpForward(req, ['workspace_id', 'sort_by', 'order_by']);
      const data = await typeformApi<{ items?: Rec[]; total_items?: number; page_count?: number }>(
        token, '/forms', { params: { page, page_size, ...(search ? { search } : {}), ...fwd } },
      );
      return json(full ? data : slimForms(data));
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- Get form ---
  base.describeMCP('/typeform/forms/:id', 'GET', {
    description: 'Get full form definition including fields, logic, settings, and theme.',
    params: { id: { description: 'Form ID', type: 'string', required: true } },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms/:id', async (req) => {
    try {
      const token = requireToken();
      const { id } = params(req);
      if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
      const data = await typeformApi<Rec>(token, `/forms/${id}`);
      return json(data);
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- List responses ---
  base.describeMCP('/typeform/forms/:id/responses', 'GET', {
    description:
      'List responses for a form. Pagination: before/after cursors OR sort — do not combine sort with before/after (Typeform). Prefer response_type over deprecated completed.',
    params: {
      id: { description: 'Form ID', type: 'string', required: true },
      page_size: { description: 'Max responses (default 25, max 1000)', type: 'string' },
      before: { description: 'Cursor: fetch responses before this token', type: 'string' },
      after: { description: 'Cursor: fetch responses after this token', type: 'string' },
      since: {
        description: 'ISO8601 lower bound — which timestamp applies depends on response_type / completed (see Typeform docs)',
        type: 'string',
      },
      until: {
        description: 'ISO8601 upper bound — which timestamp applies depends on response_type / completed (see Typeform docs)',
        type: 'string',
      },
      completed: { description: '[Deprecated API] completion filter; prefer response_type', type: 'string' },
      response_type: {
        description:
          'Comma-separated: started | partial | completed (Typeform replaces completed); changes which timestamp since/until apply to.',
        type: 'string',
      },
      sort: { description: 'Order: field,direction e.g. submitted_at,desc — cannot combine with before/after', type: 'string' },
      query: { description: 'Substring match across answers, hidden fields, variables', type: 'string' },
      fields: { description: 'Comma-separated field refs to include in answers projection', type: 'string' },
      answered_fields: { description: 'Comma-separated refs; only responses mentioning at least one', type: 'string' },
      excluded_response_ids: { description: 'Comma-separated response IDs to omit', type: 'string' },
      included_response_ids: { description: 'Comma-separated response IDs whitelist', type: 'string' },
      full: { description: 'If true, return raw response objects', type: 'string' },
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms/:id/responses', async (req) => {
    try {
      const token = requireToken();
      const { id } = params(req);
      if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
      const page_size = Math.min(1000, parseInt(qp(req, 'page_size') ?? '25', 10) || 25);
      const full = qp(req, 'full') === 'true';
      const sort = qp(req, 'sort');
      if (sort && (qp(req, 'before') || qp(req, 'after'))) {
        return json(
          {
            ok: false,
            error: 'Cannot use sort together with before or after (Typeform Responses API)',
          },
          { status: 400 },
        );
      }
      const fwd = qpForward(req, [
        'before',
        'after',
        'since',
        'until',
        'completed',
        'response_type',
        'sort',
        'query',
        'fields',
        'answered_fields',
        'excluded_response_ids',
        'included_response_ids',
      ]);
      const responseParams = { page_size, ...fwd };
      const data = await typeformApi<{ items?: Rec[]; total_items?: number; page_count?: number }>(
        token, `/forms/${id}/responses`, { params: responseParams },
      );
      if (full) return json(data);
      const slim = slimResponses(data);
      const summary = cache.write(`responses_${id}`, slim);
      return json({ total_items: slim.total_items, page_count: slim.page_count, ...summary });
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- Get single response ---
  base.describeMCP('/typeform/forms/:id/responses/:rid', 'GET', {
    description: 'Get a single response by response_id.',
    params: {
      id: { description: 'Form ID', type: 'string', required: true },
      rid: { description: 'Response ID', type: 'string', required: true },
    },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms/:id/responses/:rid', async (req) => {
    try {
      const token = requireToken();
      const { id, rid } = params(req);
      if (!id || !rid) return json({ ok: false, error: 'id and rid required' }, { status: 400 });
      // Typeform has no single-response endpoint; filter from list
      const data = await typeformApi<{ items?: Rec[] }>(
        token, `/forms/${id}/responses`, { params: { included_response_ids: rid, page_size: 1 } },
      );
      const item = data.items?.[0];
      if (!item) return json({ ok: false, error: 'response not found' }, { status: 404 });
      const slim = slimResponse(item);
      const summary = cache.write(`response_${id}_${rid}`, slim);
      return json({ response_id: slim.response_id, ...summary });
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- Form insights ---
  base.describeMCP('/typeform/forms/:id/insights', 'GET', {
    description: 'Get response stats for a form: total responses, completion rate, average time.',
    params: { id: { description: 'Form ID', type: 'string', required: true } },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms/:id/insights', async (req) => {
    try {
      const token = requireToken();
      const { id } = params(req);
      if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
      const data = await typeformApi<Rec>(token, `/insights/${id}/summary`);
      return json(data);
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- List webhooks ---
  base.describeMCP('/typeform/forms/:id/webhooks', 'GET', {
    description: 'List all webhooks registered for a form.',
    params: { id: { description: 'Form ID', type: 'string', required: true } },
    annotations: { readOnlyHint: true },
  });
  router.get('/typeform/forms/:id/webhooks', async (req) => {
    try {
      const token = requireToken();
      const { id } = params(req);
      if (!id) return json({ ok: false, error: 'id required' }, { status: 400 });
      const data = await typeformApi<Rec>(token, `/forms/${id}/webhooks`);
      return json(data);
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- Create/update webhook ---
  base.describeMCP('/typeform/forms/:id/webhooks/:tag', 'POST', {
    description: 'Create or update a webhook for a form. Tag is a unique slug you choose.',
    params: {
      id: { description: 'Form ID', type: 'string', required: true },
      tag: { description: 'Webhook tag/slug (unique identifier)', type: 'string', required: true },
      body: {
        description: '{ url: string, enabled?: boolean, secret?: string, verify_ssl?: boolean }',
        type: 'object',
      },
    },
    annotations: { destructiveHint: false },
  });
  router.post('/typeform/forms/:id/webhooks/:tag', async (req) => {
    try {
      const token = requireToken();
      const { id, tag } = params(req);
      if (!id || !tag) return json({ ok: false, error: 'id and tag required' }, { status: 400 });
      const body = (await req.json()) as Rec;
      if (!body.url) return json({ ok: false, error: 'url is required in body' }, { status: 400 });
      const data = await typeformApi<Rec>(token, `/forms/${id}/webhooks/${tag}`, { method: 'PUT', body });
      return json(data);
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  // --- Delete webhook ---
  base.describeMCP('/typeform/forms/:id/webhooks/:tag', 'DELETE', {
    description: 'Delete a webhook by tag.',
    params: {
      id: { description: 'Form ID', type: 'string', required: true },
      tag: { description: 'Webhook tag/slug', type: 'string', required: true },
    },
    annotations: { destructiveHint: true },
  });
  router.delete('/typeform/forms/:id/webhooks/:tag', async (req) => {
    try {
      const token = requireToken();
      const { id, tag } = params(req);
      if (!id || !tag) return json({ ok: false, error: 'id and tag required' }, { status: 400 });
      await typeformApi<void>(token, `/forms/${id}/webhooks/${tag}`, { method: 'DELETE' });
      return json({ ok: true, deleted: tag });
    } catch (e) { return json({ ok: false, error: errMessage(e) }, { status: errStatus(e) }); }
  });

  base.catchNotFound();

  const mcp = base.asMCP({
    name: 'mcp-typeform',
    version: '0.2.0',
    instructions:
      'Typeform: list forms (optional workspace_id, sort_by, order_by; full=true for settings.is_public). Responses: cached to disk by default — tool returns { file, total_items, preview }; use Read on the file path for full data; pass full=true for inline JSON. Pagination via before/after; never mix sort with before/after; use response_type and since/until; total_items reflects filters. Recent submissions may lag ~30min — use webhooks for realtime. Webhook tag is a unique slug. Docs: skill://mcp-typeform/workflow.',
  });

  augmentMcpWithSkillResource(mcp, {
    serverName: 'mcp-typeform',
    repoRootAbs: resolve(import.meta.dirname, '..'),
    skillRelativePath: '.claude/skills/mcp-typeform/SKILL.md',
  });

  async function httpFetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'mcp-typeform' });
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return mcp.httpHandler(req);
    return base.fetchHandler(req);
  }

  return { mcp, httpFetch, base };
}
