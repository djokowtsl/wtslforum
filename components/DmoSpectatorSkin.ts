import * as THREE from 'three';

/**
 * Volume-preserving skinning for the exposed VALID arms. Linear matrix blends
 * pinch a large forearm turn into a ribbon; dual-quaternion blending retains
 * the original connected surface without moving joints or grafting geometry.
 * Results are baked once per pose, not calculated for every spectator/frame.
 */
export function createSpectatorSkin(mesh: THREE.SkinnedMesh) {
  const transforms = mesh.skeleton.bones.map((joint, index) => {
    const matrix = mesh.matrixWorld.clone().multiply(mesh.bindMatrixInverse)
      .multiply(joint.matrixWorld).multiply(mesh.skeleton.boneInverses[index]).multiply(mesh.bindMatrix);
    const translation = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    matrix.decompose(translation, rotation, scale);
    const dual = new THREE.Quaternion(translation.x, translation.y, translation.z, 0).multiply(rotation);
    dual.set(dual.x * 0.5, dual.y * 0.5, dual.z * 0.5, dual.w * 0.5);
    return { rotation, dual, scale };
  });
  const joints = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const real = new THREE.Quaternion(), dual = new THREE.Quaternion(), translation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  return (vertex: number, point: THREE.Vector3, normal: THREE.Vector3) => {
    real.set(0, 0, 0, 0); dual.set(0, 0, 0, 0); scale.set(0, 0, 0);
    let reference: THREE.Quaternion | undefined;
    for (let c = 0; c < 4; c++) {
      const weight = weights.getComponent(vertex, c);
      if (!weight) continue;
      const transform = transforms[joints.getComponent(vertex, c)];
      reference ??= transform.rotation;
      const w = weight * (reference.dot(transform.rotation) < 0 ? -1 : 1);
      real.set(real.x + transform.rotation.x * w, real.y + transform.rotation.y * w,
        real.z + transform.rotation.z * w, real.w + transform.rotation.w * w);
      dual.set(dual.x + transform.dual.x * w, dual.y + transform.dual.y * w,
        dual.z + transform.dual.z * w, dual.w + transform.dual.w * w);
      scale.addScaledVector(transform.scale, weight);
    }
    const length = real.length();
    if (length < 0.000001) throw new Error('Spectator vertex has no usable skin weights.');
    real.set(real.x / length, real.y / length, real.z / length, real.w / length);
    dual.set(dual.x / length, dual.y / length, dual.z / length, dual.w / length);
    translation.set(-real.x, -real.y, -real.z, real.w).premultiply(dual);
    point.multiply(scale).applyQuaternion(real);
    point.x += 2 * translation.x; point.y += 2 * translation.y; point.z += 2 * translation.z;
    normal.divide(scale).applyQuaternion(real).normalize();
  };
}
