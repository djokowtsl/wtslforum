import type { PlayerHead } from './DmoPlayerHeads';
import * as THREE from 'three';

/**
 * Skinned tennis garments share the native skeleton, including at the sleeves.
 *
 * Garment boundaries are scalar fields evaluated on the body's bind-pose
 * vertices (metres, model faces +Z, A-pose). A garment keeps a surface region
 * where every field is >= 0 and clips triangles exactly at the zero crossing,
 * so collars, cuffs and hems are clean lines that follow the anatomy:
 *  - the crew neckline follows the base of the neck (the old flat y = 1.375 cut
 *    ran BELOW the 1.38–1.43 m shoulder tops, leaving every shoulder bare);
 *  - sleeves are cut perpendicular to each upper arm (the old vertical x = ±0.29
 *    plane sliced the A-posed arm diagonally);
 *  - the shirt is layered outside the shorts' waistband;
 *  - body skin hidden under a garment is removed, so it cannot poke through.
 */
type Vertex = {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  weights: Map<number, number>;
  fields: number[];
};

const smooth = THREE.MathUtils.smoothstep;
const WTA_TANK_TOP_END_FRACTION = 0.06;
const WTA_CAP_SLEEVE_END_FRACTION = 0.24;
const STANDARD_SHORT_SLEEVE_END_FRACTION = 0.46;
const WTA_TENNIS_SKIRT_HEIGHT = 0.16;
const WTA_UNDER_SKIRT_SHORTS_HEM_Y = 0.74;

function taperedHairGeometry(path: THREE.CatmullRomCurve3, radius: number) {
  const tubularSegments = 24;
  const radialSegments = 8;
  const geometry = new THREE.TubeGeometry(path, tubularSegments, radius, radialSegments, false);
  const positions = geometry.getAttribute('position');
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (let ring = 0; ring <= tubularSegments; ring++) {
    const t = ring / tubularSegments;
    path.getPointAt(t, center);
    const taper = 0.2 + 0.8 * (1 - t) ** 0.6;
    for (let segment = 0; segment <= radialSegments; segment++) {
      const vertex = ring * (radialSegments + 1) + segment;
      point.fromBufferAttribute(positions, vertex).sub(center).multiplyScalar(taper).add(center);
      positions.setXYZ(vertex, point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}


const FACE_FEATURES = [
  'jaw', 'chin', 'chinForward', 'noseLength', 'noseWidth', 'noseBridge',
  'cheekbones', 'brow', 'lips', 'ears', 'width',
] as const;
type FaceFeature = typeof FACE_FEATURES[number];
export type FaceShape = {
  /** Each feature from -1 to 1 (0 is the base sculpt). */
  sculpt: Record<FaceFeature, number>;
  eyeColor: number;
  eyeColorName: string;
  browThickness: number;
  browArch: number;
  browLift: number;
};
const EYE_COLOURS: [string, number, number][] = [
  // name, colour, cumulative share
  ['dark-brown', 0x3a2418, 0.3],
  ['brown', 0x603e24, 0.55],
  ['hazel', 0x806234, 0.7],
  ['blue', 0x4a74a0, 0.85],
  ['green', 0x567648, 0.93],
  ['grey', 0x768088, 1.01],
];

/** A player's face, the same every time for the same seed. */
export function faceShapeFor(seed: string, female: boolean): FaceShape {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  state >>>= 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Centred on the base face: most players are near average, a few are not.
  const sculpt = Object.fromEntries(FACE_FEATURES.map(feature => [feature, next() + next() - 1])) as Record<FaceFeature, number>;
  if (female) {
    for (const feature of ['jaw', 'chin', 'brow', 'noseWidth'] as const) sculpt[feature] = sculpt[feature] * 0.6 - 0.35;
  }
  const pick = next();
  const [eyeColorName, eyeColor] = EYE_COLOURS.find(([, , share]) => pick < share) ?? EYE_COLOURS[0];
  return {
    sculpt,
    eyeColor,
    eyeColorName,
    browThickness: female ? 0.0058 + 0.0008 * next() : 0.0058 + 0.0018 * next(),
    browArch: female ? 0.003 + 0.0015 * next() : 0.003 * next(),
    browLift: female ? 0.0008 : 0,
  };
}

/**
 * Wrap the body's head onto a transplanted face: move its vertices, give
 * them the face texture's UVs, and bend the normals to the new shape.
 * Returns the head's vertices, or null if the head doesn't fit this model.
 */
function applyPlayerHead(body: THREE.SkinnedMesh, head: PlayerHead) {
  const geometry = body.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  if (positions.count !== head.vertexCount || !geometry.index) return null;
  // Split copies of a vertex (at seams) share a position: merge them for normals.
  const keyOf = (i: number) => `${Math.round(positions.getX(i) * 1e5)},${Math.round(positions.getY(i) * 1e5)},${Math.round(positions.getZ(i) * 1e5)}`;
  const keys = new Map<number, string>();
  const region = new Set<number>();
  for (const index of head.indices) { region.add(index); keys.set(index, keyOf(index)); }
  const toBody = new THREE.Matrix3().setFromMatrix4(body.matrixWorld.clone().invert());
  const move = new THREE.Vector3();
  head.indices.forEach((vertex, k) => {
    move.set(head.displacement[k * 3], head.displacement[k * 3 + 1], head.displacement[k * 3 + 2]).applyMatrix3(toBody);
    positions.setXYZ(vertex, positions.getX(vertex) + move.x, positions.getY(vertex) + move.y, positions.getZ(vertex) + move.z);
  });
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const uvs = uv ? uv : new THREE.BufferAttribute(new Float32Array(positions.count * 2), 2);
  head.indices.forEach((vertex, k) => uvs.setXY(vertex, head.uv[k * 2], head.uv[k * 2 + 1]));
  geometry.setAttribute('uv', uvs);
  uvs.needsUpdate = true;
  // Fresh normals over the head (face normals summed per merged position).
  const sums = new Map<string, THREE.Vector3>();
  const index = geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (!tri.some(v => region.has(v))) continue;
    a.fromBufferAttribute(positions, tri[0]); b.fromBufferAttribute(positions, tri[1]); c.fromBufferAttribute(positions, tri[2]);
    const face = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    for (const v of tri) {
      if (!region.has(v)) continue;
      const key = keys.get(v)!;
      const sum = sums.get(key);
      if (sum) sum.add(face); else sums.set(key, face.clone());
    }
  }
  for (const vertex of region) {
    const sum = sums.get(keys.get(vertex)!);
    if (sum && sum.lengthSq() > 0) {
      sum.normalize();
      normals.setXYZ(vertex, sum.x, sum.y, sum.z);
    }
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  return region;
}

type FaceBump = { centre: THREE.Vector3; sigma: number; direction: THREE.Vector3; amount: number };
/** Smooth local pushes (head-local) that shape the jaw, chin, nose, cheeks, brow, lips and ears. */
function faceBumps(sculpt: Record<FaceFeature, number>): FaceBump[] {
  const spec: [[number, number, number], number, [number, number, number], number, boolean][] = [
    [[0.055, -0.045, 0.03], 0.025, [1, 0, 0], 0.009 * sculpt.jaw, true],
    [[0, -0.075, 0.08], 0.022, [0, -1, 0.3], 0.008 * sculpt.chin, false],
    [[0, -0.075, 0.08], 0.022, [0, 0, 1], 0.007 * sculpt.chinForward, false],
    [[0, -0.005, 0.12], 0.012, [0, -0.6, 0.8], 0.006 * sculpt.noseLength, false],
    [[0.016, -0.008, 0.105], 0.01, [1, 0, 0], 0.004 * sculpt.noseWidth, true],
    [[0, 0.025, 0.11], 0.012, [0, 0, 1], 0.0045 * sculpt.noseBridge, false],
    [[0.052, 0.012, 0.075], 0.018, [0.7, 0, 0.7], 0.006 * sculpt.cheekbones, true],
    [[0.03, 0.058, 0.095], 0.016, [0, 0, 1], 0.004 * sculpt.brow, true],
    [[0, -0.04, 0.105], 0.01, [0, 0, 1], 0.003 * sculpt.lips, false],
    [[0.08, 0.02, 0], 0.02, [1, 0, -0.3], 0.004 * sculpt.ears, true],
  ];
  const bumps: FaceBump[] = [];
  for (const [[x, y, z], sigma, [dx, dy, dz], amount, mirrored] of spec) {
    const direction = new THREE.Vector3(dx, dy, dz).normalize();
    bumps.push({ centre: new THREE.Vector3(x, y, z), sigma, direction, amount });
    if (mirrored) bumps.push({ centre: new THREE.Vector3(-x, y, z), sigma, direction: direction.clone().setX(-direction.x), amount });
  }
  return bumps;
}

/** Displacement at head-local `l`, and (optionally) its Jacobian for bending normals. */
function faceDisplacement(l: THREE.Vector3, bumps: FaceBump[], width: number, jacobian?: THREE.Matrix3) {
  const out = new THREE.Vector3();
  const j = jacobian ? new Array(9).fill(0) : null;
  for (const bump of bumps) {
    if (!bump.amount) continue;
    const rx = l.x - bump.centre.x, ry = l.y - bump.centre.y, rz = l.z - bump.centre.z;
    const falloff = Math.exp(-(rx * rx + ry * ry + rz * rz) / (2 * bump.sigma * bump.sigma));
    if (falloff < 1e-4) continue;
    out.addScaledVector(bump.direction, bump.amount * falloff);
    if (j) {
      const g = -bump.amount * falloff / (bump.sigma * bump.sigma);
      const d = bump.direction;
      const r = [rx, ry, rz];
      const dv = [d.x, d.y, d.z];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) j[a * 3 + b] += dv[a] * g * r[b];
    }
  }
  // A wider or narrower lower face.
  out.x += l.x * 0.045 * width * smooth(-l.y, -0.06, 0);
  if (j && jacobian) jacobian.set(j[0], j[1], j[2], j[3], j[4], j[5], j[6], j[7], j[8]);
  return out;
}

/** Fit a sphere to the head-local points (least squares); null if it is degenerate. */
function fitSphere(points: THREE.Vector3[]) {
  if (points.length < 12) return null;
  // Solve [2x 2y 2z 1] [cx cy cz k]^T = x²+y²+z² by its normal equations.
  const m = Array.from({ length: 4 }, () => new Array(5).fill(0));
  for (const p of points) {
    const row = [2 * p.x, 2 * p.y, 2 * p.z, 1];
    const rhs = p.lengthSq();
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) m[a][b] += row[a] * row[b];
      m[a][4] += row[a] * rhs;
    }
  }
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c < 5; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const centre = new THREE.Vector3(m[0][4] / m[0][0], m[1][4] / m[1][1], m[2][4] / m[2][2]);
  const radius = Math.sqrt(m[3][4] / m[3][3] + centre.lengthSq());
  return Number.isFinite(radius) ? { centre, radius } : null;
}

/**
 * The player model's eye sockets are empty spheres. Find them, then sculpt
 * the face (moving each socket rigidly so the eyes still fit). Returns the
 * sockets where they ended up, in head-local coordinates.
 */
function sculptFace(body: THREE.SkinnedMesh, head: THREE.Bone, face: FaceShape) {
  const geometry = body.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const headIndex = body.skeleton.bones.indexOf(head);
  const bodyToHead = head.matrixWorld.clone().invert().multiply(body.matrixWorld);
  const headToBody = bodyToHead.clone().invert();
  const rotateToHead = new THREE.Matrix3().setFromMatrix4(bodyToHead);
  const rotateToBody = new THREE.Matrix3().setFromMatrix4(headToBody);
  const local = Array.from({ length: positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(bodyToHead));

  const sockets: { centre: THREE.Vector3; radius: number }[] = [];
  for (const side of [1, -1]) {
    const inside = local.filter(l => {
      const x = l.x * side;
      return x > 0.012 && x < 0.052 && l.y > 0.022 && l.y < 0.056 && l.z > 0.05 && l.z < 0.078;
    });
    const fit = fitSphere(inside);
    const plausible = fit && fit.radius > 0.009 && fit.radius < 0.02 && Math.abs(Math.abs(fit.centre.x) - 0.03) < 0.012;
    sockets.push(plausible ? fit! : { centre: new THREE.Vector3(side * 0.0298, 0.0392, 0.08), radius: 0.0149 });
  }

  const bumps = faceBumps(face.sculpt);
  const width = face.sculpt.width;
  const socketMoves = sockets.map(socket => faceDisplacement(socket.centre, bumps, width));
  const jacobian = new THREE.Matrix3();
  const normal = new THREE.Vector3();
  const bend = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    let headWeight = 0;
    for (let k = 0; k < 4; k++) if (skinIndex.getComponent(i, k) === headIndex) headWeight += skinWeight.getComponent(i, k);
    const weight = smooth(headWeight, 0.3, 0.9);
    if (weight <= 0) continue;
    const l = local[i];
    const move = faceDisplacement(l, bumps, width, jacobian);
    let bendScale = 1;
    // Inside a socket the face moves as the socket's centre does, so it stays a sphere.
    for (const [s, socket] of sockets.entries()) {
      const rigid = 1 - smooth(l.distanceTo(socket.centre), socket.radius + 0.003, socket.radius + 0.012);
      if (rigid > 0) {
        move.lerp(socketMoves[s], rigid);
        bendScale *= 1 - rigid;
      }
    }
    move.multiplyScalar(weight);
    const moved = l.clone().add(move).applyMatrix4(headToBody);
    positions.setXYZ(i, moved.x, moved.y, moved.z);
    // Normals bend by (I + J)^-T ≈ I - Jᵀ.
    normal.fromBufferAttribute(normals, i).applyMatrix3(rotateToHead);
    bend.copy(normal).applyMatrix3(jacobian.clone().transpose()).multiplyScalar(weight * bendScale);
    normal.sub(bend).applyMatrix3(rotateToBody).normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.computeBoundingSphere();
  return sockets.map((socket, s) => ({ centre: socket.centre.clone().add(socketMoves[s]), radius: socket.radius }));
}

function shapeWtaBody(body: THREE.SkinnedMesh, model: THREE.Group) {
  const positions = body.geometry.getAttribute('position');
  const skinIndex = body.geometry.getAttribute('skinIndex');
  const skinWeight = body.geometry.getAttribute('skinWeight');
  const torsoBones = new Set(body.skeleton.bones
    .map((bone, index) => /^(pelvis|spine_0[123])$/.test(bone.name) ? index : -1)
    .filter(index => index >= 0));
  const bodyToModel = new THREE.Matrix4().multiplyMatrices(
    model.matrixWorld.clone().invert(),
    body.matrixWorld,
  );
  const modelToBody = bodyToModel.clone().invert();
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    let torsoWeight = 0;
    for (let k = 0; k < 4; k++) {
      if (torsoBones.has(skinIndex.getComponent(vertex, k))) {
        torsoWeight += skinWeight.getComponent(vertex, k);
      }
    }
    if (torsoWeight < 0.2) continue;

    point.fromBufferAttribute(positions, vertex).applyMatrix4(bodyToModel);
    const hip = smooth(point.y, 0.77, 0.86) * (1 - smooth(point.y, 1.02, 1.12));
    const waist = smooth(point.y, 0.98, 1.05) * (1 - smooth(point.y, 1.14, 1.22));
    const shoulder = smooth(point.y, 1.37, 1.45);
    point.x *= 1 + torsoWeight * (0.18 * hip - 0.12 * waist - 0.07 * shoulder);

    const front = smooth(point.z, 0.02, 0.08);
    const leftBust = Math.exp(-(((point.x + 0.056) / 0.046) ** 2 + ((point.y - 1.235) / 0.065) ** 2));
    const rightBust = Math.exp(-(((point.x - 0.056) / 0.046) ** 2 + ((point.y - 1.235) / 0.065) ** 2));
    point.z += torsoWeight * front * 0.05 * Math.max(leftBust, rightBust);

    point.applyMatrix4(modelToBody);
    positions.setXYZ(vertex, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
}

type MaleHairStyle = 'short-crop' | 'textured-crop' | 'curly-top' | 'side-part' | 'swept-back' | 'buzz-cut'
  | 'quiff' | 'afro' | 'flow' | 'man-bun';
type FemaleHairStyle = 'swept' | 'ponytail' | 'high-ponytail' | 'low-ponytail' | 'braid' | 'double-braid' | 'bun' | 'bob'
  | 'pixie' | 'curly' | 'puffs';
type TennisTopStyle = 'sleeveless' | 'cap-sleeve' | 'short-sleeve';
/** Neck of the top: crew, a polo collar with a buttoned placket, or a V. */
type NeckStyle = 'crew' | 'polo' | 'v-neck';
/** Back of a sleeveless women's top: a standard tank or a racerback. */
type BackStyle = 'standard' | 'racerback';
type ShirtPattern = 'solid' | 'chest-band' | 'side-panels' | 'yoke';
type Headwear = 'none' | 'headband' | 'visor';
type FacialHair = 'none' | 'stubble' | 'short-beard' | 'full-beard' | 'goatee' | 'moustache';

/**
 * Where hair and face details sit on this player model, measured from its
 * own head at dressing time (head-local coordinates).
 */
type HeadGuide = {
  /** The head's surface along `direction` from the skull's centre, lifted by `lift`. */
  surface: (direction: THREE.Vector3, lift?: number) => THREE.Vector3;
  /** A closed loop round the forehead and over the hair, for a headband. */
  band: THREE.Vector3[];
  earLobe: THREE.Vector3 | null;
  lips: THREE.Vector3 | null;
  cheek: THREE.Vector3 | null;
  /** The eye sockets (player's left, then right): centre and radius. */
  eyes: { centre: THREE.Vector3; radius: number }[];
  face: FaceShape;
  ringRadius: (angle: number, y: number) => number;
  hair: HairShape;
};
const SKULL_CENTRE = new THREE.Vector3(0, 0.055, 0.006);

export type NativePlayerKit = {
  id: string;
  shirtColor: number;
  shortsColor: number;
  skinColor?: number | null;
  /**
   * Who is wearing the kit (e.g. the player's name). Their face is built from
   * it, so the same player keeps the same face whatever kit they draw.
   */
  faceSeed?: string | null;
  /** A real face for this player (see DmoPlayerHeads); without one, a sculpted face. */
  head?: PlayerHead | null;
  accentColor: number;
  hairColor: number;
  maleHairStyle: MaleHairStyle;
  femaleHairStyle: FemaleHairStyle;
  maleTopStyle: TennisTopStyle;
  femaleTopStyle: TennisTopStyle;
  shirtPattern: ShirtPattern;
  headwear: Headwear;
  facialHair: FacialHair;
  skirtLength: number;
  /** Invented sportswear maker (index into KIT_SPORTSWEAR_BRANDS). */
  brand: number;
  /** Invented sleeve partner (index into KIT_PARTNER_BRANDS). */
  partner: number;
  maleNeck: NeckStyle;
  femaleNeck: NeckStyle;
  femaleBack: BackStyle;
};

/**
 * Invented sportswear makers and partners for the kits: original names and
 * marks, never real brands or anything made to look like one.
 */
export const KIT_SPORTSWEAR_BRANDS = [
  { name: 'VANTRE', mark: 'bars' },
  { name: 'KESTRYN', mark: 'diamond' },
  { name: 'ORBITA', mark: 'ring' },
  { name: 'HALDEN', mark: 'hex' },
  { name: 'NOVARC', mark: 'split-square' },
] as const;
export const KIT_PARTNER_BRANDS = ['TEMPORIQ', 'ALDERWYN', 'LUMARA', 'QUINTARA'] as const;

/** Per kit (by position in its list): neck and back cuts. */
const ATP_NECKS: NeckStyle[] = [
  'polo', 'crew', 'v-neck', 'polo', 'crew', 'polo', 'crew', 'crew',
  'v-neck', 'crew', 'polo', 'crew', 'crew', 'polo', 'v-neck', 'crew',
];
const WTA_NECKS: NeckStyle[] = [
  'crew', 'crew', 'v-neck', 'crew', 'crew', 'v-neck', 'crew', 'crew',
  'polo', 'crew', 'v-neck', 'crew', 'crew', 'polo', 'crew', 'crew',
];

function withCuts(kits: NativePlayerKit[], necks: NeckStyle[], female: boolean): NativePlayerKit[] {
  return kits.map((kit, index) => {
    const top = female ? kit.femaleTopStyle : kit.maleTopStyle;
    // A collar needs sleeves; sleeveless tops keep a crew or scoop neck.
    const neck = top === 'sleeveless' && necks[index] === 'polo' ? 'crew' : necks[index];
    return {
      ...kit,
      brand: index % KIT_SPORTSWEAR_BRANDS.length,
      partner: (index * 3 + 1) % KIT_PARTNER_BRANDS.length,
      maleNeck: female ? kit.maleNeck : neck,
      femaleNeck: female ? neck : kit.femaleNeck,
      // Every other sleeveless women's top is a racerback.
      femaleBack: female && top === 'sleeveless' && index % 2 === 0 ? 'racerback' : 'standard',
    };
  });
}

function createTennisKit(
  id: string,
  shirtColor: number,
  shortsColor: number,
  accentColor: number,
  hairColor: number,
  maleHairStyle: MaleHairStyle,
  femaleHairStyle: FemaleHairStyle,
  maleTopStyle: TennisTopStyle,
  femaleTopStyle: TennisTopStyle,
  shirtPattern: ShirtPattern,
  headwear: Headwear,
  facialHair: FacialHair = 'none',
  skirtLength = WTA_TENNIS_SKIRT_HEIGHT,
): NativePlayerKit {
  return {
    id,
    shirtColor,
    shortsColor,
    accentColor,
    hairColor,
    maleHairStyle,
    femaleHairStyle,
    maleTopStyle,
    femaleTopStyle,
    shirtPattern,
    headwear,
    facialHair,
    skirtLength,
    brand: 0,
    partner: 1,
    maleNeck: 'crew',
    femaleNeck: 'crew',
    femaleBack: 'standard',
  };
}

export const ATP_PLAYER_KITS: NativePlayerKit[] = withCuts([
  createTennisKit('men-classic-white', 0xf0eee7, 0x26343a, 0xc9433a, 0x2b2522, 'side-part', 'swept', 'short-sleeve', 'sleeveless', 'side-panels', 'headband'),
  createTennisKit('men-royal-court', 0x245ca8, 0xf1eee7, 0xe8c844, 0x493429, 'textured-crop', 'ponytail', 'sleeveless', 'short-sleeve', 'chest-band', 'visor', 'short-beard', 0.17),
  createTennisKit('men-deep-teal', 0x167a77, 0x202b35, 0xb4d65a, 0x211d1b, 'curly-top', 'high-ponytail', 'short-sleeve', 'cap-sleeve', 'yoke', 'none', 'stubble'),
  createTennisKit('men-forest-green', 0x35614d, 0xe9e1cd, 0xb6be7a, 0x604636, 'flow', 'low-ponytail', 'short-sleeve', 'short-sleeve', 'side-panels', 'headband', 'stubble'),
  createTennisKit('men-burgundy', 0x762e47, 0x202b35, 0xd0ad79, 0x241b1a, 'buzz-cut', 'bun', 'sleeveless', 'sleeveless', 'yoke', 'none', 'full-beard'),
  createTennisKit('men-sky-blue', 0x66b4d4, 0x253957, 0xf2eee1, 0x9a6843, 'quiff', 'braid', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-black-coral', 0x282d35, 0x282d35, 0xe57f72, 0x302720, 'man-bun', 'double-braid', 'sleeveless', 'short-sleeve', 'side-panels', 'headband', 'goatee'),
  createTennisKit('men-orange-white', 0xe67635, 0xf0eee7, 0x363c49, 0x5b3d2a, 'afro', 'bob', 'short-sleeve', 'sleeveless', 'yoke', 'none', 'stubble'),
  createTennisKit('men-lavender', 0x8175ad, 0x29313e, 0xe6d9c7, 0x332a27, 'swept-back', 'swept', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor', 'short-beard'),
  createTennisKit('men-mint-white', 0x9dcdb9, 0x26343a, 0x477563, 0x72503b, 'short-crop', 'ponytail', 'sleeveless', 'short-sleeve', 'side-panels', 'none', 'moustache'),
  createTennisKit('men-navy-gold', 0x1e2b4c, 0xe5dfd2, 0xd1b06d, 0x30231e, 'side-part', 'low-ponytail', 'short-sleeve', 'sleeveless', 'yoke', 'headband', 'short-beard'),
  createTennisKit('men-red-white', 0xc63b43, 0x2e3845, 0xf2eee7, 0x86553b, 'textured-crop', 'high-ponytail', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-stone-lime', 0xbab9ad, 0x343a36, 0x9ebc46, 0x28211f, 'curly-top', 'bun', 'sleeveless', 'short-sleeve', 'side-panels', 'none', 'full-beard'),
  createTennisKit('men-white-lime', 0xf2efe3, 0x61704a, 0xc7d95c, 0x523b2d, 'flow', 'braid', 'short-sleeve', 'sleeveless', 'yoke', 'headband', 'stubble'),
  createTennisKit('men-teal-white', 0x195f69, 0xf1eee7, 0x80c2bc, 0x392b25, 'buzz-cut', 'double-braid', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor', 'goatee'),
  createTennisKit('men-charcoal-gold', 0x41444a, 0x282c34, 0xc5a25e, 0x7a553b, 'quiff', 'bob', 'sleeveless', 'short-sleeve', 'side-panels', 'none', 'stubble'),
], ATP_NECKS, false);

export const WTA_PLAYER_KITS: NativePlayerKit[] = withCuts([
  createTennisKit('women-coral-classic', 0xd95f66, 0x273b54, 0xf4eee2, 0x38231f, 'side-part', 'swept', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.16),
  createTennisKit('women-royal-pleats', 0x245ca8, 0xf1eee7, 0xe9cc54, 0x573a2b, 'textured-crop', 'high-ponytail', 'sleeveless', 'cap-sleeve', 'chest-band', 'visor', 'none', 0.17),
  createTennisKit('women-mint-court', 0x91cbb5, 0x26343a, 0xe2d6b6, 0x251d19, 'curly-top', 'low-ponytail', 'short-sleeve', 'short-sleeve', 'yoke', 'none', 'none', 0.15),
  createTennisKit('women-teal-stripe', 0x1e7777, 0x173d47, 0xd7e7d2, 0x8a5b3d, 'swept-back', 'curly', 'short-sleeve', 'cap-sleeve', 'chest-band', 'headband', 'none', 0.18),
  createTennisKit('women-plum-skirt', 0x653c74, 0x30233e, 0xd7b79b, 0x2d211e, 'buzz-cut', 'bun', 'sleeveless', 'sleeveless', 'side-panels', 'none', 'none', 0.16),
  createTennisKit('women-sky-court', 0x70b9dc, 0x243955, 0xf4eee2, 0x9a6645, 'side-part', 'double-braid', 'short-sleeve', 'sleeveless', 'yoke', 'visor', 'none', 0.17),
  createTennisKit('women-lemon-dress', 0xe6d45d, 0x4a513c, 0xf5f0df, 0x4f3527, 'textured-crop', 'bob', 'sleeveless', 'sleeveless', 'solid', 'headband', 'none', 0.15),
  createTennisKit('women-black-rose', 0x30313a, 0x292d37, 0xd87991, 0x211b1a, 'curly-top', 'puffs', 'short-sleeve', 'short-sleeve', 'side-panels', 'visor', 'none', 0.18),
  createTennisKit('women-red-white', 0xc4414d, 0xf1eee7, 0x344866, 0x7f4c32, 'swept-back', 'ponytail', 'short-sleeve', 'cap-sleeve', 'chest-band', 'none', 'none', 0.16),
  createTennisKit('women-lilac-white', 0xb4a8d2, 0xf1eee7, 0x50466f, 0x362522, 'buzz-cut', 'low-ponytail', 'sleeveless', 'sleeveless', 'yoke', 'headband', 'none', 0.15),
  createTennisKit('women-forest-gold', 0x355b4e, 0x233a34, 0xd8c479, 0x573d2b, 'side-part', 'pixie', 'short-sleeve', 'short-sleeve', 'side-panels', 'visor', 'none', 0.18),
  createTennisKit('women-orange-navy', 0xe77b42, 0x273b54, 0xf2ead8, 0x2d201c, 'textured-crop', 'bun', 'sleeveless', 'cap-sleeve', 'chest-band', 'none', 'none', 0.16),
  createTennisKit('women-white-lime', 0xf1eee5, 0x66734b, 0xc7d95c, 0x86563c, 'curly-top', 'double-braid', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.17),
  createTennisKit('women-navy-teal', 0x243753, 0x1c6463, 0x8ec9be, 0x34231e, 'swept-back', 'swept', 'short-sleeve', 'short-sleeve', 'yoke', 'visor', 'none', 0.16),
  createTennisKit('women-peach-skirt', 0xe8ae91, 0x984b55, 0xf4eee2, 0x583a2b, 'buzz-cut', 'ponytail', 'sleeveless', 'cap-sleeve', 'chest-band', 'none', 'none', 0.15),
  createTennisKit('women-graphite-pink', 0x55545d, 0x303039, 0xe28ca0, 0x241d1a, 'side-part', 'curly', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.18),
], WTA_NECKS, true);

export const BROADCAST_PLAYER_KITS: [NativePlayerKit, NativePlayerKit] = [
  ATP_PLAYER_KITS[0],
  ATP_PLAYER_KITS[1],
];

const textureCache = new Map<string, THREE.CanvasTexture | null>();

/** Dark ink on light kit colours, light ink on dark ones. */
function inkFor(color: number) {
  const c = new THREE.Color(color);
  const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luminance > 0.45 ? '#1d2633' : '#f4f1e8';
}

/** An invented maker's mark, drawn in a square of side `size` at (x, y). */
function drawBrandMark(context: CanvasRenderingContext2D, mark: string, x: number, y: number, size: number) {
  context.save();
  context.translate(x + size / 2, y + size / 2);
  const r = size / 2;
  context.beginPath();
  if (mark === 'bars') {
    // Three rising slanted bars.
    for (let bar = 0; bar < 3; bar++) {
      const height = r * (0.8 + bar * 0.45);
      const left = -r * 0.95 + bar * r * 0.68;
      context.moveTo(left, r * 0.9);
      context.lineTo(left + r * 0.42, r * 0.9);
      context.lineTo(left + r * 0.62, r * 0.9 - height);
      context.lineTo(left + r * 0.2, r * 0.9 - height);
      context.closePath();
    }
    context.fill();
  } else if (mark === 'diamond') {
    // A diamond with a smaller diamond cut out, off-centre.
    context.moveTo(0, -r);
    context.lineTo(r, 0);
    context.lineTo(0, r);
    context.lineTo(-r, 0);
    context.closePath();
    context.moveTo(r * 0.3, -r * 0.36);
    context.lineTo(r * 0.66, 0);
    context.lineTo(r * 0.3, r * 0.36);
    context.lineTo(-r * 0.06, 0);
    context.closePath();
    context.fill('evenodd');
  } else if (mark === 'ring') {
    context.lineWidth = r * 0.32;
    context.arc(0, 0, r * 0.74, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(r * 0.36, -r * 0.36, r * 0.2, 0, Math.PI * 2);
    context.fill();
  } else if (mark === 'hex') {
    context.lineWidth = r * 0.22;
    for (let side = 0; side < 6; side++) {
      const angle = Math.PI / 6 + side * Math.PI / 3;
      context[side ? 'lineTo' : 'moveTo'](Math.cos(angle) * r * 0.9, Math.sin(angle) * r * 0.9);
    }
    context.closePath();
    context.stroke();
    context.fillRect(-r * 0.32, -r * 0.42, r * 0.16, r * 0.84);
    context.fillRect(r * 0.16, -r * 0.42, r * 0.16, r * 0.84);
    context.fillRect(-r * 0.32, -r * 0.08, r * 0.64, r * 0.16);
  } else {
    // A square split on the diagonal, the lower half filled.
    context.lineWidth = r * 0.2;
    context.strokeRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    context.moveTo(-r * 0.8, r * 0.8);
    context.lineTo(r * 0.8, -r * 0.8);
    context.lineTo(r * 0.8, r * 0.8);
    context.closePath();
    context.fill();
  }
  context.restore();
}

/** A transparent wordmark texture (no box, printed straight onto the kit). */
function wordmarkTexture(text: string, mark: string | null, ink: string, accent: string) {
  const key = `${text}|${mark}|${ink}|${accent}`;
  if (textureCache.has(key)) return textureCache.get(key) ?? undefined;
  let texture: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      let x = 18;
      if (mark) {
        context.fillStyle = accent;
        context.strokeStyle = accent;
        drawBrandMark(context, mark, x, 26, 108);
        x += 132;
      }
      context.fillStyle = ink;
      context.textBaseline = 'middle';
      context.textAlign = mark ? 'left' : 'center';
      let size = 88;
      const room = mark ? canvas.width - x - 14 : canvas.width - 36;
      // Letter-spaced like a printed wordmark.
      const spaced = text.split('').join(String.fromCharCode(8202));
      do {
        context.font = `800 ${size}px Arial, sans-serif`;
        size -= 4;
      } while (size > 30 && context.measureText(spaced).width > room);
      context.fillText(spaced, mark ? x : canvas.width / 2, 84);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
    }
  }
  textureCache.set(key, texture);
  return texture ?? undefined;
}

/**
 * A printed logo on the kit, placed on the bind-pose surface at `point`
 * (facing `normal`) and carried by `bone`.
 */
function addKitPrint(
  model: THREE.Group,
  bone: THREE.Object3D | undefined,
  name: string,
  texture: THREE.CanvasTexture | undefined,
  fallbackColor: number,
  width: number,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  up: THREE.Vector3,
) {
  if (!bone) return null;
  const print = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 3.2),
    new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : fallbackColor,
      ...(texture ? { map: texture, transparent: true, alphaTest: 0.3 } : {}),
      roughness: 0.7,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  print.name = name;
  model.add(print);
  model.updateMatrixWorld(true);
  const world = point.clone().addScaledVector(normal, 0.0035);
  print.position.copy(model.worldToLocal(world.clone()));
  print.up.copy(up);
  print.lookAt(world.clone().add(normal));
  bone.attach(print);
  return print;
}

type HeadField = (l: THREE.Vector3) => number;
const hairSmooth = THREE.MathUtils.smoothstep;

const HAIRLINE_ANGLES = [0, 0.45, 0.75, 1.05, 1.35, 1.8, 2.1, 2.5, Math.PI];
/** Round the head from the front (0) to the back (π), head-local. */
function headAzimuth(l: THREE.Vector3) {
  return Math.abs(Math.atan2(l.x, l.z - SKULL_CENTRE.z));
}
/**
 * Head-local hairline (positive on the scalp): across the forehead, back at
 * the temples, down to a sideburn in front of the ear, over the ear and down
 * behind it to the nape.
 */
function hairline(l: THREE.Vector3, front = 0.1, side = 0.052, nape = -0.03, sideburn = true) {
  const angle = headAzimuth(l);
  const heights = [front, front - 0.002, front - 0.02, (front + side) / 2 + 0.004, side, side - 0.002, 0.02, nape + 0.01, nape];
  let height = nape;
  for (let k = 1; k < HAIRLINE_ANGLES.length; k++) {
    if (angle <= HAIRLINE_ANGLES[k]) {
      const t = (angle - HAIRLINE_ANGLES[k - 1]) / (HAIRLINE_ANGLES[k] - HAIRLINE_ANGLES[k - 1]);
      height = heights[k - 1] + (heights[k] - heights[k - 1]) * t;
      break;
    }
  }
  let field = l.y - height;
  if (sideburn) field = Math.max(field, Math.min(l.y - 0.012, (angle - 1.28) * 0.05, (1.52 - angle) * 0.05));
  return field;
}
/** Gentle light and dark streaks through hair (0..1). */
function hairStrands(l: THREE.Vector3) {
  const a = Math.atan2(l.x, l.z - SKULL_CENTRE.z);
  return 0.5 + 0.25 * Math.sin(a * 41 + l.y * 30) * Math.sin(l.y * 57 - a * 5) + 0.25 * Math.sin(a * 97 + l.y * 11);
}

/** Long hair that hangs from the head rather than hugging the neck. */
type HairCurtain = { bottom: number; flare: number; curl: number; bump: number; reach: number };
type HairShape = {
  field: HeadField;
  offset: (l: THREE.Vector3, f: number) => number;
  /** How far in from the hairline the hair fades in (soft edge). */
  fade: number;
  /** How strong the light and dark streaks are. */
  streaks: number;
  curtain?: HairCurtain;
};

/**
 * Each hairstyle's shell: where it covers (field ≥ 0) and how far it stands
 * off the scalp (`offset`, from the head-local point and its field value).
 */
function hairShape(style: string): HairShape {
  const crop = (l: THREE.Vector3) => hairline(l);
  const shape = (field: HeadField, offset: HairShape['offset'], extra: Partial<HairShape> = {}): HairShape =>
    ({ field, offset, fade: 0.008, streaks: 0.13, ...extra });
  switch (style) {
    case 'buzz-cut':
      return shape(l => hairline(l, 0.098), () => 0.0016, { fade: 0.004, streaks: 0.05 });
    case 'side-part':
      return shape(crop, (l, f) => 0.004 + 0.006 * hairSmooth(f, 0, 0.03) * hairSmooth(l.y, 0.09, 0.14));
    case 'textured-crop':
      return shape(crop, (l, f) => 0.005 + hairSmooth(f, 0, 0.02)
        * (0.004 + 0.008 * Math.max(0, Math.sin(l.x * 85) * Math.sin(l.z * 70 + l.y * 45))));
    case 'quiff':
      return shape(crop, (l, f) => 0.003 + hairSmooth(f, 0, 0.025)
        * (0.004 + 0.024 * hairSmooth(l.z, 0, 0.08) * hairSmooth(l.y, 0.08, 0.13)));
    case 'afro':
      return shape(l => hairline(l, 0.096, 0.05, -0.02), (_, f) => 0.004 + 0.03 * hairSmooth(f, 0, 0.04));
    case 'flow':
      return shape(l => hairline(l, 0.1, 0.03, -0.01), (_, f) => 0.006 + 0.003 * hairSmooth(f, 0, 0.03),
        { curtain: { bottom: -0.062, flare: 0.01, curl: 0, bump: 0, reach: 1.72 } });
    case 'bob':
      return shape(l => hairline(l, 0.1, 0.028, -0.01), (_, f) => 0.007 + 0.004 * hairSmooth(f, 0, 0.03),
        { curtain: { bottom: -0.05, flare: 0.006, curl: 0.008, bump: 0, reach: 1.85 } });
    case 'curly':
      return shape(l => hairline(l, 0.1, 0.028, -0.01), (l, f) => 0.01 + 0.02 * hairSmooth(f, 0, 0.03)
        + 0.006 * Math.max(0, Math.sin(l.x * 70) * Math.sin(l.y * 60)),
      { curtain: { bottom: -0.1, flare: 0.03, curl: 0, bump: 0.007, reach: 1.85 } });
    case 'pixie':
      // A side-swept fringe over the forehead.
      return shape(crop, (l, f) => 0.005 + hairSmooth(f, 0, 0.02) * 0.02
        * hairSmooth(l.z, 0.02, 0.09) * hairSmooth(l.x, -0.07, 0.04) * hairSmooth(l.y, 0.07, 0.12));
    case 'man-bun':
    case 'puffs':
    case 'swept':
    case 'ponytail':
    case 'high-ponytail':
    case 'low-ponytail':
    case 'braid':
    case 'double-braid':
    case 'bun':
      return shape(crop, (_, f) => 0.005 + 0.002 * hairSmooth(f, 0, 0.03));
    default:
      return shape(crop, (_, f) => 0.004 + 0.003 * hairSmooth(f, 0, 0.03));
  }
}

type FacialPiece = { field: HeadField; offset: (l: THREE.Vector3) => number; fade: number };
/**
 * Beards, goatees and moustaches, fitted to the face (head-local). Each
 * field is roughly a distance in metres, so edges fade in evenly. Stubble
 * is painted on the skin instead (see skinTint).
 */
function facialHairShape(style: FacialHair): FacialPiece[] {
  // In front of the ear, below the cheek line, above the neck crease, clear of the lips.
  const beardArea: HeadField = l => Math.min(
    l.z - 0.004,
    0.03 - THREE.MathUtils.clamp(l.z, 0, 0.1) * 0.55 - l.y,
    l.y - (-0.052 - 0.85 * THREE.MathUtils.clamp(l.z, 0, 0.05)),
    clearOfLips(l),
  );
  const moustache: FacialPiece = {
    field: l => Math.min(
      (1 - Math.hypot(l.x / 0.031, (l.y - (-0.0255 - 0.006 * (Math.abs(l.x) / 0.03) ** 2)) / 0.0078)) * 0.006,
      l.z - 0.08,
    ),
    offset: () => 0.0036,
    fade: 0.003,
  };
  switch (style) {
    case 'short-beard':
      return [{ field: beardArea, offset: () => 0.003, fade: 0.006 }, moustache];
    case 'full-beard':
      return [{ field: beardArea, offset: l => 0.004 + 0.011 * hairSmooth(-l.y, -0.02, 0.08), fade: 0.007 }, moustache];
    case 'goatee':
      return [{
        field: l => Math.min((1 - Math.hypot(l.x / 0.034, (l.y + 0.05) / 0.042)) * 0.02, clearOfLips(l), l.z - 0.004),
        offset: () => 0.0035,
        fade: 0.005,
      }, moustache];
    case 'moustache':
      return [moustache];
    default:
      return [];
  }
}
function clearOfLips(l: THREE.Vector3) {
  return Math.max(Math.hypot(l.x / 0.03, (l.y + 0.04) / 0.011) - 1, (0.085 - l.z) * 100) * 0.01;
}

/** Brows (head-local): a soft arc over each eye. Positive inside. */
function browField(face: FaceShape): HeadField {
  return l => {
    const across = Math.abs(l.x);
    const centreLine = 0.0628 + face.browLift + face.browArch * (1 - ((across - 0.033) / 0.022) ** 2)
      - 0.004 * hairSmooth(across, 0.04, 0.052);
    const thickness = face.browThickness * (1 - 0.55 * hairSmooth(across, 0.03, 0.053));
    return Math.min(thickness / 2 - Math.abs(l.y - centreLine), (across - 0.011) * 0.3, (0.053 - across) * 0.3, l.z - 0.075);
  };
}

/**
 * Skin tones painted on the face (multipliers, head-local): lip colour, warm
 * cheeks, shade round the eyes, and for men a beard shadow or stubble.
 */
function skinTint(
  l: THREE.Vector3, female: boolean, facialHair: FacialHair,
  eyes: { centre: THREE.Vector3 }[], skin: THREE.Color, hair: THREE.Color,
  /** A real face texture already has its own cheeks and eye shade. */
  painted = false,
) {
  const tint = new THREE.Color(1, 1, 1);
  const bump = (x: number, y: number, z: number, sigma: number) =>
    Math.exp(-((l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2) / (2 * sigma * sigma));
  const lips = hairSmooth(1 - Math.hypot(l.x / 0.024, (l.y + 0.039) / 0.0105), 0, 0.6) * hairSmooth(l.z, 0.088, 0.098);
  const lipTone = female ? [0.1, 0.32, 0.3] : [0.08, 0.24, 0.24];
  tint.r *= 1 - lips * lipTone[0]; tint.g *= 1 - lips * lipTone[1]; tint.b *= 1 - lips * lipTone[2];
  for (const side of painted ? [] : [1, -1]) {
    const cheek = 0.06 * bump(side * 0.045, -0.005, 0.085, 0.016);
    tint.g *= 1 - cheek * 0.5; tint.b *= 1 - cheek * 0.6;
  }
  for (const eye of painted ? [] : eyes) {
    const shade = 1 - 0.13 * bump(eye.centre.x, eye.centre.y + 0.004, eye.centre.z + 0.006, 0.011);
    tint.multiplyScalar(shade);
  }
  if (!female) {
    const area = Math.min(
      l.z - 0.004,
      0.03 - THREE.MathUtils.clamp(l.z, 0, 0.1) * 0.55 - l.y,
      l.y - (-0.052 - 0.85 * THREE.MathUtils.clamp(l.z, 0, 0.05)),
      clearOfLips(l),
    );
    const amount = ({ none: 0.06, stubble: 0.42, 'short-beard': 0.3, 'full-beard': 0.3, goatee: 0.2, moustache: 0.14 } as const)[facialHair];
    const w = hairSmooth(area, -0.002, 0.008) * amount;
    // Toward the hair's colour, relative to the skin.
    tint.r *= 1 - w + w * Math.min(1, hair.r / Math.max(skin.r, 1e-3));
    tint.g *= 1 - w + w * Math.min(1, hair.g / Math.max(skin.g, 1e-3));
    tint.b *= 1 - w + w * Math.min(1, hair.b / Math.max(skin.b, 1e-3));
  }
  return tint;
}

function addGrooming(model: THREE.Group, kit: NativePlayerKit, index: number, female: boolean, guide: HeadGuide | null) {
  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone) || !guide) return;
  const hairMaterial = new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.82 });
  const accessoryMaterial = new THREE.MeshStandardMaterial({
    color: kit.accentColor,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const playerNumber = index + 1;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** The scalp along a direction from the skull's centre. */
  const onHead = (x: number, y: number, z: number, lift = 0) => guide.surface(v(x, y, z), lift);
  /** The scalp behind a head-local point at height y (for tied-back hair). */
  const behind = (x: number, y: number, lift = 0.004) => guide.surface(v(x, y - SKULL_CENTRE.y, -0.09), lift);
  if ((kit.headwear === 'headband' || kit.headwear === 'visor') && guide.band.length > 8) {
    const loop = new THREE.CatmullRomCurve3(guide.band, true);
    const band = new THREE.Mesh(new THREE.TubeGeometry(loop, guide.band.length * 2, 0.0068, 6, true), accessoryMaterial);
    band.name = `native-player-headband-${playerNumber}`;
    head.add(band);
  }
  if (kit.headwear === 'visor' && guide.band.length) {
    const front = guide.band[0];
    // The inner edge curves with the forehead; the peak reaches ~4.5 cm out.
    const brimShape = new THREE.Shape();
    brimShape.moveTo(-0.07, -0.035);
    brimShape.quadraticCurveTo(0, 0.02, 0.07, -0.035);
    brimShape.quadraticCurveTo(0, 0.11, -0.07, -0.035);
    const brim = new THREE.Mesh(new THREE.ShapeGeometry(brimShape, 16), accessoryMaterial);
    brim.name = `native-player-visor-brim-${playerNumber}`;
    brim.geometry.rotateX(Math.PI / 2);
    // Out from the front of the band, tipped slightly down.
    brim.position.set(0, front.y - 0.002, front.z + 0.0035);
    brim.rotation.x = 0.16;
    head.add(brim);
  }
  const ellipsoid = (name: string, centre: THREE.Vector3, scale: [number, number, number], segments = 18) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.round(segments * 2 / 3)), hairMaterial);
    mesh.name = name;
    mesh.scale.set(...scale);
    mesh.position.copy(centre);
    mesh.castShadow = true;
    head.add(mesh);
    return mesh;
  };
  const addSweptHair = () => {
    const sweptHair = ellipsoid(`native-player-swept-hair-${playerNumber}`, v(0.018, 0.111, -0.018), [0.061, 0.031, 0.079]);
    sweptHair.rotation.z = -0.18;
    sweptHair.rotation.x = -0.15;
  };
  const tie = (at: THREE.Vector3, facing: THREE.Vector3, radius = 0.021) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.005, 6, 16), accessoryMaterial);
    ring.name = `native-player-hair-tie-${playerNumber}`;
    ring.position.copy(at);
    ring.quaternion.setFromUnitVectors(v(0, 0, 1), facing.clone().normalize());
    head.add(ring);
  };
  const addBraid = (side: -1 | 1, tailLength: number, suffix: string) => {
    const root = behind(side * 0.026, 0.046);
    const path = new THREE.CatmullRomCurve3([
      root,
      root.clone().add(v(side * 0.016, -0.116, -0.034)),
      root.clone().add(v(side * 0.026, -0.216, -0.058)),
      root.clone().add(v(side * 0.019, -tailLength, -0.048)),
    ]);
    const braid = new THREE.Mesh(taperedHairGeometry(path, 0.013), hairMaterial);
    braid.name = `native-player-hair-braid-${suffix}-${playerNumber}`;
    braid.castShadow = true;
    head.add(braid);
    for (let segment = 1; segment <= 6; segment++) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), hairMaterial);
      bead.name = `native-player-hair-braid-bead-${suffix}-${playerNumber}-${segment}`;
      bead.position.copy(path.getPointAt(segment / 7));
      bead.scale.set(0.86, 1.2, 0.86);
      head.add(bead);
    }
  };
  const addPonytail = (hairStyle: 'ponytail' | 'high-ponytail' | 'low-ponytail') => {
    const startY = hairStyle === 'high-ponytail' ? 0.086 : hairStyle === 'low-ponytail' ? 0.025 : 0.0;
    const tailLength = hairStyle === 'low-ponytail' ? 0.32 : 0.36;
    const side = index === 0 ? -1 : 1;
    const root = behind(-0.008, startY);
    tie(root, root.clone().sub(SKULL_CENTRE));
    const path = new THREE.CatmullRomCurve3([
      root,
      root.clone().add(v(side * 0.01 + 0.008, -0.09, -0.039)),
      root.clone().add(v(side * 0.022 + 0.008, -0.19, -0.064)),
      root.clone().add(v(side * 0.015 + 0.008, -tailLength, -0.054)),
    ]);
    const ponytail = new THREE.Mesh(taperedHairGeometry(path, 0.019), hairMaterial);
    ponytail.name = `native-player-ponytail-${playerNumber}`;
    ponytail.userData.hairStyle = hairStyle;
    ponytail.castShadow = true;
    head.add(ponytail);
  };
  if (guide.hair.curtain) addHairCurtain(head, kit, playerNumber, guide, guide.hair.curtain);
  if (female) {
    const style = kit.femaleHairStyle;
    if (style === 'swept') {
      addSweptHair();
      addPonytail('ponytail');
    } else if (style === 'bun') {
      const at = behind(0, 0.04, 0.026);
      ellipsoid(`native-player-hair-bun-${playerNumber}`, at, [0.043, 0.043, 0.043]);
    } else if (style === 'puffs') {
      for (const side of [-1, 1]) {
        ellipsoid(`native-player-hair-puff-${side < 0 ? 'left' : 'right'}-${playerNumber}`,
          onHead(side * 0.55, 0.75, -0.35, 0.026), [0.04, 0.037, 0.04]);
      }
    } else if (style === 'double-braid') {
      addBraid(-1, 0.33, 'left');
      addBraid(1, 0.33, 'right');
    } else if (style === 'braid') {
      addBraid(index === 0 ? -1 : 1, 0.34, 'single');
    } else if (style === 'ponytail' || style === 'high-ponytail' || style === 'low-ponytail') {
      addPonytail(style);
    }
    // bob, pixie and curly are all in the hair shell.
  } else {
    const style = kit.maleHairStyle;
    if (style === 'side-part') {
      addSweptHair();
    } else if (style === 'swept-back') {
      const sweep = ellipsoid(`native-player-hair-swept-back-${playerNumber}`, v(-0.004, 0.094, -0.035), [0.064, 0.033, 0.081]);
      sweep.rotation.x = -0.18;
    } else if (style === 'curly-top') {
      for (let curl = 0; curl < 15; curl++) {
        const angle = curl * Math.PI * (3 - Math.sqrt(5));
        const radius = 0.55 * Math.sqrt((curl + 0.5) / 15);
        ellipsoid(`native-player-hair-curl-${playerNumber}-${curl}`,
          onHead(Math.cos(angle) * radius, 1, Math.sin(angle) * radius * 1.1 + 0.12), [0.018, 0.018, 0.018], 10);
      }
    } else if (style === 'man-bun') {
      const direction = v(0, 0.55, -0.85);
      ellipsoid(`native-player-hair-bun-${playerNumber}`, guide.surface(direction, 0.018), [0.03, 0.028, 0.03]);
      tie(guide.surface(direction, 0.004), direction, 0.02);
    }
    // short-crop, buzz-cut, textured-crop, quiff, afro and flow are all in the hair shell.
  }
}

/**
 * Long hair as a curtain hanging from the head (behind and over the ears),
 * standing off the neck the way real hair falls, rather than a shell
 * hugging it. Head-local; carried by the head.
 */
function addHairCurtain(head: THREE.Bone, kit: NativePlayerKit, playerNumber: number, guide: HeadGuide, spec: HairCurtain) {
  const top = 0.032;
  const lift = guide.hair.offset(new THREE.Vector3(0, 0.03, -0.09), 0.03);
  const across = 48, down = 14;
  const positions: number[] = [], colours: number[] = [], index: number[] = [];
  const base = new THREE.Color(kit.hairColor);
  for (let i = 0; i <= across; i++) {
    const angle = -spec.reach + 2 * spec.reach * i / across;
    const out = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
    const start = new THREE.Vector3(SKULL_CENTRE.x, top, SKULL_CENTRE.z)
      .addScaledVector(out, guide.ringRadius(angle, top) + lift);
    const length = (top - spec.bottom) * (1 + 0.05 * Math.sin(angle * 23) + 0.03 * Math.sin(angle * 61));
    // The front edges are a little shorter and sweep back.
    const edge = smooth(Math.abs(angle), spec.reach - 0.35, spec.reach);
    const shade = 1 + 0.13 * Math.sin(angle * 37) * Math.sin(angle * 13 + 1) + 0.06 * Math.sin(angle * 91);
    for (let j = 0; j <= down; j++) {
      const v = j / down;
      const point = start.clone()
        .add(new THREE.Vector3(0, -length * v * (1 - 0.25 * edge), -0.012 * edge * v))
        .addScaledVector(out, spec.flare * v ** 1.4 - spec.curl * smooth(v, 0.75, 1)
          + spec.bump * Math.sin(v * Math.PI * 3 + angle * 9) * Math.sin(angle * 14) * smooth(v, 0.1, 0.3));
      positions.push(point.x, point.y, point.z);
      const colour = base.clone().multiplyScalar(shade * (1 - 0.18 * v));
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < down; j++) {
      const a = i * (down + 1) + j;
      index.push(a, a + down + 1, a + 1, a + 1, a + down + 1, a + down + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  const curtain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide,
  }));
  curtain.name = `native-player-hair-curtain-${playerNumber}`;
  curtain.castShadow = true;
  head.add(curtain);
}

/**
 * Turn a player's eyes toward a point in the world (e.g. the ball), within
 * how far eyes can turn; pass null to look straight ahead. Eases each call.
 */
export function aimNativePlayerEyes(root: THREE.Object3D, target: THREE.Vector3 | null, ease = 0.3) {
  // The dressed model may load (or be replaced) after the rig: re-find its eyes when it changes.
  const model = root.getObjectByName('wtsl-continuous-player')
    ?? root.getObjectByName('wtsl-continuous-player-claude') ?? root;
  let eyes = root.userData.nativeEyes as THREE.Object3D[] | undefined;
  if (!eyes || root.userData.nativeEyesFor !== model.uuid) {
    const found: THREE.Object3D[] = [];
    model.traverse(object => { if (/^native-player-eye-(left|right)-\d+$/.test(object.name)) found.push(object); });
    eyes = found;
    root.userData.nativeEyes = eyes;
    root.userData.nativeEyesFor = model.uuid;
  }
  for (const eye of eyes) {
    let yaw = 0, pitch = 0;
    if (target && eye.parent) {
      const at = eye.parent.worldToLocal(target.clone()).sub(eye.position);
      yaw = THREE.MathUtils.clamp(Math.atan2(at.x, at.z), -0.45, 0.45);
      pitch = THREE.MathUtils.clamp(Math.atan2(at.y, Math.hypot(at.x, at.z)), -0.3, 0.3);
      // Behind the head: eyes can't follow, so rest ahead.
      if (at.z < 0) yaw = pitch = 0;
    }
    eye.rotation.x += (-pitch - eye.rotation.x) * ease;
    eye.rotation.y += (yaw - eye.rotation.y) * ease;
  }
}

/** Eyeballs (white, iris and pupil) in the model's eye sockets. */
function addEyes(model: THREE.Group, index: number, guide: HeadGuide | null) {
  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone) || !guide?.eyes.length) return;
  const shaded = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.25 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.15 });
  const glint = new THREE.MeshBasicMaterial({ color: 0xfafafa });
  const paint = (geometry: THREE.BufferGeometry, colourAt: (p: THREE.Vector3) => THREE.Color) => {
    const position = geometry.getAttribute('position');
    const colours: number[] = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) colours.push(...colourAt(p.fromBufferAttribute(position, i)).toArray());
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    return geometry;
  };
  /** A cap of a sphere round +Z, `angle` from its centre to its edge. */
  const cap = (radius: number, angle: number) => new THREE.SphereGeometry(radius, 24, 5, 0, Math.PI * 2, 0, angle)
    .rotateX(Math.PI / 2);
  const white = new THREE.Color(0xe2dbd2);
  const irisColour = new THREE.Color(guide.face.eyeColor);
  for (const [side, socket] of guide.eyes.entries()) {
    const radius = socket.radius - 0.0009;
    const eye = new THREE.Group();
    eye.name = `native-player-eye-${side ? 'right' : 'left'}-${index + 1}`;
    eye.position.copy(socket.centre);
    eye.userData.eyeColor = guide.face.eyeColorName;
    // The white, shaded under the upper lid and toward the corners.
    const ball = new THREE.Mesh(paint(new THREE.SphereGeometry(radius, 24, 16), p =>
      white.clone().multiplyScalar(1 - 0.4 * smooth(p.y / radius, -0.1, 0.75) - 0.12 * Math.abs(p.x) / radius)), shaded);
    ball.name = `${eye.name}-white`;
    // The iris: darker at its rim, lighter toward the pupil, shaded at the top.
    const irisMesh = new THREE.Mesh(paint(cap(radius + 0.0002, THREE.MathUtils.degToRad(27)), p => {
      const out = Math.hypot(p.x, p.y) / radius;
      return irisColour.clone().multiplyScalar((0.75 + 0.45 * smooth(out, 0.1, 0.42)) * (1 - 0.3 * smooth(p.y / radius, 0.1, 0.45)));
    }), shaded);
    irisMesh.name = `${eye.name}-iris`;
    const pupilMesh = new THREE.Mesh(cap(radius + 0.0004, THREE.MathUtils.degToRad(9.5)), pupil);
    pupilMesh.name = `${eye.name}-pupil`;
    eye.add(ball, irisMesh, pupilMesh);
    head.add(eye);
    // A small catchlight; on the head, so it stays put as the eye turns.
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), glint);
    light.name = `${eye.name}-catchlight`;
    light.position.copy(socket.centre).add(new THREE.Vector3(0.003, 0.0035, radius + 0.0003));
    head.add(light);
  }
}

function addWtaMakeupAndStuds(model: THREE.Group, index: number, guide: HeadGuide | null) {
  // Lip colour and blush are painted on the skin (skinTint); these are the studs.
  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone) || !guide) return;
  const studMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7bd87, roughness: 0.28, metalness: 0.48,
  });
  for (const side of [-1, 1] as const) {
    const earring = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 10), studMaterial);
    earring.name = `native-wta-earring-${side < 0 ? 'left' : 'right'}-${index + 1}`;
    const lobe = guide.earLobe ?? new THREE.Vector3(0.072, -0.012, 0.004);
    earring.position.set(side * (lobe.x + 0.002), lobe.y - 0.003, lobe.z);
    earring.castShadow = true;
    head.add(earring);
  }
}

export function addNativePlayerAccessories(
  model: THREE.Group,
  kit: NativePlayerKit,
  dominantHandedness: 'left' | 'right',
  kitIndex: number,
) {
  model.updateMatrixWorld(true);
  const dominant = dominantHandedness === 'left' ? 'l' : 'r';
  const support = dominant === 'l' ? 'r' : 'l';
  const wristBandMaterial = new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.86 });
  const watchStrapMaterial = new THREE.MeshStandardMaterial({ color: 0x344047, roughness: 0.72 });
  const watchFaceMaterial = new THREE.MeshStandardMaterial({ color: 0x29343a, roughness: 0.48, metalness: 0.12 });
  const axis = new THREE.Vector3(0, 0, 1);
  const wristAccessory = (side: 'l' | 'r') => {
    const hand = model.getObjectByName(`hand_${side}`);
    const forearm = model.getObjectByName(`lowerarm_${side}`);
    if (!(hand instanceof THREE.Bone) || !(forearm instanceof THREE.Bone)) return null;
    hand.updateWorldMatrix(true, false);
    forearm.updateWorldMatrix(true, false);
    const wrist = hand.getWorldPosition(new THREE.Vector3());
    const elbow = forearm.getWorldPosition(new THREE.Vector3());
    const localAxis = wrist.clone().sub(elbow).normalize()
      .applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
    const anchor = new THREE.Group();
    anchor.position.copy(localAxis).multiplyScalar(-0.035);
    anchor.quaternion.setFromUnitVectors(axis, localAxis);
    anchor.name = `native-wrist-accessory-anchor-${side}`;
    hand.add(anchor);
    return anchor;
  };

  const sweatband = wristAccessory(dominant);
  if (sweatband) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.008, 6, 20), wristBandMaterial);
    ring.name = `native-tennis-sweatband-${kitIndex + 1}`;
    sweatband.add(ring);
  }

  const watch = wristAccessory(support);
  if (watch) {
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.006, 6, 20), watchStrapMaterial);
    strap.name = `native-sports-watch-strap-${kitIndex + 1}`;
    watch.add(strap);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.007, 0.026), watchFaceMaterial);
    face.name = `native-sports-watch-face-${kitIndex + 1}`;
    face.position.y = 0.044;
    watch.add(face);
    const display = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.002, 0.011), new THREE.MeshStandardMaterial({
      color: kit.accentColor, roughness: 0.48, metalness: 0.08,
    }));
    display.name = 'sports-watch-display';
    display.position.set(0, 0.0485, 0);
    watch.add(display);
  }
}

/** A polo's folded collar (with a tipped edge) and a two-button placket. */
function addPoloCollar(
  model: THREE.Group, kit: NativePlayerKit, neck: THREE.Vector3,
  placketPoint: THREE.Vector3, placketNormal: THREE.Vector3,
) {
  const chest = model.getObjectByName('spine_03');
  if (!chest) return;
  const shirt = new THREE.MeshStandardMaterial({ color: kit.shirtColor, roughness: 0.76, side: THREE.DoubleSide });
  const accent = new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.76, side: THREE.DoubleSide });
  const gap = 0.42; // open at the front
  const collar = new THREE.Group();
  collar.name = 'native-polo-collar';
  // Standing band round the neck base, flaring out to the fold.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.094, 0.038, 36, 1, true, gap / 2, Math.PI * 2 - gap), shirt);
  band.name = 'native-polo-collar-band';
  collar.add(band);
  // The tipped edge: a thin contrast stripe along the top.
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0795, 0.0815, 0.006, 36, 1, true, gap / 2, Math.PI * 2 - gap), accent);
  tip.name = 'native-polo-collar-tipping';
  tip.position.y = 0.014;
  collar.add(tip);
  collar.scale.set(1, 1, 0.94);
  model.add(collar);
  model.updateMatrixWorld(true);
  const toLocal = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  collar.position.copy(model.worldToLocal(new THREE.Vector3(neck.x, neck.y - 0.03, neck.z + 0.012)));
  collar.quaternion.copy(toLocal);
  chest.attach(collar);
  // The placket: a buttoned strip running down from the collar's opening,
  // laid on the chest surface (its +Z along the surface normal).
  const placket = new THREE.Group();
  placket.name = 'native-polo-placket';
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.085), shirt);
  strip.name = 'native-polo-placket-strip';
  placket.add(strip);
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.0025, 0.085), accent);
  edge.name = 'native-polo-placket-edge';
  edge.position.set(0.0135, 0, 0.0006);
  placket.add(edge);
  for (const [index, y] of [0.022, -0.016].entries()) {
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.0025, 10),
      new THREE.MeshStandardMaterial({ color: 0xf1eee6, roughness: 0.45 }));
    button.name = `native-polo-button-${index + 1}`;
    button.rotation.x = Math.PI / 2;
    button.position.set(0, y, 0.0015);
    placket.add(button);
  }
  model.add(placket);
  model.updateMatrixWorld(true);
  const world = placketPoint.clone().addScaledVector(new THREE.Vector3(0, 1, 0), 0.008);
  placket.position.copy(model.worldToLocal(world.clone()));
  placket.up.set(0, 1, 0);
  placket.lookAt(world.clone().add(placketNormal));
  chest.attach(placket);
}

export function dressNativePlayer(
  model: THREE.Group,
  shirtColor: number,
  female: boolean,
  kit: NativePlayerKit = BROADCAST_PLAYER_KITS[0],
  kitIndex = 0,
) {
  model.userData.tennisKit = {
    id: kit.id,
    tour: female ? 'WTA' : 'ATP',
    hairStyle: female ? kit.femaleHairStyle : kit.maleHairStyle,
    shirtPattern: kit.shirtPattern,
  };
  model.updateMatrixWorld(true);
  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if (o instanceof THREE.SkinnedMesh) bodies.push(o); });
  let headGuide: HeadGuide | null = null;
  for (const body of bodies) {
    body.geometry = body.geometry.clone();
    if (female) shapeWtaBody(body, model);
    // Each player's own face, and where their eyes go: a real transplanted
    // face when one is given, otherwise a sculpted one.
    const face = faceShapeFor(kit.faceSeed || kit.id, female);
    const headRegion = kit.head ? applyPlayerHead(body, kit.head) : null;
    if (headRegion && kit.head) {
      for (const feature of Object.keys(face.sculpt) as (keyof typeof face.sculpt)[]) face.sculpt[feature] = 0;
      face.eyeColor = kit.head.iris;
      face.eyeColorName = 'from-face';
    }
    const faceHead = body.skeleton.bones.find(bone => bone.name === 'head');
    const eyes = faceHead ? sculptFace(body, faceHead, face) : [];
    const original = body.geometry;
    const bodySkin = kit.skinColor ?? (headRegion && kit.head ? kit.head.skin : 0xcda080);
    body.material = new THREE.MeshStandardMaterial({
      color: bodySkin,
      roughness: 0.76,
    });
    const positions = original.getAttribute('position'), normals = original.getAttribute('normal');
    const indices = original.index;
    if (!indices) throw new Error('Native body requires indexed skin geometry.');
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(body.matrixWorld));
    const skinIndex = original.getAttribute('skinIndex'), skinWeight = original.getAttribute('skinWeight');
    const boneNames = body.skeleton.bones.map(b => b.name);
    const vertexWeights = Array.from({ length: positions.count }, (_, i) => {
      const weights = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const joint = skinIndex.getComponent(i, k), weight = skinWeight.getComponent(i, k);
        if (weight > 0) weights.set(joint, (weights.get(joint) ?? 0) + weight);
      }
      return weights;
    });
    const weightOf = (i: number, test: RegExp) => {
      let total = 0;
      vertexWeights[i].forEach((w, j) => { if (test.test(boneNames[j])) total += w; });
      return total;
    };
    // Bind-pose joint positions (same space as `points`).
    const joint = (name: string) => {
      const bone = body.skeleton.bones[boneNames.indexOf(name)];
      if (!bone) throw new Error(`Native kit requires joint ${name}`);
      return bone.getWorldPosition(new THREE.Vector3());
    };
    const neck = joint('neck_01');
    const arms = (['l', 'r'] as const).map(side => {
      const shoulder = joint(`upperarm_${side}`), elbow = joint(`lowerarm_${side}`);
      const axis = elbow.clone().sub(shoulder);
      const length = axis.length();
      return { side, shoulder, axis: axis.divideScalar(length), length, test: new RegExp(`^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)\\w*_${side}$`) };
    });
    type Field = (i: number) => number;
    // Crew neckline: an elliptical collar around the neck base, slightly lower
    // at the front. Positive = garment.
    const neckStyle = female ? kit.femaleNeck : kit.maleNeck;
    const neckline: Field = i => {
      const p = points[i];
      const dx = p.x - neck.x, dz = p.z - (neck.z + 0.012);
      const radial = Math.hypot(dx / 0.088, dz / 0.082) - 1;
      // A V-neck drops to a point at the front centre.
      const vee = neckStyle === 'v-neck'
        ? 0.075 * Math.max(0, 1 - Math.abs(dx) / 0.075) * smooth(dz, 0.01, 0.07) : 0;
      const collarHeight = neck.y - 0.045 - 0.022 * smooth(dz, 0, 0.08) - vee;
      return Math.max(collarHeight - p.y, radial * 0.08);
    };
    // Short sleeves end ~45% down the upper arm, perpendicular to it. Torso
    // vertices (no arm weight) are always inside the shirt.
    const sleeve = (fraction: number): Field => i => {
      const p = points[i];
      const arm = arms[p.x >= 0 ? 0 : 1];
      const along = p.clone().sub(arm.shoulder).dot(arm.axis) / arm.length;
      const armness = smooth(weightOf(i, arm.test), 0.25, 0.75);
      return (fraction - along) * armness + 0.3 * (1 - armness);
    };
    const topStyle = female ? kit.femaleTopStyle : kit.maleTopStyle;
    const sleeveEndFraction = topStyle === 'sleeveless'
      ? WTA_TANK_TOP_END_FRACTION
      : topStyle === 'cap-sleeve'
        ? WTA_CAP_SLEEVE_END_FRACTION
        : STANDARD_SHORT_SLEEVE_END_FRACTION;
    const sleeveField = sleeve(sleeveEndFraction);
    // A racerback: the back cut away to a centre strap between the shoulder blades.
    const racerback = female && topStyle === 'sleeveless' && kit.femaleBack === 'racerback';
    const shirtFields: Field[] = [
      i => points[i].y - 0.86,
      neckline,
      sleeveField,
      i => neck.y + 0.01 - points[i].y,
      ...(racerback ? [(i: number) => {
        const p = points[i];
        return Math.max(
          p.z - (neck.z - 0.03),
          0.045 + Math.max(0, 1.42 - p.y) * 0.3 - Math.abs(p.x - neck.x),
          1.2 - p.y,
        );
      }] : []),
    ];
    const isTrunk = (i: number) => weightOf(i, /^(pelvis|spine_01|thigh|calf)/) > 0.5;
    const shortsFields: Field[] = female
      ? [i => points[i].y - WTA_UNDER_SKIRT_SHORTS_HEM_Y, i => 0.975 - points[i].y]
      : [i => points[i].y - 0.575, i => 0.975 - points[i].y];

    const fieldCache = new Map<Field[], Map<number, number[]>>();
    const sourceVertex = (i: number, fields: Field[]): Vertex => {
      let cache = fieldCache.get(fields);
      if (!cache) fieldCache.set(fields, cache = new Map());
      let values = cache.get(i);
      if (!values) cache.set(i, values = fields.map(f => f(i)));
      return {
        point: points[i].clone(),
        normal: new THREE.Vector3().fromBufferAttribute(normals, i),
        weights: vertexWeights[i],
        fields: [...values],
      };
    };
    const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => {
      const weights = new Map<number, number>();
      a.weights.forEach((v, k) => weights.set(k, v * (1 - t)));
      b.weights.forEach((v, k) => weights.set(k, (weights.get(k) ?? 0) + v * t));
      return {
        point: a.point.clone().lerp(b.point, t),
        normal: a.normal.clone().lerp(b.normal, t).normalize(),
        weights,
        fields: a.fields.map((f, k) => f + (b.fields[k] - f) * t),
      };
    };
    const covered = new Set<number>();
    const addShell = (
      name: string, color: number, offset: (v: Vertex) => number, fields: Field[],
      include?: (triangle: number[]) => boolean, hidesSkin = true,
      vertexColour?: (v: Vertex) => THREE.Color,
    ) => {
      const vertices: Vertex[] = [], visible: number[] = [];
      for (let i = 0; i < indices.count; i += 3) {
        const triangle = [0, 1, 2].map(k => indices.getX(i + k));
        if (include && !include(triangle)) continue;
        let polygon = triangle.map(v => sourceVertex(v, fields));
        // Skin fully inside the garment (with margin) can never be seen.
        if (hidesSkin && polygon.every(v => v.fields.every(f => f > 0.012))) covered.add(i);
        for (let k = 0; k < fields.length; k++) {
          const clipped: Vertex[] = [];
          for (let e = 0; e < polygon.length; e++) {
            const a = polygon[e], b = polygon[(e + 1) % polygon.length];
            const da = a.fields[k], db = b.fields[k];
            if (da >= 0) clipped.push(a);
            if ((da >= 0) !== (db >= 0)) clipped.push(interpolate(a, b, da / (da - db)));
          }
          polygon = clipped;
          if (polygon.length < 3) break;
        }
        if (polygon.length < 3) continue;
        const base = vertices.length;
        vertices.push(...polygon);
        for (let k = 1; k < polygon.length - 1; k++) visible.push(base, base + k, base + k + 1);
      }
      const position: number[] = [], normal: number[] = [], joints: number[] = [], weights: number[] = [];
      const inverse = body.matrixWorld.clone().invert();
      for (const vertex of vertices) {
        position.push(...vertex.point.clone().applyMatrix4(inverse).addScaledVector(vertex.normal, offset(vertex)).toArray());
        normal.push(...vertex.normal.toArray());
        const strongest = [...vertex.weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = strongest.reduce((n, entry) => n + entry[1], 0) || 1;
        for (let k = 0; k < 4; k++) {
          joints.push(strongest[k]?.[0] ?? 0); weights.push((strongest[k]?.[1] ?? 0) / total);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(visible);
      if (vertexColour) {
        const colours: number[] = [];
        for (const vertex of vertices) colours.push(...vertexColour(vertex).toArray());
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      // Performance fabric: a soft sheen rather than flat cotton.
      const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
        color: vertexColour ? 0xffffff : color, vertexColors: Boolean(vertexColour), roughness: 0.76, side: THREE.DoubleSide,
      }));
      mesh.name = name;
      if (name === 'native-tennis-shirt') {
        mesh.userData.sleeveEndFraction = sleeveEndFraction;
        mesh.userData.topStyle = topStyle;
        mesh.userData.pattern = kit.shirtPattern;
        mesh.userData.neckStyle = neckStyle;
        mesh.userData.racerback = racerback;
      }
      mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
      mesh.bind(body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      body.parent!.add(mesh);
      return mesh;
    };
    // Shirt sits outside the shorts' waistband (shirt worn untucked): a larger
    // offset where they overlap, a closer fit at the collar and sleeve hems.
    addShell('native-tennis-shirt', kit.shirtColor, v => {
      const hemFlare = 0.004 * (1 - smooth(v.point.y, 0.88, 1.0));
      const collarFit = 0.003 * (1 - smooth(v.fields[1], 0, 0.02));
      return 0.011 + hemFlare - collarFit;
    }, shirtFields);
    // Contrast piping: a narrow band at the sleeve or armhole edge, and round
    // a crew or V neckline (a polo has its collar instead).
    addShell('native-tennis-shirt-sleeve-trim', kit.accentColor, () => 0.0175,
      [...shirtFields, i => 0.035 - sleeveField(i)], undefined, false);
    if (neckStyle !== 'polo') {
      addShell('native-tennis-shirt-neck-trim', kit.accentColor, () => 0.017,
        [...shirtFields, i => 0.011 - neckline(i)], undefined, false);
    }
    if (kit.shirtPattern === 'chest-band') {
      const band: Field = i => 0.035 - Math.abs(points[i].y - 1.2);
      addShell('native-tennis-shirt-chest-band', kit.accentColor, () => 0.016,
        [...shirtFields, band], undefined, false);
    } else if (kit.shirtPattern === 'side-panels') {
      const panels: Field = i => Math.max(
        0.028 - Math.abs(points[i].x - 0.145),
        0.028 - Math.abs(points[i].x + 0.145),
      );
      addShell('native-tennis-shirt-side-panels', kit.accentColor, () => 0.016,
        [...shirtFields, panels], undefined, false);
    } else if (kit.shirtPattern === 'yoke') {
      const yoke: Field = i => points[i].y - 1.31;
      addShell('native-tennis-shirt-yoke', kit.accentColor, () => 0.016,
        [...shirtFields, yoke], undefined, false);
    }
    addShell('native-tennis-shorts', kit.shortsColor, () => 0.007, shortsFields, triangle => triangle.every(isTrunk));
    if (!female) {
      // A contrast band at the shorts' hem.
      addShell('native-tennis-shorts-hem-trim', kit.accentColor, () => 0.0085,
        [...shortsFields, i => 0.6 - points[i].y], triangle => triangle.every(isTrunk), false);
    }
    // Printed logos, placed on the bind-pose surface.
    const surface = (pick: (i: number) => boolean, score: (p: THREE.Vector3) => number, lift = 0.016) => {
      let best = -1, bestScore = -Infinity;
      for (let i = 0; i < points.length; i++) {
        if (!pick(i)) continue;
        const value = score(points[i]);
        if (value > bestScore) { bestScore = value; best = i; }
      }
      if (best < 0) return null;
      const normal = new THREE.Vector3().fromBufferAttribute(normals, best).transformDirection(body.matrixWorld);
      return { point: points[best].clone().addScaledVector(normal, lift), normal };
    };
    const brand = KIT_SPORTSWEAR_BRANDS[kit.brand % KIT_SPORTSWEAR_BRANDS.length];
    const accentCss = `#${kit.accentColor.toString(16).padStart(6, '0')}`;
    const shirtInk = inkFor(kit.shirtColor);
    const up = new THREE.Vector3(0, 1, 0);
    // The maker's mark on the left chest (+X is the player's left).
    const chest = surface(
      i => Math.abs(points[i].x - (neck.x + 0.085)) < 0.02 && Math.abs(points[i].y - (neck.y - 0.17)) < 0.02,
      p => p.z,
    );
    const upperChest = model.getObjectByName('spine_03');
    if (chest && upperChest) {
      const print = addKitPrint(model, upperChest, 'native-apparel-patch',
        wordmarkTexture(brand.name, brand.mark, shirtInk, shirtInk === '#1d2633' ? accentCss : '#f4f1e8'),
        kit.accentColor, 0.11, chest.point, chest.normal, up);
      if (print) {
        // Grouped (at the bone's origin) under the kit's maker name.
        const mark = new THREE.Group();
        mark.name = `native-tour-mark-${kitIndex + 1}`;
        mark.userData.inventedLabel = brand.name;
        upperChest.add(mark);
        mark.add(print);
        print.userData.inventedLabel = brand.name;
      }
    }
    // The partner's name on the sleeve (player's right), when there's a sleeve.
    if (topStyle === 'short-sleeve') {
      const arm = arms[1];
      // Outward from the arm's axis, toward up-and-away from the body: the
      // outer face of the sleeve once the arm hangs at the side.
      const outward = new THREE.Vector3(-1, 1, 0).normalize();
      outward.addScaledVector(arm.axis, -outward.dot(arm.axis)).normalize();
      const sleevePoint = surface(
        i => weightOf(i, arm.test) > 0.6
          && Math.abs(points[i].clone().sub(arm.shoulder).dot(arm.axis) / arm.length - 0.24) < 0.05,
        p => {
          const offset = p.clone().sub(arm.shoulder);
          return offset.addScaledVector(arm.axis, -offset.dot(arm.axis)).dot(outward);
        },
      );
      if (sleevePoint) {
        addKitPrint(model, model.getObjectByName('upperarm_r'), 'native-sleeve-partner',
          wordmarkTexture(KIT_PARTNER_BRANDS[kit.partner % KIT_PARTNER_BRANDS.length], null, shirtInk, accentCss),
          kit.accentColor, 0.06, sleevePoint.point, sleevePoint.normal, arm.axis.clone().negate());
      }
    } else {
      // Sleeveless: the maker's name across the upper back instead.
      // A racerback's centre strap is too narrow: print below it instead.
      const backY = racerback ? 1.12 : neck.y - 0.12;
      const back = surface(
        i => Math.abs(points[i].x - neck.x) < 0.02 && Math.abs(points[i].y - backY) < 0.02,
        p => -p.z,
      );
      if (back) {
        addKitPrint(model, model.getObjectByName(racerback ? 'spine_02' : 'spine_03'), 'native-back-wordmark',
          wordmarkTexture(brand.name, null, shirtInk, accentCss),
          kit.accentColor, racerback ? 0.12 : 0.15, back.point, back.normal, up);
      }
    }
    if (!female) {
      // The maker's mark on the left leg of the shorts, above the hem.
      const leg = surface(
        i => isTrunk(i) && points[i].x > 0.04 && Math.abs(points[i].y - 0.65) < 0.02,
        p => p.z + p.x * 0.4,
        0.006,
      );
      if (leg) {
        addKitPrint(model, model.getObjectByName('thigh_l'), 'native-shorts-mark',
          wordmarkTexture(brand.name, brand.mark, inkFor(kit.shortsColor), accentCss),
          kit.accentColor, 0.065, leg.point, leg.normal, up);
      }
    }
    // A polo's folded collar and buttoned placket, carried by the upper chest.
    if (neckStyle === 'polo') {
      const placket = surface(
        i => Math.abs(points[i].x - neck.x) < 0.012 && Math.abs(points[i].y - (neck.y - 0.1)) < 0.012,
        p => p.z,
        0.013,
      );
      if (placket) addPoloCollar(model, kit, neck, placket.point, placket.normal);
    }
    // ---- Hair and facial hair, grown from this model's own head as skinned
    // shells (so they never float or sink), plus a guide to where the rest of
    // the grooming goes.
    const headBone = body.skeleton.bones[boneNames.indexOf('head')];
    const toHead = headBone.matrixWorld.clone().invert();
    const headLocal = points.map(p => p.clone().applyMatrix4(toHead));
    const local = (point: THREE.Vector3) => point.clone().applyMatrix4(toHead);
    const nearHead = (triangle: number[]) => triangle.every(v => headLocal[v].y > -0.125 && Math.abs(headLocal[v].x) < 0.11);
    const hairStyle = female ? kit.femaleHairStyle : kit.maleHairStyle;
    const hair = hairShape(hairStyle);
    const skinColour = new THREE.Color(bodySkin);
    const hairColour = new THREE.Color(kit.hairColor);
    const tintAt = (l: THREE.Vector3) => skinTint(l, female, kit.facialHair, eyes, skinColour, hairColour, Boolean(headRegion));
    // Paint the face: lips, cheeks, eye shade, beard shadow.
    const tints = new Float32Array(positions.count * 3).fill(1);
    for (let i = 0; i < positions.count; i++) {
      if (headLocal[i].y < -0.13 || weightOf(i, /^(head|neck_01)$/) < 0.2) continue;
      const tint = tintAt(headLocal[i]);
      tints.set([tint.r, tint.g, tint.b], i * 3);
    }
    original.setAttribute('color', new THREE.BufferAttribute(tints, 3));
    (body.material as THREE.MeshStandardMaterial).vertexColors = true;
    body.userData.facialHair = female ? 'none' : kit.facialHair;
    /**
     * Hair, beards and brows as shells whose edges fade into the skin, with
     * light and dark streaks, so none of them has a cut-out edge.
     */
    const softShell = (
      name: string, colour: THREE.Color, field: HeadField, offset: (l: THREE.Vector3, f: number) => number,
      fade: number, streaks: number,
    ) => addShell(name, colour.getHex(),
      v => offset(local(v.point), v.fields[0]) * (0.08 + 0.92 * smooth(v.fields[0], 0, fade * 1.6)),
      [i => field(headLocal[i])], nearHead, false,
      v => {
        const l = local(v.point);
        const amount = 0.15 + 0.85 * smooth(v.fields[0], 0, fade);
        const shade = 1 + streaks * (hairStrands(l) - 0.5) * 2;
        return skinColour.clone().multiply(tintAt(l)).lerp(colour.clone().multiplyScalar(shade), amount);
      });
    const hairShell = softShell('native-cropped-hair',
      hairStyle === 'buzz-cut' ? hairColour.clone().lerp(skinColour, 0.1) : hairColour,
      hair.field, hair.offset, hair.fade, hair.streaks);
    (hairShell.material as THREE.MeshStandardMaterial).roughness = 0.86;
    hairShell.userData.hairStyle = hairStyle;
    if (!female) {
      for (const [part, piece] of facialHairShape(kit.facialHair).entries()) {
        const mesh = softShell(`native-player-facial-hair-${kitIndex + 1}${part ? `-${part}` : ''}`, hairColour,
          piece.field, l => piece.offset(l), piece.fade, 0.1);
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.roughness = 0.94;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        mesh.userData.facialHair = kit.facialHair;
      }
    }
    const skull = headLocal.map((_, i) => i)
      .filter(i => headLocal[i].y > -0.07 && weightOf(i, /^(head|neck_01)$/) > 0.5);
    const scalpAt = (direction: THREE.Vector3, lift = 0) => {
      const d = direction.clone().normalize();
      let best = -Infinity;
      for (const i of skull) {
        const offset = headLocal[i].clone().sub(SKULL_CENTRE);
        const length = offset.length();
        const cos = offset.dot(d) / length;
        if (cos > 0.96 && length * cos > best) best = length * cos;
      }
      return SKULL_CENTRE.clone().addScaledVector(d, (best > 0 ? best : 0.09) + lift);
    };
    // The headband: low on the forehead, higher at the back, over the hair.
    const band: THREE.Vector3[] = [];
    for (let k = 0; k < 40; k++) {
      const theta = k / 40 * Math.PI * 2;
      const y = 0.079 + 0.017 * Math.cos(theta);
      let best = -Infinity, at = -1;
      for (const i of skull) {
        const l = headLocal[i];
        if (Math.abs(l.y - y) > 0.014) continue;
        const angle = Math.atan2(l.x, l.z - SKULL_CENTRE.z);
        const apart = Math.abs(THREE.MathUtils.euclideanModulo(angle - theta + Math.PI, Math.PI * 2) - Math.PI);
        if (apart > 0.3) continue;
        const radius = Math.hypot(l.x, l.z - SKULL_CENTRE.z) * Math.cos(apart);
        if (radius > best) { best = radius; at = i; }
      }
      if (at < 0) continue;
      const l = headLocal[at];
      // Over the hair where there is hair; on the skin of the forehead.
      const thickness = hair.offset(l, hair.field(l)) * smooth(hair.field(l), -0.005, 0.01);
      const radius = best + thickness + 0.0045;
      band.push(new THREE.Vector3(Math.sin(theta) * radius, y, SKULL_CENTRE.z + Math.cos(theta) * radius));
    }
    const frontmost = (x: number, y: number) => {
      let best: THREE.Vector3 | null = null;
      for (const i of skull) {
        const l = headLocal[i];
        if (Math.abs(l.x - x) < 0.008 && Math.abs(l.y - y) < 0.006 && (!best || l.z > best.z)) best = l;
      }
      return best?.clone() ?? null;
    };
    let earLobe: THREE.Vector3 | null = null;
    for (const i of skull) {
      const l = headLocal[i];
      if (l.x > 0.066 && l.y < 0.03 && l.z > -0.025 && l.z < 0.03 && (!earLobe || l.y < earLobe.y)) earLobe = l.clone();
    }
    // Eyebrows (soft-edged) and, for WTA players, a lash line.
    if (!headRegion) {
      const browShell = softShell(`native-player-brows-${kitIndex + 1}`, hairColour.clone().multiplyScalar(0.85),
        browField(face), () => 0.0016, 0.0016, 0.08);
      (browShell.material as THREE.MeshStandardMaterial).roughness = 0.95;
      browShell.userData.browThickness = face.browThickness;
    }
    if (female) {
      for (const [side, eye] of eyes.entries()) {
        const lash = addShell(`native-wta-lash-line-${side ? 'right' : 'left'}-${kitIndex + 1}`, 0x141010, () => 0.0007, [i => {
          const l = headLocal[i].clone().sub(eye.centre);
          return Math.min(0.0014 - Math.abs(l.length() - (eye.radius + 0.0022)), l.y - 0.001, l.z - 0.006);
        }], nearHead, false);
        (lash.material as THREE.MeshStandardMaterial).roughness = 0.5;
      }
    }
    /** How far the head reaches, at height y, in a horizontal direction (angle 0 = straight back). */
    const ringRadius = (angle: number, y: number) => {
      const dx = Math.sin(angle), dz = -Math.cos(angle);
      let best = -Infinity;
      for (const i of skull) {
        const l = headLocal[i];
        if (Math.abs(l.y - y) > 0.012) continue;
        const ox = l.x - SKULL_CENTRE.x, oz = l.z - SKULL_CENTRE.z;
        const length = Math.hypot(ox, oz);
        const along = ox * dx + oz * dz;
        if (length > 1e-6 && along / length > 0.97 && along > best) best = along;
      }
      return best > 0 ? best : 0.09;
    };
    headGuide = {
      surface: scalpAt, band, earLobe, lips: frontmost(0, -0.04), cheek: frontmost(0.045, -0.006), eyes, face,
      ringRadius, hair,
    };
    const visible: number[] = [];
    for (let i = 0; i < indices.count; i += 3) {
      if (covered.has(i)) continue;
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      if (Math.max(points[a].y, points[b].y, points[c].y) >= 0.1) visible.push(a, b, c);
    }
    if (headRegion && kit.head) {
      // The head's triangles get the face texture; the rest stays plain skin.
      const rest: number[] = [], faceTriangles: number[] = [];
      for (let i = 0; i < visible.length; i += 3) {
        const target = headRegion.has(visible[i]) && headRegion.has(visible[i + 1]) && headRegion.has(visible[i + 2])
          ? faceTriangles : rest;
        target.push(visible[i], visible[i + 1], visible[i + 2]);
      }
      body.geometry.setIndex([...rest, ...faceTriangles]);
      body.geometry.clearGroups();
      body.geometry.addGroup(0, rest.length, 0);
      body.geometry.addGroup(rest.length, faceTriangles.length, 1);
      const skinMaterial = body.material as THREE.MeshStandardMaterial;
      const faceMaterial = new THREE.MeshStandardMaterial({
        // The texture is the face relative to its own skin (x0.8); this colours it.
        color: new THREE.Color(bodySkin).multiplyScalar(1 / 0.8),
        map: kit.head.texture,
        vertexColors: true,
        roughness: 0.72,
      });
      faceMaterial.name = 'native-player-face';
      body.material = [skinMaterial, faceMaterial];
      body.userData.headKey = kit.head.key;
    } else {
      body.geometry.setIndex(visible);
    }
    body.frustumCulled = false; body.castShadow = true; body.receiveShadow = true;
  }
  if (female) {
    const pelvis = model.getObjectByName('pelvis')!;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, kit.skirtLength, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: kit.shortsColor, roughness: 0.9, side: THREE.DoubleSide }));
    skirt.name = 'native-tennis-skirt';
    skirt.userData.skirtLength = kit.skirtLength;
    // A contrast band round the hem.
    const hemBand = new THREE.Mesh(new THREE.CylinderGeometry(0.2735, 0.2735, 0.014, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.8, side: THREE.DoubleSide }));
    hemBand.name = 'native-tennis-skirt-hem-trim';
    hemBand.position.y = -kit.skirtLength / 2 + 0.007;
    skirt.add(hemBand);
    model.updateMatrixWorld(true);
    const pelvisWorld = pelvis.getWorldPosition(new THREE.Vector3());
    const world = pelvisWorld.clone()
      .add(new THREE.Vector3(0, -kit.skirtLength / 2 + 0.005, 0));
    model.add(skirt); skirt.position.copy(model.worldToLocal(world));
    skirt.quaternion.copy(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    pelvis.attach(skirt);

    const waistband = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.055, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: kit.shortsColor, roughness: 0.88, side: THREE.DoubleSide }),
    );
    waistband.name = 'native-tennis-skirt-waistband';
    waistband.userData.overlapsTorsoAndSkirt = true;
    const waistbandWorld = pelvisWorld.add(new THREE.Vector3(0, 0.012, 0));
    model.add(waistband);
    waistband.position.copy(model.worldToLocal(waistbandWorld));
    waistband.quaternion.copy(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    pelvis.attach(waistband);
  }
  addGrooming(model, kit, kitIndex, female, headGuide);
  addEyes(model, kitIndex, headGuide);
  if (female) addWtaMakeupAndStuds(model, kitIndex, headGuide);
}
