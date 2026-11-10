import * as THREE from 'three';

/** The source people are barefoot. Shoes replace the source foot surfaces. */
export function stripBareFeet(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  if (!positions || !index) return 0;
  const visible: number[] = [];
  let removed = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (Math.max(positions.getY(a), positions.getY(b), positions.getY(c)) < 0.115) removed++;
    else visible.push(a, b, c);
  }
  geometry.setIndex(visible);
  return removed;
}

/** Cover the whole torso/hips/legs, not just the garments painted on the atlas. */
export function dressNpc(
  mesh: THREE.SkinnedMesh,
  shirtColor: number,
  skinTone?: readonly [number, number, number],
) {
  const geometry = mesh.geometry;
  const index = geometry.index;
  const positions = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  if (!index || !skinIndex || !skinWeight) {
    throw new Error('NPC clothing requires an indexed, skinned human model.');
  }
  // Mesh positions are metres, while the source armature has centimetre-scale
  // transforms. Use the mesh's own bind-space height for its clothing boundary.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const waistY = THREE.MathUtils.lerp(box.min.y, box.max.y, 0.5);
  const category = (vertex: number) => {
    let torso = 0, leg = 0, arm = 0;
    for (let c = 0; c < 4; c++) {
      const name = mesh.skeleton.bones[skinIndex.getComponent(vertex, c)]?.name ?? '';
      const weight = skinWeight.getComponent(vertex, c);
      if (/^(Hips|Spine02|Spine01|Spine|LeftShoulder|RightShoulder)$/.test(name)) torso += weight;
      if (/^(Left|Right)(UpLeg|Leg)$/.test(name)) leg += weight;
      if (/^(Left|Right)Arm$/.test(name)) arm += weight;
    }
    if (torso > 0.35) return positions.getY(vertex) >= waistY ? 1 : 2;
    if (leg > 0.35) return 2;
    if (arm > 0.35) return 1;
    return 0;
  };
  const buckets: number[][] = [[], [], []];
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const votes = [0, 0, 0];
    triangle.forEach(vertex => votes[category(vertex)]++);
    const material = votes[1] >= 2 ? 1 : votes[2] >= 2 ? 2 : 0;
    buckets[material].push(...triangle);
  }
  const skin = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (skin instanceof THREE.MeshStandardMaterial) {
    skin.vertexColors = false;
    if (skinTone) {
      skin.color.setRGB(...skinTone, THREE.SRGBColorSpace);
      const reference = new THREE.Color(0xe5b59b);
      skin.color.setRGB(skin.color.r / reference.r, skin.color.g / reference.g, skin.color.b / reference.b);
    }
  }
  mesh.material = [
    skin,
    new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.94, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0x303944, roughness: 0.96, side: THREE.DoubleSide }),
  ];
  geometry.setIndex(buckets.flat());
  geometry.clearGroups();
  let offset = 0;
  buckets.forEach((bucket, materialIndex) => {
    geometry.addGroup(offset, bucket.length, materialIndex);
    offset += bucket.length;
  });
}

/** Flat sole, narrower heel and rounded toe; not a sphere/capsule at the ankle. */
export function createNpcShoeGeometry() {
  const outline = [
    [-0.033, -0.105], [0.033, -0.105], [0.043, -0.07], [0.05, 0.035],
    [0.048, 0.095], [0.028, 0.13], [0, 0.14], [-0.028, 0.13],
    [-0.048, 0.095], [-0.05, 0.035], [-0.043, -0.07],
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring < 3; ring++) {
    for (const [x, z] of outline) {
      positions.push(
        x * (ring === 2 ? 0.86 : 1),
        ring === 0 ? -0.035 : ring === 1 ? -0.02 : z < -0.03 ? 0.052 : z < 0.08 ? 0.025 : 0.012,
        z * (ring === 2 ? 0.96 : 1),
      );
    }
  }
  const n = outline.length;
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < n; i++) {
    const a = ring * n + i, b = ring * n + (i + 1) % n;
    indices.push(a, a + n, b, b, a + n, b + n);
  }
  const bottom = positions.length / 3;
  positions.push(0, -0.035, 0);
  const top = positions.length / 3;
  positions.push(0, 0.047, -0.035);
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    indices.push(bottom, i, next, top, 2 * n + next, 2 * n + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
