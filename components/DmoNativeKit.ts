import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;

/** Skinned tennis garments share the native skeleton, including at the sleeves. */
export function dressNativePlayer(model: THREE.Group, shirtColor: number, female: boolean) {
  model.updateMatrixWorld(true);
  const bodies: THREE.SkinnedMesh[] = [];
  model.traverse(o => { if (o instanceof THREE.SkinnedMesh) bodies.push(o); });
  for (const body of bodies) {
    const original = body.geometry;
    body.geometry = original.clone();
    body.material = new THREE.MeshStandardMaterial({ color: 0xcda080, roughness: 0.76 });
    const positions = original.getAttribute('position'), normals = original.getAttribute('normal');
    const indices = original.index;
    if (!indices) throw new Error('Native body requires indexed skin geometry.');
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(body.matrixWorld));
    const skinIndex = original.getAttribute('skinIndex'), skinWeight = original.getAttribute('skinWeight');
    const boneNames = body.skeleton.bones.map(bone => bone.name);
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
      vertexWeights[i].forEach((weight, joint) => { if (test.test(boneNames[joint])) total += weight; });
      return total;
    };
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
      return { side, shoulder, axis: axis.divideScalar(length), length,
        test: new RegExp(`^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)\\w*_${side}$`) };
    });
    type Field = (i: number) => number;
    type Vertex = { point: THREE.Vector3; normal: THREE.Vector3; weights: Map<number, number>; fields: number[] };
    const fieldCache = new Map<Field[], Map<number, number[]>>();
    const sourceVertex = (i: number, fields: Field[]): Vertex => {
      let cache = fieldCache.get(fields);
      if (!cache) fieldCache.set(fields, cache = new Map());
      let values = cache.get(i);
      if (!values) cache.set(i, values = fields.map(field => field(i)));
      return {
        point: points[i].clone(),
        normal: new THREE.Vector3().fromBufferAttribute(normals, i),
        weights: vertexWeights[i],
        fields: [...values],
      };
    };
    const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => {
      const weights = new Map<number, number>();
      a.weights.forEach((weight, joint) => weights.set(joint, weight * (1 - t)));
      b.weights.forEach((weight, joint) => weights.set(joint, (weights.get(joint) ?? 0) + weight * t));
      return {
        point: a.point.clone().lerp(b.point, t),
        normal: a.normal.clone().lerp(b.normal, t).normalize(),
        weights,
        fields: a.fields.map((value, i) => value + (b.fields[i] - value) * t),
      };
    };
    const covered = new Set<number>();
    const addShell = (
      name: string, color: number, offset: (vertex: Vertex) => number, fields: Field[],
      include?: (triangle: number[]) => boolean, hidesSkin = true,
    ) => {
      const vertices: Vertex[] = [], visible: number[] = [];
      for (let i = 0; i < indices.count; i += 3) {
        const triangle = [0, 1, 2].map(k => indices.getX(i + k));
        if (include && !include(triangle)) continue;
        let polygon = triangle.map(vertex => sourceVertex(vertex, fields));
        if (hidesSkin && polygon.every(vertex => vertex.fields.every(field => field > 0.012))) covered.add(i);
        for (let field = 0; field < fields.length; field++) {
          const clipped: Vertex[] = [];
          for (let k = 0; k < polygon.length; k++) {
            const a = polygon[k], b = polygon[(k + 1) % polygon.length];
            const da = a.fields[field], db = b.fields[field];
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
      mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
      mesh.bind(body.skeleton, body.bindMatrix);
      mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
      body.parent!.add(mesh);
    };
    const neckline: Field = i => {
      const point = points[i];
      const dx = point.x - neck.x, dz = point.z - (neck.z + 0.012);
      const radial = Math.hypot(dx / 0.088, dz / 0.082) - 1;
      const collarHeight = neck.y - 0.045 - 0.022 * smooth(dz, 0, 0.08);
      return Math.max(collarHeight - point.y, radial * 0.08);
    };
    const sleeve = (fraction: number): Field => i => {
      const point = points[i];
      const arm = arms[point.x >= 0 ? 0 : 1];
      const along = point.clone().sub(arm.shoulder).dot(arm.axis) / arm.length;
      const armness = smooth(weightOf(i, arm.test), 0.25, 0.75);
      return (fraction - along) * armness + 0.3 * (1 - armness);
    };
    const shirtFields: Field[] = [
      i => points[i].y - 0.86,
      neckline,
      sleeve(0.46),
      i => neck.y + 0.01 - points[i].y,
    ];
    const isTrunk = (i: number) => weightOf(i, /^(pelvis|spine_01|thigh|calf)/) > 0.5;
    const shortsFields: Field[] = [i => points[i].y - 0.575, i => 0.975 - points[i].y];
    addShell('native-tennis-shirt', shirtColor, vertex => {
      const hemFlare = 0.004 * (1 - smooth(vertex.point.y, 0.88, 1.0));
      const collarFit = 0.003 * (1 - smooth(vertex.fields[1], 0, 0.02));
      return 0.011 + hemFlare - collarFit;
    }, shirtFields);
    addShell('native-tennis-shorts', 0x202b35, () => 0.007, shortsFields,
      triangle => triangle.every(isTrunk));
    addShell('native-cropped-hair', 0x38291f, () => 0.004, [i => points[i].y - 1.56],
      triangle => triangle.some(i => {
        const point = points[i];
        return point.y > 1.635 || point.z < 0.015 || (point.y > 1.60 && Math.abs(point.x) > 0.064);
      }), false);
    const visible: number[] = [];
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2);
      if (!covered.has(i) && Math.max(points[a].y, points[b].y, points[c].y) >= 0.1) visible.push(a, b, c);
    }
    body.geometry.setIndex(visible);
    body.frustumCulled = false; body.castShadow = true; body.receiveShadow = true;
  }
  if (female) {
    const pelvis = model.getObjectByName('pelvis')!;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.235, 0.28, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x202b35, roughness: 0.9, side: THREE.DoubleSide }));
    skirt.name = 'native-tennis-skirt';
    model.updateMatrixWorld(true);
    const world = pelvis.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.12, 0));
    model.add(skirt); skirt.position.copy(model.worldToLocal(world));
    skirt.quaternion.copy(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    pelvis.attach(skirt);
  }
}
