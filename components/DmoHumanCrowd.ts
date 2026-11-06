import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { disposeHumanModel, HumanPose, tintKit } from './DmoHumanModels';
import type { CourtFixtureRig, CrowdRig } from './DmoLiveCourt3DScene';
import { shouldUseHighDetailCrowdSeat } from '../lib/dmoCrowdLod';

function tintedHuman(template: THREE.Group, tint: number) {
  const model = clone(template) as THREE.Group;
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((item) => item.clone())
      : object.material.clone();
    tintKit(object, tint);
  });
  return model;
}

function addCrowdAccessories(scene: THREE.Scene, crowd: CrowdRig) {
  const capSeats = crowd.seats.filter((seat, index) => ((seat.sourceIndex ?? index) % 17) === 7);
  if (capSeats.length) {
    const dome = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66 }),
      capSeats.length,
    );
    const brim = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.24, 0.025, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.66 }),
      capSeats.length,
    );
    const colors = [0x184d66, 0x9d3037, 0xd1ae42, 0xf0eee5, 0x29363d, 0x467357, 0x71466d];
    const transform = new THREE.Object3D();
    capSeats.forEach((seat, index) => {
      transform.position.set(seat.x, seat.y + 1.34, seat.z);
      transform.rotation.set(0, seat.facing, 0);
      transform.scale.set(0.135, 0.095, 0.135);
      transform.updateMatrix();
      dome.setMatrixAt(index, transform.matrix);
      const color = new THREE.Color(colors[(seat.sourceIndex ?? index) % colors.length]);
      dome.setColorAt(index, color);

      const forwardX = Math.sin(seat.facing);
      const forwardZ = Math.cos(seat.facing);
      transform.position.set(seat.x + forwardX * 0.08, seat.y + 1.32, seat.z + forwardZ * 0.08);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      brim.setMatrixAt(index, transform.matrix);
      brim.setColorAt(index, color);
    });
    dome.name = 'wtsl-crowd-caps';
    brim.name = 'wtsl-crowd-cap-brims';
    dome.instanceMatrix.needsUpdate = true;
    brim.instanceMatrix.needsUpdate = true;
    if (dome.instanceColor) dome.instanceColor.needsUpdate = true;
    if (brim.instanceColor) brim.instanceColor.needsUpdate = true;
    dome.castShadow = false;
    brim.castShadow = false;
    scene.add(dome, brim);
  }

  const bannerSeats = crowd.seats.filter((seat, index) =>
    seat.row >= 6 && ((seat.sourceIndex ?? index) % 283) === 37);
  bannerSeats.slice(0, 36).forEach((seat, index) => {
    const banner = new THREE.Group();
    banner.name = `wtsl-fan-banner-${index + 1}`;
    banner.position.set(seat.x, seat.y, seat.z);
    banner.rotation.y = seat.facing;
    const palette = [0x174e5d, 0x913841, 0x335b43, 0x765276, 0xa17a2e];
    const color = palette[index % palette.length];
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.016, 0.78, 7),
      new THREE.MeshStandardMaterial({ color: 0xc3c1b7, roughness: 0.72 }),
    );
    pole.name = 'wtsl-fan-banner-pole';
    pole.position.set(-0.34, 1.42, 0);
    pole.castShadow = false;
    banner.add(pole);
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.38),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide }),
    );
    panel.name = 'wtsl-fan-banner-panel';
    panel.position.set(0, 1.65, 0.01);
    panel.castShadow = false;
    banner.add(panel);
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 288;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#f5f1e5';
        context.fillRect(0, 0, canvas.width, 16);
        context.fillRect(0, canvas.height - 16, canvas.width, 16);
        context.font = '800 104px Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(index % 2 ? 'WTSL' : 'ACE', canvas.width / 2, canvas.height / 2 + 4);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = panel.material as THREE.MeshStandardMaterial;
        material.color.set(0xffffff);
        material.map = texture;
        material.needsUpdate = true;
      }
    }
    scene.add(banner);
  });
}

function poseSeatedStaff(model: THREE.Group, space: THREE.Group, hipsY: number) {
  const pose = new HumanPose(model, space);
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const neck = v(0, hipsY + 0.5);
  const head = v(0, hipsY + 0.57);
  pose.begin();
  pose.place('Hips', v(0, hipsY));
  for (const [name, y] of [['Spine02', 0.13], ['Spine01', 0.26], ['Spine', 0.39]] as const) {
    pose.place(name, v(0, hipsY + y), neck);
  }
  pose.place('neck', neck, head);
  pose.place('Head', head);
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    const shoulder = v(sign * 0.2, hipsY + 0.41);
    const elbow = v(sign * 0.24, hipsY + 0.19, 0.12);
    const wrist = v(sign * 0.15, hipsY + 0.06, 0.25);
    pose.place(`${side}Shoulder`, v(sign * 0.04, hipsY + 0.39), shoulder);
    pose.place(`${side}Arm`, shoulder, elbow);
    pose.place(`${side}ForeArm`, elbow, wrist);
    pose.place(`${side}Hand`, wrist, wrist.clone().add(v(-sign * 0.05, 0, 0.08)));
    const hip = v(sign * 0.11, hipsY);
    const knee = v(sign * 0.14, hipsY - 0.2, 0.26);
    const ankle = v(sign * 0.14, hipsY - 0.51, 0.19);
    const toe = v(sign * 0.14, hipsY - 0.58, 0.29);
    pose.place(`${side}UpLeg`, hip, knee);
    pose.place(`${side}Leg`, knee, ankle);
    pose.place(`${side}Foot`, ankle, toe);
    pose.place(`${side}ToeBase`, toe);
  }
  pose.finish();
  return { pose, head };
}

function attachStaffModel(
  space: THREE.Group,
  template: THREE.Group,
  name: string,
  tint: number,
  hipsY: number,
) {
  const model = tintedHuman(template, tint);
  model.name = name;
  space.add(model);
  return { model, ...poseSeatedStaff(model, space, hipsY) };
}

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
  const makeBatches = (
    template: THREE.Group,
    target: THREE.InstancedMesh[],
    label: string,
    clothingTint?: number,
  ) => {
    const variant = clothingTint === undefined ? template : tintedHuman(template, clothingTint);
    let sourceMaterial: THREE.Material | undefined;
    variant.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) sourceMaterial = Array.isArray(object.material) ? object.material[0] : object.material;
    });
    if (!sourceMaterial) throw new Error('Crowd material missing.');
    for (const applauding of [false, true]) for (const look of [-0.5, 0, 0.5]) {
      const mesh = new THREE.InstancedMesh(seatedGeometry(variant, look, applauding), sourceMaterial.clone(), crowd.seats.length);
      mesh.name = `wtsl-${label}-spectators-${target.length}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      target.push(mesh);
    }
    if (variant !== template) disposeHumanModel(variant, false);
  };
  const wardrobeTints = [
    [0x638296, 0x343f4b],
    [0x8e664b, 0x526047],
  ] as const;
  templates.forEach((template, gender) => {
    makeBatches(template, batches, `textured-${gender}-sport`, wardrobeTints[gender % 2][0]);
    makeBatches(template, batches, `textured-${gender}-formal`, wardrobeTints[gender % 2][1]);
  });

  const dummy = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  const tones = [
    [1.0, 0.92, 0.83],
    [0.91, 0.79, 0.66],
    [0.81, 0.65, 0.51],
    [0.69, 0.52, 0.4],
    [0.97, 0.85, 0.71],
    [0.86, 0.74, 0.62],
    [0.75, 0.59, 0.46],
    [0.62, 0.47, 0.36],
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
      const sourceIndex = seat.sourceIndex ?? index;
      let delta = ball ? Math.atan2(ball.x - seat.x, ball.z - seat.z) - seat.facing : 0;
      delta = THREE.MathUtils.euclideanModulo(delta + Math.PI, Math.PI * 2) - Math.PI;
      const gaze = delta < -0.18 ? 0 : delta > 0.18 ? 2 : 1;
      const gender = sourceIndex % 2;
      // Alternate hands-apart and hands-together poses during applause.
      const clap = applauding && sourceIndex % 5 !== 0 && Math.sin(time * 9 + sourceIndex) > -0.15;
      const useHighDetail = highDetailEnabled && highDetailBatches.length > 0 && highDetailSeats.has(index);
      const bucket = (clap ? 3 : 0) + gaze;
      const wardrobe = seat.row === 0 && sourceIndex % 4 === 0 ? 1 : 0;
      const batchIndex = gender * 12 + wardrobe * 6 + bucket;
      const mesh = useHighDetail ? highDetailBatches[bucket] : batches[batchIndex];
      const instance = useHighDetail ? highDetailCounts[bucket]++ : counts[batchIndex]++;
      const lean = ((sourceIndex % 5) - 2) * 0.009;
      const turn = ((sourceIndex * 3 % 5) - 2) * 0.012;
      dummy.position.set(seat.x, seat.y, seat.z);
      dummy.rotation.set(lean, seat.facing + turn, 0);
      const stature = 0.91 + (sourceIndex % 7) * 0.025;
      dummy.scale.set(0.9 + (sourceIndex % 5) * 0.035, stature, 0.94 + (sourceIndex % 3) * 0.04);
      dummy.updateMatrix();
      mesh.setMatrixAt(instance, dummy.matrix);
      // Subtle warm-neutral tint variation gives the textured models a less repeated look.
      const tone = sourceIndex % tones.length;
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
        shouldUseHighDetailCrowdSeat(seat.row, seat.sourceIndex ?? index, genderIndex) ? [index] : []),
    );
    highDetailCounts = new Uint16Array(highDetailBatches.length);
    highDetailBatches.forEach((mesh) => { mesh.visible = highDetailEnabled; });
    forceUpdate = true;
  };
  crowd.replacePeople(update);
  addCrowdAccessories(scene, crowd);
  update(0, false);
  return batches;
}

/** Adds two seated player coaches and a textured, gaze-tracking chair umpire. */
export function attachHumanCourtStaff(
  scene: THREE.Scene,
  fixtures: CourtFixtureRig,
  templates: [THREE.Group, THREE.Group],
  crowd: CrowdRig,
  detailedUmpireTemplate: THREE.Group = templates[0],
) {
  const coachTints = [0x314a5a, 0x6e493b];
  crowd.staffSeats.forEach((seat, index) => {
    const space = new THREE.Group();
    space.name = `wtsl-coach-space-${index + 1}`;
    space.position.set(seat.x, seat.y, seat.z);
    space.rotation.y = seat.facing;
    space.userData.seatRow = seat.row;
    space.userData.offCourt = true;
    scene.add(space);
    attachStaffModel(
      space,
      templates[index % templates.length],
      `wtsl-court-coach-${index + 1}`,
      coachTints[index % coachTints.length],
      0.4,
    );
  });

  const chair = scene.getObjectByName('wtsl-umpire-chair');
  const placeholder = scene.getObjectByName('wtsl-umpire-placeholder');
  if (!(chair instanceof THREE.Group) || !(placeholder instanceof THREE.Group)) {
    throw new Error('Court fixtures are missing the umpire chair or placeholder.');
  }
  const umpire = attachStaffModel(chair, detailedUmpireTemplate, 'wtsl-detailed-umpire', 0x38536a, 1.72);
  const headTurn = new THREE.Quaternion();
  placeholder.visible = false;
  fixtures.setDetailedUmpireUpdater((ballPosition) => {
    if (!ballPosition) return;
    chair.updateWorldMatrix(true, false);
    const localBall = chair.worldToLocal(ballPosition.clone());
    const horizontalDistance = Math.max(0.01, Math.hypot(localBall.x, localBall.z));
    const yaw = THREE.MathUtils.clamp(Math.atan2(localBall.x, localBall.z), -0.8, 0.8);
    const pitch = THREE.MathUtils.clamp(
      -Math.atan2(localBall.y - umpire.head.y, horizontalDistance),
      -0.28,
      0.28,
    );
    headTurn.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), 0.18);
    umpire.pose.begin();
    umpire.pose.place('Head', umpire.head, undefined, headTurn);
    umpire.pose.finish();
  });
}
