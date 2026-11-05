import * as THREE from 'three';

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
    type Vertex = { point: THREE.Vector3; normal: THREE.Vector3; weights: Map<number, number> };
    const skinIndex = original.getAttribute('skinIndex'), skinWeight = original.getAttribute('skinWeight');
    const covered = new Set<number>();
    const influence = (vertex: Vertex, matches: (name: string) => boolean) =>
      [...vertex.weights].reduce((n, [i, weight]) => n + (matches(body.skeleton.bones[i].name) ? weight : 0), 0);
    const sourceVertex = (i: number): Vertex => {
      const weights = new Map<number, number>();
      for (let k = 0; k < 4; k++) {
        const joint = skinIndex.getComponent(i, k), weight = skinWeight.getComponent(i, k);
        if (weight > 0) weights.set(joint, (weights.get(joint) ?? 0) + weight);
      }
      return { point: points[i].clone(), normal: new THREE.Vector3().fromBufferAttribute(normals, i), weights };
    };
    const interpolate = (a: Vertex, b: Vertex, t: number): Vertex => {
      const weights = new Map<number, number>();
      a.weights.forEach((v, k) => weights.set(k, v * (1 - t)));
      b.weights.forEach((v, k) => weights.set(k, (weights.get(k) ?? 0) + v * t));
      return { point: a.point.clone().lerp(b.point, t), normal: a.normal.clone().lerp(b.normal, t).normalize(), weights };
    };
    const addShell = (
      name: string, color: number, offset: number, planes: ((v: Vertex) => number)[],
      include?: (vertices: Vertex[]) => boolean,
      coversSkin = false,
    ) => {
      const vertices: Vertex[] = [], visible: number[] = [];
      for (let i = 0; i < indices.count; i += 3) {
        let polygon = [0, 1, 2].map(k => sourceVertex(indices.getX(i + k)));
        if (include && !include(polygon)) continue;
        if (coversSkin && polygon.every(vertex => planes.every(plane => plane(vertex) >= 0))) covered.add(i);
        // Clip triangles at garment boundaries rather than dropping whole
        // faces: collars, cuffs and hems must not have saw-toothed edges.
        for (const plane of planes) {
          const clipped: Vertex[] = [];
          for (let k = 0; k < polygon.length; k++) {
            const a = polygon[k], b = polygon[(k + 1) % polygon.length];
            const da = plane(a), db = plane(b);
            if (da >= 0) clipped.push(a);
            if ((da >= 0) !== (db >= 0)) clipped.push(interpolate(a, b, da / (da - db)));
          }
          polygon = clipped;
        }
        const base = vertices.length;
        vertices.push(...polygon);
        for (let k = 1; k < polygon.length - 1; k++) visible.push(base, base + k, base + k + 1);
      }
      const position: number[] = [], normal: number[] = [], joints: number[] = [], weights: number[] = [];
      const inverse = body.matrixWorld.clone().invert();
      for (const vertex of vertices) {
        position.push(...vertex.point.clone().applyMatrix4(inverse).addScaledVector(vertex.normal, offset).toArray());
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
    const cuffs = (['l', 'r'] as const).map(side => {
      const shoulder = model.getObjectByName(`upperarm_${side}`)!.getWorldPosition(new THREE.Vector3());
      const elbow = model.getObjectByName(`lowerarm_${side}`)!.getWorldPosition(new THREE.Vector3());
      const axis = elbow.sub(shoulder), length = axis.length();
      axis.normalize();
      return (vertex: Vertex) => Math.max(
        0.5 - influence(vertex, name => /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)_/.test(name) && name.endsWith(`_${side}`)),
        length * 0.48 - vertex.point.clone().sub(shoulder).dot(axis),
      );
    });
    const collarHeight = model.getObjectByName('neck_01')!.getWorldPosition(new THREE.Vector3()).y - 0.01;
    // The neckline is at the neck base, above both shoulder caps. A neck
    // weight threshold is not suitable: those weights extend onto the traps.
    addShell('native-tennis-shirt', shirtColor, 0.008, [
      v => v.point.y - 0.96,
      v => collarHeight - v.point.y,
      ...cuffs,
    ], undefined, true);
    addShell('native-tennis-shorts', 0x202b35, 0.012, [v => v.point.y - 0.58, v => 0.98 - v.point.y],
      vertices => vertices.every(v => [...v.weights].reduce((n, [i, w]) =>
        n + (/^(pelvis|spine_01|thigh|calf)/.test(body.skeleton.bones[i].name) ? w : 0), 0) > 0.5), true);
    addShell('native-cropped-hair', 0x38291f, 0.004, [v => v.point.y - 1.56], vertices => vertices.some(v =>
      v.point.y > 1.635 || (v.point.z < 0.015) || (v.point.y > 1.60 && Math.abs(v.point.x) > 0.064)));
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
