import { resolve } from 'node:path';
import { json } from 'itty-router';
import { RouterWrapper } from 'edge.libx.js/build/main.js';
import { augmentMcpWithSkillResource } from './mcp/with-skill-resource.ts';
import { requireToken, typeformApi } from './typeform-api.ts';
import { slimForms, slimResponse, slimResponses } from './slim.ts';

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

function params(req: unknown): Record<string, string> {
  return ((req as { params?: Record<string, string> })?.params) ?? {};
}

export function createTypeformMcp() {
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
      const data = await typeformApi<{ items?: Rec[]; total_items?: number; page_count?: number }>(
        token, '/forms', { params: { page, page_size, ...(search ? { search } : {}) } },
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
    description: 'List responses for a form. Supports pagination and date filtering.',
    params: {
      id: { description: 'Form ID', type: 'string', required: true },
      page_size: { description: 'Max responses (default 25, max 1000)', type: 'string' },
      before: { description: 'Cursor: fetch responses before this token', type: 'string' },
      after: { description: 'Cursor: fetch responses after this token', type: 'string' },
      since: { description: 'Filter: submitted_at >= ISO8601 date', type: 'string' },
      until: { description: 'Filter: submitted_at <= ISO8601 date', type: 'string' },
      completed: { description: 'Filter by completion: true | false', type: 'string' },
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
      const params: Record<string, string | number | undefined> = { page_size };
      for (const k of ['before', 'after', 'since', 'until', 'completed']) {
        const v = qp(req, k); if (v) params[k] = v;
      }
      const data = await typeformApi<{ items?: Rec[]; total_items?: number; page_count?: number }>(
        token, `/forms/${id}/responses`, { params },
      );
      return json(full ? data : slimResponses(data));
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
      return json(slimResponse(item));
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
    version: '0.1.0',
    instructions:
      'Typeform: list forms to get IDs, then fetch responses or insights. Responses are paginated — use before/after cursors. Webhook tag is a unique slug you assign. Full workflow docs: MCP resource skill://mcp-typeform/workflow.',
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
