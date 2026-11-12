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
};

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
  };
}

export const ATP_PLAYER_KITS: NativePlayerKit[] = [
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
];

export const WTA_PLAYER_KITS: NativePlayerKit[] = [
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
];

export const BROADCAST_PLAYER_KITS: [NativePlayerKit, NativePlayerKit] = [
  ATP_PLAYER_KITS[0],
  ATP_PLAYER_KITS[1],
];

function addTourMark(model: THREE.Group, kit: NativePlayerKit, index: number) {
  const chest = model.getObjectByName('spine_03');
  if (!(chest instanceof THREE.Bone)) return;
  const mark = new THREE.Group();
  mark.name = `native-tour-mark-${index + 1}`;
  mark.position.set(-0.09, 0.11, 0.108);
  const inventedLabel = index === 0 ? 'COURTLINE' : 'MERIDIAN';
  mark.userData.inventedLabel = inventedLabel;
  let map: THREE.CanvasTexture | undefined;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 196;
    const context = canvas.getContext('2d');
    if (context) {
      const accent = `#${kit.accentColor.toString(16).padStart(6, '0')}`;
      context.fillStyle = '#26343a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#d8d0bd';
      context.lineWidth = 8;
      context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
      context.fillStyle = accent;
      context.fillRect(18, 18, 14, canvas.height - 36);
      context.beginPath();
      context.moveTo(66, 48);
      context.lineTo(91, 98);
      context.lineTo(66, 148);
      context.lineTo(41, 98);
      context.closePath();
      context.fill();
      context.fillStyle = '#f0eadc';
      context.font = '700 44px sans-serif';
      context.textBaseline = 'middle';
      context.fillText(inventedLabel, 111, 92, 374);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
    }
  }
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.066),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      ...(map ? { map } : {}),
      roughness: 0.86,
      side: THREE.DoubleSide,
    }),
  );
  patch.name = 'native-apparel-patch';
  mark.add(patch);
  if (!map) {
    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.004, 0.003),
      new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.82 }),
    );
    seam.name = 'native-patch-seam';
    seam.position.y = -0.023;
    mark.add(seam);
  }
  chest.add(mark);
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
    const neckline: Field = i => {
      const p = points[i];
      const dx = p.x - neck.x, dz = p.z - (neck.z + 0.012);
      const radial = Math.hypot(dx / 0.088, dz / 0.082) - 1;
      const collarHeight = neck.y - 0.045 - 0.022 * smooth(dz, 0, 0.08);
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
    const shirtFields: Field[] = [
      i => points[i].y - 0.86,
      neckline,
      sleeve(sleeveEndFraction),
      i => neck.y + 0.01 - points[i].y,
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
      const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
        color, roughness: 0.91, side: THREE.DoubleSide,
      }));
      mesh.name = name;
      if (name === 'native-tennis-shirt') {
        mesh.userData.sleeveEndFraction = sleeveEndFraction;
        mesh.userData.topStyle = topStyle;
        mesh.userData.pattern = kit.shirtPattern;
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
  addTourMark(model, kit, kitIndex);
  addGrooming(model, kit, kitIndex, female);
  if (female) addWtaMakeupAndStuds(model, kitIndex);
}
