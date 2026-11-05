import * as THREE from 'three';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh;
  hip: THREE.Group;
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
  update: (timeSeconds: number, applauding: boolean, ballPosition?: THREE.Vector3) => void;
};

export type CourtFixtureRig = {
  update: (ballPosition?: THREE.Vector3) => void;
};

export type CourtSurfaceEffects = {
  addSkidMark: (x: number, z: number, heading: number, intensity: number) => void;
  clearSkidMarks: () => void;
};

export const SCALE = 0.01;
export const BALL_RADIUS = 0.034;
export const PALETTE = {
  outside: 0x82918d,
  stands: 0x263b43,
  trim: 0xc0b79e,
  yellow: 0xf0dc63,
  shirtOne: 0xc7d7c5,
  shirtTwo: 0xd97861,
};

const COURT_LENGTH = 23.77;
const COURT_WIDTH = 10.97;
const SINGLES_WIDTH = 8.23;
const NET_CENTER_HEIGHT = 0.914;
const NET_POST_HEIGHT = 1.07;

function material(color: number, roughness = 0.86) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function realisticMaterial(color: number, roughness = 0.78) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
  });
}

function ellipticalBodyGeometry(
  rings: Array<[y: number, radiusX: number, radiusZ: number]>,
  segments = 24,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [y, radiusX, radiusZ] of rings) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const lower = ring * segments + segment;
      const lowerNext = ring * segments + next;
      const upper = (ring + 1) * segments + segment;
      const upperNext = (ring + 1) * segments + next;
      indices.push(lower, upper, upperNext, lower, upperNext, lowerNext);
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, rings[0][0], 0);
  const topCenter = positions.length / 3;
  positions.push(0, rings[rings.length - 1][0], 0);
  const lastRingStart = (rings.length - 1) * segments;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(bottomCenter, next, segment);
    indices.push(topCenter, lastRingStart + segment, lastRingStart + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function naturalScalpGeometry() {
  const rows: Array<[y: number, radiusX: number, radiusZ: number, centerZ: number]> = [
    [-0.095, 0.018, 0.026, -0.018],
    [-0.064, 0.083, 0.077, -0.017],
    [-0.025, 0.096, 0.087, -0.014],
    [0.045, 0.103, 0.093, -0.012],
    [0.09, 0.09, 0.09, -0.006],
    [0.125, 0.056, 0.062, -0.003],
    [0.139, 0.019, 0.026, -0.008],
  ];
  const angularSegments = 48;
  const openingHalfAngle = 0.74;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [y, radiusX, radiusZ, centerZ] of rows) {
    // Close the face opening above the forehead, not through the crown.
    const rowOpening = y >= 0.09 ? 0 : openingHalfAngle;
    const angularStart = Math.PI / 2 + rowOpening;
    const angularSpan = Math.PI * 2 - rowOpening * 2;
    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = angularStart + (segment / angularSegments) * angularSpan;
      positions.push(
        Math.cos(angle) * radiusX,
        y,
        centerZ + Math.sin(angle) * radiusZ,
      );
    }
  }
  const rowSize = angularSegments + 1;
  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const lower = row * rowSize + segment;
      const upper = lower + rowSize;
      indices.push(lower, upper, upper + 1, lower, upper + 1, lower + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.userData.scalpShell = { openingHalfAngle, rowCount: rows.length };
  return geometry;
}

export function buildStadiumEnvironment(scene: THREE.Scene, indoor = false) {
  const existing = scene.getObjectByName('wtsl-stadium-architecture');
  if (existing && scene.userData.wtslStadiumIndoor === indoor) return;
  existing?.removeFromParent();
  scene.getObjectByName('wtsl-open-sky')?.removeFromParent();
  scene.background = new THREE.Color(indoor ? 0x444f55 : 0x9babb0);
  scene.fog = new THREE.Fog(indoor ? 0x444f55 : 0x9babb0, 82, 205);
  scene.userData.wtslStadiumIndoor = indoor;
  const stadium = new THREE.Group();
  stadium.name = 'wtsl-stadium-architecture';
  if (!indoor) {
    const skyGeometry = new THREE.SphereGeometry(180, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    const skyPositions = skyGeometry.getAttribute('position');
    const skyColors: number[] = [];
    const horizon = new THREE.Color(0xc7d2ce);
    const zenith = new THREE.Color(0x668797);
    for (let index = 0; index < skyPositions.count; index += 1) {
      const height = THREE.MathUtils.clamp(skyPositions.getY(index) / 180, 0, 1);
      const color = horizon.clone().lerp(zenith, Math.pow(height, 0.72));
      skyColors.push(color.r, color.g, color.b);
    }
    skyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
    const sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    sky.name = 'wtsl-open-sky';
    sky.renderOrder = -10;
    scene.add(sky);
  }
  const steel = material(0x3f5051, 0.62);
  const concrete = material(0x777e79, 0.88);
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xe8dfca, emissive: 0xffe6b9, emissiveIntensity: 0.52, roughness: 0.42,
  });
  if (indoor) {
    // Full-span trusses and a shallow vaulted roof appear only for indoor venues.
    for (const side of [-1, 1]) {
      const z = side * 19.6;
      const beam = addBox(stadium, [50, 0.34, 0.42], [0, 13.6, z], steel);
      beam.castShadow = false;
      for (let x = -22; x <= 22; x += 5.5) {
        const post = addBox(stadium, [0.24, 8.8, 0.26], [x, 9.3, z], steel);
        post.castShadow = false;
        const brace = addBox(stadium, [0.11, 5.5, 0.11], [x + side * 1.7, 11.6, z], steel);
        brace.rotation.z = side * -0.34;
        brace.castShadow = false;
      }
      const fascia = addBox(stadium, [49, 0.65, 0.35], [0, 12.95, z - side * 0.28], concrete);
      fascia.castShadow = false;
    }
    for (let x = -22; x <= 22; x += 11) {
      const roofRib = addBox(stadium, [0.22, 0.28, 39.2], [x, 14.4, 0], steel);
      roofRib.castShadow = false;
    }
    const roof = addBox(stadium, [48, 0.28, 38], [0, 15, 0], concrete);
    roof.castShadow = false;
  }
  for (const x of [-22, 22]) {
    const mast = addBox(stadium, [0.32, 13.5, 0.32], [x, 6.75, 0], steel);
    mast.castShadow = false;
    const crossbar = addBox(stadium, [0.5, 0.28, 4.4], [x, 13.25, 0], steel);
    crossbar.castShadow = false;
    for (let i = -2; i <= 2; i += 1) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.2, 0.48), lamp);
      fixture.position.set(x, 13.08, i * 0.75);
      stadium.add(fixture);
    }
  }
  scene.add(stadium);
  for (const [x, z] of [[-18, -13], [-18, 13], [18, -13], [18, 13]] as const) {
    const spot = new THREE.SpotLight(0xfff0d7, indoor ? 8 : 5, 48, Math.PI / 5, 0.68, 2);
    spot.position.set(x, indoor ? 12.4 : 11.5, z);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = false;
    stadium.add(spot, spot.target);
  }
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
    material(0x607a78),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);

  const texture = courtSurfaceTexture(surface);
  const court = new THREE.Mesh(
    // The playing surface continues behind both baselines and beyond the
    // sidelines. One continuous mesh avoids a different-material runoff seam.
    new THREE.PlaneGeometry(42, 22),
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
      new THREE.Vector3(-21, -0.03, -11),
      new THREE.Vector3(21, -0.03, -11),
      new THREE.Vector3(21, -0.03, 11),
      new THREE.Vector3(-21, -0.03, 11),
    ]),
    new THREE.LineBasicMaterial({ color: PALETTE.trim, transparent: true, opacity: 0.42 }),
  );
  scene.add(apronOutline);

  const skidTexture = surface === 'clay' ? claySkidTexture() : null;
  const skidCount = 2048;
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
      // Keep the whole mark (not merely its center) on the clay apron.
      if (surface === 'clay' && (Math.abs(x) > 20.35 || Math.abs(z) > 10.35)) return;
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
  const rowStep = 0.66;
  const platformBaseY = (row: number) => 0.05 + row * rowStep;
  const rowSpacing = 0.82;
  for (let row = 0; row < 7; row += 1) {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 32; index += 1) {
        spectators.push({
          x: -14.2 + (index / 31) * 28.4,
          z: side * (12 + row * rowSpacing),
          row,
          facing: side > 0 ? Math.PI : 0,
        });
      }
    }
    for (const end of [-1, 1]) {
      for (let index = 0; index < 16; index += 1) {
        spectators.push({
          x: end * (22.25 + row * rowSpacing),
          z: -7.2 + (index / 15) * 14.4,
          row,
          facing: end > 0 ? -Math.PI / 2 : Math.PI / 2,
        });
      }
    }
  }

  for (let row = 0; row < 7; row += 1) {
    const y = platformBaseY(row);
    const platformMaterial = material(row % 2 === 0 ? PALETTE.stands : 0x333e4e, 0.96);
    for (const side of [-1, 1]) {
      const platform = addBox(scene, [30.2, 0.12, 0.72], [0, y, side * (12 + row * rowSpacing)], platformMaterial);
      platform.castShadow = false;
    }
    for (const end of [-1, 1]) {
      const platform = addBox(scene, [0.72, 0.12, 15.6], [end * (22.25 + row * rowSpacing), y, 0], platformMaterial);
      platform.castShadow = false;
    }
  }

  const seatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.45, 0.1, 0.42),
    material(0x334146, 0.86),
    spectators.length,
  );
  const seatBackMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.45, 0.48, 0.08),
    material(0x3b494b, 0.82),
    spectators.length,
  );
  const bodyMesh = new THREE.InstancedMesh(
    ellipticalBodyGeometry([
      [-0.29, 0.02, 0.025],
      [-0.24, 0.13, 0.085],
      [-0.13, 0.155, 0.095],
      [-0.015, 0.15, 0.09],
      [0.085, 0.17, 0.10],
      [0.19, 0.20, 0.105],
      [0.25, 0.17, 0.09],
      [0.29, 0.025, 0.025],
    ], 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }),
    spectators.length,
  );
  const headMesh = new THREE.InstancedMesh(
    ellipticalBodyGeometry([
      [-0.125, 0.018, 0.035],
      [-0.11, 0.047, 0.057],
      [-0.078, 0.068, 0.072],
      [-0.025, 0.078, 0.082],
      [0.035, 0.081, 0.084],
      [0.087, 0.072, 0.078],
      [0.12, 0.047, 0.06],
      [0.132, 0.015, 0.025],
    ], 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 }),
    spectators.length,
  );
  const eyeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.007, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x342b27, roughness: 0.74 }),
    spectators.length * 2,
  );
  const mouthMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.012, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x855b50, roughness: 0.76 }),
    spectators.length,
  );
  const noseMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.012, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.76 }),
    spectators.length,
  );
  const earMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.018, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
    spectators.length * 2,
  );
  headMesh.name = 'wtsl-spectator-heads';
  noseMesh.name = 'wtsl-spectator-noses';
  earMesh.name = 'wtsl-spectator-ears';
  const neckMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.039, 0.048, 0.14, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
    spectators.length,
  );
  const shortsMesh = new THREE.InstancedMesh(
    ellipticalBodyGeometry([
      [-0.13, 0.11, 0.085],
      [-0.09, 0.17, 0.11],
      [0, 0.19, 0.12],
      [0.09, 0.17, 0.11],
      [0.13, 0.11, 0.085],
    ]),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length,
  );
  const segmentGeometry = (proximal: number, mid: number, distal: number) => ellipticalBodyGeometry([
    [-0.11, distal * 0.7, distal * 0.7],
    [-0.075, distal, distal],
    [-0.015, mid, mid],
    [0.055, proximal, proximal],
    [0.09, proximal * 0.88, proximal * 0.88],
    [0.11, proximal * 0.52, proximal * 0.52],
  ], 16);
  const upperArmGeometry = segmentGeometry(0.044, 0.038, 0.031);
  const forearmGeometry = segmentGeometry(0.034, 0.03, 0.024);
  const thighGeometry = segmentGeometry(0.06, 0.053, 0.044);
  const calfGeometry = segmentGeometry(0.044, 0.035, 0.026);
  const upperArmMesh = new THREE.InstancedMesh(
    upperArmGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const forearmMesh = new THREE.InstancedMesh(
    forearmGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const thighMesh = new THREE.InstancedMesh(
    thighGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const calfMesh = new THREE.InstancedMesh(
    calfGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectators.length * 2,
  );
  const handMesh = new THREE.InstancedMesh(
    ellipticalBodyGeometry([
      [-0.06, 0.025, 0.024], [-0.045, 0.04, 0.031],
      [0.005, 0.042, 0.03], [0.045, 0.034, 0.026],
      [0.06, 0.02, 0.02],
    ], 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    spectators.length * 2,
  );
  const shoeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    material(0xe8e5dc, 0.82),
    spectators.length * 2,
  );
  const hairMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.49),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
    spectators.length,
  );
  const hairTempleMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
    spectators.length * 2,
  );
  const dummy = new THREE.Object3D();
  const fromPoint = new THREE.Vector3();
  const toPoint = new THREE.Vector3();
  const segmentDirection = new THREE.Vector3();
  const localToWorld = (spectator: (typeof spectators)[number], x: number, y: number, z: number, target: THREE.Vector3) => {
    const cosine = Math.cos(spectator.facing);
    const sine = Math.sin(spectator.facing);
    return target.set(
      spectator.x + x * cosine + z * sine,
      platformBaseY(spectator.row) + y,
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
    const baseY = platformBaseY(spectator.row);
    dummy.position.set(spectator.x, baseY + 0.45, spectator.z);
    dummy.rotation.y = spectator.facing;
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    seatMesh.setMatrixAt(index, dummy.matrix);
    placePart(seatBackMesh, index, spectator, 0, 0.75, -0.17);

    dummy.position.y = baseY + 0.8;
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(index, dummy.matrix);
    bodyMesh.setColorAt(index, new THREE.Color(shirts[(index * 5 + spectator.row) % shirts.length]));

    dummy.position.y = baseY + 1.23;
    const headScale = 0.92 + (index % 4) * 0.025;
    dummy.scale.setScalar(headScale);
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
    const skin = new THREE.Color(skinTones[(index * 3 + spectator.row) % skinTones.length]);
    headMesh.setColorAt(index, skin);

    const forwardX = Math.sin(spectator.facing);
    const forwardZ = Math.cos(spectator.facing);
    const sideX = Math.cos(spectator.facing);
    const sideZ = -Math.sin(spectator.facing);
    const facialScale = [0.94, 0.98, 1.02, 1.06][index % 4];
    for (const eyeSide of [-1, 1]) {
      dummy.position.set(
        spectator.x + forwardX * 0.079 * facialScale + sideX * eyeSide * 0.029 * facialScale,
        baseY + 1.25,
        spectator.z + forwardZ * 0.079 * facialScale + sideZ * eyeSide * 0.029 * facialScale,
      );
      dummy.rotation.y = spectator.facing;
      dummy.scale.set(0.72, 0.78, 0.68);
      dummy.updateMatrix();
      eyeMesh.setMatrixAt(index * 2 + (eyeSide === 1 ? 1 : 0), dummy.matrix);
      placePart(earMesh, index * 2 + (eyeSide === 1 ? 1 : 0), spectator,
        eyeSide * 0.074 * facialScale, 1.225, -0.002, 0.62, 0.92, 0.56);
    }
    placePart(noseMesh, index, spectator, 0, 1.207, 0.093 * facialScale,
      0.72, 0.78, 0.88);
    noseMesh.setColorAt(index, skin);
    earMesh.setColorAt(index * 2, skin);
    earMesh.setColorAt(index * 2 + 1, skin);
    dummy.position.set(
      spectator.x + forwardX * 0.086 * facialScale,
      baseY + 1.17,
      spectator.z + forwardZ * 0.086 * facialScale,
    );
    dummy.rotation.y = spectator.facing;
    dummy.scale.set(1.15, 0.22, 0.48);
    dummy.updateMatrix();
    mouthMesh.setMatrixAt(index, dummy.matrix);

    placePart(neckMesh, index, spectator, 0, 1.1, 0.01, 0.9, 0.9, 0.9);
    neckMesh.setColorAt(index, skin);
    placePart(shortsMesh, index, spectator, 0, 0.5, -0.01, 0.95, 0.82, 0.92);
    shortsMesh.setColorAt(index, new THREE.Color(index % 2 ? 0x36465a : 0x4b4050));
    const hairStyle = index % 5;
    placePart(hairMesh, index, spectator, 0, 1.30, -0.014,
      (0.19 + (hairStyle % 3) * 0.012) * headScale,
      (0.16 + (hairStyle === 3 ? 0.025 : 0)) * headScale,
      (0.18 + (hairStyle === 4 ? 0.025 : 0)) * headScale);
    const hairColor = new THREE.Color(hairColors[(index * 7 + spectator.row) % hairColors.length]);
    hairMesh.setColorAt(index, hairColor);
    for (const side of [-1, 1]) {
      const templeIndex = index * 2 + (side === 1 ? 1 : 0);
      placePart(hairTempleMesh, templeIndex, spectator, side * 0.071, 1.255, -0.01,
        0.036, (0.052 + (hairStyle % 3) * 0.008), 0.046);
      hairTempleMesh.setColorAt(templeIndex, hairColor);
    }

    for (const [sideIndex, side] of [-1, 1].entries()) {
      const instance = index * 2 + sideIndex;
      const thighTop: [number, number, number] = [side * 0.11, 0.5, 0];
      const knee: [number, number, number] = [side * 0.17, 0.43, 0.19];
      const ankle: [number, number, number] = [side * 0.17, 0.12, 0.28];
      placeLimb(thighMesh, instance, spectator, thighTop, knee);
      placeLimb(calfMesh, instance, spectator, knee, ankle);
      thighMesh.setColorAt(instance, new THREE.Color(index % 2 ? 0x36465a : 0x4b4050));
      calfMesh.setColorAt(instance, skin);
      placePart(shoeMesh, instance, spectator, side * 0.17, 0.1, 0.37, 0.19, 0.07, 0.11, side * -0.08);
      const shoulder: [number, number, number] = [side * 0.17, 0.99, 0.015];
      const elbow: [number, number, number] = [side * 0.21, 0.78, 0.08];
      const wrist: [number, number, number] = [side * 0.19, 0.61, 0.15];
      placeLimb(upperArmMesh, instance, spectator, shoulder, elbow);
      placeLimb(forearmMesh, instance, spectator, elbow, wrist);
      upperArmMesh.setColorAt(instance, new THREE.Color(shirts[(index * 5 + spectator.row) % shirts.length]));
      forearmMesh.setColorAt(instance, skin);
      placePart(handMesh, instance, spectator, wrist[0], wrist[1], wrist[2] + 0.025,
        0.82, 0.92, 0.72);
      handMesh.setColorAt(instance, skin);
    }
  });
  const staticInstances = [
    seatMesh, seatBackMesh, bodyMesh, headMesh, eyeMesh, earMesh, noseMesh, neckMesh, shortsMesh,
    thighMesh, calfMesh, shoeMesh, upperArmMesh, forearmMesh, handMesh, hairMesh, hairTempleMesh, mouthMesh,
  ];
  for (const instances of staticInstances) {
    instances.instanceMatrix.needsUpdate = true;
    instances.castShadow = false;
    instances.receiveShadow = false;
    scene.add(instances);
  }
  for (const instances of [bodyMesh, headMesh, earMesh, noseMesh, neckMesh, shortsMesh, thighMesh, calfMesh, upperArmMesh, forearmMesh, handMesh, hairMesh, hairTempleMesh]) {
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }
  for (const instances of [upperArmMesh, forearmMesh, handMesh]) {
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  for (const instances of [mouthMesh, headMesh, eyeMesh, earMesh, noseMesh, hairMesh, hairTempleMesh]) {
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  let previousApplause = false;
  let lastGazeUpdate = -Infinity;
  const gazeOffsets = new Float32Array(spectators.length);
  const updateFaceGaze = (ballPosition: THREE.Vector3) => {
    for (let index = 0; index < spectators.length; index += 1) {
      const spectator = spectators[index];
      const bearing = Math.atan2(ballPosition.x - spectator.x, ballPosition.z - spectator.z);
      const targetDelta = THREE.MathUtils.clamp(
        THREE.MathUtils.euclideanModulo(bearing - spectator.facing + Math.PI, Math.PI * 2) - Math.PI,
        -0.72,
        0.72,
      );
      gazeOffsets[index] += (targetDelta - gazeOffsets[index]) * 0.62;
      const delta = gazeOffsets[index];
      const facing = spectator.facing + delta;
      const headScale = 0.92 + (index % 4) * 0.025;
      const headY = 1.23;
      const placeFace = (
        mesh: THREE.InstancedMesh,
        instance: number,
        localX: number,
        localY: number,
        localZ: number,
        scale: number | [number, number, number] = headScale,
      ) => {
        const cosine = Math.cos(facing);
        const sine = Math.sin(facing);
        dummy.position.set(
          spectator.x + localX * cosine + localZ * sine,
          platformBaseY(spectator.row) + headY + localY,
          spectator.z - localX * sine + localZ * cosine,
        );
        dummy.rotation.set(0, facing, 0);
        if (typeof scale === 'number') dummy.scale.setScalar(scale);
        else dummy.scale.set(...scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(instance, dummy.matrix);
      };
      const placeHair = () => {
        const cosine = Math.cos(facing);
        const sine = Math.sin(facing);
        dummy.position.set(
          spectator.x + 0.014 * sine,
          platformBaseY(spectator.row) + headY + 0.07,
          spectator.z + 0.014 * cosine,
        );
        dummy.rotation.set(0, facing, 0);
        dummy.scale.set(0.19 * headScale, 0.16 * headScale, 0.18 * headScale);
        dummy.updateMatrix();
        hairMesh.setMatrixAt(index, dummy.matrix);
        for (const side of [-1, 1]) {
          const templeIndex = index * 2 + (side === 1 ? 1 : 0);
          dummy.position.set(
            spectator.x + side * 0.071 * cosine - 0.01 * sine,
            platformBaseY(spectator.row) + headY + 0.025,
            spectator.z - side * 0.071 * sine - 0.01 * cosine,
          );
          dummy.rotation.set(0, facing, 0);
          dummy.scale.set(0.036, 0.052 + (index % 3) * 0.008, 0.046);
          dummy.updateMatrix();
          hairTempleMesh.setMatrixAt(templeIndex, dummy.matrix);
        }
      };
      placeFace(headMesh, index, 0, 0, 0);
      placeHair();
      placeFace(eyeMesh, index * 2, -0.029 * headScale, 0.02, 0.079 * headScale, [0.72, 0.78, 0.68]);
      placeFace(eyeMesh, index * 2 + 1, 0.029 * headScale, 0.02, 0.079 * headScale, [0.72, 0.78, 0.68]);
      placeFace(noseMesh, index, 0, -0.008, 0.093 * headScale, [0.72, 0.78, 0.88]);
      placeFace(earMesh, index * 2, -0.074 * headScale, -0.005, -0.002, [0.62, 0.92, 0.56]);
      placeFace(earMesh, index * 2 + 1, 0.074 * headScale, -0.005, -0.002, [0.62, 0.92, 0.56]);
      placeFace(mouthMesh, index, 0, -0.06, 0.071 * headScale, [1.15, 0.22, 0.48]);
      if (previousApplause && index % 5 !== 0) {
        const cosine = Math.cos(facing);
        const sine = Math.sin(facing);
        dummy.position.set(
          spectator.x + 0.071 * headScale * sine,
          platformBaseY(spectator.row) + headY - 0.05,
          spectator.z + 0.071 * headScale * cosine,
        );
        dummy.rotation.set(0, facing, 0);
        dummy.scale.set(1.15, 1.21, 0.48);
        dummy.updateMatrix();
        mouthMesh.setMatrixAt(index, dummy.matrix);
      }
    }
    for (const instances of [headMesh, eyeMesh, earMesh, noseMesh, hairMesh, hairTempleMesh, mouthMesh]) {
      instances.instanceMatrix.needsUpdate = true;
    }
  };
  const updateApplausePose = (timeSeconds: number, applauding: boolean, ballPosition?: THREE.Vector3) => {
    if (ballPosition && timeSeconds - lastGazeUpdate >= 0.12) {
      updateFaceGaze(ballPosition);
      lastGazeUpdate = timeSeconds;
    }
    if (!applauding && !previousApplause) return;
    for (let index = 0; index < spectators.length; index += 1) {
      const spectator = spectators[index];
      const clapping = applauding && index % 5 !== 0;
      const phase = timeSeconds * 15 + index * 0.73;
      const separation = clapping ? 0.012 + (0.5 + Math.sin(phase) * 0.5) * 0.085 : 0.23;
      const handY = clapping ? 1.42 : 0.61;
      const elbowY = clapping ? 1.2 : 0.78;
      const elbowZ = clapping ? 0.11 : 0.105;
      for (const [sideIndex, side] of [-1, 1].entries()) {
        const instance = index * 2 + sideIndex;
        const shoulder: [number, number, number] = [side * 0.17, 0.99, 0.015];
        const elbow: [number, number, number] = [side * (clapping ? 0.13 : 0.21), elbowY, elbowZ];
        const wristX = clapping ? side * separation / 2 : side * 0.115;
        const wrist: [number, number, number] = [wristX, handY, clapping ? 0.16 : 0.17];
        placeLimb(upperArmMesh, instance, spectator, shoulder, elbow);
        placeLimb(forearmMesh, instance, spectator, elbow, wrist);
        placePart(handMesh, instance, spectator, wristX, handY, wrist[2] + 0.025, 1, 1, 1, side * -0.1);
      }
      if (applauding !== previousApplause) {
        const openMouth = applauding && index % 5 !== 0;
        const facing = spectator.facing + gazeOffsets[index];
        dummy.position.set(
          spectator.x + Math.sin(facing) * 0.071,
          platformBaseY(spectator.row) + 1.18,
          spectator.z + Math.cos(facing) * 0.071,
        );
        dummy.rotation.y = facing;
        dummy.scale.set(1.15, openMouth ? 1.21 : 0.22, 0.48);
        dummy.updateMatrix();
        mouthMesh.setMatrixAt(index, dummy.matrix);
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
  const structure = new THREE.MeshStandardMaterial({ color: 0x354c4e, roughness: 0.84 });
  const fascia = new THREE.MeshStandardMaterial({ color: 0x8b9586, roughness: 0.76 });
  const enclosureHeight = 2.1;
  const sideWalls = [-1, 1].map((side) => addBox(
    scene,
    [49, enclosureHeight, 0.45],
    [0, enclosureHeight / 2, side * 18.3],
    structure,
  ));
  const endWalls = [-1, 1].map((end) => addBox(
    scene,
    [0.45, enclosureHeight, 37],
    [end * 27.8, enclosureHeight / 2, 0],
    structure,
  ));
  for (const wall of [...sideWalls, ...endWalls]) {
    wall.castShadow = false;
    wall.receiveShadow = true;
  }
  for (const side of [-1, 1]) {
    const cap = addBox(scene, [49.2, 0.12, 0.55], [0, enclosureHeight + 0.06, side * 18.3], fascia);
    cap.castShadow = false;
    for (let index = -2; index <= 2; index += 1) {
      const rib = addBox(
        scene,
        [0.16, enclosureHeight - 0.18, 0.55],
        [index * 9, enclosureHeight / 2, side * 18.3],
        fascia,
      );
      rib.castShadow = false;
    }
  }
  for (const end of [-1, 1]) {
    const cap = addBox(scene, [0.55, 0.12, 37.2], [end * 27.8, enclosureHeight + 0.06, 0], fascia);
    cap.castShadow = false;
    for (let index = -1; index <= 1; index += 1) {
      const rib = addBox(
        scene,
        [0.55, enclosureHeight - 0.18, 0.16],
        [end * 27.8, enclosureHeight / 2, index * 11],
        fascia,
      );
      rib.castShadow = false;
    }
  }
  return crowdRig;
}

export function buildCourtFixtures(scene: THREE.Scene): CourtFixtureRig {
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
  const umpireSkin = new THREE.MeshStandardMaterial({ color: 0xb98a6d, roughness: 0.78 });
  const umpireHair = new THREE.MeshStandardMaterial({ color: 0x37312d, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 4, 8), umpireShirt);
  torso.position.set(0, 2.02, 0.02);
  torso.castShadow = true;
  chair.add(torso);
  const headRig = new THREE.Group();
  headRig.name = 'wtsl-umpire-gaze';
  headRig.position.set(0, 2.35, 0.02);
  chair.add(headRig);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 20, 16), umpireSkin);
  head.scale.set(0.9, 1.08, 0.92);
  head.castShadow = true;
  headRig.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.39), umpireHair);
  hair.position.set(0, 0.035, -0.026);
  headRig.add(hair);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), material(0xe1d9cb, 0.7));
    eye.position.set(side * 0.041, 0.023, 0.109);
    eye.scale.set(1, 0.65, 0.55);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 10, 8), material(0x29231f, 0.55));
    pupil.position.z = 0.009;
    eye.add(pupil);
    headRig.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), umpireSkin);
  nose.position.set(0, -0.012, 0.114);
  nose.scale.set(0.68, 1, 0.72);
  headRig.add(nose);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 6), material(0x63443a));
  mouth.position.set(0, -0.052, 0.105);
  mouth.scale.set(1, 0.15, 0.3);
  headRig.add(mouth);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.42, 8), umpireSkin);
    arm.position.set(side * 0.2, 1.99, 0.14);
    arm.rotation.x = Math.PI / 2.7;
    arm.rotation.z = side * -0.24;
    arm.castShadow = true;
    chair.add(arm);
    addBox(chair, [0.13, 0.16, 0.47], [side * 0.15, 1.68, 0.36], frameMaterial);
  }
  const fixtureRig: CourtFixtureRig = {
    update: (ballPosition?: THREE.Vector3) => {
      if (!ballPosition) return;
      const dx = ballPosition.x - chair.position.x;
      const dz = ballPosition.z - chair.position.z;
      const targetYaw = Math.atan2(dx, dz);
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - chair.rotation.y),
        Math.cos(targetYaw - chair.rotation.y),
      );
      headRig.rotation.y = THREE.MathUtils.lerp(headRig.rotation.y,
        THREE.MathUtils.clamp(yawDelta, -0.8, 0.8), 0.18);
      headRig.rotation.x = THREE.MathUtils.clamp(-(ballPosition.y - 2.25) * 0.12, -0.28, 0.28);
    },
  };
  return fixtureRig;
}

export function makePlayer(shirtColor: number, shortsColor: number, isWta = false): PlayerRig {
  const root = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({
    color: 0xc89574, roughness: 0.72, metalness: 0, clearcoat: 0.035, clearcoatRoughness: 0.82,
  });
  const shirt = new THREE.MeshPhysicalMaterial({
    color: shirtColor, roughness: 0.82, metalness: 0, sheen: 0.18, sheenRoughness: 0.9,
  });
  const shorts = new THREE.MeshPhysicalMaterial({
    color: shortsColor, roughness: 0.86, metalness: 0, sheen: 0.12, sheenRoughness: 0.92,
  });
  const shoe = realisticMaterial(0xe5e2d9, 0.68);
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: isWta ? 0x49372e : 0x352f2c, roughness: 0.58, metalness: 0,
  });
  // Sculpted elliptical cross-sections create a human rib cage, waist and
  // shoulder shelf instead of a lathed toy barrel.
  const body = new THREE.Mesh(ellipticalBodyGeometry([
    [-0.31, 0.165, 0.105],
    [-0.285, 0.165, 0.105],
    [-0.22, 0.155, 0.085],
    [-0.12, 0.148, 0.084],
    [-0.015, 0.16, 0.09],
    [0.105, 0.18, 0.095],
    [0.19, 0.23, 0.105],
    [0.25, 0.225, 0.095],
    [0.29, 0.11, 0.065],
    [0.30, 0.025, 0.025],
  ], 32), shirt);
  body.position.y = 1.22;
  body.castShadow = true;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.007, 6, 20), realisticMaterial(0xe7e0d2, 0.85));
  collar.position.set(0, 0.275, 0.004);
  collar.scale.set(1, 0.72, 0.9);
  body.add(collar);
  root.add(body);
  const hip = new THREE.Group();
  hip.name = 'animated-hip';
  if (!isWta) {
    // Keep one tailored shell over the pelvis and both upper thighs. Its
    // connected crotch and two hem notches remove the visibly intersecting
    // panels that made the earlier mesh look like separate toy parts.
    const pelvis = new THREE.Mesh(ellipticalBodyGeometry([
      [-0.18, 0.135, 0.105], [-0.145, 0.16, 0.115],
      [-0.10, 0.18, 0.12], [0, 0.19, 0.125],
      [0.10, 0.17, 0.115], [0.12, 0.17, 0.11],
    ], 28), shorts);
    pelvis.name = 'shorts-volume';
    pelvis.castShadow = true;
    hip.add(pelvis);

    const shortsOutline = new THREE.Shape();
    shortsOutline.moveTo(-0.155, 0.115);
    shortsOutline.quadraticCurveTo(0, 0.14, 0.155, 0.115);
    shortsOutline.lineTo(0.185, -0.155);
    shortsOutline.quadraticCurveTo(0.19, -0.215, 0.15, -0.22);
    shortsOutline.lineTo(0.075, -0.22);
    shortsOutline.quadraticCurveTo(0.058, -0.22, 0.056, -0.195);
    shortsOutline.lineTo(0.039, -0.12);
    shortsOutline.quadraticCurveTo(0.025, -0.075, 0, -0.068);
    shortsOutline.quadraticCurveTo(-0.025, -0.075, -0.039, -0.12);
    shortsOutline.lineTo(-0.056, -0.195);
    shortsOutline.quadraticCurveTo(-0.058, -0.22, -0.075, -0.22);
    shortsOutline.lineTo(-0.15, -0.22);
    shortsOutline.quadraticCurveTo(-0.19, -0.215, -0.185, -0.155);
    shortsOutline.closePath();
    const shortsShell = new THREE.Mesh(new THREE.ExtrudeGeometry(shortsOutline, {
      depth: 0.258,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.009,
      bevelThickness: 0.01,
      curveSegments: 8,
    }), shorts);
    shortsShell.name = 'single-piece-athletic-shorts';
    shortsShell.position.z = -0.129;
    shortsShell.castShadow = true;
    hip.add(shortsShell);

    const waistbandColor = new THREE.Color(shortsColor)
      .lerp(new THREE.Color(0xffffff), 0.08).getHex();
    const waistband = new THREE.Mesh(ellipticalBodyGeometry([
      [0.105, 0.17, 0.115],
      [0.12, 0.176, 0.12],
      [0.138, 0.145, 0.098],
    ], 28), realisticMaterial(waistbandColor, 0.84));
    hip.add(waistband);
  } else {
    const skirt = new THREE.Mesh(ellipticalBodyGeometry([
      [-0.24, 0.22, 0.135], [-0.20, 0.24, 0.145], [-0.11, 0.22, 0.14],
      [0.015, 0.19, 0.125], [0.12, 0.17, 0.11], [0.15, 0.12, 0.085],
    ], 28), shorts);
    skirt.name = 'tennis-skirt';
    skirt.castShadow = true;
    hip.add(skirt);
  }
  hip.position.y = 0.9;
  hip.scale.x = 1.08;
  root.add(hip);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.11, 14), skin);
  neck.position.y = 1.56;
  root.add(neck);
  const head = new THREE.Mesh(ellipticalBodyGeometry([
    [-0.132, 0.027, 0.048],
    [-0.12, 0.052, 0.06],
    [-0.085, 0.075, 0.073],
    [-0.025, 0.091, 0.083],
    [0.045, 0.098, 0.089],
    [0.09, 0.083, 0.079],
    [0.125, 0.052, 0.056],
    [0.135, 0.016, 0.022],
  ], 28), skin);
  head.position.y = 1.73;
  head.castShadow = true;
  root.add(head);
  const earGeometry = new THREE.SphereGeometry(0.017, 14, 10);
  let leftEye: THREE.Mesh | null = null;
  let rightEye: THREE.Mesh | null = null;
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeometry, skin);
    ear.position.set(side * 0.09, -0.002, 0);
    ear.scale.set(0.62, 0.9, 0.72);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), realisticMaterial(0xe1d9cb, 0.68));
    eye.name = side < 0 ? 'left-eye' : 'right-eye';
    eye.position.set(side * 0.034, 0.029, 0.084);
    eye.scale.set(1.15, 0.68, 0.5);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0062, 12, 10),
      realisticMaterial(isWta ? 0x5c5142 : 0x554638, 0.5));
    iris.name = 'iris';
    iris.position.set(-side * 0.001, 0.001, 0.006);
    eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 10, 8), realisticMaterial(0x211d19, 0.42));
    pupil.name = 'pupil';
    pupil.position.set(-side * 0.001, 0.001, 0.011);
    eye.add(pupil);
    head.add(eye);
    if (side < 0) leftEye = eye;
    else rightEye = eye;
  }
  if (!leftEye || !rightEye) throw new Error('Player face requires two eyes.');
  const noseBridge = new THREE.Mesh(new THREE.SphereGeometry(0.013, 14, 12), skin);
  noseBridge.position.set(0, -0.005, 0.084);
  noseBridge.scale.set(0.55, 0.9, 0.55);
  head.add(noseBridge);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.011, 14, 10), skin);
  nose.position.set(0, -0.038, 0.09);
  nose.scale.set(0.76, 0.45, 0.55);
  head.add(nose);
  const browMaterial = realisticMaterial(isWta ? 0x49372e : 0x352f2c, 0.82);
  const makeNaturalBrow = (side: -1 | 1) => new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.016, 0, 0.001),
      new THREE.Vector3(side * 0.008, 0.003, 0.004),
      new THREE.Vector3(0, 0.004, 0.005),
      new THREE.Vector3(-side * 0.008, 0.003, 0.004),
      new THREE.Vector3(-side * 0.016, 0, 0.001),
    ]), 10, 0.0024, 5, false),
    browMaterial,
  );
  const leftBrow = makeNaturalBrow(-1);
  leftBrow.position.set(-0.034, 0.052, 0.085);
  head.add(leftBrow);
  const rightBrow = makeNaturalBrow(1);
  rightBrow.position.set(0.034, 0.052, 0.085);
  head.add(rightBrow);
  const smile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.012, 0.002, 0),
    new THREE.Vector3(-0.006, -0.002, 0.002),
    new THREE.Vector3(0, -0.003, 0.003),
    new THREE.Vector3(0.006, -0.002, 0.002),
    new THREE.Vector3(0.012, 0.002, 0),
  ]);
  const mouth = new THREE.Mesh(
    new THREE.TubeGeometry(smile, 12, 0.0022, 5, false),
    realisticMaterial(0x875b52, 0.82),
  );
  mouth.position.set(0, -0.082, 0.088);
  mouth.name = 'mouth';
  head.add(mouth);
  // Full scalp coverage wraps behind the crown and temples; the smaller top
  // cap alone left the back and sides looking bald from a court-level camera.
  const hair = new THREE.Mesh(
    naturalScalpGeometry(),
    hairMaterial,
  );
  hair.name = 'natural-scalp';
  head.add(hair);
  if (isWta) {
    const tie = new THREE.Mesh(new THREE.SphereGeometry(0.031, 12, 10), realisticMaterial(0x302923, 0.55));
    tie.position.set(-0.01, -0.035, -0.088);
    head.add(tie);
    const ponytail = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, 0.105, 4, 10), hairMaterial);
    ponytail.position.set(-0.012, -0.105, -0.105);
    ponytail.rotation.z = -0.12;
    head.add(ponytail);
  }

  // poseLimb scales each anatomically slim segment to measured joint spacing.
  const taperedSegment = (proximal: number, mid: number, distal: number) => new THREE.LatheGeometry([
    new THREE.Vector2(proximal * 0.68, -0.5),
    new THREE.Vector2(proximal * 0.88, -0.47),
    new THREE.Vector2(proximal, -0.39),
    new THREE.Vector2((proximal + mid) * 0.52, -0.2),
    new THREE.Vector2(mid, 0.08),
    new THREE.Vector2(distal, 0.34),
    new THREE.Vector2(distal * 0.78, 0.47),
    new THREE.Vector2(distal * 0.68, 0.5),
  ], 20);
  // Fill the muscle silhouette and overlap larger, rounded joints so movement
  // reads as connected athletic anatomy instead of exposed hinge-like bones.
  const upperArmGeometry = taperedSegment(0.072, 0.065, 0.057);
  const forearmGeometry = taperedSegment(0.056, 0.05, 0.039);
  // Keep the hip insertion inside the garments, then build the quadriceps
  // below the hem rather than pushing flesh through the waistband.
  const legGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0.05, -0.5),
    new THREE.Vector2(0.055, -0.4),
    new THREE.Vector2(0.06, -0.25),
    new THREE.Vector2(0.082, -0.08),
    new THREE.Vector2(0.09, 0.08),
    new THREE.Vector2(0.073, 0.34),
    new THREE.Vector2(0.057, 0.47),
    new THREE.Vector2(0.05, 0.5),
  ], 20);
  const calfGeometry = taperedSegment(0.071, 0.058, 0.038);
  const leftArm = new THREE.Mesh(upperArmGeometry, skin);
  const rightArm = new THREE.Mesh(upperArmGeometry, skin);
  const leftForearm = new THREE.Mesh(forearmGeometry, skin);
  const rightForearm = new THREE.Mesh(forearmGeometry, skin);
  const leftLeg = new THREE.Mesh(legGeometry, skin);
  const rightLeg = new THREE.Mesh(legGeometry, skin);
  const leftCalf = new THREE.Mesh(calfGeometry, skin);
  const rightCalf = new THREE.Mesh(calfGeometry, skin);
  const trimMaterial = realisticMaterial(0xe7e0d2, 0.86);
  for (const sleeve of [leftArm, rightArm]) {
    const shirtSleeve = new THREE.Mesh(ellipticalBodyGeometry([
      [-0.535, 0.054, 0.055],
      [-0.50, 0.078, 0.077],
      [-0.34, 0.079, 0.078],
      [-0.16, 0.075, 0.074],
      [0.015, 0.07, 0.069],
      [0.035, 0.067, 0.066],
    ], 20), shirt);
    shirtSleeve.castShadow = true;
    sleeve.add(shirtSleeve);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.067, 0.0045, 6, 18), trimMaterial);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.02;
    sleeve.add(cuff);
  }
  const sockMaterial = realisticMaterial(0xe4dfd2, 0.88);
  for (const calf of [leftCalf, rightCalf]) {
    const sockBand = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 6, 16), sockMaterial);
    sockBand.rotation.x = Math.PI / 2;
    sockBand.position.y = -0.43;
    calf.add(sockBand);
  }
  // Soft connectors slightly overlap both end rings at each elbow and knee;
  // the shared flesh color hides flat tube caps during fast direction changes.
  const jointGeometry = new THREE.SphereGeometry(0.047, 20, 16);
  const leftElbow = new THREE.Mesh(jointGeometry, skin);
  const rightElbow = new THREE.Mesh(jointGeometry, skin);
  const kneeGeometry = new THREE.SphereGeometry(0.061, 20, 16);
  const leftKnee = new THREE.Mesh(kneeGeometry, skin);
  const rightKnee = new THREE.Mesh(kneeGeometry, skin);
  // A continuous closed fist reads cleanly at broadcast scale. Separate
  // curved finger tubes looked like loose loops wrapped around the shaft.
  const handGeometry = ellipticalBodyGeometry([
    [-0.043, 0.019, 0.017],
    [-0.037, 0.03, 0.025],
    [-0.025, 0.037, 0.028],
    [-0.012, 0.039, 0.029],
    [0.002, 0.04, 0.03],
    [0.016, 0.039, 0.03],
    [0.03, 0.034, 0.027],
    [0.041, 0.024, 0.021],
    [0.046, 0.015, 0.014],
  ], 28);
  handGeometry.translate(0, 0, -0.004);
  handGeometry.userData.closedGrip = true;
  const leftHand = new THREE.Mesh(handGeometry, skin);
  const rightHand = new THREE.Mesh(handGeometry, skin);
  leftHand.name = 'left-palm';
  rightHand.name = 'dominant-right-hand';
  for (const [hand, side] of [[leftHand, -1], [rightHand, 1]] as const) {
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.026, 5, 12), skin);
    thumb.name = 'grip-thumb';
    thumb.position.set(side * 0.02, 0.009, 0.02);
    thumb.rotation.z = side * 0.7;
    thumb.castShadow = true;
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

  const shoeGeometry = new THREE.CapsuleGeometry(0.055, 0.17, 3, 12);
  shoeGeometry.rotateX(Math.PI / 2);
  const leftShoe = new THREE.Mesh(shoeGeometry, shoe);
  leftShoe.scale.set(1, 0.82, 1);
  const soleGeometry = new THREE.CapsuleGeometry(0.057, 0.16, 3, 12);
  soleGeometry.rotateX(Math.PI / 2);
  const sole = new THREE.Mesh(soleGeometry, material(0x26322f, 0.95));
  sole.scale.set(1, 0.32, 0.92);
  sole.position.y = -0.036;
  sole.castShadow = true;
  leftShoe.add(sole);
  const rightShoe = leftShoe.clone();
  leftShoe.name = 'left-shoe';
  rightShoe.name = 'right-shoe';
  leftShoe.castShadow = true;
  rightShoe.castShadow = true;
  root.add(leftShoe, rightShoe);
  leftShoe.position.set(-0.12, 0.052, 0.07);
  rightShoe.position.set(0.12, 0.052, 0.07);

  const racket = new THREE.Group();
  const racketVisual = new THREE.Group();
  // Pivot the racket at the grip, so the hand closes around the handle rather
  // than appearing to hold the hoop. The face is +Z; anatomical right is -X.
  racketVisual.position.y = 0.36;
  racketVisual.scale.setScalar(0.77);
  racket.add(racketVisual);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 8, 32), material(0xe5dfc6, 0.55));
  frame.name = 'racket-head';
  frame.scale.set(0.77, 0.95, 0.45);
  racketVisual.add(frame);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.02, 0.5, 10), material(0xb6aa84));
  handle.name = 'racket-handle';
  handle.position.y = -0.36;
  racketVisual.add(handle);
  const gripTape = new THREE.Mesh(new THREE.CylinderGeometry(0.0205, 0.0215, 0.28, 10), material(0x293a35, 0.88));
  gripTape.name = 'racket-grip-tape';
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
