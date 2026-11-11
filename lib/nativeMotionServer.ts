import { NATIVE_MOTION_CATALOG_SHA256 } from './nativeMotionCatalog';
import type { NativeMotionCatalog } from './nativeMotionCatalogData';

export async function fetchNativeMotionCatalog(): Promise<NativeMotionCatalog> {
  const base = (process.env.WTSL_CORE_API_URL || '').replace(/\/+$/, '');
  const token = process.env.WTSL_CORE_API_KEY || '';
  if (!base || !token) throw new Error('Native motion Core API is not configured.');

  const response = await fetch(
    `${base}/api/core/native-motion/${NATIVE_MOTION_CATALOG_SHA256}/catalog.json`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error(`Native motion catalog request returned ${response.status}.`);
  const catalog = await response.json() as NativeMotionCatalog;
  if (catalog.format !== 'WTMC1' || !Array.isArray(catalog.clips) || !catalog.rig?.modelHash) {
    throw new Error('Native motion catalog did not pass format validation.');
  }
  return catalog;
}
