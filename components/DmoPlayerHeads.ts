import * as THREE from 'three';

/**
 * Real faces for the native player: heads from Google's VALID avatar library
 * (MIT), transplanted onto native-player.glb offline (scripts/buildPlayerHeads.py).
 * Each head is the player's own head with its vertices moved onto that face's
 * shape, plus a face texture. The player keeps its own skeleton, eye sockets
 * and hair, so animation, eyes and hairstyles all still work.
 */
export type PlayerHead = {
  key: string;
  /** Native vertex count the head was made for (a guard against model changes). */
  vertexCount: number;
  /** Native vertex indices of the head, with their face-texture UVs and moves (metres). */
  indices: Uint16Array;
  uv: Float32Array;
  displacement: Float32Array;
  texture: THREE.Texture;
  /** The face's own skin tone, and its iris colour. */
  skin: number;
  iris: number;
};

export type HeadManifest = {
  version: number;
  vertexCount: number;
  regionCount: number;
  heads: { key: string; gender: 'male' | 'female'; skin: string; iris: string; texture: string }[];
};

const HEAD_DIRECTORY = 'player-heads';

/** A stable number for a string (for choosing a head). */
function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function colourDistance(a: number, b: number) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  // Lightness matters most for skin tone.
  const la = 0.3 * ca.r + 0.59 * ca.g + 0.11 * ca.b, lb = 0.3 * cb.r + 0.59 * cb.g + 0.11 * cb.b;
  return Math.abs(la - lb) * 3 + Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
}

/**
 * Which head each player gets: from their gender's heads, the same one every
 * time for the same seed. With a known complexion, from the three heads
 * closest in skin tone.
 */
export function choosePlayerHeads(
  heads: HeadManifest['heads'], gender: 'male' | 'female', seeds: string[], complexions: (number | null | undefined)[],
) {
  const pool = heads.filter(head => head.gender === gender);
  if (!pool.length) return seeds.map(() => null);
  const chosen: (string | null)[] = [];
  seeds.forEach((seed, index) => {
    const complexion = complexions[index];
    const candidates = complexion == null
      ? pool
      : [...pool].sort((a, b) => colourDistance(parseInt(a.skin.slice(1), 16), complexion)
        - colourDistance(parseInt(b.skin.slice(1), 16), complexion)).slice(0, Math.min(3, pool.length));
    let pick = candidates[hashString(seed || `player-${index}`) % candidates.length].key;
    // Two players in one match get different faces when there is a choice.
    if (index > 0 && pick === chosen[0] && candidates.length > 1) {
      pick = candidates[(hashString(seed) + 1) % candidates.length].key;
    }
    chosen.push(pick);
  });
  return chosen;
}

/** Read player-heads.bin (checked against its manifest). */
export function parsePlayerHeadData(manifest: HeadManifest, data: ArrayBuffer) {
  const view = new DataView(data);
  const magic = String.fromCharCode(...new Uint8Array(data, 0, 4));
  if (magic !== 'WTHD' || view.getUint32(4, true) !== 1) throw new Error('Unknown player head format.');
  const vertexCount = view.getUint32(8, true);
  const regionCount = view.getUint32(12, true);
  const headCount = view.getUint32(16, true);
  if (vertexCount !== manifest.vertexCount || regionCount !== manifest.regionCount || headCount !== manifest.heads.length) {
    throw new Error('Player head manifest does not match its data.');
  }
  let offset = 20;
  const indices = new Uint16Array(data.slice(offset, offset + regionCount * 2));
  offset += regionCount * 2;
  offset += (4 - (offset % 4)) % 4;
  const packedUv = new Uint16Array(data.slice(offset, offset + regionCount * 4));
  offset += regionCount * 4;
  const uv = new Float32Array(regionCount * 2);
  for (let i = 0; i < uv.length; i++) uv[i] = packedUv[i] / 65535;
  const moveBytes = regionCount * 6;
  if (data.byteLength < offset + moveBytes * headCount) throw new Error('Player head data is truncated.');
  const moves = new Map<string, Float32Array>();
  manifest.heads.forEach((head, index) => {
    const packed = new Int16Array(data.slice(offset + index * moveBytes, offset + (index + 1) * moveBytes));
    const displacement = new Float32Array(packed.length);
    for (let i = 0; i < packed.length; i++) displacement[i] = packed[i] * 1e-5;
    moves.set(head.key, displacement);
  });
  return { vertexCount, indices, uv, moves };
}

/** Load the heads for this match's players (null where none could be loaded). */
export async function loadPlayerHeads(
  gender: 'male' | 'female',
  seeds: string[],
  complexions: (number | null | undefined)[],
  signal?: AbortSignal,
  assetBase = '/models/dmo-humans',
): Promise<(PlayerHead | null)[]> {
  const base = `${assetBase.replace(/\/$/, '')}/${HEAD_DIRECTORY}`;
  const [manifestResponse, binaryResponse] = await Promise.all([
    fetch(`${base}/player-heads.json`, { signal }),
    fetch(`${base}/player-heads.bin`, { signal }),
  ]);
  if (!manifestResponse.ok || !binaryResponse.ok) throw new Error('Player heads are not available.');
  const manifest = await manifestResponse.json() as HeadManifest;
  const { vertexCount, indices, uv, moves } = parsePlayerHeadData(manifest, await binaryResponse.arrayBuffer());
  const keys = choosePlayerHeads(manifest.heads, gender, seeds, complexions);
  const loader = new THREE.TextureLoader();
  return Promise.all(keys.map(async (key) => {
    const head = manifest.heads.find(entry => entry.key === key);
    const displacement = key ? moves.get(key) : undefined;
    if (!head || !displacement) return null;
    try {
      const texture = await loader.loadAsync(`${base}/${head.texture}`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      return {
        key: head.key, vertexCount, indices, uv, displacement, texture,
        skin: parseInt(head.skin.slice(1), 16),
        iris: parseInt(head.iris.slice(1), 16),
      } satisfies PlayerHead;
    } catch {
      return null;
    }
  }));
}
