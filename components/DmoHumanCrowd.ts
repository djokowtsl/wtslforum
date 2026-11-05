import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HumanPose } from './DmoHumanModels';
import type { CrowdRig } from './DmoLiveCourt3DScene';
import { shouldUseHighDetailCrowdSeat } from '../lib/dmoCrowdLod';

function seatedGeometry(template: THREE.Group, look: number, applause: boolean) {
  const space = new THREE.Group();
  const model = clone(template) as THREE.Group;
  space.add(model);
  const pose = new HumanPose(model, space);
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  pose.begin();
  const hips = v(0, 0.63), neck = v(0, 1.13), head = v(0, 1.2);
  pose.place('Hips', hips);
  for (const [name, y] of [['Spine02', 0.76], ['Spine01', 0.89], ['Spine', 1.02]] as const) {
    pose.place(name, v(0, y), neck);
  }
  pose.place('neck', neck, head);
  pose.place('Head', head, undefined, new THREE.Quaternion().setFromAxisAngle(v(0, 1), look));
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const shoulder = v(sign * 0.2, 1.04);
    const elbow = applause ? v(sign * 0.2, 0.98, 0.22) : v(sign * 0.24, 0.82, 0.12);
    const wrist = applause ? v(sign * 0.04, 1.14, 0.28) : v(sign * 0.15, 0.69, 0.25);
    pose.place(`${side}Shoulder`, v(sign * 0.04, 1.02), shoulder);
    pose.place(`${side}Arm`, shoulder, elbow);
    pose.place(`${side}ForeArm`, elbow, wrist);
    pose.place(`${side}Hand`, wrist, wrist.clone().add(v(-sign * 0.05, 0, 0.08)));
    const hip = v(sign * 0.11, 0.63);
    const knee = v(sign * 0.14, 0.43, 0.26);
    const ankle = v(sign * 0.14, 0.12, 0.19);
    const toe = v(sign * 0.14, 0.05, 0.29);
    pose.place(`${side}UpLeg`, hip, knee);
    pose.place(`${side}Leg`, knee, ankle);
    pose.place(`${side}Foot`, ankle, toe);
    pose.place(`${side}ToeBase`, toe);
  }
  pose.finish();
  let result: THREE.BufferGeometry | undefined;
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const geometry = object.geometry.clone();
    const positions = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      object.applyBoneTransform(i, vertex).applyMatrix4(object.matrixWorld);
      positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
    geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    object.skeleton.dispose();
    result = geometry;
  });
  if (!result) throw new Error('Crowd asset has no skinned human mesh.');
  return result;
}

/** Textured seated humans use instancing; full-detail meshes are added progressively. */
export function attachHumanCrowd(scene: THREE.Scene, crowd: CrowdRig, templates: THREE.Group[]) {
  const batches: THREE.InstancedMesh[] = [];
  const highDetailBatches: THREE.InstancedMesh[] = [];
  const makeBatches = (template: THREE.Group, target: THREE.InstancedMesh[], label: string) => {
    let sourceMaterial: THREE.Material | undefined;
    template.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    });
    if (!sourceMaterial) throw new Error('Crowd material missing.');
    for (const applauding of [false, true]) for (const look of [-0.5, 0, 0.5]) {
      const mesh = new THREE.InstancedMesh(seatedGeometry(template, look, applauding), sourceMaterial.clone(), crowd.seats.length);
      mesh.name = `wtsl-${label}-spectators-${target.length}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      target.push(mesh);
    }
  };
  templates.forEach((template) => makeBatches(template, batches, 'textured'));

  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  const tones = [
    [0.96, 0.89, 0.82],
    [0.88, 0.79, 0.70],
    [1.0, 0.95, 0.88],
    [0.91, 0.84, 0.77],
    [0.84, 0.76, 0.69],
    [0.95, 0.91, 0.87],
  ] as const;
  let highDetailEnabled = crowd.highDetailEnabled;
  let highDetailCounts = new Uint16Array(0);
  let highDetailSeats = new Set<number>();
  let lastUpdate = -Infinity, previousApplause = false, forceUpdate = true;
  const counts = new Uint16Array(batches.length);
  const update: CrowdRig['update'] = (time, applauding, ball) => {
    if (!forceUpdate && time - lastUpdate < 0.16 && applauding === previousApplause) return;
    counts.fill(0);
    highDetailCounts.fill(0);
    crowd.seats.forEach((seat, index) => {
      let delta = ball ? Math.atan2(ball.x - seat.x, ball.z - seat.z) - seat.facing : 0;
      delta = THREE.MathUtils.euclideanModulo(delta + Math.PI, Math.PI * 2) - Math.PI;
      const gaze = delta < -0.18 ? 0 : delta > 0.18 ? 2 : 1;
      const gender = index % 2;
      // Alternate hands-apart and hands-together poses during applause.
      const clap = applauding && index % 5 !== 0 && Math.sin(time * 9 + index) > -0.15;
      const useHighDetail = highDetailEnabled && highDetailBatches.length > 0 && highDetailSeats.has(index);
      const bucket = (clap ? 3 : 0) + gaze;
      const mesh = useHighDetail ? highDetailBatches[bucket] : batches[gender * 6 + bucket];
      const instance = useHighDetail ? highDetailCounts[bucket]++ : counts[gender * 6 + bucket]++;
      const lean = ((index % 5) - 2) * 0.009;
      const turn = ((index * 3 % 5) - 2) * 0.012;
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(lean, seat.facing + turn, 0);
      const stature = 0.91 + (index % 7) * 0.025;
      dummy.scale.set(0.9 + (index % 5) * 0.035, stature, 0.94 + (index % 3) * 0.04);
      dummy.updateMatrix();
      mesh.setMatrixAt(instance, dummy.matrix);
      // Subtle warm-neutral tint variation gives the textured models a less repeated look.
      const tone = index % 6;
      instanceColor.setRGB(tones[tone][0], tones[tone][1], tones[tone][2]);
      mesh.setColorAt(instance, instanceColor);
    });
    batches.forEach((mesh, index) => {
      mesh.count = counts[index]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    highDetailBatches.forEach((mesh, index) => {
      mesh.count = highDetailCounts[index]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    previousApplause = applauding; lastUpdate = time;
    forceUpdate = false;
  };
  crowd.setHighDetailEnabled = (enabled) => {
    crowd.highDetailEnabled = enabled;
    highDetailEnabled = enabled;
    highDetailBatches.forEach((mesh) => { mesh.visible = enabled; });
    forceUpdate = true;
  };
  crowd.setHighDetailModel = (template, genderIndex) => {
    if (highDetailBatches.length > 0) return;
    makeBatches(template, highDetailBatches, 'high-detail');
    highDetailSeats = new Set(
      crowd.seats.flatMap((seat, index) =>
        shouldUseHighDetailCrowdSeat(seat.row, index, genderIndex) ? [index] : []),
    );
    highDetailCounts = new Uint16Array(highDetailBatches.length);
    highDetailBatches.forEach((mesh) => { mesh.visible = highDetailEnabled; });
    forceUpdate = true;
  };
  crowd.replacePeople(update);
  update(0, false);
  return batches;
}
