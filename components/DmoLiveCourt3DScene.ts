import * as THREE from 'three';
import { resolveDmoVenueProfile, type DmoVenueProfile } from '../lib/dmoVenue';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
import { buildStadiumArchitecture } from './DmoStadiumArchitecture';

export type PlayerRig = {
  detailed?: { update: () => void };
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
  seats: Array<{ x: number; y: number; z: number; row: number; facing: number; sourceIndex?: number }>;
  staffSeats: Array<{ x: number; y: number; z: number; row: number; facing: number; sourceIndex?: number }>;
  replacePeople: (update: CrowdRig['update']) => void;
  highDetailEnabled: boolean;
  setHighDetailEnabled: (enabled: boolean) => void;
  setHighDetailModel: (template: THREE.Group, genderIndex: number) => void;
};

export type CourtFixtureRig = {
  update: (ballPosition?: THREE.Vector3) => void;
  setDetailedUmpireUpdater: (update: (ballPosition?: THREE.Vector3) => void) => void;
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
  shirtOne: 0x31545a,
  shirtTwo: 0xc7baa2,
};

export const COURT_LENGTH = 23.77;
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

export function buildStadiumEnvironment(
  scene: THREE.Scene,
  indoor = false,
  scoreboard?: import('./DmoStadiumArchitecture').StadiumScoreboardData,
  venueName?: string | null,
) {
  const venue = resolveDmoVenueProfile(venueName);
  const existing = scene.getObjectByName('wtsl-stadium-architecture');
  if (
    existing
    && scene.userData.wtslStadiumIndoor === indoor
    && scene.userData.wtslStadiumVenue === venue.label
  ) return;
  existing?.removeFromParent();
  scene.getObjectByName('wtsl-open-sky')?.removeFromParent();
  // Keep the horizon inside the arena palette in every venue mode. The bowl
  // itself closes the view; there is no outdoor sky or landscape backdrop.
  scene.background = new THREE.Color(0x26383b);
  scene.fog = new THREE.Fog(0x26383b, 82, 205);
  scene.userData.wtslStadiumIndoor = indoor;
  scene.userData.wtslStadiumVenue = venue.label;
  const stadium = new THREE.Group();
  stadium.name = 'wtsl-stadium-architecture';
  stadium.userData.venueName = venue.label;
  stadium.userData.capacity = venue.capacity;
  const steel = material(0x3f5051, 0.62);
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xe8dfca, emissive: 0xffe6b9, emissiveIntensity: 0.52, roughness: 0.42,
  });
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
  const architecture = buildStadiumArchitecture(scoreboard, venue);
  stadium.add(architecture);
  stadium.userData.updateScoreboard = architecture.userData.updateScoreboard;
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

function addCourtsideSafetyBarrier(scene: THREE.Scene) {
  const barrier = new THREE.Group();
  barrier.name = 'wtsl-courtside-safety-barrier';
  barrier.userData = {
    height: 1.3,
    outsideClearRunoff: true,
    accessGaps: 4,
    transparentPanels: true,
  };
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xa9c9c6,
    transparent: true,
    opacity: 0.2,
    roughness: 0.16,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const rail = new THREE.MeshStandardMaterial({
    color: 0x425653,
    roughness: 0.58,
    metalness: 0.18,
  });
  const halfLength = 21.55;
  const halfWidth = 11.55;
  const gateHalfWidth = 2.65;
  const panelBottom = 0.06;
  const panelHeight = 1.16;
  const topY = panelBottom + panelHeight + 0.04;

  const addSegment = (axis: 'x' | 'z', fixed: number, from: number, to: number) => {
    const length = to - from;
    if (length <= 0) return;
    const center = (from + to) / 2;
    const panel = new THREE.Mesh(
      axis === 'x'
        ? new THREE.BoxGeometry(length, panelHeight, 0.035)
        : new THREE.BoxGeometry(0.035, panelHeight, length),
      glass,
    );
    panel.name = 'wtsl-courtside-safety-glass';
    panel.position.set(
      axis === 'x' ? center : fixed,
      panelBottom + panelHeight / 2,
      axis === 'x' ? fixed : center,
    );
    panel.userData.role = 'transparent-safety-panel';
    panel.castShadow = false;
    panel.receiveShadow = true;
    barrier.add(panel);

    const addRail = (y: number, height: number, depth: number) => {
      const railMesh = new THREE.Mesh(
        axis === 'x'
          ? new THREE.BoxGeometry(length, height, depth)
          : new THREE.BoxGeometry(depth, height, length),
        rail,
      );
      railMesh.name = 'wtsl-courtside-safety-rail';
      railMesh.position.set(axis === 'x' ? center : fixed, y, axis === 'x' ? fixed : center);
      railMesh.castShadow = false;
      barrier.add(railMesh);
    };
    addRail(panelBottom, 0.06, 0.08);
    addRail(topY, 0.08, 0.1);

    const addPost = (along: number) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.075, 1.3, 0.075), rail);
      post.name = 'wtsl-courtside-safety-post';
      post.position.set(axis === 'x' ? along : fixed, 0.65, axis === 'x' ? fixed : along);
      post.castShadow = false;
      barrier.add(post);
    };
    for (let along = from; along < to; along += 2.2) addPost(along);
    addPost(to);
  };

  for (const side of [-1, 1]) {
    for (const [from, to] of [
      [-halfLength, -gateHalfWidth],
      [gateHalfWidth, halfLength],
    ]) {
      addSegment('x', side * halfWidth, from, to);
    }
    for (const [from, to] of [
      [-halfWidth, -gateHalfWidth],
      [gateHalfWidth, halfWidth],
    ]) {
      addSegment('z', side * halfLength, from, to);
    }
  }
  scene.add(barrier);
}

export function buildCourt(scene: THREE.Scene, surface: Te4CourtSurface) {
  const halfLength = COURT_LENGTH / 2;
  const halfWidth = COURT_WIDTH / 2;
  const singlesHalfWidth = SINGLES_WIDTH / 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 36),
    material(0x607a78),
  );
  ground.name = 'wtsl-court-apron';
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
  addCourtsideSafetyBarrier(scene);

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

function buildUnifiedCrowd(scene: THREE.Scene, venue: DmoVenueProfile): CrowdRig {
  const seats: CrowdRig['seats'] = [];
  const nearSeats: CrowdRig['seats'] = [];
  const tunnelHalfWidth = 2.5;
  const lowerRows = 4;
  const lowerRowRise = 0.53;
  const lowerRowRun = 1.62;
  let lowerSeatIndex = 0;
  const addNearSeat = (x: number, z: number, row: number, facing: number) => {
    const seat = {
      x, z, row, facing,
      y: 0.05 + row * lowerRowRise,
      sourceIndex: row * 10_000 + lowerSeatIndex++,
    };
    seats.push(seat);
    nearSeats.push(seat);
  };

  // The first four rows are a continuous, human-scaled ring immediately
  // outside the clear runoff. Each side has its own centered access aisle.
  for (let row = 0; row < lowerRows; row += 1) {
    const halfWidth = 22 + row * lowerRowRun;
    const halfDepth = 12 + row * lowerRowRun;
    const corner = 1.3;
    const addRun = (
      from: number,
      to: number,
      spacing: number,
      place: (value: number) => void,
      skipCenter: boolean,
    ) => {
      const count = Math.max(1, Math.floor(Math.abs(to - from) / spacing));
      for (let index = 0; index <= count; index += 1) {
        const value = from + (to - from) * index / count;
        if (skipCenter && Math.abs(value) < tunnelHalfWidth) continue;
        place(value);
      }
    };
    addRun(-halfWidth, halfWidth, 0.92, (x) => addNearSeat(x, -halfDepth, row, 0), true);
    addRun(-halfWidth, halfWidth, 0.92, (x) => addNearSeat(x, halfDepth, row, Math.PI), true);
    addRun(-halfDepth, halfDepth, 0.92, (z) => addNearSeat(halfWidth + corner, z, row, -Math.PI / 2), true);
    addRun(-halfDepth, halfDepth, 0.92, (z) => addNearSeat(-halfWidth - corner, z, row, Math.PI / 2), true);
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        for (const fraction of [0.28, 0.72]) {
          addNearSeat(
            xSign * (halfWidth + corner * fraction),
            zSign * (halfDepth + corner * fraction),
            row,
            zSign > 0
              ? (xSign > 0 ? -Math.PI * 0.75 : Math.PI * 0.75)
              : (xSign > 0 ? -Math.PI * 0.25 : Math.PI * 0.25),
          );
        }
      }
    }
  }

  // Match the upper bowl's three-tier seating rake, but place every person
  // into the same animated crowd rig as the new continuous near-court rows.
  const innerX = 27.8;
  const innerZ = 18.8;
  const rowWidth = 1.62;
  const rowRise = 0.94;
  const concourseWidth = 2.15;
  const tierRows = venue.tierRows;
  const rowRadiusStart = (row: number) => row * rowWidth + Math.floor(row / tierRows) * concourseWidth;
  const baseY = 2.7;
  for (let upperRow = 0; upperRow < venue.upperRows; upperRow += 1) {
    const radius = rowRadiusStart(upperRow) + rowWidth / 2;
    const ellipseX = innerX + radius;
    const ellipseZ = innerZ + radius;
    const count = Math.round((Math.PI * 2 * ((ellipseX + ellipseZ) / 2)) / 0.86);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const x = Math.cos(angle) * ellipseX;
      const z = Math.sin(angle) * ellipseZ;
      // Keep the four centered bowl passageways clear on every upper tier.
      if (Math.abs(x) < tunnelHalfWidth || Math.abs(z) < tunnelHalfWidth) continue;
      seats.push({
        x,
        z,
        row: lowerRows + upperRow,
        facing: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
        y: baseY + upperRow * rowRise,
        sourceIndex: (lowerRows + upperRow) * 10_000 + index,
      });
    }
  }

  // Reserve two lower-stand places for the player teams. The actual seat
  // geometry remains in the bowl; only the spectator instances are omitted.
  const staffSeats = [-1, 1].map((side) => {
    const seat = nearSeats
      .filter((candidate) => candidate.row === 1 && candidate.z < 0 && Math.abs(candidate.z) > 13)
      .sort((a, b) => Math.abs(a.x - side * 5.5) - Math.abs(b.x - side * 5.5))[0];
    if (!seat) throw new Error('Lower stands are missing reserved team seats.');
    return seat;
  });
  const staffSeatSet = new Set(staffSeats);
  const spectatorSeats = seats.filter((seat) => !staffSeatSet.has(seat));

  const nearSupports = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material(0x465553, 0.92),
    lowerRows * 8,
  );
  nearSupports.name = 'wtsl-near-court-seating-supports';
  nearSupports.userData = { rows: lowerRows, style: 'narrow-beams', accessPassages: 4 };
  const platformTransform = new THREE.Object3D();
  let supportIndex = 0;
  for (let row = 0; row < lowerRows; row += 1) {
    const halfWidth = 22 + row * lowerRowRun;
    const halfDepth = 12 + row * lowerRowRun;
    const corner = 1.3;
    const seatY = 0.05 + row * lowerRowRise;
    const addSupport = (
      x: number,
      z: number,
      width: number,
      depth: number,
    ) => {
      platformTransform.position.set(x, seatY - 0.06, z);
      platformTransform.rotation.set(0, 0, 0);
      platformTransform.scale.set(width, 0.12, depth);
      platformTransform.updateMatrix();
      nearSupports.setMatrixAt(supportIndex++, platformTransform.matrix);
    };
    const outerX = halfWidth + corner;
    const outerZ = halfDepth + corner;
    for (const side of [-1, 1]) {
      for (const direction of [-1, 1]) {
        const segmentLength = outerX - tunnelHalfWidth;
        const segmentCenter = direction * (outerX + tunnelHalfWidth) / 2;
        addSupport(segmentCenter, side * halfDepth, segmentLength, 0.18);
      }
      for (const direction of [-1, 1]) {
        const segmentLength = outerZ - tunnelHalfWidth;
        const segmentCenter = direction * (outerZ + tunnelHalfWidth) / 2;
        addSupport(side * (halfWidth + corner), segmentCenter, 0.18, segmentLength);
      }
    }
  }
  nearSupports.instanceMatrix.needsUpdate = true;
  nearSupports.castShadow = false;
  nearSupports.receiveShadow = true;
  scene.add(nearSupports);

  const nearSeatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.1, 0.42),
    material(0x334146, 0.86),
    nearSeats.length,
  );
  const nearSeatBackMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.48, 0.08),
    material(0x3b494b, 0.82),
    nearSeats.length,
  );
  nearSeatMesh.name = 'wtsl-unified-near-bowl-seats';
  nearSeatBackMesh.name = 'wtsl-unified-near-bowl-seat-backs';
  const transform = new THREE.Object3D();
  nearSeats.forEach((seat, index) => {
    transform.position.set(seat.x, seat.y + 0.38, seat.z);
    transform.rotation.set(0, seat.facing, 0);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    nearSeatMesh.setMatrixAt(index, transform.matrix);
    transform.position.set(
      seat.x - Math.sin(seat.facing) * 0.16,
      seat.y + 0.72,
      seat.z - Math.cos(seat.facing) * 0.16,
    );
    transform.updateMatrix();
    nearSeatBackMesh.setMatrixAt(index, transform.matrix);
  });
  for (const mesh of [nearSeatMesh, nearSeatBackMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // A compact instanced fallback keeps the connected audience animated while
  // the textured seated-human models load, without multiplying mobile draw cost.
  const bodyMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 }),
    spectatorSeats.length,
  );
  const headMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.74 }),
    spectatorSeats.length,
  );
  const armMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.045, 0.052, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
    spectatorSeats.length * 2,
  );
  bodyMesh.name = 'wtsl-unified-crowd-fallback-bodies';
  headMesh.name = 'wtsl-spectator-heads';
  armMesh.name = 'wtsl-unified-crowd-fallback-arms';
  const shirtColors = [0xc96b52, 0x397e75, 0xd7b253, 0x526b98, 0xefe0c8, 0x885e80, 0x465754];
  const skinColors = [0xf1c2a0, 0xd8a17c, 0x9e684c, 0xe0b090];
  const dummy = new THREE.Object3D();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const upDirection = new THREE.Vector3(0, 1, 0);
  const placeArm = (instance: number, seat: CrowdRig['seats'][number], side: number, time: number, applauding: boolean) => {
    const clap = applauding && (seat.sourceIndex ?? instance) % 5 !== 0;
    const phase = time * 13 + (seat.sourceIndex ?? instance) * 0.73;
    const handY = clap ? 1.27 + Math.sin(phase) * 0.055 : 0.67;
    const handX = clap ? side * (0.035 + Math.abs(Math.sin(phase)) * 0.045) : side * 0.2;
    start.set(seat.x + Math.sin(seat.facing) * side * 0.17, seat.y + 0.92, seat.z + Math.cos(seat.facing) * side * 0.17);
    end.set(
      seat.x + Math.sin(seat.facing) * handX + Math.cos(seat.facing) * 0.12,
      seat.y + handY,
      seat.z + Math.cos(seat.facing) * handX - Math.sin(seat.facing) * 0.12,
    );
    direction.subVectors(end, start);
    const length = direction.length();
    dummy.position.copy(start).add(end).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(upDirection, direction.normalize());
    dummy.scale.set(1, length, 1);
    dummy.updateMatrix();
    armMesh.setMatrixAt(instance, dummy.matrix);
  };
    spectatorSeats.forEach((seat, index) => {
    dummy.position.set(seat.x, seat.y + 0.83, seat.z);
    dummy.rotation.set(0, seat.facing, 0);
    dummy.scale.set(0.42, 0.54, 0.28);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(index, dummy.matrix);
    bodyMesh.setColorAt(index, new THREE.Color(shirtColors[(index * 5 + seat.row) % shirtColors.length]));
    dummy.position.set(seat.x, seat.y + 1.23, seat.z);
    dummy.scale.set(0.17, 0.24, 0.15);
    dummy.updateMatrix();
    headMesh.setMatrixAt(index, dummy.matrix);
    headMesh.setColorAt(index, new THREE.Color(skinColors[(index * 3 + seat.row) % skinColors.length]));
    placeArm(index * 2, seat, -1, 0, false);
    placeArm(index * 2 + 1, seat, 1, 0, false);
  });
  const fallbackMeshes = [bodyMesh, headMesh, armMesh];
  headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  armMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fallbackMeshes.forEach((mesh) => {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
  });
  bodyMesh.instanceColor!.needsUpdate = true;
  headMesh.instanceColor!.needsUpdate = true;
  let lastUpdate = -Infinity;
  let detailedUpdate: CrowdRig['update'] | undefined;
  const crowdRig: CrowdRig = {
    seats: spectatorSeats,
    staffSeats,
    highDetailEnabled: true,
    setHighDetailEnabled(enabled) { crowdRig.highDetailEnabled = enabled; },
    setHighDetailModel: () => undefined,
    replacePeople(update) {
      fallbackMeshes.forEach((mesh) => { mesh.visible = false; });
      detailedUpdate = update;
    },
    update(time, applauding, ballPosition) {
      if (detailedUpdate) {
        detailedUpdate(time, applauding, ballPosition);
        return;
      }
      if (time - lastUpdate < 0.12) return;
      lastUpdate = time;
      spectatorSeats.forEach((seat, index) => {
        let gaze = 0;
        if (ballPosition) {
          const bearing = Math.atan2(ballPosition.x - seat.x, ballPosition.z - seat.z);
          gaze = THREE.MathUtils.clamp(
            THREE.MathUtils.euclideanModulo(bearing - seat.facing + Math.PI, Math.PI * 2) - Math.PI,
            -0.65,
            0.65,
          );
        }
        dummy.position.set(
          seat.x + Math.sin(seat.facing) * 0.018,
          seat.y + 1.23,
          seat.z + Math.cos(seat.facing) * 0.018,
        );
        dummy.rotation.set(0, seat.facing + gaze, 0);
        dummy.scale.set(0.17, 0.24, 0.15);
        dummy.updateMatrix();
        headMesh.setMatrixAt(index, dummy.matrix);
        placeArm(index * 2, seat, -1, time, applauding);
        placeArm(index * 2 + 1, seat, 1, time, applauding);
      });
      headMesh.instanceMatrix.needsUpdate = true;
      armMesh.instanceMatrix.needsUpdate = true;
    },
  };
  return crowdRig;
}

export function buildCrowd(scene: THREE.Scene, venueName?: string | null) {
  return buildUnifiedCrowd(scene, resolveDmoVenueProfile(venueName));
}

export function buildCourtFixtures(scene: THREE.Scene): CourtFixtureRig {
  const frameMaterial = material(0x364255, 0.72);
  const seatMaterial = material(0x647188, 0.76);
  const backMaterial = material(0x45536a, 0.78);

  for (const end of [-1, 1]) {
    const bench = new THREE.Group();
    bench.name = end < 0 ? 'wtsl-player-bench-left' : 'wtsl-player-bench-right';
    bench.position.set(end * 2.4, 0, 6.75);
    bench.userData.courtsideTeamArea = true;
    scene.add(bench);
    addBox(bench, [2.55, 0.12, 0.62], [0, 0.53, 0], seatMaterial);
    addBox(bench, [2.55, 0.88, 0.12], [0, 1.0, 0.28], backMaterial);
    for (const x of [-0.91, 0.91]) {
      addBox(bench, [0.09, 0.5, 0.09], [x, 0.26, -0.2], frameMaterial);
      addBox(bench, [0.09, 0.5, 0.09], [x, 0.26, 0.2], frameMaterial);
    }
    addBox(bench, [2.1, 0.08, 0.08], [0, 0.25, -0.21], frameMaterial);
    addBox(bench, [2.1, 0.08, 0.08], [0, 0.25, 0.21], frameMaterial);

    const kitBag = new THREE.Group();
    kitBag.name = end < 0 ? 'wtsl-player-kit-bag-left' : 'wtsl-player-kit-bag-right';
    kitBag.position.set(-1.4, 0.15, 0);
    const bagColor = material(end < 0 ? 0x314c58 : 0x53444b, 0.78);
    const bagBody = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.29, 0.25), bagColor);
    bagBody.name = 'team-kit-bag-body';
    bagBody.castShadow = true;
    kitBag.add(bagBody);
    const bagEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.015, 16), bagColor);
    bagEnd.rotation.z = Math.PI / 2;
    bagEnd.position.x = 0.29;
    kitBag.add(bagEnd);
    const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.012, 0.014), material(0xc4bda9, 0.62));
    zipper.position.set(0, 0.15, 0.13);
    kitBag.add(zipper);
    kitBag.userData.contents = 'rackets-and-match-kit';
    bench.add(kitBag);

    const bottle = new THREE.Group();
    bottle.name = end < 0 ? 'wtsl-player-water-bottle-left' : 'wtsl-player-water-bottle-right';
    bottle.position.set(1.05, 0.68, 0.02);
    const bottleBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.058, 0.25, 12),
      new THREE.MeshStandardMaterial({ color: 0xd4d8cf, roughness: 0.32, metalness: 0.12 }),
    );
    bottleBody.name = 'reusable-water-bottle';
    bottleBody.castShadow = true;
    bottle.add(bottleBody);
    const bottleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.034, 0.035, 12), material(0x48585a, 0.54));
    bottleCap.position.y = 0.142;
    bottle.add(bottleCap);
    bench.add(bottle);

    const towel = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.035, 0.24),
      new THREE.MeshStandardMaterial({ color: end < 0 ? 0xb8c3bb : 0xd7b8a8, roughness: 0.98 }),
    );
    towel.name = end < 0 ? 'wtsl-player-court-towel-left' : 'wtsl-player-court-towel-right';
    towel.position.set(0.54, 0.62, -0.02);
    towel.rotation.y = -0.16 * end;
    bench.add(towel);
  }

  const chair = new THREE.Group();
  chair.name = 'wtsl-umpire-chair';
  chair.position.set(0, 0, 6.75);
  chair.rotation.y = Math.PI;
  scene.add(chair);
  const placeholder = new THREE.Group();
  placeholder.name = 'wtsl-umpire-placeholder';
  chair.add(placeholder);
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
  placeholder.add(torso);
  const headRig = new THREE.Group();
  headRig.name = 'wtsl-umpire-gaze';
  headRig.position.set(0, 2.35, 0.02);
  placeholder.add(headRig);
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
    placeholder.add(arm);
    addBox(chair, [0.13, 0.16, 0.47], [side * 0.15, 1.68, 0.36], frameMaterial);
  }
  let detailedUmpireUpdater: ((ballPosition?: THREE.Vector3) => void) | null = null;
  const fixtureRig: CourtFixtureRig = {
    setDetailedUmpireUpdater: (update) => {
      detailedUmpireUpdater = update;
      placeholder.visible = false;
    },
    update: (ballPosition?: THREE.Vector3) => {
      if (detailedUmpireUpdater) {
        detailedUmpireUpdater(ballPosition);
        return;
      }
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
  racketVisual.position.y = 0;
  racket.add(racketVisual);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 8, 32), material(0xe5dfc6, 0.55));
  frame.name = 'racket-head';
  frame.scale.set(0.5929, 0.7315, 0.3465);
  frame.position.y = 0.36;
  racketVisual.add(frame);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.015, 0.18, 10), material(0x293a35, 0.88));
  handle.name = 'racket-handle';
  racketVisual.add(handle);
  const gripTape = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.019, 0.18, 10), material(0x293a35, 0.88));
  gripTape.name = 'racket-grip-tape';
  racketVisual.add(gripTape);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 10), material(0x202724));
  cap.position.y = -0.094;
  racketVisual.add(cap);
  // An open V throat ends at the hoop; no solid cylinder crosses the strings.
  for (const side of [-1, 1]) {
    const from = new THREE.Vector3(0, 0.09, 0);
    const to = new THREE.Vector3(side * 0.055, 0.20, 0);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 1, 8), material(0xe5dfc6, 0.55));
    poseLimb(stem, from, to);
    racketVisual.add(stem);
  }
  const stringMaterial = new THREE.LineBasicMaterial({ color: 0xeae7d8, transparent: true, opacity: 0.55 });
  for (let index = -2; index <= 2; index += 1) {
    const vertical = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(index * 0.035, 0.36 - 0.15 * Math.sqrt(1 - (index * 0.035 / 0.14) ** 2), 0),
      new THREE.Vector3(index * 0.035, 0.36 + 0.15 * Math.sqrt(1 - (index * 0.035 / 0.14) ** 2), 0),
    ]);
    const horizontal = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.13 * Math.sqrt(1 - (index * 0.05 / 0.175) ** 2), 0.36 + index * 0.05, 0),
      new THREE.Vector3(0.13 * Math.sqrt(1 - (index * 0.05 / 0.175) ** 2), 0.36 + index * 0.05, 0),
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
