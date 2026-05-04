#!/usr/bin/env bun
/**
 * Export Typeform responses for one form in a UTC time window (completed + started + partial).
 *
 * Outputs CSV (default, flat join-friendly) or JSON (`--format json`).
 * Treat exports as sensitive (PII). Uses TYPEFORM_PERSONAL_TOKEN (Bun loads .env in project root).
 *
 * Usage:
 *   bun run scripts/export-form-period.ts
 *   bun run scripts/export-form-period.ts --format json --pretty
 *   bun run scripts/export-form-period.ts --form mbO4IDgi --since 2026-04-20T00:00:00Z --until 2026-04-27T00:00:00Z --out reports/out.csv
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { typeformApi } from '../src/typeform-api.ts';

const RT = ['completed', 'started', 'partial'] as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  return undefined;
}
function flag(name: string) {
  return process.argv.includes(name);
}

type FormField = {
  ref: string;
  id?: string;
  type?: string;
  title?: string;
};

function collectFields(nodes: unknown, out: FormField[]) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    const n = node as FormField & { properties?: { fields?: unknown } };
    if (n.ref) out.push({ ref: String(n.ref), id: n.id, type: n.type, title: String(n.title ?? '').trim() });
    collectFields(n.properties?.fields, out);
  }
}

async function fetchAllBuckets(
  token: string,
  formId: string,
  since: string,
  until: string,
): Promise<{ itemsByType: Record<(typeof RT)[number], Record<string, unknown>[]> }> {
  const itemsByType: Record<(typeof RT)[number], Record<string, unknown>[]> = {
    completed: [],
    started: [],
    partial: [],
  };

  for (const response_type of RT) {
    let after: string | undefined;
    const seen = new Set<string>();
    let duplicateAfterStopped = false;
    for (let guard = 0; guard < 500; guard++) {
      const data = await typeformApi<{
        items?: Record<string, unknown>[];
      }>(token, `/forms/${formId}/responses`, {
        params: {
          page_size: 1000,
          since,
          until,
          response_type,
          ...(after ? { after } : {}),
        },
      });
      const batch = data.items ?? [];
      if (!batch.length) break;

      let added = 0;
      const fresh: Record<string, unknown>[] = [];
      for (const row of batch) {
        const t = row.token as string | undefined;
        if (!t) continue;
        if (!seen.has(t)) {
          seen.add(t);
          fresh.push(row);
          added++;
        }
      }
      if (after !== undefined && added === 0) {
        duplicateAfterStopped = true;
        break;
      }
      itemsByType[response_type].push(...fresh);

      const lastToken = batch[batch.length - 1]?.token as string | undefined;
      if (!lastToken || batch.length < 1000) break;
      after = lastToken;
    }
    if (duplicateAfterStopped) {
      console.error(
        `[export-form-period] warning: '${response_type}' pagination hit duplicate-after; got ${itemsByType[response_type].length} unique rows`,
      );
    }
  }

  return { itemsByType };
}

function csvCell(v: unknown): string {
  if (v == null || v === '') return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCsvLine(cols: string[], row: Record<string, string>) {
  return cols.map((c) => csvCell(row[c] ?? '')).join(',');
}

function answerToText(a: Record<string, unknown>): string {
  const t = a.type as string | undefined;
  switch (t) {
    case 'choice': {
      const ch = a.choice as { label?: string } | undefined;
      return ch?.label ?? '';
    }
    case 'choices': {
      const ch = a.choices as { labels?: string[] } | undefined;
      return (ch?.labels ?? []).join(' | ');
    }
    case 'text':
    case 'email':
    case 'url':
    case 'phone_number':
      return String((a as { text?: string }).text ?? '');
    case 'number':
      return String((a as { number?: number }).number ?? '');
    case 'boolean':
      return String((a as { boolean?: boolean }).boolean ?? '');
    case 'date':
      return String((a as { date?: string }).date ?? '');
    default:
      return JSON.stringify(a);
  }
}

function collectStringKeys(rows: Record<string, unknown>[], path: 'metadata' | 'hidden') {
  const keys = new Set<string>();
  for (const row of rows) {
    const o = row[path] as Record<string, unknown> | undefined;
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) keys.add(k);
  }
  return [...keys].sort();
}

function collectAnswerRefs(rows: Record<string, unknown>[]) {
  const refs = new Set<string>();
  for (const row of rows) {
    const ans = row.answers as unknown[] | undefined;
    if (!Array.isArray(ans)) continue;
    for (const a of ans) {
      const fc = (a as { field?: { ref?: string } })?.field?.ref;
      if (fc) refs.add(fc);
    }
  }
  return refs;
}

function stringifyMetaLeaf(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function buildCsv(items: Record<string, unknown>[], fieldMapRefs: string[]) {
  const metaKs = collectStringKeys(items, 'metadata');
  const hiddenKs = collectStringKeys(items, 'hidden');

  const refOrder = [...new Set([...fieldMapRefs, ...collectAnswerRefs(items)])];

  const baseCols = ['response_id', 'token', 'response_type', 'export_bucket', 'landed_at', 'submitted_at', 'thankyou_screen_ref'];
  const metaCols = metaKs.map((k) => `metadata.${k}`);
  const hiddenCols = hiddenKs.map((k) => `hidden.${k}`);
  const varColsPrefix = [...new Set(items.flatMap((row) => (row.variables as { key?: string }[] | undefined)?.map((v) => v.key) ?? []))]
    .filter(Boolean)
    .sort()
    .map((k) => `variable.${String(k)}`);
  const calculatedCol = ['calculated_json'];

  const allCols = [
    ...baseCols,
    ...metaCols,
    ...hiddenCols,
    ...varColsPrefix,
    ...calculatedCol,
    ...refOrder.map((r) => `answer.${r}`),
  ];

  const lines: string[] = [rowToCsvLine(allCols, Object.fromEntries(allCols.map((c) => [c, c])))];

  for (const row of items) {
    const flat: Record<string, string> = {};
    flat['response_id'] = String(row.response_id ?? '');
    flat['token'] = String(row.token ?? '');
    flat['response_type'] = String(row.response_type ?? '');
    flat['export_bucket'] = String((row._export_bucket as string) ?? '');
    flat['landed_at'] = String(row.landed_at ?? '');
    flat['submitted_at'] = String(row.submitted_at ?? '');
    flat['thankyou_screen_ref'] = String(row.thankyou_screen_ref ?? '');

    const md = row.metadata as Record<string, unknown> | undefined;
    for (const k of metaKs) flat[`metadata.${k}`] = md?.[k] == null ? '' : stringifyMetaLeaf(md[k]);

    const hi = row.hidden as Record<string, unknown> | undefined;
    for (const k of hiddenKs) flat[`hidden.${k}`] = hi?.[k] == null ? '' : stringifyMetaLeaf(hi[k]);

    for (const k of varColsPrefix) flat[k] = '';
    const vars = row.variables as { key?: string; text?: string; number?: number; boolean?: boolean }[] | undefined;
    if (Array.isArray(vars))
      for (const v of vars) {
        if (!v?.key) continue;
        const col = `variable.${v.key}`;
        flat[col] =
          v.text ?? (v.number != null ? String(v.number) : v.boolean != null ? String(v.boolean) : flat[col]);
      }

    flat['calculated_json'] = row.calculated != null ? JSON.stringify(row.calculated) : '';

    for (const r of refOrder) flat[`answer.${r}`] = '';

    const answers = row.answers as Record<string, unknown>[] | undefined;
    if (Array.isArray(answers))
      for (const a of answers) {
        const ref = (a.field as { ref?: string } | undefined)?.ref;
        if (ref) flat[`answer.${ref}`] = answerToText(a);
      }

    lines.push(rowToCsvLine(allCols, flat));
  }

  return lines.join('\n') + '\n';
}

async function main() {
  const form = arg('--form') ?? 'mbO4IDgi';
  const since = arg('--since') ?? '2026-04-20T00:00:00Z';
  const until = arg('--until') ?? '2026-04-27T00:00:00Z';
  const fmt = (arg('--format') ?? 'csv').toLowerCase();
  if (fmt !== 'json' && fmt !== 'csv') throw new Error(`--format must be csv or json, got "${fmt}"`);
  const pretty = flag('--pretty');
  const ext = fmt === 'json' ? 'json' : 'csv';
  const defaultOut = `reports/${form}_${since.slice(0, 10)}_to_${until.slice(0, 10)}.${ext}`;
  const outPath = arg('--out') ?? defaultOut;

  const token = process.env.TYPEFORM_PERSONAL_TOKEN?.trim();
  if (!token) throw new Error('TYPEFORM_PERSONAL_TOKEN missing');

  const formDef = await typeformApi<{
    title?: string;
    fields?: unknown[];
  }>(token, `/forms/${form}`);

  const flatFields: FormField[] = [];
  collectFields(formDef.fields ?? [], flatFields);
  const fieldMapRefs = [...new Map(flatFields.filter((f) => f.ref).map((f) => [f.ref, f])).keys()];

  console.error(`Fetching ${form} ${since} … ${until} …`);
  const fetched = await fetchAllBuckets(token, form, since, until);

  const items: Record<string, unknown>[] = [];
  for (const response_type of RT)
    for (const row of fetched.itemsByType[response_type]) items.push({ ...row, _export_bucket: response_type });

  await mkdir(dirname(outPath), { recursive: true });

  if (fmt === 'json') {
    const payload = {
      exported_at: new Date().toISOString(),
      form_id: form,
      form_title: formDef.title,
      since,
      until,
      counts: {
        completed: fetched.itemsByType.completed.length,
        started: fetched.itemsByType.started.length,
        partial: fetched.itemsByType.partial.length,
        merged: items.length,
      },
      field_map: Object.fromEntries(
        [...new Map(flatFields.filter((f) => f.ref).map((f) => [f.ref, { id: f.id, type: f.type, title: f.title }]))].entries(),
      ),
      items,
    };
    await Bun.write(outPath, pretty ? `${JSON.stringify(payload, null, 2)}\n` : `${JSON.stringify(payload)}\n`);
  } else {
    const csv = buildCsv(items, fieldMapRefs);
    await Bun.write(outPath, csv);
  }

  console.error(`Wrote ${outPath} (${items.length} responses)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
