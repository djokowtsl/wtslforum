import * as THREE from 'three';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh;
  hip: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftForearm: THREE.Mesh;
  rightForearm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftCalf: THREE.Mesh;
  rightCalf: THREE.Mesh;
  leftElbow: THREE.Mesh;
  rightElbow: THREE.Mesh;
  leftKnee: THREE.Mesh;
  rightKnee: THREE.Mesh;
  leftHand: THREE.Mesh;
  rightHand: THREE.Mesh;
  leftShoe: THREE.Mesh;
  rightShoe: THREE.Mesh;
  racket: THREE.Group;
  face: {
    leftEye: THREE.Mesh;
    rightEye: THREE.Mesh;
    leftBrow: THREE.Mesh;
    rightBrow: THREE.Mesh;
    mouth: THREE.Mesh;
  };
};

export type CrowdRig = {
  update: (timeSeconds: number, applauding: boolean) => void;
};

export type CourtSurfaceEffects = {
  addSkidMark: (x: number, z: number, heading: number, intensity: number) => void;
  clearSkidMarks: () => void;
};

export const SCALE = 0.01;
export const BALL_RADIUS = 0.034;
export const PALETTE = {
  outside: 0x596373,
  stands: 0x3d4859,
  trim: 0x9da8b7,
  yellow: 0xf0dc63,
  shirtOne: 0xd9a95e,
  shirtTwo: 0xd96d5b,
};

const COURT_LENGTH = 23.77;
const COURT_WIDTH = 10.97;
const SINGLES_WIDTH = 8.23;
const NET_CENTER_HEIGHT = 0.914;
const NET_POST_HEIGHT = 1.07;

function material(color: number, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function addBox(
  parent: THREE.Group | THREE.Scene,
  size: [number, number, number],
  position: [number, number, number],
  surfaceMaterial: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), surfaceMaterial);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function courtColor(surface: Te4CourtSurface) {
  if (surface === 'grass') return 0x63795b;
  if (surface === 'clay') return 0x9c5a4c;
  if (surface === 'hard') return 0x4c6b99;
  return 0x667283;
}

function courtSurfaceTexture(surface: Te4CourtSurface) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const colors: Record<Te4CourtSurface, string> = {
    clay: '#9c5a4c',
    grass: '#63795b',
    hard: '#4c6b99',
    unknown: '#667283',
  };
  context.fillStyle = colors[surface];
  context.fillRect(0, 0, canvas.width, canvas.height);

  let seed = surface.split('').reduce((value, letter) => value * 31 + letter.charCodeAt(0), 17);
  const random = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  if (surface === 'grass') {
    const stripeHeight = canvas.height / 12;
    for (let index = 0; index < 12; index += 1) {
      context.fillStyle = index % 2 === 0
        ? 'rgba(225,239,201,0.055)'
        : 'rgba(20,42,20,0.075)';
      context.fillRect(0, index * stripeHeight, canvas.width, stripeHeight);
    }
    context.strokeStyle = 'rgba(235,244,215,0.035)';
    context.lineWidth = 1;
    for (let index = 0; index < 70; index += 1) {
      const y = random() * canvas.height;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y + (random() - 0.5) * 4);
      context.stroke();
    }
  } else {
    const speckleCount = surface === 'clay' ? 4_800 : 2_900;
    for (let index = 0; index < speckleCount; index += 1) {
      const radius = surface === 'clay' ? 0.45 + random() * 1.1 : 0.35 + random() * 0.75;
      const shade = random() > 0.5 ? 255 : 28;
      context.fillStyle = `rgba(${shade},${shade},${shade},${surface === 'clay' ? 0.055 : 0.035})`;
      context.beginPath();
      context.arc(random() * canvas.width, random() * canvas.height, radius, 0, Math.PI * 2);
      context.fill();
    }
    if (surface === 'clay') {
      context.strokeStyle = 'rgba(75,33,28,0.045)';
      context.lineWidth = 1;
      for (let index = 0; index < 90; index += 1) {
        const x = random() * canvas.width;
        const y = random() * canvas.height;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 3 + random() * 14, y + (random() - 0.5) * 3);
        context.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function claySkidTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, 'rgba(59,25,21,0)');
  gradient.addColorStop(0.22, 'rgba(66,28,24,0.24)');
  gradient.addColorStop(0.5, 'rgba(51,21,19,0.48)');
  gradient.addColorStop(0.78, 'rgba(66,28,24,0.2)');
  gradient.addColorStop(1, 'rgba(59,25,21,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(42,18,17,0.24)';
  context.lineWidth = 1;
  for (let line = 0; line < 9; line += 1) {
    const y = 7 + line * 4;
    context.beginPath();
    context.moveTo(10, y);
    context.lineTo(246, y + (line % 2 ? 1 : -1));
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildCourt(scene: THREE.Scene, surface: Te4CourtSurface) {
  const halfLength = COURT_LENGTH / 2;
  const halfWidth = COURT_WIDTH / 2;
  const singlesHalfWidth = SINGLES_WIDTH / 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    material(0x4c5665),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);

  const texture = courtSurfaceTexture(surface);
  const court = new THREE.Mesh(
    // The playing surface continues behind both baselines and beyond the
    // sidelines. One continuous mesh avoids a different-material runoff seam.
    new THREE.PlaneGeometry(31.8, 18.4),
    new THREE.MeshStandardMaterial({
      color: texture ? 0xffffff : courtColor(surface),
      map: texture ?? undefined,
      roughness: 0.94,
    }),
  );
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  scene.add(court);

  const lineMaterial = material(0xf2efdf, 0.72);
  const lineY = 0.018;
  const lineWidth = 0.075;
  const lineX = (length: number, x: number, z: number) =>
    addBox(scene, [length, 0.025, lineWidth], [x, lineY, z], lineMaterial);
  const lineZ = (length: number, x: number, z: number) =>
    addBox(scene, [lineWidth, 0.025, length], [x, lineY, z], lineMaterial);
  lineZ(COURT_WIDTH, -halfLength, 0);
  lineZ(COURT_WIDTH, halfLength, 0);
  lineX(COURT_LENGTH, 0, -halfWidth);
  lineX(COURT_LENGTH, 0, halfWidth);
  lineX(COURT_LENGTH, 0, -singlesHalfWidth);
  lineX(COURT_LENGTH, 0, singlesHalfWidth);
  lineZ(SINGLES_WIDTH, -6.4, 0);
  lineZ(SINGLES_WIDTH, 6.4, 0);
  lineX(12.8, 0, 0);

  const netPoints: number[] = [];
  const segments = 36;
  const rows = 8;
  const topAt = (z: number) =>
    NET_CENTER_HEIGHT + (NET_POST_HEIGHT - NET_CENTER_HEIGHT) * Math.abs(z) / halfWidth;
  for (let segment = 0; segment <= segments; segment += 1) {
    const z = -halfWidth + (segment / segments) * COURT_WIDTH;
    netPoints.push(0, 0.035, z, 0, topAt(z), z);
  }
  for (let row = 1; row < rows; row += 1) {
    const fraction = row / rows;
    for (let segment = 0; segment < segments; segment += 1) {
      const z1 = -halfWidth + (segment / segments) * COURT_WIDTH;
      const z2 = -halfWidth + ((segment + 1) / segments) * COURT_WIDTH;
      netPoints.push(
        0, 0.035 + (topAt(z1) - 0.035) * fraction, z1,
        0, 0.035 + (topAt(z2) - 0.035) * fraction, z2,
      );
    }
  }
  const netGeometry = new THREE.BufferGeometry();
  netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPoints, 3));
  const net = new THREE.LineSegments(
    netGeometry,
    new THREE.LineBasicMaterial({ color: 0xd9dfd2, transparent: true, opacity: 0.4 }),
  );
  net.frustumCulled = false;
  scene.add(net);
  const tape = material(0xe9e6d9, 0.76);
  addBox(scene, [0.08, 0.045, COURT_WIDTH + 0.12], [0, NET_CENTER_HEIGHT, 0], tape);
  for (const z of [-halfWidth - 0.08, halfWidth + 0.08]) {
    addBox(scene, [0.08, NET_POST_HEIGHT, 0.08], [0, NET_POST_HEIGHT / 2, z], tape);
  }

  const apronOutline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-15.9, -0.03, -8.75),
      new THREE.Vector3(15.9, -0.03, -8.75),
      new THREE.Vector3(15.9, -0.03, 8.75),
      new THREE.Vector3(-15.9, -0.03, 8.75),
    ]),
    new THREE.LineBasicMaterial({ color: PALETTE.trim, transparent: true, opacity: 0.42 }),
  );
  scene.add(apronOutline);

  const skidTexture = surface === 'clay' ? claySkidTexture() : null;
  const skidCount = 48;
  const skidMesh = skidTexture
    ? new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.68, 0.12),
      new THREE.MeshBasicMaterial({
        map: skidTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      skidCount,
    )
    : null;
  const markDummy = new THREE.Object3D();
  if (skidMesh) {
    skidMesh.frustumCulled = false;
    for (let index = 0; index < skidCount; index += 1) {
      markDummy.position.set(0, -5, 0);
      markDummy.scale.set(0, 0, 0);
      markDummy.updateMatrix();
      skidMesh.setMatrixAt(index, markDummy.matrix);
    }
    skidMesh.instanceMatrix.needsUpdate = true;
    scene.add(skidMesh);
  }
  let nextSkidIndex = 0;
  const planeRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  const surfaceEffects: CourtSurfaceEffects = {
    addSkidMark: (x, z, heading, intensity) => {
      if (!skidMesh) return;
      markDummy.position.set(x, 0.006, z);
      markDummy.quaternion
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading)
        .multiply(planeRotation);
      const size = 0.78 + THREE.MathUtils.clamp(intensity, 0, 1) * 0.38;
      markDummy.scale.set(size, 0.82 + size * 0.08, 1);
      markDummy.updateMatrix();
      skidMesh.setMatrixAt(nextSkidIndex % skidCount, markDummy.matrix);
      nextSkidIndex += 1;
      skidMesh.instanceMatrix.needsUpdate = true;
    },
    clearSkidMarks: () => {
      if (!skidMesh) return;
      for (let index = 0; index < skidCount; index += 1) {
        markDummy.position.set(0, -5, 0);
        markDummy.scale.set(0, 0, 0);
        markDummy.updateMatrix();
        skidMesh.setMatrixAt(index, markDummy.matrix);
      }
      nextSkidIndex = 0;
      skidMesh.instanceMatrix.needsUpdate = true;
    },
  };
  return surfaceEffects;
}

export function buildCrowd(scene: THREE.Scene) {
  const spectators: Array<{ x: number; z: number; row: number; facing: number }> = [];
  const rowStep = 0.6;
  const rowSpacing = 0.82;
  for (let row = 0; row < 7; row += 1) {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 32; index += 1) {
        spectators.push({
          x: -14.2 + (index / 31) * 28.4,
          z: side * (9.3 + row * rowSpacing),
          row,
          facing: side > 0 ? Math.PI : 0,
        });
      }
    }
    for (const end of [-1, 1]) {
      for (let index = 0; index < 16; index += 1) {
        spectators.push({
          x: end * (16.35 + row * rowSpacing),
          z: -6.8 + (index / 15) * 13.6,
          row,
          facing: end > 0 ? -Math.PI / 2 : Math.PI / 2,
        });
      }
    }
  }

  for (let row = 0; row < 7; row += 1) {
    const y = 0.05 + row * rowStep;
    const platformMaterial = material(row % 2 === 0 ? PALETTE.stands : 0x333e4e, 0.96);
    for (const side of [-1, 1]) {
      const platform = addBox(scene, [30.2, 0.12, 0.72], [0, y, side * (9.3 + row * rowSpacing)], platformMaterial);
      platform.castShadow = false;
    }
    for (const end of [-1, 1]) {
      const platform = addBox(scene, [0.72, 0.12, 14.8], [end * (16.35 + row * rowSpacing), y, 0], platformMaterial);
      platform.castShadow = false;
    }
  }

  const seatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.24, 0.08, 0.22),
    material(PALETTE.stands, 0.95),
    spectators.length,
  );
  const bodyMesh = new THREE.InstancedMesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0.015, -0.23),
      new THREE.Vector2(0.08, -0.21),
      new THREE.Vector2(0.105, -0.12),
      new THREE.Vector2(0.095, 0.01),
      new THREE.Vector2(0.13, 0.15),
      new THREE.Vector2(0.15, 0.2),
      new THREE.Vector2(0.105, 0.25),
      new THREE.Vector2(0.018, 0.27),
    ], 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
    spectators.length,
  );
  const eyeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.012, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0x28221f, roughness: 0.9 }),
    spectators.length * 2,
  );
  const mouthMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.026, 0.006, 0.006),
    new THREE.MeshStandardMaterial({ color: 0x68463d, roughness: 0.9 }),
    spectators.length,
  );
  const neckMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.038, 0.05, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length,
  );
  const shortsMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.09, 0.07, 2, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length,
  );
  const limbGeometry = new THREE.CapsuleGeometry(0.035, 0.15, 2, 8);
  const upperArmMesh = new THREE.InstancedMesh(
    limbGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const forearmMesh = new THREE.InstancedMesh(
    limbGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const thighMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.042, 0.16, 2, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const calfMesh = new THREE.InstancedMesh(
    limbGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const handMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.026, 0.07, 0.045),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length * 2,
  );
  const shoeMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.14, 0.055, 0.075),
    material(0xe8e5dc, 0.82),
    spectators.length * 2,
  );
  const hairMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.083, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.56),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length,
  );
  const dummy = new THREE.Object3D();
  const fromPoint = new THREE.Vector3();
  const toPoint = new THREE.Vector3();
  const segmentDirection = new THREE.Vector3();
  const localToWorld = (spectator: (typeof spectators)[number], x: number, y: number, z: number, target: THREE.Vector3) => {
    const seatY = 0.17 + spectator.row * rowStep;
    const cosine = Math.cos(spectator.facing);
    const sine = Math.sin(spectator.facing);
    return target.set(
      spectator.x + x * cosine + z * sine,
      seatY + y,
      spectator.z - x * sine + z * cosine,
    );
  };
  const placePart = (
    mesh: THREE.InstancedMesh,
    instance: number,
    spectator: (typeof spectators)[number],
    x: number,
    y: number,
    z: number,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1,
    rotationZ = 0,
  ) => {
    localToWorld(spectator, x, y, z, dummy.position);
    dummy.rotation.set(0, spectator.facing, rotationZ);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.updateMatrix();
    mesh.setMatrixAt(instance, dummy.matrix);
  };
  const placeLimb = (
    mesh: THREE.InstancedMesh,
    instance: number,
    spectator: (typeof spectators)[number],
    from: [number, number, number],
    to: [number, number, number],
    width = 1,
  ) => {
    localToWorld(spectator, ...from, fromPoint);
    localToWorld(spectator, ...to, toPoint);
    segmentDirection.subVectors(toPoint, fromPoint);
    const length = segmentDirection.length();
    dummy.position.copy(fromPoint).add(toPoint).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segmentDirection.normalize());
    dummy.scale.set(width, length / 0.22, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(instance, dummy.matrix);
  };
  const shirts = [0xc96b52, 0x397e75, 0xd7b253, 0x526b98, 0xefe0c8, 0x885e80, 0x465754];
  const skinTones = [0xf1c2a0, 0xd8a17c, 0x9e684c, 0xe0b090];
  const hairColors = [0x272321, 0x4d372c, 0x3c3440, 0x72563b];
  spectators.forEach((spectator, index) => {
    const seatY = 0.17 + spectator.row * rowStep;
    dummy.position.set(spectator.x, seatY, spectator.z);
    dummy.rotation.y = spectator.facing;
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    seatMesh.setMatrixAt(index, dummy.matrix);

    dummy.position.y = seatY + 0.28;
    dummy.scale.set(0.88 + (index % 4) * 0.06, 0.92 + (index % 3) * 0.07, 1);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(index, dummy.matrix);
    bodyMesh.setColorAt(index, new THREE.Color(shirts[(index * 5 + spectator.row) % shirts.length]));

    dummy.position.y = seatY + 0.56;
    const headScale = 0.88 + (index % 3) * 0.08;
    dummy.scale.setScalar(headScale);
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
    const skin = new THREE.Color(skinTones[(index * 3 + spectator.row) % skinTones.length]);
    headMesh.setColorAt(index, skin);

    const forwardX = Math.sin(spectator.facing);
    const forwardZ = Math.cos(spectator.facing);
    const sideX = Math.cos(spectator.facing);
    const sideZ = -Math.sin(spectator.facing);
    for (const eyeSide of [-1, 1]) {
      dummy.position.set(
        spectator.x + forwardX * 0.071 * headScale + sideX * eyeSide * 0.025 * headScale,
        seatY + 0.57,
        spectator.z + forwardZ * 0.071 * headScale + sideZ * eyeSide * 0.025 * headScale,
      );
      dummy.rotation.y = spectator.facing;
      dummy.scale.setScalar(headScale);
      dummy.updateMatrix();
      eyeMesh.setMatrixAt(index * 2 + (eyeSide === 1 ? 1 : 0), dummy.matrix);
    }
    dummy.position.set(
      spectator.x + forwardX * 0.078 * headScale,
      seatY + 0.535,
      spectator.z + forwardZ * 0.078 * headScale,
    );
    dummy.rotation.y = spectator.facing;
    dummy.scale.setScalar(headScale);
    dummy.updateMatrix();
    mouthMesh.setMatrixAt(index, dummy.matrix);

    placePart(neckMesh, index, spectator, 0, 0.46, 0.01, 0.9, 0.9, 0.9);
    neckMesh.setColorAt(index, skin);
    placePart(shortsMesh, index, spectator, 0, 0.11, 0.03, 0.95, 0.68, 0.82);
    shortsMesh.setColorAt(index, new THREE.Color(index % 2 ? 0x36465a : 0x4b4050));
    placePart(hairMesh, index, spectator, 0, 0.595, -0.006, headScale, headScale, headScale);
    hairMesh.setColorAt(index, new THREE.Color(hairColors[(index * 7 + spectator.row) % hairColors.length]));

    for (const [sideIndex, side] of [-1, 1].entries()) {
      const instance = index * 2 + sideIndex;
      const thighTop: [number, number, number] = [side * 0.07, 0.12, 0.02];
      const knee: [number, number, number] = [side * 0.085, -0.005, 0.2];
      const ankle: [number, number, number] = [side * 0.085, -0.12, 0.22];
      placeLimb(thighMesh, instance, spectator, thighTop, knee, 1.05);
      placeLimb(calfMesh, instance, spectator, knee, ankle, 0.9);
      thighMesh.setColorAt(instance, new THREE.Color(index % 2 ? 0x36465a : 0x4b4050));
      calfMesh.setColorAt(instance, skin);
      placePart(shoeMesh, instance, spectator, side * 0.085, -0.13, 0.28, 1, 1, 1, side * -0.08);
      const shoulder: [number, number, number] = [side * 0.115, 0.41, 0.015];
      const elbow: [number, number, number] = [side * 0.155, 0.27, 0.105];
      const wrist: [number, number, number] = [side * 0.115, 0.16, 0.17];
      placeLimb(upperArmMesh, instance, spectator, shoulder, elbow, 1.05);
      placeLimb(forearmMesh, instance, spectator, elbow, wrist, 0.86);
      upperArmMesh.setColorAt(instance, new THREE.Color(shirts[(index * 5 + spectator.row) % shirts.length]));
      forearmMesh.setColorAt(instance, skin);
      placePart(handMesh, instance, spectator, wrist[0], wrist[1], wrist[2] + 0.025, 1, 1, 1, side * -0.1);
    }
  });
  const staticInstances = [
    seatMesh, bodyMesh, headMesh, eyeMesh, neckMesh, shortsMesh,
    thighMesh, calfMesh, shoeMesh, upperArmMesh, forearmMesh, handMesh, hairMesh, mouthMesh,
  ];
  for (const instances of staticInstances) {
    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = false;
    instances.receiveShadow = false;
    scene.add(instances);
  }
  for (const instances of [bodyMesh, headMesh, neckMesh, shortsMesh, thighMesh, calfMesh, upperArmMesh, forearmMesh, hairMesh]) {
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }
  for (const instances of [upperArmMesh, forearmMesh, handMesh]) {
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  mouthMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  let previousApplause = false;
  const updateApplausePose = (timeSeconds: number, applauding: boolean) => {
    if (!applauding && !previousApplause) return;
    for (let index = 0; index < spectators.length; index += 1) {
      const spectator = spectators[index];
      const clapping = applauding && index % 5 !== 0;
      const phase = timeSeconds * 15 + index * 0.73;
      const separation = clapping ? 0.012 + (0.5 + Math.sin(phase) * 0.5) * 0.085 : 0.23;
      const handY = clapping ? 0.43 : 0.16;
      const elbowY = clapping ? 0.35 : 0.27;
      const elbowZ = clapping ? 0.11 : 0.105;
      for (const [sideIndex, side] of [-1, 1].entries()) {
        const instance = index * 2 + sideIndex;
        const shoulder: [number, number, number] = [side * 0.115, 0.41, 0.015];
        const elbow: [number, number, number] = [side * (clapping ? 0.13 : 0.155), elbowY, elbowZ];
        const wristX = clapping ? side * separation / 2 : side * 0.115;
        const wrist: [number, number, number] = [wristX, handY, clapping ? 0.16 : 0.17];
        placeLimb(upperArmMesh, instance, spectator, shoulder, elbow, 1.05);
        placeLimb(forearmMesh, instance, spectator, elbow, wrist, 0.86);
        placePart(handMesh, instance, spectator, wristX, handY, wrist[2] + 0.025, 1, 1, 1, side * -0.1);
      }
      if (applauding !== previousApplause) {
        const openMouth = applauding && index % 5 !== 0;
        placePart(mouthMesh, index, spectator, 0, 0.535, 0.078, 0.9, openMouth ? 5.5 : 1, 1);
      }
    }
    for (const instances of [upperArmMesh, forearmMesh, handMesh]) {
      instances.instanceMatrix.needsUpdate = true;
    }
    if (applauding !== previousApplause) mouthMesh.instanceMatrix.needsUpdate = true;
    previousApplause = applauding;
  };
  const crowdRig: CrowdRig = { update: updateApplausePose };

  // A low, open-sided retaining bowl gives the seating a clear stadium boundary
  // without placing a roof or scoreboard in aerial and TV camera sightlines.
  const structure = new THREE.MeshStandardMaterial({
    color: 0x293649,
    roughness: 0.88,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const fascia = new THREE.MeshStandardMaterial({
    color: 0x758397,
    roughness: 0.72,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const enclosureHeight = 1.8;
  const sideWalls = [-1, 1].map((side) => addBox(
    scene,
    [39.2, enclosureHeight, 0.4],
    [0, enclosureHeight / 2, side * 15.55],
    structure,
  ));
  const endWalls = [-1, 1].map((end) => addBox(
    scene,
    [0.4, enclosureHeight, 31.7],
    [end * 22.45, enclosureHeight / 2, 0],
    structure,
  ));
  for (const wall of [...sideWalls, ...endWalls]) {
    wall.castShadow = false;
    wall.receiveShadow = true;
  }
  for (const side of [-1, 1]) {
    const cap = addBox(scene, [39.4, 0.12, 0.5], [0, enclosureHeight + 0.06, side * 15.55], fascia);
    cap.castShadow = false;
    for (let index = -2; index <= 2; index += 1) {
      const rib = addBox(
        scene,
        [0.12, enclosureHeight - 0.18, 0.5],
        [index * 8, enclosureHeight / 2, side * 15.55],
        fascia,
      );
      rib.castShadow = false;
    }
  }
  for (const end of [-1, 1]) {
    const cap = addBox(scene, [0.5, 0.12, 31.9], [end * 22.45, enclosureHeight + 0.06, 0], fascia);
    cap.castShadow = false;
    for (let index = -1; index <= 1; index += 1) {
      const rib = addBox(
        scene,
        [0.5, enclosureHeight - 0.18, 0.12],
        [end * 22.45, enclosureHeight / 2, index * 9],
        fascia,
      );
      rib.castShadow = false;
    }
  }
  return crowdRig;
}

export function buildCourtFixtures(scene: THREE.Scene) {
  const frameMaterial = material(0x364255, 0.72);
  const seatMaterial = material(0x647188, 0.76);
  const backMaterial = material(0x45536a, 0.78);

  for (const end of [-1, 1]) {
    const bench = new THREE.Group();
    bench.position.set(end * 2.4, 0, 6.75);
    scene.add(bench);
    addBox(bench, [2.55, 0.12, 0.62], [0, 0.53, 0], seatMaterial);
    addBox(bench, [2.55, 0.88, 0.12], [0, 1.0, 0.28], backMaterial);
    for (const x of [-0.91, 0.91]) {
      addBox(bench, [0.09, 0.5, 0.09], [x, 0.26, -0.2], frameMaterial);
      addBox(bench, [0.09, 0.5, 0.09], [x, 0.26, 0.2], frameMaterial);
    }
    addBox(bench, [2.1, 0.08, 0.08], [0, 0.25, -0.21], frameMaterial);
    addBox(bench, [2.1, 0.08, 0.08], [0, 0.25, 0.21], frameMaterial);
  }

  const chair = new THREE.Group();
  chair.position.set(0, 0, 6.75);
  chair.rotation.y = Math.PI;
  scene.add(chair);
  for (const x of [-0.34, 0.34]) {
    addBox(chair, [0.08, 1.5, 0.08], [x, 0.75, 0], frameMaterial);
  }
  addBox(chair, [0.82, 0.11, 0.72], [0, 1.48, 0], frameMaterial);
  addBox(chair, [0.58, 0.08, 0.58], [0, 1.65, 0], seatMaterial);
  addBox(chair, [0.58, 0.62, 0.09], [0, 1.96, -0.25], backMaterial);
  addBox(chair, [0.7, 0.08, 0.45], [0, 0.48, 0.25], frameMaterial);
  for (const y of [0.48, 0.82, 1.16]) {
    addBox(chair, [0.6, 0.07, 0.08], [0, y, 0.38], seatMaterial);
  }

  const umpireShirt = material(0x526d93, 0.84);
  const umpireSkin = material(0xd2a17f, 0.9);
  const umpireHair = material(0x353744, 0.92);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 4, 8), umpireShirt);
  torso.position.set(0, 2.02, 0.02);
  torso.castShadow = true;
  chair.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), umpireSkin);
  head.position.set(0, 2.35, 0.02);
  head.castShadow = true;
  chair.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.143, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.48), umpireHair);
  hair.position.set(0, 2.38, 0.02);
  chair.add(hair);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.42, 8), umpireSkin);
    arm.position.set(side * 0.2, 1.99, 0.14);
    arm.rotation.x = Math.PI / 2.7;
    arm.rotation.z = side * -0.24;
    arm.castShadow = true;
    chair.add(arm);
    addBox(chair, [0.13, 0.16, 0.47], [side * 0.15, 1.68, 0.36], frameMaterial);
  }
}

export function makePlayer(shirtColor: number, shortsColor: number, isWta = false): PlayerRig {
  const root = new THREE.Group();
  const outline = material(0x18302e);
  const skin = material(0xd8a17c);
  const shirt = material(shirtColor, 0.78);
  const shorts = material(shortsColor, 0.8);
  const shoe = material(0xe9e6d9);
  // A tapered athletic torso: narrow waist, broad upper back/chest, and a
  // defined shoulder line read more clearly at the existing broadcast scale.
  const body = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.025, -0.4),
    new THREE.Vector2(0.145, -0.39),
    new THREE.Vector2(0.19, -0.33),
    new THREE.Vector2(0.18, -0.24),
    new THREE.Vector2(0.165, -0.12),
    new THREE.Vector2(0.19, 0.015),
    new THREE.Vector2(0.245, 0.13),
    new THREE.Vector2(0.29, 0.23),
    new THREE.Vector2(0.275, 0.31),
    new THREE.Vector2(0.205, 0.375),
    new THREE.Vector2(0.12, 0.415),
    new THREE.Vector2(0.025, 0.43),
  ], 32), shirt);
  body.scale.set(0.96, 1.02, 0.72);
  body.position.y = 1.22;
  body.castShadow = true;
  body.material = shirt;
  const shoulderGeometry = new THREE.SphereGeometry(0.15, 16, 12);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(shoulderGeometry, shirt);
    shoulder.position.set(side * 0.225, 0.245, 0);
    shoulder.scale.set(0.9, 0.72, 0.74);
    shoulder.castShadow = true;
    body.add(shoulder);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.014, 6, 20), material(0xe6e2d7, 0.82));
  collar.position.set(0, 0.39, 0.004);
  collar.scale.set(1, 0.72, 0.9);
  body.add(collar);
  root.add(body);
  const hip = new THREE.Mesh(
    isWta
      ? new THREE.CylinderGeometry(0.18, 0.28, 0.28, 18)
      : new THREE.CapsuleGeometry(0.19, 0.06, 4, 12),
    shorts,
  );
  hip.scale.set(1.1, isWta ? 1 : 0.48, isWta ? 0.88 : 0.78);
  hip.position.y = 0.79;
  hip.castShadow = true;
  root.add(hip);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.045, 3, 10), skin);
  neck.position.y = 1.61;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.018, -0.16),
    new THREE.Vector2(0.07, -0.145),
    new THREE.Vector2(0.12, -0.09),
    new THREE.Vector2(0.142, -0.01),
    new THREE.Vector2(0.145, 0.075),
    new THREE.Vector2(0.12, 0.14),
    new THREE.Vector2(0.075, 0.17),
    new THREE.Vector2(0.018, 0.175),
  ], 24), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  root.add(head);
  const earGeometry = new THREE.SphereGeometry(0.035, 10, 8);
  let leftEye: THREE.Mesh | null = null;
  let rightEye: THREE.Mesh | null = null;
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, skin);
    ear.position.set(side * 0.15, 0, 0);
    ear.scale.set(0.55, 0.74, 0.82);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), material(0xf5f1e9, 0.72));
    eye.position.set(side * 0.047, 0.027, 0.115);
    eye.scale.set(1, 0.82, 0.55);
    eye.castShadow = true;
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), material(0x5a3b2b, 0.62));
    iris.position.set(0, -0.002, 0.010);
    eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), material(0x171514, 0.38));
    pupil.position.set(0, -0.001, 0.009);
    eye.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 6, 4), material(0xffffff, 0.2));
    glint.position.set(-0.003, 0.003, 0.013);
    eye.add(glint);
    head.add(eye);
    if (side < 0) leftEye = eye;
    else rightEye = eye;
  }
  if (!leftEye || !rightEye) throw new Error('Player face requires two eyes.');
  const noseBridge = new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 10), skin);
  noseBridge.position.set(0, -0.012, 0.13);
  noseBridge.scale.set(0.62, 1.35, 0.78);
  head.add(noseBridge);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.023, 12, 8), skin);
  nose.position.set(0, -0.05, 0.145);
  nose.scale.set(0.78, 0.6, 0.82);
  head.add(nose);
  const leftBrow = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.047, 2, 8), outline);
  leftBrow.position.set(-0.047, 0.066, 0.118);
  leftBrow.rotation.z = Math.PI / 2 + 0.12;
  head.add(leftBrow);
  const rightBrow = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.047, 2, 8), outline);
  rightBrow.position.set(0.047, 0.066, 0.118);
  rightBrow.rotation.z = Math.PI / 2 - 0.12;
  head.add(rightBrow);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), material(0x4b2525, 0.88));
  mouth.position.set(0, -0.093, 0.115);
  mouth.scale.set(0.82, 0.16, 0.28);
  head.add(mouth);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.154, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
    outline,
  );
  hair.position.set(0, 0.04, 0);
  head.add(hair);
  if (isWta) {
    const ponytail = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.18, 3, 8), outline);
    ponytail.position.set(-0.1, -0.07, -0.08);
    ponytail.rotation.z = -0.18;
    head.add(ponytail);
  }

  // poseLimb scales geometry to the measured joint-to-joint length; unit
  // capsules keep segment endpoints at the actual elbow/knee instead of
  // letting long built-in cylinders extend through the joints.
  const limbGeometry = new THREE.CapsuleGeometry(0.095, 0.81, 4, 12);
  const forearmGeometry = new THREE.CapsuleGeometry(0.068, 0.864, 4, 12);
  const legGeometry = new THREE.CapsuleGeometry(0.115, 0.77, 4, 12);
  const calfGeometry = new THREE.CapsuleGeometry(0.085, 0.83, 4, 12);
  const leftArm = new THREE.Mesh(limbGeometry, shirt);
  const rightArm = new THREE.Mesh(limbGeometry, shirt);
  const leftForearm = new THREE.Mesh(forearmGeometry, skin);
  const rightForearm = new THREE.Mesh(forearmGeometry, skin);
  const leftLeg = new THREE.Mesh(legGeometry, skin);
  const rightLeg = new THREE.Mesh(legGeometry, skin);
  const leftCalf = new THREE.Mesh(calfGeometry, skin);
  const rightCalf = new THREE.Mesh(calfGeometry, skin);
  const jointGeometry = new THREE.SphereGeometry(0.06, 12, 10);
  const leftElbow = new THREE.Mesh(jointGeometry, skin);
  const rightElbow = new THREE.Mesh(jointGeometry, skin);
  const leftKnee = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), skin);
  const rightKnee = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), skin);
  const handGeometry = new THREE.SphereGeometry(0.075, 10, 8);
  const leftHand = new THREE.Mesh(handGeometry, skin);
  const rightHand = new THREE.Mesh(handGeometry, skin);
  rightHand.name = 'dominant-right-hand';
  for (const hand of [leftHand, rightHand]) {
    hand.scale.set(0.78, 0.95, 0.78);
    const fingerGeometry = new THREE.CapsuleGeometry(0.008, 0.028, 2, 6);
    for (let finger = 0; finger < 4; finger += 1) {
      const digit = new THREE.Mesh(fingerGeometry, skin);
      digit.position.set((finger - 1.5) * 0.018, -0.055, 0.012);
      digit.rotation.z = (finger - 1.5) * 0.08;
      hand.add(digit);
    }
    const thumb = new THREE.Mesh(fingerGeometry, skin);
    thumb.position.set(0.042, -0.005, 0.014);
    thumb.rotation.z = 0.82;
    hand.add(thumb);
  }
  for (const part of [
    leftArm, rightArm, leftForearm, rightForearm, leftLeg, rightLeg, leftCalf, rightCalf,
    leftElbow, rightElbow, leftKnee, rightKnee,
  ]) {
    part.castShadow = true;
    root.add(part);
  }
  leftHand.castShadow = true;
  rightHand.castShadow = true;
  root.add(leftHand, rightHand);

  const shoeGeometry = new THREE.CapsuleGeometry(0.095, 0.17, 3, 12);
  shoeGeometry.rotateX(Math.PI / 2);
  const leftShoe = new THREE.Mesh(shoeGeometry, shoe);
  leftShoe.scale.set(1.08, 0.72, 1);
  const soleGeometry = new THREE.CapsuleGeometry(0.098, 0.17, 3, 12);
  soleGeometry.rotateX(Math.PI / 2);
  const sole = new THREE.Mesh(soleGeometry, material(0x26322f, 0.95));
  sole.scale.set(1.06, 0.52, 0.86);
  sole.position.y = -0.055;
  sole.castShadow = true;
  leftShoe.add(sole);
  const rightShoe = leftShoe.clone();
  leftShoe.name = 'left-shoe';
  rightShoe.name = 'right-shoe';
  leftShoe.castShadow = true;
  rightShoe.castShadow = true;
  root.add(leftShoe, rightShoe);
  leftShoe.position.set(-0.12, 0.032, 0.07);
  rightShoe.position.set(0.12, 0.032, 0.07);

  const racket = new THREE.Group();
  const racketVisual = new THREE.Group();
  // Pivot the racket at the grip, so the hand closes around the handle rather
  // than appearing to hold the hoop. The face is +Z; anatomical right is -X.
  racketVisual.position.y = 0.36;
  racketVisual.scale.setScalar(0.77);
  racket.add(racketVisual);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.027, 6, 24), material(0xe5dfc6, 0.55));
  frame.name = 'racket-head';
  frame.scale.set(0.77, 1.22, 0.45);
  racketVisual.add(frame);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 7), material(0xb6aa84));
  handle.position.y = -0.36;
  racketVisual.add(handle);
  const gripTape = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.28, 8), material(0x293a35, 0.88));
  gripTape.position.y = -0.36;
  racketVisual.add(gripTape);
  const stringMaterial = new THREE.LineBasicMaterial({ color: 0xeae7d8, transparent: true, opacity: 0.55 });
  for (let index = -2; index <= 2; index += 1) {
    const vertical = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(index * 0.06, -0.18, 0),
      new THREE.Vector3(index * 0.06, 0.2, 0),
    ]);
    const horizontal = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.13, index * 0.07, 0),
      new THREE.Vector3(0.13, index * 0.07, 0),
    ]);
    racketVisual.add(new THREE.Line(vertical, stringMaterial), new THREE.Line(horizontal, stringMaterial));
  }
  racket.position.set(0.39, 1.1, 0.04);
  root.add(racket);
  root.scale.set(0.95, 0.95, 0.95);
  return {
    root, body, hip, head, leftArm, rightArm, leftForearm, rightForearm,
    leftLeg, rightLeg, leftCalf, rightCalf, leftElbow, rightElbow, leftKnee, rightKnee,
    leftHand, rightHand, leftShoe, rightShoe, racket,
    face: { leftEye, rightEye, leftBrow, rightBrow, mouth },
  };
}

export function poseLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, radius = 1) {
  const direction = new THREE.Vector3().subVectors(to, from);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.scale.set(radius, Math.max(0.1, direction.length()), radius);
}
