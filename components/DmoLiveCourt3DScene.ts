import * as THREE from 'three';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh;
  hip: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftHand: THREE.Mesh;
  rightHand: THREE.Mesh;
  leftShoe: THREE.Mesh;
  rightShoe: THREE.Mesh;
  racket: THREE.Group;
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
  return 0x4c6b99;
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
    new THREE.CapsuleGeometry(0.09, 0.28, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.08, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
    spectators.length,
  );
  const dummy = new THREE.Object3D();
  const shirts = [0xc96b52, 0x397e75, 0xd7b253, 0x526b98, 0xefe0c8, 0x885e80, 0x465754];
  const skinTones = [0xf1c2a0, 0xd8a17c, 0x9e684c, 0xe0b090];
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
    dummy.scale.setScalar(0.88 + (index % 3) * 0.08);
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
    headMesh.setColorAt(index, new THREE.Color(skinTones[(index * 3 + spectator.row) % skinTones.length]));
  });
  for (const instances of [seatMesh, bodyMesh, headMesh]) {
    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = false;
    instances.receiveShadow = false;
    scene.add(instances);
  }
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;

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

export function makePlayer(shirtColor: number, shortsColor: number): PlayerRig {
  const root = new THREE.Group();
  const outline = material(0x18302e);
  const skin = material(0xd8a17c);
  const facialDetail = material(0x302b2c, 0.86);
  const shirt = material(shirtColor, 0.78);
  const shorts = material(shortsColor, 0.8);
  const shoe = material(0xe9e6d9);
  const body = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.02, -0.38),
    new THREE.Vector2(0.18, -0.36),
    new THREE.Vector2(0.22, -0.25),
    new THREE.Vector2(0.23, -0.08),
    new THREE.Vector2(0.28, 0.15),
    new THREE.Vector2(0.3, 0.27),
    new THREE.Vector2(0.24, 0.38),
    new THREE.Vector2(0.14, 0.43),
    new THREE.Vector2(0.02, 0.44),
  ], 20), shirt);
  body.scale.set(1.02, 1, 0.86);
  body.position.y = 1.22;
  body.castShadow = true;
  const shoulderGeometry = new THREE.SphereGeometry(0.15, 16, 12);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(shoulderGeometry, shirt);
    shoulder.position.set(side * 0.22, 0.22, 0);
    shoulder.scale.set(1.05, 0.76, 0.92);
    shoulder.castShadow = true;
    body.add(shoulder);
  }
  root.add(body);
  const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.06, 4, 12), shorts);
  hip.scale.set(1.1, 0.48, 0.78);
  hip.position.y = 0.79;
  hip.castShadow = true;
  root.add(hip);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.045, 3, 10), skin);
  neck.position.y = 1.61;
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  root.add(head);
  const earGeometry = new THREE.SphereGeometry(0.035, 10, 8);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, skin);
    ear.position.set(side * 0.15, 0, 0);
    ear.scale.set(0.55, 0.74, 0.82);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), facialDetail);
    eye.position.set(side * 0.05, 0.025, 0.145);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.019, 8, 6), skin);
  nose.position.set(0, -0.018, 0.158);
  head.add(nose);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.164, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.47),
    outline,
  );
  hair.position.set(0, 0.04, 0);
  head.add(hair);

  const limbGeometry = new THREE.CapsuleGeometry(0.07, 0.86, 4, 12);
  const legGeometry = new THREE.CapsuleGeometry(0.085, 0.83, 4, 12);
  const leftArm = new THREE.Mesh(limbGeometry, skin);
  const rightArm = new THREE.Mesh(limbGeometry, skin);
  const leftLeg = new THREE.Mesh(legGeometry, skin);
  const rightLeg = new THREE.Mesh(legGeometry, skin);
  const handGeometry = new THREE.SphereGeometry(0.075, 10, 8);
  const leftHand = new THREE.Mesh(handGeometry, skin);
  const rightHand = new THREE.Mesh(handGeometry, skin);
  for (const part of [leftArm, rightArm, leftLeg, rightLeg]) {
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
  leftShoe.castShadow = true;
  rightShoe.castShadow = true;
  root.add(leftShoe, rightShoe);
  leftShoe.position.set(-0.12, 0.032, 0.07);
  rightShoe.position.set(0.12, 0.032, 0.07);

  const racket = new THREE.Group();
  const racketVisual = new THREE.Group();
  // Pivot the racket at the grip, so the hand closes around the handle rather
  // than appearing to hold the hoop. The rig's local +X is the player's right.
  racketVisual.position.y = 0.36;
  racketVisual.scale.setScalar(0.77);
  racket.add(racketVisual);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.027, 6, 24), material(0xe5dfc6, 0.55));
  frame.scale.set(0.77, 1.22, 0.45);
  racketVisual.add(frame);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 7), material(0xb6aa84));
  handle.position.y = -0.36;
  racketVisual.add(handle);
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
  root.scale.set(0.84, 0.84, 0.84);
  return {
    root, body, hip, head, leftArm, rightArm, leftLeg, rightLeg,
    leftHand, rightHand, leftShoe, rightShoe, racket,
  };
}

export function poseLimb(mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, radius = 1) {
  const direction = new THREE.Vector3().subVectors(to, from);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  mesh.scale.set(radius, Math.max(0.1, direction.length()), radius);
}
