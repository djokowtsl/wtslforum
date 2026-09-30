import { neon } from '@neondatabase/serverless';

type Row = Record<string, any>;
let client: any = null;

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

/**
 * Tagged-template query. The connection is created lazily so a missing
 * DATABASE_URL no longer crashes every page at import time.
 */
export function sql(strings: TemplateStringsArray, ...values: any[]): Promise<Row[]> {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error('DATABASE_URL is not set'));
  client ??= neon(url);
  return client(strings, ...values);
}

/** Run a read and fall back to a default instead of taking the whole page down. */
export async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    console.error('[wtsl]', e instanceof Error ? e.message : e);
    return fallback;
  }
}
