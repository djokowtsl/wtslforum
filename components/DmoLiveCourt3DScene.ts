import * as THREE from 'three';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  racket: THREE.Group;
};

export const SCALE = 0.01;
export const BALL_RADIUS = 0.034;
export const PALETTE = {
  outside: 0x274f49,
  stands: 0x193b39,
  trim: 0x8b9e83,
  yellow: 0xe9dc78,
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
  if (surface === 'grass') return 0x567a51;
  if (surface === 'clay') return 0x9d5a43;
  return 0x416f67;
}

export function buildCourt(scene: THREE.Scene, surface: Te4CourtSurface) {
  const halfLength = COURT_LENGTH / 2;
  const halfWidth = COURT_WIDTH / 2;
  const singlesHalfWidth = SINGLES_WIDTH / 2;
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(31.8, 18.4),
    material(PALETTE.outside),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.065;
  apron.receiveShadow = true;
  scene.add(apron);

  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT_LENGTH, COURT_WIDTH),
    material(courtColor(surface), 0.94),
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
    const platformMaterial = material(row % 2 === 0 ? PALETTE.stands : 0x234743, 0.96);
    for (const side of [-1, 1]) {
      const platform = addBox(scene, [30.2, 0.12, 0.72], [0, y, side * (9.3 + row * rowSpacing)], platformMaterial);
      platform.castShadow = false;
    }
    for (const end of [-1, 1]) {
      const platform = addBox(scene, [0.72, 0.12, 14.8], [end * (16.35 + row * rowSpacing), y, 0], platformMaterial);
      platform.castShadow = false;
    }
  }

  const bodyMesh = new THREE.InstancedMesh(
    new THREE.CapsuleGeometry(0.085, 0.23, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.075, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
    spectators.length,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  spectators.forEach((spectator, index) => {
    const baseY = 0.2 + spectator.row * rowStep;
    dummy.position.set(spectator.x, baseY, spectator.z);
    dummy.rotation.y = spectator.facing;
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(index, dummy.matrix);
    color.setHSL(((index * 37) % 360) / 360, 0.24 + (index % 3) * 0.08, 0.44 + (index % 4) * 0.055);
    bodyMesh.setColorAt(index, color);
    dummy.position.y = baseY + 0.19;
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
    color.setHSL(((index * 29 + 12) % 360) / 360, 0.2, 0.61);
    headMesh.setColorAt(index, color);
  });
  bodyMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  bodyMesh.castShadow = false;
  headMesh.castShadow = false;
  scene.add(bodyMesh, headMesh);
}

export function makePlayer(shirtColor: number, shortsColor: number): PlayerRig {
  const root = new THREE.Group();
  const skin = material(0xd8a17c);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.56, 5, 10), material(shirtColor, 0.78));
  body.position.y = 1.18;
  body.castShadow = true;
  root.add(body);
  const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.25, 0.3), material(shortsColor, 0.8));
  shorts.position.y = 0.79;
  shorts.castShadow = true;
  root.add(shorts);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin);
  head.position.y = 1.75;
  head.castShadow = true;
  root.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.172, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.47),
    material(0x18302e),
  );
  hair.position.set(0, 1.79, 0);
  root.add(hair);

  const armGeometry = new THREE.CylinderGeometry(0.07, 0.09, 1, 8);
  const legGeometry = new THREE.CylinderGeometry(0.09, 0.105, 1, 8);
  const leftArm = new THREE.Mesh(armGeometry, skin);
  const rightArm = new THREE.Mesh(armGeometry, skin);
  const leftLeg = new THREE.Mesh(legGeometry, skin);
  const rightLeg = new THREE.Mesh(legGeometry, skin);
  for (const part of [leftArm, rightArm, leftLeg, rightLeg]) {
    part.castShadow = true;
    root.add(part);
  }

  const racket = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.027, 6, 24), material(0xe5dfc6, 0.55));
  frame.scale.set(0.77, 1.22, 0.45);
  racket.add(frame);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 7), material(0xb6aa84));
  handle.position.y = -0.36;
  racket.add(handle);
  racket.position.set(0.38, 1.2, 0);
  root.add(racket);
  root.scale.setScalar(0.9);
  return { root, body, head, leftArm, rightArm, leftLeg, rightLeg, racket };
}

export function poseLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, radius = 1) {
  const direction = new THREE.Vector3().subVectors(to, from);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.scale.set(radius, Math.max(0.1, direction.length()), radius);
}
