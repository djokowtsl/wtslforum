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
const WTA_SHORT_SLEEVE_END_FRACTION = 0.3;
const STANDARD_SHORT_SLEEVE_END_FRACTION = 0.46;
const WTA_TENNIS_SKIRT_HEIGHT = 0.16;

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

export type NativePlayerKit = {
  shortsColor: number;
  accentColor: number;
  hairColor: number;
  grooming: 'headband-swept' | 'short-beard';
};

export const BROADCAST_PLAYER_KITS: [NativePlayerKit, NativePlayerKit] = [
  { shortsColor: 0x26343a, accentColor: 0xc2ad7e, hairColor: 0x2b2522, grooming: 'headband-swept' },
  { shortsColor: 0x35413d, accentColor: 0x9c6655, hairColor: 0x46352d, grooming: 'short-beard' },
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
  const style = female ? (index === 1 ? 'ponytail' : 'headband-swept') : kit.grooming;
  if (female) {
    if (style === 'headband-swept') {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.084, 0.008, 6, 28),
        new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.8 }),
      );
      band.name = `native-player-headband-${index + 1}`;
      band.rotation.x = Math.PI / 2;
      band.position.set(0, 0.062, 0);
      band.scale.set(0.88, 1, 0.82);
      head.add(band);
      const sweptHair = new THREE.Mesh(
        new THREE.SphereGeometry(1, 18, 12),
        new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.78 }),
      );
      sweptHair.name = `native-player-swept-hair-${index + 1}`;
      sweptHair.scale.set(0.061, 0.031, 0.079);
      sweptHair.position.set(0.018, 0.111, -0.018);
      sweptHair.rotation.z = -0.18;
      sweptHair.rotation.x = -0.15;
      sweptHair.castShadow = true;
      head.add(sweptHair);
    }

    const tie = new THREE.Mesh(
      new THREE.TorusGeometry(0.021, 0.005, 6, 16),
      new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.78 }),
    );
    tie.name = `native-player-hair-tie-${index + 1}`;
    tie.position.set(-0.008, -0.058, -0.066);
    tie.rotation.x = Math.PI / 2;
    head.add(tie);
    const side = index === 0 ? -1 : 1;
    const tailLength = index === 0 ? 0.31 : 0.36;
    const ponytailPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.008, -0.058, -0.066),
      new THREE.Vector3(side * 0.01, -0.13, -0.105),
      new THREE.Vector3(side * 0.022, -0.22, -0.13),
      new THREE.Vector3(side * 0.015, -0.058 - tailLength, -0.12),
    ]);
    const ponytail = new THREE.Mesh(
      taperedHairGeometry(ponytailPath, 0.019),
      new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.78 }),
    );
    ponytail.name = `native-player-ponytail-${index + 1}`;
    ponytail.castShadow = true;
    head.add(ponytail);
    for (const side of [-1, 1] as const) {
      const lockPath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.052, 0.035, 0.032),
        new THREE.Vector3(side * 0.071, -0.02, 0.054),
        new THREE.Vector3(side * 0.082, -0.105, 0.056),
        new THREE.Vector3(side * 0.066, -0.19, 0.045),
        new THREE.Vector3(side * 0.087, -0.27, 0.022),
        new THREE.Vector3(side * 0.09, -0.31, 0.012),
      ]);
      const lock = new THREE.Mesh(
        taperedHairGeometry(lockPath, 0.013),
        new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.78 }),
      );
      lock.name = `native-player-front-lock-${side < 0 ? 'left' : 'right'}-${index + 1}`;
      lock.castShadow = true;
      head.add(lock);
    }
  } else if (style === 'headband-swept') {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.084, 0.008, 6, 28),
      new THREE.MeshStandardMaterial({ color: kit.accentColor, roughness: 0.8 }),
    );
    band.name = `native-player-headband-${index + 1}`;
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.062, 0);
    band.scale.set(0.88, 1, 0.82);
    head.add(band);
    const sweptHair = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.78 }),
    );
    sweptHair.name = `native-player-swept-hair-${index + 1}`;
    sweptHair.scale.set(0.061, 0.031, 0.079);
    sweptHair.position.set(0.018, 0.111, -0.018);
    sweptHair.rotation.z = -0.18;
    sweptHair.rotation.x = -0.15;
    sweptHair.castShadow = true;
    head.add(sweptHair);
  } else {
    const beardMaterial = new THREE.MeshStandardMaterial({ color: kit.hairColor, roughness: 0.94 });
    const beard = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 10),
      beardMaterial,
    );
    beard.name = `native-player-neat-beard-${index + 1}`;
    beard.scale.set(0.066, 0.032, 0.019);
    beard.position.set(0, -0.086, 0.075);
    beard.castShadow = true;
    const grooming = new THREE.Group();
    grooming.name = `native-player-stubble-${index + 1}`;
    grooming.add(beard);
    for (const side of [-1, 1]) {
      const sideburn = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 8),
        beardMaterial,
      );
      sideburn.scale.set(0.012, 0.035, 0.014);
      sideburn.position.set(side * 0.064, -0.042, 0.045);
      grooming.add(sideburn);
    }
    head.add(grooming);
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
  model.updateMatrixWorld(true);
  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if (o instanceof THREE.SkinnedMesh) bodies.push(o); });
  for (const body of bodies) {
    body.geometry = body.geometry.clone();
    if (female) shapeWtaBody(body, model);
    const original = body.geometry;
    body.material = new THREE.MeshStandardMaterial({ color: 0xcda080, roughness: 0.76 });
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
    const sleeveEndFraction = female
      ? WTA_SHORT_SLEEVE_END_FRACTION
      : STANDARD_SHORT_SLEEVE_END_FRACTION;
    const shirtFields: Field[] = [
      i => points[i].y - 0.86,
      neckline,
      sleeve(sleeveEndFraction),
      i => neck.y + 0.01 - points[i].y,
    ];
    const isTrunk = (i: number) => weightOf(i, /^(pelvis|spine_01|thigh|calf)/) > 0.5;
    const shortsFields: Field[] = [i => points[i].y - 0.575, i => 0.975 - points[i].y];

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
      }
      mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
      mesh.bind(body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      body.parent!.add(mesh);
    };
    // Shirt sits outside the shorts' waistband (shirt worn untucked): a larger
    // offset where they overlap, a closer fit at the collar and sleeve hems.
    addShell('native-tennis-shirt', shirtColor, v => {
      const hemFlare = 0.004 * (1 - smooth(v.point.y, 0.88, 1.0));
      const collarFit = 0.003 * (1 - smooth(v.fields[1], 0, 0.02));
      return 0.011 + hemFlare - collarFit;
    }, shirtFields);
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
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, WTA_TENNIS_SKIRT_HEIGHT, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: kit.shortsColor, roughness: 0.9, side: THREE.DoubleSide }));
    skirt.name = 'native-tennis-skirt';
    skirt.userData.skirtLength = WTA_TENNIS_SKIRT_HEIGHT;
    model.updateMatrixWorld(true);
    const world = pelvis.getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, -WTA_TENNIS_SKIRT_HEIGHT / 2 + 0.005, 0));
    model.add(skirt); skirt.position.copy(model.worldToLocal(world));
    skirt.quaternion.copy(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    pelvis.attach(skirt);
  }
  addTourMark(model, kit, kitIndex);
  addGrooming(model, kit, kitIndex, female);
  if (female) addWtaMakeupAndStuds(model, kitIndex);
}
