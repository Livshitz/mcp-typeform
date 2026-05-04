import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class FileCacheOptions {
  dir = '.mcp-typeform/cache';
}

export class FileCache {
  public options: FileCacheOptions;
  public dir: string;

  public constructor(options?: Partial<FileCacheOptions>) {
    this.options = { ...new FileCacheOptions(), ...options };
    this.dir = resolve(this.options.dir);
    mkdirSync(this.dir, { recursive: true });
  }

  write(label: string, data: unknown) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safe}_${ts}.json`;
    const filePath = join(this.dir, filename);
    const json = JSON.stringify(data, null, 2);
    writeFileSync(filePath, json, 'utf-8');

    return {
      file: filePath,
      type: Array.isArray(data) ? 'array' : typeof data,
      ...(Array.isArray(data) && { length: data.length }),
      ...(data && typeof data === 'object' && !Array.isArray(data) && { childCount: Object.keys(data as object).length }),
      sizeBytes: json.length,
      preview: this.preview(data),
    };
  }

  private preview(data: unknown): string {
    if (data == null) return 'null';
    if (Array.isArray(data)) return `Array(${data.length})`;
    if (typeof data === 'object') {
      const keys = Object.keys(data as object).slice(0, 4);
      const more = Object.keys(data as object).length > 4 ? ', ...' : '';
      return `{ ${keys.join(', ')}${more} }`;
    }
    const s = String(data);
    return s.length > 80 ? s.slice(0, 80) + '...' : s;
  }
}
