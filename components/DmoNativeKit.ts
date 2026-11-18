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

type MaleHairStyle = 'short-crop' | 'textured-crop' | 'curly-top' | 'side-part' | 'swept-back' | 'buzz-cut';
type FemaleHairStyle = 'swept' | 'ponytail' | 'high-ponytail' | 'low-ponytail' | 'braid' | 'double-braid' | 'bun' | 'bob';
type TennisTopStyle = 'sleeveless' | 'cap-sleeve' | 'short-sleeve';
/** Neck of the top: crew, a polo collar with a buttoned placket, or a V. */
type NeckStyle = 'crew' | 'polo' | 'v-neck';
/** Back of a sleeveless women's top: a standard tank or a racerback. */
type BackStyle = 'standard' | 'racerback';
type ShirtPattern = 'solid' | 'chest-band' | 'side-panels' | 'yoke';
type Headwear = 'none' | 'headband' | 'visor';
type FacialHair = 'none' | 'stubble' | 'short-beard';

export type NativePlayerKit = {
  id: string;
  shirtColor: number;
  shortsColor: number;
  skinColor?: number | null;
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
  createTennisKit('men-deep-teal', 0x167a77, 0x202b35, 0xb4d65a, 0x211d1b, 'curly-top', 'high-ponytail', 'short-sleeve', 'cap-sleeve', 'yoke', 'none'),
  createTennisKit('men-forest-green', 0x35614d, 0xe9e1cd, 0xb6be7a, 0x604636, 'swept-back', 'low-ponytail', 'short-sleeve', 'short-sleeve', 'side-panels', 'headband', 'stubble'),
  createTennisKit('men-burgundy', 0x762e47, 0x202b35, 0xd0ad79, 0x241b1a, 'buzz-cut', 'bun', 'sleeveless', 'sleeveless', 'yoke', 'none'),
  createTennisKit('men-sky-blue', 0x66b4d4, 0x253957, 0xf2eee1, 0x9a6843, 'side-part', 'braid', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-black-coral', 0x282d35, 0x282d35, 0xe57f72, 0x302720, 'textured-crop', 'double-braid', 'sleeveless', 'short-sleeve', 'side-panels', 'headband', 'short-beard'),
  createTennisKit('men-orange-white', 0xe67635, 0xf0eee7, 0x363c49, 0x5b3d2a, 'curly-top', 'bob', 'short-sleeve', 'sleeveless', 'yoke', 'none'),
  createTennisKit('men-lavender', 0x8175ad, 0x29313e, 0xe6d9c7, 0x332a27, 'swept-back', 'swept', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-mint-white', 0x9dcdb9, 0x26343a, 0x477563, 0x72503b, 'buzz-cut', 'ponytail', 'sleeveless', 'short-sleeve', 'side-panels', 'none'),
  createTennisKit('men-navy-gold', 0x1e2b4c, 0xe5dfd2, 0xd1b06d, 0x30231e, 'side-part', 'low-ponytail', 'short-sleeve', 'sleeveless', 'yoke', 'headband', 'short-beard'),
  createTennisKit('men-red-white', 0xc63b43, 0x2e3845, 0xf2eee7, 0x86553b, 'textured-crop', 'high-ponytail', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-stone-lime', 0xbab9ad, 0x343a36, 0x9ebc46, 0x28211f, 'curly-top', 'bun', 'sleeveless', 'short-sleeve', 'side-panels', 'none'),
  createTennisKit('men-white-lime', 0xf2efe3, 0x61704a, 0xc7d95c, 0x523b2d, 'swept-back', 'braid', 'short-sleeve', 'sleeveless', 'yoke', 'headband'),
  createTennisKit('men-teal-white', 0x195f69, 0xf1eee7, 0x80c2bc, 0x392b25, 'buzz-cut', 'double-braid', 'short-sleeve', 'cap-sleeve', 'chest-band', 'visor'),
  createTennisKit('men-charcoal-gold', 0x41444a, 0x282c34, 0xc5a25e, 0x7a553b, 'side-part', 'bob', 'sleeveless', 'short-sleeve', 'side-panels', 'none', 'stubble'),
], ATP_NECKS, false);

export const WTA_PLAYER_KITS: NativePlayerKit[] = withCuts([
  createTennisKit('women-coral-classic', 0xd95f66, 0x273b54, 0xf4eee2, 0x38231f, 'side-part', 'swept', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.16),
  createTennisKit('women-royal-pleats', 0x245ca8, 0xf1eee7, 0xe9cc54, 0x573a2b, 'textured-crop', 'high-ponytail', 'sleeveless', 'cap-sleeve', 'chest-band', 'visor', 'none', 0.17),
  createTennisKit('women-mint-court', 0x91cbb5, 0x26343a, 0xe2d6b6, 0x251d19, 'curly-top', 'low-ponytail', 'short-sleeve', 'short-sleeve', 'yoke', 'none', 'none', 0.15),
  createTennisKit('women-teal-stripe', 0x1e7777, 0x173d47, 0xd7e7d2, 0x8a5b3d, 'swept-back', 'braid', 'short-sleeve', 'cap-sleeve', 'chest-band', 'headband', 'none', 0.18),
  createTennisKit('women-plum-skirt', 0x653c74, 0x30233e, 0xd7b79b, 0x2d211e, 'buzz-cut', 'bun', 'sleeveless', 'sleeveless', 'side-panels', 'none', 'none', 0.16),
  createTennisKit('women-sky-court', 0x70b9dc, 0x243955, 0xf4eee2, 0x9a6645, 'side-part', 'double-braid', 'short-sleeve', 'sleeveless', 'yoke', 'visor', 'none', 0.17),
  createTennisKit('women-lemon-dress', 0xe6d45d, 0x4a513c, 0xf5f0df, 0x4f3527, 'textured-crop', 'bob', 'sleeveless', 'sleeveless', 'solid', 'headband', 'none', 0.15),
  createTennisKit('women-black-rose', 0x30313a, 0x292d37, 0xd87991, 0x211b1a, 'curly-top', 'high-ponytail', 'short-sleeve', 'short-sleeve', 'side-panels', 'visor', 'none', 0.18),
  createTennisKit('women-red-white', 0xc4414d, 0xf1eee7, 0x344866, 0x7f4c32, 'swept-back', 'ponytail', 'short-sleeve', 'cap-sleeve', 'chest-band', 'none', 'none', 0.16),
  createTennisKit('women-lilac-white', 0xb4a8d2, 0xf1eee7, 0x50466f, 0x362522, 'buzz-cut', 'low-ponytail', 'sleeveless', 'sleeveless', 'yoke', 'headband', 'none', 0.15),
  createTennisKit('women-forest-gold', 0x355b4e, 0x233a34, 0xd8c479, 0x573d2b, 'side-part', 'braid', 'short-sleeve', 'short-sleeve', 'side-panels', 'visor', 'none', 0.18),
  createTennisKit('women-orange-navy', 0xe77b42, 0x273b54, 0xf2ead8, 0x2d201c, 'textured-crop', 'bun', 'sleeveless', 'cap-sleeve', 'chest-band', 'none', 'none', 0.16),
  createTennisKit('women-white-lime', 0xf1eee5, 0x66734b, 0xc7d95c, 0x86563c, 'curly-top', 'double-braid', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.17),
  createTennisKit('women-navy-teal', 0x243753, 0x1c6463, 0x8ec9be, 0x34231e, 'swept-back', 'swept', 'short-sleeve', 'short-sleeve', 'yoke', 'visor', 'none', 0.16),
  createTennisKit('women-peach-skirt', 0xe8ae91, 0x984b55, 0xf4eee2, 0x583a2b, 'buzz-cut', 'ponytail', 'sleeveless', 'cap-sleeve', 'chest-band', 'none', 'none', 0.15),
  createTennisKit('women-graphite-pink', 0x55545d, 0x303039, 0xe28ca0, 0x241d1a, 'side-part', 'high-ponytail', 'short-sleeve', 'sleeveless', 'side-panels', 'headband', 'none', 0.18),
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

function addGrooming(model: THREE.Group, kit: NativePlayerKit, index: number, female: boolean) {
  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone)) return;
  const hairMaterial = new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.78 });
  const accessoryMaterial = new THREE.MeshStandardMaterial({
    color: kit.accentColor,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  const playerNumber = index + 1;

  if (kit.headwear === 'headband' || kit.headwear === 'visor') {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.084, 0.007, 6, 28),
      accessoryMaterial,
    );
    band.name = `native-player-headband-${playerNumber}`;
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.062, 0);
    band.scale.set(0.88, 1, 0.82);
    head.add(band);
  }
  if (kit.headwear === 'visor') {
    const brimShape = new THREE.Shape();
    brimShape.moveTo(-0.08, 0);
    brimShape.quadraticCurveTo(0, 0.045, 0.08, 0);
    brimShape.quadraticCurveTo(0, -0.018, -0.08, 0);
    const brim = new THREE.Mesh(new THREE.ShapeGeometry(brimShape, 16), accessoryMaterial);
    brim.name = `native-player-visor-brim-${playerNumber}`;
    brim.geometry.rotateX(Math.PI / 2);
    brim.position.set(0, 0.041, 0.035);
    head.add(brim);
  }

  const addSweptHair = () => {
    const sweptHair = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), hairMaterial);
    sweptHair.name = `native-player-swept-hair-${playerNumber}`;
    sweptHair.scale.set(0.061, 0.031, 0.079);
    sweptHair.position.set(0.018, 0.111, -0.018);
    sweptHair.rotation.z = -0.18;
    sweptHair.rotation.x = -0.15;
    sweptHair.castShadow = true;
    head.add(sweptHair);
  };

  const addBraid = (side: -1 | 1, tailLength: number, suffix: string) => {
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.026, 0.046, -0.062),
      new THREE.Vector3(side * 0.042, -0.07, -0.096),
      new THREE.Vector3(side * 0.052, -0.17, -0.12),
      new THREE.Vector3(side * 0.045, 0.046 - tailLength, -0.11),
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
    const startY = hairStyle === 'high-ponytail' ? 0.086 : hairStyle === 'low-ponytail' ? 0.025 : -0.012;
    const tailLength = hairStyle === 'low-ponytail' ? 0.32 : 0.36;
    const side = index === 0 ? -1 : 1;
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.005, 6, 16), accessoryMaterial);
    tie.name = `native-player-hair-tie-${playerNumber}`;
    tie.position.set(-0.008, startY - 0.014, -0.066);
    tie.rotation.x = Math.PI / 2;
    head.add(tie);
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.008, startY, -0.066),
      new THREE.Vector3(side * 0.01, startY - 0.09, -0.105),
      new THREE.Vector3(side * 0.022, startY - 0.19, -0.13),
      new THREE.Vector3(side * 0.015, startY - tailLength, -0.12),
    ]);
    const ponytail = new THREE.Mesh(taperedHairGeometry(path, 0.019), hairMaterial);
    ponytail.name = `native-player-ponytail-${playerNumber}`;
    ponytail.userData.hairStyle = hairStyle;
    ponytail.castShadow = true;
    head.add(ponytail);
  };

  if (female) {
    const style = kit.femaleHairStyle;
    if (style === 'swept') {
      addSweptHair();
      addPonytail('ponytail');
    } else if (style === 'bob') {
      const bob = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 16), hairMaterial);
      bob.name = `native-player-hair-bob-${playerNumber}`;
      bob.scale.set(0.079, 0.089, 0.065);
      bob.position.set(0, 0.015, -0.03);
      bob.castShadow = true;
      head.add(bob);
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), hairMaterial);
        panel.name = `native-player-hair-bob-side-${side < 0 ? 'left' : 'right'}-${playerNumber}`;
        panel.scale.set(0.023, 0.061, 0.04);
        panel.position.set(side * 0.068, -0.005, -0.004);
        head.add(panel);
      }
    } else if (style === 'bun') {
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.043, 18, 12), hairMaterial);
      bun.name = `native-player-hair-bun-${playerNumber}`;
      bun.position.set(0, 0.028, -0.083);
      bun.castShadow = true;
      head.add(bun);
    } else if (style === 'double-braid') {
      addBraid(-1, 0.33, 'left');
      addBraid(1, 0.33, 'right');
    } else if (style === 'braid') {
      addBraid(index === 0 ? -1 : 1, 0.34, 'single');
    } else {
      addPonytail(style);
    }
  } else {
    const style = kit.maleHairStyle;
    if (style === 'side-part') {
      addSweptHair();
    } else if (style === 'swept-back') {
      const sweep = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), hairMaterial);
      sweep.name = `native-player-hair-swept-back-${playerNumber}`;
      sweep.scale.set(0.064, 0.033, 0.081);
      sweep.position.set(-0.004, 0.094, -0.035);
      sweep.rotation.x = -0.18;
      head.add(sweep);
    } else if (style === 'textured-crop') {
      for (let tuft = 0; tuft < 9; tuft++) {
        const angle = tuft * Math.PI * 2 / 9;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.034, 6), hairMaterial);
        spike.name = `native-player-hair-texture-${playerNumber}-${tuft}`;
        spike.position.set(Math.cos(angle) * 0.045, 0.093 + (tuft % 3) * 0.004, Math.sin(angle) * 0.034 - 0.012);
        spike.rotation.z = Math.cos(angle) * 0.24;
        spike.rotation.x = Math.sin(angle) * 0.22;
        head.add(spike);
      }
    } else if (style === 'curly-top') {
      for (let curl = 0; curl < 13; curl++) {
        const angle = curl * Math.PI * (3 - Math.sqrt(5));
        const radius = 0.045 * Math.sqrt((curl + 0.5) / 13);
        const coil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), hairMaterial);
        coil.name = `native-player-hair-curl-${playerNumber}-${curl}`;
        coil.position.set(Math.cos(angle) * radius, 0.09 + (curl % 3) * 0.004, Math.sin(angle) * radius - 0.01);
        head.add(coil);
      }
    }
  }

  if (!female && kit.facialHair !== 'none') {
    const beardMaterial = new THREE.MeshStandardMaterial({
      color: kit.hairColor,
      roughness: 0.94,
      transparent: kit.facialHair === 'stubble',
      opacity: kit.facialHair === 'stubble' ? 0.48 : 1,
    });
    const beard = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), beardMaterial);
    beard.name = `native-player-neat-beard-${playerNumber}`;
    beard.scale.set(
      kit.facialHair === 'stubble' ? 0.062 : 0.066,
      kit.facialHair === 'stubble' ? 0.023 : 0.032,
      kit.facialHair === 'stubble' ? 0.012 : 0.019,
    );
    beard.position.set(0, -0.086, 0.075);
    const facialHair = new THREE.Group();
    facialHair.name = `native-player-stubble-${playerNumber}`;
    facialHair.add(beard);
    for (const side of [-1, 1]) {
      const sideburn = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), beardMaterial);
      sideburn.scale.set(0.012, 0.035, 0.014);
      sideburn.position.set(side * 0.064, -0.042, 0.045);
      facialHair.add(sideburn);
    }
    head.add(facialHair);
  }
}

function addWtaMakeupAndStuds(model: THREE.Group, index: number) {
  const head = model.getObjectByName('head');
  if (!(head instanceof THREE.Bone)) return;
  const blushMaterial = new THREE.MeshBasicMaterial({
    color: 0xb87578, transparent: true, opacity: 0.2, depthWrite: false,
  });
  const studMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7bd87, roughness: 0.28, metalness: 0.48,
  });
  for (const side of [-1, 1] as const) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), blushMaterial);
    cheek.name = `native-wta-blush-${side < 0 ? 'left' : 'right'}-${index + 1}`;
    cheek.scale.set(0.02, 0.008, 0.003);
    cheek.position.set(side * 0.052, -0.035, 0.09);
    head.add(cheek);

    const earring = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 10), studMaterial);
    earring.name = `native-wta-earring-${side < 0 ? 'left' : 'right'}-${index + 1}`;
    earring.position.set(side * 0.085, -0.018, 0.022);
    earring.castShadow = true;
    head.add(earring);
  }
  const lipTint = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xa65d65, transparent: true, opacity: 0.32, depthWrite: false }),
  );
  lipTint.name = `native-wta-lip-tint-${index + 1}`;
  lipTint.scale.set(0.014, 0.004, 0.0025);
  lipTint.position.set(0, -0.077, 0.092);
  head.add(lipTint);
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
  for (const body of bodies) {
    body.geometry = body.geometry.clone();
    if (female) shapeWtaBody(body, model);
    const original = body.geometry;
    body.material = new THREE.MeshStandardMaterial({
      color: kit.skinColor ?? 0xcda080,
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
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
      // Performance fabric: a soft sheen rather than flat cotton.
      const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
        color, roughness: 0.76, side: THREE.DoubleSide,
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
    addShell('native-cropped-hair', kit.hairColor, () => 0.004, [i => points[i].y - 1.56],
      triangle => triangle.some(v => {
        const p = points[v];
        return p.y > 1.635 || p.z < 0.015 || (p.y > 1.60 && Math.abs(p.x) > 0.064);
      }), false);
    const visible: number[] = [];
    for (let i = 0; i < indices.count; i += 3) {
      if (covered.has(i)) continue;
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      if (Math.max(points[a].y, points[b].y, points[c].y) >= 0.1) visible.push(a, b, c);
    }
    body.geometry.setIndex(visible);
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
  addGrooming(model, kit, kitIndex, female);
  if (female) addWtaMakeupAndStuds(model, kitIndex);
}
