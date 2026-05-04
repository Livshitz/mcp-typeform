const BASE = 'https://api.typeform.com';

export async function typeformApi<T>(
  token: string,
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const hasBody = opts.body != null;
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw Object.assign(new Error(`Typeform API error ${res.status}: ${text}`), { status: res.status });
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export function requireToken(): string {
  const t = process.env.TYPEFORM_PERSONAL_TOKEN?.trim();
  if (!t) throw new Error('TYPEFORM_PERSONAL_TOKEN is not set');
  return t;
}
