import * as THREE from 'three';
import type { DmoVenueProfile } from '@/lib/dmoVenue';

export type StadiumScoreboardData = {
  players: [string, string];
  score: {
    sets: [number, number][];
    games: [number, number];
    pointText: [string, string];
    tiebreak: boolean;
    server: 1 | 2 | null;
  } | null;
  live: boolean;
  final?: boolean;
};

type ScoreboardTexture = {
  texture?: THREE.CanvasTexture;
  update: (data: StadiumScoreboardData) => void;
};

export const UPPER_BOWL_AISLE_COUNT = 16;

/** Shared aisle mask for upper-bowl seats and animated spectator anchors. */
export function isUpperBowlSectionAisle(x: number, z: number) {
  const angle = Math.atan2(z, x);
  const sectionAngle = (Math.PI * 2) / UPPER_BOWL_AISLE_COUNT;
  const nearestCenter = Math.round(angle / sectionAngle);
  let difference = angle - nearestCenter * sectionAngle;
  difference = Math.atan2(Math.sin(difference), Math.cos(difference));
  return Math.abs(difference) * Math.hypot(x, z) < 0.82;
}

export function isUpperBowlAccessGap(x: number, z: number) {
  return isUpperBowlSectionAisle(x, z);
}

/** Build four narrow radial stair flights through the lower seats. The actual
 * five-metre tunnel mouths remain open behind the last row. */
export function addLowerBowlSectionStairs(
  parent: THREE.Group | THREE.Scene,
  dimensions: {
    rows: number;
    rowRise: number;
    rowRun: number;
    baselineHalfDepth: number;
    sidelineHalfWidth: number;
    corner: number;
  },
) {
  const stepsPerTransition = 3;
  const stepRun = dimensions.rowRun / stepsPerTransition;
  const stepRise = dimensions.rowRise / stepsPerTransition;
  const transitions = dimensions.rows - 1;
  const count = transitions * stepsPerTransition * 4;
  const treads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, 0.11, stepRun),
    new THREE.MeshStandardMaterial({ color: 0x657270, roughness: 0.9 }),
    count,
  );
  const risers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, stepRise, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x303f44, roughness: 0.88 }),
    count,
  );
  treads.name = 'wtsl-lower-section-stair-treads';
  risers.name = 'wtsl-lower-section-stair-risers';
  const info = {
    aisleCount: 4,
    aisleWidth: 1.64,
    stepsPerRow: stepsPerTransition,
    flights: 4,
    transitions: transitions,
    continuesToTunnelEntrances: true,
    leavesTunnelMouthsOpen: true,
  };
  treads.userData = { ...info };
  risers.userData = { ...info };
  const transform = new THREE.Object3D();
  let index = 0;
  for (let row = 0; row < transitions; row += 1) {
    const rowY = 0.05 + row * dimensions.rowRise;
    const baselineZ = dimensions.baselineHalfDepth + row * dimensions.rowRun;
    const sidelineX = dimensions.sidelineHalfWidth + dimensions.corner + row * dimensions.rowRun;
    for (const side of [-1, 1]) for (const along of ['baseline', 'sideline'] as const) {
      for (let step = 0; step < stepsPerTransition; step += 1) {
        const start = along === 'baseline' ? baselineZ : sidelineX;
        const center = start + (step + 0.5) * stepRun;
        transform.position.set(
          along === 'baseline' ? 0 : side * center,
          rowY + (step + 1) * stepRise - 0.055,
          along === 'baseline' ? side * center : 0,
        );
        transform.rotation.set(0, along === 'sideline' ? Math.PI / 2 : 0, 0);
        transform.updateMatrix();
        treads.setMatrixAt(index, transform.matrix);
        const edge = start + (step + 1) * stepRun;
        transform.position.set(
          along === 'baseline' ? 0 : side * edge,
          rowY + (step + 0.5) * stepRise,
          along === 'baseline' ? side * edge : 0,
        );
        transform.updateMatrix();
        risers.setMatrixAt(index, transform.matrix);
        index += 1;
      }
    }
  }
  for (const mesh of [treads, risers]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
  return { treads, risers };
}

function pointOnEllipseAtBearing(angle: number, semiAxisX: number, semiAxisZ: number) {
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  const radius = 1 / Math.sqrt(
    (directionX * directionX) / (semiAxisX * semiAxisX)
    + (directionZ * directionZ) / (semiAxisZ * semiAxisZ),
  );
  return { x: directionX * radius, z: directionZ * radius };
}

function makeScreenTexture(): ScoreboardTexture {
  if (typeof document === 'undefined') return { update: () => undefined };
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return { update: () => undefined };
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;

  return {
    texture,
    update(data) {
      const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      background.addColorStop(0, '#123542');
      background.addColorStop(1, '#081b26');
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = 'rgba(205, 224, 220, .18)';
      context.lineWidth = 2;
      context.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
      context.fillStyle = 'rgba(255, 255, 255, .025)';
      for (let x = 68; x < canvas.width; x += 64) {
        context.fillRect(x, 108, 1, 310);
      }
      context.fillStyle = '#d9b954';
      context.fillRect(24, 24, canvas.width - 48, 8);
      context.fillRect(24, canvas.height - 32, canvas.width - 48, 8);
      context.textAlign = 'left';
      context.fillStyle = '#e8c85f';
      context.font = '700 34px Arial, sans-serif';
      context.fillText(
        data.live ? 'WTSL · TE4 LIVE SCORE' : data.final ? 'WTSL · MATCH FINAL' : 'WTSL · MATCH SCORE',
        58,
        82,
      );

      if (!data.score) {
        context.textAlign = 'center';
        context.fillStyle = '#f5f3e9';
        context.font = '700 54px Arial, sans-serif';
        context.fillText(data.live ? 'LIVE SCORE UNAVAILABLE' : 'SCORE UNAVAILABLE', canvas.width / 2, 290);
      } else {
        context.fillStyle = '#94aaa8';
        context.font = '600 22px Arial, sans-serif';
        context.fillText('PLAYER', 72, 158);
        context.textAlign = 'center';
        context.fillText('SETS', 626, 158);
        context.fillText('GAMES', 778, 158);
        context.fillText(data.score.tiebreak ? 'TB' : 'POINTS', 914, 158);
        context.textAlign = 'left';

        for (const playerIndex of [0, 1] as const) {
          const rowY = playerIndex === 0 ? 258 : 370;
          context.fillStyle = '#314c54';
          context.fillRect(58, rowY - 46, 908, 2);
          context.fillStyle = '#f5f3e9';
          context.font = '700 42px Arial, sans-serif';
          context.fillText(data.players[playerIndex], 72, rowY, 485);
          const setText = data.score.sets.length
            ? data.score.sets.map((set) => String(set[playerIndex])).join(' · ')
            : '—';
          context.textAlign = 'center';
          context.font = '700 36px Arial, sans-serif';
          context.fillText(setText, 626, rowY);
          context.fillText(String(data.score.games[playerIndex]), 778, rowY);
          context.fillText(data.score.pointText[playerIndex], 914, rowY);
          context.textAlign = 'left';
          if (data.score.server === playerIndex + 1) {
            context.fillStyle = '#e8c85f';
            context.beginPath();
            context.arc(970, rowY - 13, 10, 0, Math.PI * 2);
            context.fill();
          }
        }
      }

      context.textAlign = 'center';
      context.fillStyle = '#91aaa8';
      context.font = '600 18px Arial, sans-serif';
      context.fillText(data.live ? 'OFFICIAL SCORE · MAPPED TO DISPLAYED PLAYER NAMES' : 'WTSL MATCH REPLAY', canvas.width / 2, 468);
      texture.needsUpdate = true;
    },
  };
}

function addBox(
  parent: THREE.Group,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addPlane(
  parent: THREE.Group,
  name: string,
  width: number,
  height: number,
  position: [number, number, number],
  rotationY: number,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

export function buildStadiumArchitecture(
  initialScoreboard?: StadiumScoreboardData,
  venue: DmoVenueProfile = { label: 'Unspecified tennis venue', capacity: 0, upperRows: 18, tierRows: 6 },
  indoor = false,
) {
  const stadium = new THREE.Group();
  stadium.name = 'wtsl-stadium-superstructure';

  const steel = new THREE.MeshStandardMaterial({ color: 0x596a68, roughness: 0.58, metalness: 0.18 });
  const ribbonMaterial = new THREE.MeshStandardMaterial({
    color: 0x123542,
    roughness: 0.82,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const screenDisplay = makeScreenTexture();
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: screenDisplay.texture ? 0xffffff : 0x123542,
    ...(screenDisplay.texture ? { map: screenDisplay.texture } : {}),
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const initialData = initialScoreboard ?? {
    players: ['Player 1', 'Player 2'] as [string, string],
    score: null,
    live: false,
  };
  let lastScoreboardKey = '';
  const updateScoreboard = (data: StadiumScoreboardData) => {
    const key = JSON.stringify(data);
    if (key === lastScoreboardKey) return;
    lastScoreboardKey = key;
    screenDisplay.update(data);
    stadium.userData.scoreboardData = data;
  };
  stadium.userData.updateScoreboard = updateScoreboard;
  updateScoreboard(initialData);

  const decks = new THREE.Group();
  decks.name = 'wtsl-stadium-tiered-bowl';
  stadium.add(decks);
  // Three inward-facing seating tiers rise around the court. Wide annular
  // concourses separate the tiers; indoor ceiling geometry ends at this bowl.
  const bowlPositions: number[] = [];
  const bowlColors: number[] = [];
  const bowlIndices: number[] = [];
  const perimeterSegments = 224;
  const seatRows = venue.upperRows;
  const innerX = 27.8;
  const innerZ = 18.8;
  const rowWidth = 1.62;
  const rowRise = 0.94;
  const concourseWidth = 2.15;
  const tierRows = venue.tierRows;
  const rowRadiusStart = (row: number) => row * rowWidth + Math.floor(row / tierRows) * concourseWidth;
  const outerSeatRadius = rowRadiusStart(seatRows - 1) + rowWidth;
  const interiorSeatEdgeRadius = innerZ + outerSeatRadius;
  const maxInteriorCameraDistance = Math.min(44, interiorSeatEdgeRadius * 0.82);
  const maxInteriorCameraPan = Math.min(
    7,
    Math.max(0, (interiorSeatEdgeRadius - maxInteriorCameraDistance) / Math.SQRT2),
  );
  const baseY = 2.7;
  for (let row = 0; row < seatRows; row += 1) {
    const innerRadius = rowRadiusStart(row);
    const outerRadius = innerRadius + rowWidth;
    const y = baseY + row * rowRise;
    const firstVertex = bowlPositions.length / 3;
    const tint = row % 2 === 0 ? 0x35474a : 0x405253;
    const color = new THREE.Color(tint);
    for (const radius of [innerRadius, outerRadius]) {
      for (let segment = 0; segment < perimeterSegments; segment += 1) {
        const angle = (segment / perimeterSegments) * Math.PI * 2;
        bowlPositions.push(
          Math.cos(angle) * (innerX + radius),
          y + ((radius - innerRadius) / rowWidth) * rowRise,
          Math.sin(angle) * (innerZ + radius),
        );
        bowlColors.push(color.r, color.g, color.b);
      }
    }
    for (let segment = 0; segment < perimeterSegments; segment += 1) {
      const next = (segment + 1) % perimeterSegments;
      const angle = ((segment + 0.5) / perimeterSegments) * Math.PI * 2;
      const midRadius = innerRadius + rowWidth / 2;
      const midX = Math.cos(angle) * (innerX + midRadius);
      const midZ = Math.sin(angle) * (innerZ + midRadius);
      const inner = firstVertex + segment;
      const innerNext = firstVertex + next;
      const outer = firstVertex + perimeterSegments + segment;
      const outerNext = firstVertex + perimeterSegments + next;
      if (isUpperBowlAccessGap(midX, midZ)) continue;
      bowlIndices.push(inner, outer, outerNext, inner, outerNext, innerNext);
    }
  }
  const bowlGeometry = new THREE.BufferGeometry();
  bowlGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bowlPositions, 3));
  bowlGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bowlColors, 3));
  bowlGeometry.setIndex(bowlIndices);
  bowlGeometry.computeVertexNormals();
  bowlGeometry.computeBoundingBox();
  bowlGeometry.userData = {
    continuousPerimeter: true,
    inwardFacing: true,
    rows: seatRows,
    tiers: 3,
    sectionAisleCount: UPPER_BOWL_AISLE_COUNT,
    passageGaps: 4,
  };
  const bowl = new THREE.Mesh(bowlGeometry, new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    side: THREE.DoubleSide,
  }));
  bowl.name = 'wtsl-continuous-seating-bowl';
  bowl.castShadow = false;
  bowl.receiveShadow = true;
  decks.add(bowl);

  const walkwayMaterial = new THREE.MeshStandardMaterial({
    color: 0x657270,
    roughness: 0.9,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const concourseTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7a968,
    roughness: 0.72,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const suiteFrontMaterial = new THREE.MeshStandardMaterial({
    color: 0x17333b,
    roughness: 0.48,
    metalness: 0.16,
  });
  const suiteGlassMaterial = new THREE.MeshStandardMaterial({
    color: 0x526c6b,
    roughness: 0.28,
    metalness: 0.22,
  });
  const makeConcourseRing = (
    name: string,
    innerRadius: number,
    outerRadius: number,
    y: number,
    ringMaterial: THREE.Material,
  ) => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const radius of [innerRadius, outerRadius]) {
      for (let segment = 0; segment < perimeterSegments; segment += 1) {
        const angle = (segment / perimeterSegments) * Math.PI * 2;
        positions.push(
          Math.cos(angle) * (innerX + radius),
          y,
          Math.sin(angle) * (innerZ + radius),
        );
      }
    }
    for (let segment = 0; segment < perimeterSegments; segment += 1) {
      const next = (segment + 1) % perimeterSegments;
      const inner = segment;
      const outer = perimeterSegments + segment;
      const outerNext = perimeterSegments + next;
      const innerNext = next;
      indices.push(inner, outer, outerNext, inner, outerNext, innerNext);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, ringMaterial);
    mesh.name = name;
    mesh.userData.walkway = true;
    mesh.receiveShadow = true;
    decks.add(mesh);
    return mesh;
  };
  for (const boundary of [tierRows, tierRows * 2]) {
    const innerRadius = boundary * rowWidth + (boundary / tierRows - 1) * concourseWidth;
    const outerRadius = innerRadius + concourseWidth;
    const y = baseY + boundary * rowRise;
    const concourse = makeConcourseRing(
      'wtsl-stadium-concourse',
      innerRadius,
      outerRadius,
      y,
      walkwayMaterial,
    );
    concourse.userData = {
      tierAfter: boundary,
      width: concourseWidth,
      amenities: ['concessions', 'restrooms'],
      continuous: true,
    };
    makeConcourseRing(
      'wtsl-stadium-concourse-edge',
      innerRadius,
      innerRadius + 0.09,
      y + 0.025,
      concourseTrimMaterial,
    );
    makeConcourseRing(
      'wtsl-stadium-concourse-edge',
      outerRadius - 0.09,
      outerRadius,
      y + 0.025,
      concourseTrimMaterial,
    );

    // Suite windows are set into the concourse fascia rather than forming
    // another opaque wall around the arena.
    const suiteAngles = Array.from({ length: 48 }, (_, index) => (index / 48) * Math.PI * 2)
      .filter((angle) => {
        const radius = (innerRadius + outerRadius) / 2;
        const x = Math.cos(angle) * (innerX + radius);
        const z = Math.sin(angle) * (innerZ + radius);
        return !isUpperBowlAccessGap(x, z);
      });
    const suiteCount = suiteAngles.length;
    const suiteY = y - 0.88;
    const suiteFronts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.7, 1.18, 0.16),
      suiteFrontMaterial,
      suiteCount,
    );
    suiteFronts.name = 'wtsl-stadium-suite-front';
    suiteFronts.userData = { tierAfter: boundary, suiteCount, concourseBand: true };
    const windows = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.72, 0.48, 0.035),
      suiteGlassMaterial,
      suiteCount,
    );
    windows.name = 'wtsl-stadium-suite-window';
    windows.userData = { tierAfter: boundary, suiteCount, integratedWith: 'concourse' };
    const suiteTransform = new THREE.Object3D();
    for (let index = 0; index < suiteAngles.length; index += 1) {
      const angle = suiteAngles[index];
      const radius = (innerRadius + outerRadius) / 2;
      const x = Math.cos(angle) * (innerX + radius);
      const z = Math.sin(angle) * (innerZ + radius);
      suiteTransform.position.set(x, suiteY, z);
      suiteTransform.rotation.set(0, -angle - Math.PI / 2, 0);
      suiteTransform.updateMatrix();
      suiteFronts.setMatrixAt(index, suiteTransform.matrix);
      suiteTransform.position.set(
        x - Math.cos(angle) * 0.095,
        suiteY + 0.05,
        z - Math.sin(angle) * 0.095,
      );
      suiteTransform.updateMatrix();
      windows.setMatrixAt(index, suiteTransform.matrix);
    }
    suiteFronts.instanceMatrix.needsUpdate = true;
    windows.instanceMatrix.needsUpdate = true;
    suiteFronts.castShadow = false;
    windows.castShadow = false;
    decks.add(suiteFronts, windows);
  }

  const upperSeatRows = Array.from({ length: seatRows }, (_, row) => {
    const radius = rowRadiusStart(row) + rowWidth / 2;
    const ellipseX = innerX + radius;
    const ellipseZ = innerZ + radius;
    const averageRadius = (ellipseX + ellipseZ) / 2;
    return {
      row,
      radius,
      ellipseX,
      ellipseZ,
      nominalCount: Math.round((Math.PI * 2 * averageRadius) / 0.86),
      count: 0,
    };
  });
  const seatLocations = upperSeatRows.map((row) => {
    const locations = [];
    for (let index = 0; index < row.nominalCount; index += 1) {
      const angle = (index / row.nominalCount) * Math.PI * 2;
      const x = Math.cos(angle) * row.ellipseX;
      const z = Math.sin(angle) * row.ellipseZ;
      if (isUpperBowlAccessGap(x, z)) continue;
      locations.push({ angle, x, z });
    }
    return locations;
  });
  for (const row of upperSeatRows) row.count = seatLocations[row.row].length;
  const totalSeats = upperSeatRows.reduce((total, row) => total + row.count, 0);
  const occupiedSeats = upperSeatRows.reduce((total, row) => {
    let count = 0;
    for (let index = 0; index < row.count; index += 1) {
      if ((row.row * 13 + index * 7) % 12 !== 0) count += 1;
    }
    return total + count;
  }, 0);
  const seatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.1, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x334146, roughness: 0.86 }),
    totalSeats,
  );
  const seatBackMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.48, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x3b494b, roughness: 0.82 }),
    totalSeats,
  );
  seatMesh.name = 'wtsl-continuous-bowl-seats';
  seatBackMesh.name = 'wtsl-continuous-bowl-seat-backs';
  seatMesh.userData = { rows: upperSeatRows.length, inwardFacing: true, occupied: occupiedSeats };
  seatBackMesh.userData = { rows: upperSeatRows.length, inwardFacing: true, occupied: occupiedSeats };
  seatMesh.userData.sectionAisleCount = UPPER_BOWL_AISLE_COUNT;
  seatMesh.userData.passageGaps = 4;
  seatBackMesh.userData.sectionAisleCount = UPPER_BOWL_AISLE_COUNT;
  seatBackMesh.userData.passageGaps = 4;
  const seatTransform = new THREE.Object3D();
  let seatIndex = 0;
  for (const row of upperSeatRows) {
    const y = baseY + row.row * rowRise + rowRise / 2;
    for (const { angle, x, z } of seatLocations[row.row]) {
      const facing = Math.atan2(-Math.cos(angle), -Math.sin(angle));

      seatTransform.position.set(x, y + 0.38, z);
      seatTransform.rotation.set(0, facing, 0);
      seatTransform.scale.set(1, 1, 1);
      seatTransform.updateMatrix();
      seatMesh.setMatrixAt(seatIndex, seatTransform.matrix);

      seatTransform.position.set(
        x - Math.sin(facing) * 0.16,
        y + 0.72,
        z - Math.cos(facing) * 0.16,
      );
      seatTransform.updateMatrix();
      seatBackMesh.setMatrixAt(seatIndex, seatTransform.matrix);
      seatIndex += 1;
    }
  }
  for (const mesh of [seatMesh, seatBackMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    decks.add(mesh);
  }
  const stairTreads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, 0.11, rowWidth),
    walkwayMaterial,
    seatRows * UPPER_BOWL_AISLE_COUNT,
  );
  stairTreads.name = 'wtsl-stadium-section-stair-treads';
  stairTreads.userData = {
    sectionAisleCount: UPPER_BOWL_AISLE_COUNT,
    rowsPerAisle: seatRows,
    continuousThroughTiers: true,
    alignedWithSeatGaps: true,
  };
  const stairTransform = new THREE.Object3D();
  let stairIndex = 0;
  for (let row = 0; row < seatRows; row += 1) {
    const radius = rowRadiusStart(row) + rowWidth / 2;
    for (let aisle = 0; aisle < UPPER_BOWL_AISLE_COUNT; aisle += 1) {
      const angle = (aisle / UPPER_BOWL_AISLE_COUNT) * Math.PI * 2;
      const point = pointOnEllipseAtBearing(angle, innerX + radius, innerZ + radius);
      stairTransform.position.set(
        point.x,
        baseY + row * rowRise + rowRise * 0.47,
        point.z,
      );
      stairTransform.rotation.set(0, -angle - Math.PI / 2, 0);
      stairTransform.updateMatrix();
      stairTreads.setMatrixAt(stairIndex++, stairTransform.matrix);
    }
  }
  stairTreads.instanceMatrix.needsUpdate = true;
  stairTreads.castShadow = false;
  stairTreads.receiveShadow = true;
  decks.add(stairTreads);
  const stairRisers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, rowRise - 0.11, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x303f44, roughness: 0.88 }),
    Math.max(0, seatRows - 1) * UPPER_BOWL_AISLE_COUNT,
  );
  stairRisers.name = 'wtsl-stadium-section-stair-risers';
  stairRisers.userData = {
    sectionAisleCount: UPPER_BOWL_AISLE_COUNT,
    transitions: Math.max(0, seatRows - 1),
    backedByExterior: true,
  };
  const stairRiserTransform = new THREE.Object3D();
  let stairRiserIndex = 0;
  for (let row = 0; row < seatRows - 1; row += 1) {
    const radius = rowRadiusStart(row) + rowWidth - 0.09;
    const y = baseY + (row + 0.94) * rowRise;
    for (let aisle = 0; aisle < UPPER_BOWL_AISLE_COUNT; aisle += 1) {
      const angle = (aisle / UPPER_BOWL_AISLE_COUNT) * Math.PI * 2;
      const point = pointOnEllipseAtBearing(angle, innerX + radius, innerZ + radius);
      stairRiserTransform.position.set(point.x, y, point.z);
      stairRiserTransform.rotation.set(0, -angle - Math.PI / 2, 0);
      stairRiserTransform.updateMatrix();
      stairRisers.setMatrixAt(stairRiserIndex++, stairRiserTransform.matrix);
    }
  }
  stairRisers.instanceMatrix.needsUpdate = true;
  stairRisers.castShadow = false;
  stairRisers.receiveShadow = true;
  decks.add(stairRisers);
  const concourseStepsPerTier = 4;
  const concourseStairs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, 0.11, concourseWidth / concourseStepsPerTier),
    walkwayMaterial,
    2 * UPPER_BOWL_AISLE_COUNT * concourseStepsPerTier,
  );
  concourseStairs.name = 'wtsl-stadium-concourse-stair-treads';
  concourseStairs.userData = {
    sectionAisleCount: UPPER_BOWL_AISLE_COUNT,
    stepsPerTransition: concourseStepsPerTier,
    transitionCount: 2,
    alignedWithSectionStairs: true,
  };
  const concourseStairTransform = new THREE.Object3D();
  let concourseStairIndex = 0;
  for (const boundary of [tierRows, tierRows * 2]) {
    const innerRadius = boundary * rowWidth + (boundary / tierRows - 1) * concourseWidth;
    const floorY = baseY + boundary * rowRise;
    for (let aisle = 0; aisle < UPPER_BOWL_AISLE_COUNT; aisle += 1) {
      const angle = (aisle / UPPER_BOWL_AISLE_COUNT) * Math.PI * 2;
      for (let step = 0; step < concourseStepsPerTier; step += 1) {
        const radius = innerRadius + ((step + 0.5) / concourseStepsPerTier) * concourseWidth;
        const point = pointOnEllipseAtBearing(angle, innerX + radius, innerZ + radius);
        concourseStairTransform.position.set(
          point.x,
          floorY + (step + 0.5) * (rowRise / concourseStepsPerTier),
          point.z,
        );
        concourseStairTransform.rotation.set(0, -angle - Math.PI / 2, 0);
        concourseStairTransform.updateMatrix();
        concourseStairs.setMatrixAt(concourseStairIndex++, concourseStairTransform.matrix);
      }
    }
  }
  concourseStairs.instanceMatrix.needsUpdate = true;
  concourseStairs.castShadow = false;
  concourseStairs.receiveShadow = true;
  decks.add(concourseStairs);
  const concourseStairRise = rowRise / concourseStepsPerTier;
  const concourseRisers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.64, concourseStairRise, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x303f44, roughness: 0.88 }),
    2 * UPPER_BOWL_AISLE_COUNT * (concourseStepsPerTier - 1),
  );
  concourseRisers.name = 'wtsl-stadium-concourse-stair-risers';
  concourseRisers.userData = {
    sectionAisleCount: UPPER_BOWL_AISLE_COUNT,
    transitions: 2 * (concourseStepsPerTier - 1),
    backedByExterior: true,
  };
  const concourseRiserTransform = new THREE.Object3D();
  let concourseRiserIndex = 0;
  for (const boundary of [tierRows, tierRows * 2]) {
    const innerRadius = boundary * rowWidth + (boundary / tierRows - 1) * concourseWidth;
    const floorY = baseY + boundary * rowRise;
    for (let aisle = 0; aisle < UPPER_BOWL_AISLE_COUNT; aisle += 1) {
      const angle = (aisle / UPPER_BOWL_AISLE_COUNT) * Math.PI * 2;
      for (let step = 0; step < concourseStepsPerTier - 1; step += 1) {
        const radius = innerRadius + ((step + 1) / concourseStepsPerTier) * concourseWidth;
        const point = pointOnEllipseAtBearing(angle, innerX + radius, innerZ + radius);
        concourseRiserTransform.position.set(
          point.x,
          floorY + (step + 1) * concourseStairRise,
          point.z,
        );
        concourseRiserTransform.rotation.set(0, -angle - Math.PI / 2, 0);
        concourseRiserTransform.updateMatrix();
        concourseRisers.setMatrixAt(concourseRiserIndex++, concourseRiserTransform.matrix);
      }
    }
  }
  concourseRisers.instanceMatrix.needsUpdate = true;
  concourseRisers.castShadow = false;
  concourseRisers.receiveShadow = true;
  decks.add(concourseRisers);

  const boards = new THREE.Group();
  boards.name = 'wtsl-stadium-advertising-boards';
  stadium.add(boards);
  const boardLength = 46;
  const sideBoardLength = 35;
  const tunnelWidth = 5;
  const tunnelDepth = 4.8;
  const boardSection = (boardLength - tunnelWidth) / 2;
  const boardOffset = tunnelWidth / 2 + boardSection / 2;
  const sideBoardSection = (sideBoardLength - tunnelWidth) / 2;
  const sideBoardOffset = tunnelWidth / 2 + sideBoardSection / 2;
  for (const side of [-1, 1]) {
    for (const direction of [-1, 1]) {
      addPlane(boards, 'wtsl-advertising-board-baseline', boardSection, 0.78,
        [direction * boardOffset, 2.58, side * 18.05], side > 0 ? Math.PI : 0, ribbonMaterial);
      addPlane(boards, 'wtsl-advertising-board-sideline', sideBoardSection, 0.78,
        [side * 27.56, 2.58, direction * sideBoardOffset], -side * Math.PI / 2, ribbonMaterial);
    }
  }

  const tunnelMaterial = new THREE.MeshStandardMaterial({ color: 0x202c2f, roughness: 0.96 });
  const addTunnelOpening = (axis: 'x' | 'z', side: -1 | 1) => {
    const tunnel = new THREE.Group();
    tunnel.name = 'wtsl-court-tunnel-opening';
    tunnel.userData = { axis, side, width: tunnelWidth, count: 1 };
    if (axis === 'z') {
      tunnel.position.z = side * 18.05;
      addBox(tunnel, 'wtsl-tunnel-jamb', [0.24, 2.42, tunnelDepth],
        [-tunnelWidth / 2 + 0.12, 1.21, side * tunnelDepth / 2], steel);
      addBox(tunnel, 'wtsl-tunnel-jamb', [0.24, 2.42, tunnelDepth],
        [tunnelWidth / 2 - 0.12, 1.21, side * tunnelDepth / 2], steel);
      addBox(tunnel, 'wtsl-tunnel-lintel', [tunnelWidth, 0.34, tunnelDepth],
        [0, 2.55, side * tunnelDepth / 2], steel);
      addBox(tunnel, 'wtsl-tunnel-floor', [tunnelWidth, 0.12, tunnelDepth],
        [0, 0.05, side * tunnelDepth / 2], tunnelMaterial);
      addBox(tunnel, 'wtsl-tunnel-interior', [tunnelWidth - 0.5, 0.08, tunnelDepth - 0.35],
        [0, 0.14, side * tunnelDepth / 2], tunnelMaterial);
    } else {
      tunnel.position.x = side * 27.56;
      addBox(tunnel, 'wtsl-tunnel-jamb', [tunnelDepth, 2.42, 0.24],
        [side * tunnelDepth / 2, 1.21, -tunnelWidth / 2 + 0.12], steel);
      addBox(tunnel, 'wtsl-tunnel-jamb', [tunnelDepth, 2.42, 0.24],
        [side * tunnelDepth / 2, 1.21, tunnelWidth / 2 - 0.12], steel);
      addBox(tunnel, 'wtsl-tunnel-lintel', [tunnelDepth, 0.34, tunnelWidth],
        [side * tunnelDepth / 2, 2.55, 0], steel);
      addBox(tunnel, 'wtsl-tunnel-floor', [tunnelDepth, 0.12, tunnelWidth],
        [side * tunnelDepth / 2, 0.05, 0], tunnelMaterial);
      addBox(tunnel, 'wtsl-tunnel-interior', [tunnelDepth - 0.35, 0.08, tunnelWidth - 0.5],
        [side * tunnelDepth / 2, 0.14, 0], tunnelMaterial);
    }
    boards.add(tunnel);
  };
  for (const side of [-1, 1] as const) {
    addTunnelOpening('z', side);
    addTunnelOpening('x', side);
  }
  boards.userData = { tunnelOpeningCount: 4, tunnelWidth, tunnelDepth };

  const scoreboards = new THREE.Group();
  scoreboards.name = 'wtsl-stadium-scoreboards';
  stadium.add(scoreboards);
  for (const side of [-1, 1]) {
    addBox(scoreboards, 'wtsl-scoreboard-frame', [15.5, 4.7, 0.5],
      [0, 10.65, side * 27.15], steel);
    addPlane(scoreboards, 'wtsl-scoreboard-screen', 14.6, 3.9,
      [0, 10.65, side * 26.87], side > 0 ? Math.PI : 0, screenMaterial);
  }

  stadium.userData.tierCount = 3;
  stadium.userData.concourseCount = 2;
  stadium.userData.tunnelOpeningCount = 4;
  stadium.userData.venueName = venue.label;
  stadium.userData.capacity = venue.capacity;
  stadium.userData.seatCount = totalSeats;
  stadium.userData.spectatorCount = occupiedSeats;
  stadium.userData.outerSeatRadius = outerSeatRadius;
  stadium.userData.interiorSeatEdgeRadius = interiorSeatEdgeRadius;
  stadium.userData.maxInteriorCameraDistance = maxInteriorCameraDistance;
  stadium.userData.maxInteriorCameraPan = maxInteriorCameraPan;
  const topStandHeight = baseY + seatRows * rowRise;
  stadium.userData.topStandHeight = topStandHeight;
  const rimBaseY = topStandHeight + 0.35;
  const rimTopY = indoor ? topStandHeight + 2.15 : topStandHeight + 8.5;
  const wallBaseY = indoor ? 0 : -8;
  const wallHeight = rimTopY - wallBaseY;
  const wallRadiusX = innerX + outerSeatRadius + 0.4;
  const wallRadiusZ = innerZ + outerSeatRadius + 0.4;
  const exteriorWalls = new THREE.Group();
  exteriorWalls.name = 'wtsl-stadium-exterior-walls';
  exteriorWalls.userData.openSky = !indoor;
  exteriorWalls.userData.upperEdge = rimTopY;
  exteriorWalls.userData.lowerEdge = wallBaseY;
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, wallHeight, perimeterSegments, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2c3b40, roughness: 0.84, metalness: 0.12,
      emissive: 0x172126, emissiveIntensity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
  );
  wall.name = 'wtsl-stadium-exterior-wall-shell';
  wall.position.y = (wallBaseY + rimTopY) / 2;
  wall.scale.set(wallRadiusX, 1, wallRadiusZ);
  exteriorWalls.add(wall);

  const tierCourseMaterial = new THREE.MeshStandardMaterial({
    color: 0x626f71, roughness: 0.72, metalness: 0.18,
  });
  const tierBoundaries = [tierRows, tierRows * 2];
  tierBoundaries.forEach((boundary, index) => {
    const course = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.22, perimeterSegments, 1, true),
      tierCourseMaterial,
    );
    course.name = `wtsl-stadium-exterior-tier-course-${index + 1}`;
    course.position.y = baseY + boundary * rowRise;
    course.scale.set(wallRadiusX, 1, wallRadiusZ);
    exteriorWalls.add(course);
  });

  const supportMaterial = new THREE.MeshStandardMaterial({
    color: 0x293a40, roughness: 0.76, metalness: 0.24,
  });
  const supportHeight = rimTopY;
  for (let index = 0; index < 40; index += 1) {
    const angle = ((index + 0.5) / 40) * Math.PI * 2;
    const support = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, supportHeight, 0.48),
      supportMaterial,
    );
    support.name = `wtsl-stadium-exterior-pilaster-${index + 1}`;
    support.position.set(
      wallRadiusX * Math.cos(angle),
      supportHeight / 2,
      wallRadiusZ * Math.sin(angle),
    );
    exteriorWalls.add(support);
  }
  stadium.add(exteriorWalls);

  const upperRim = new THREE.Group();
  upperRim.name = 'wtsl-stadium-upper-rim';
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x7a8989, roughness: 0.66, metalness: 0.28,
  });
  for (const [name, y, thickness] of [
    ['wtsl-stadium-upper-rim-cap', rimTopY, 0.12],
    ['wtsl-stadium-upper-rim-base', rimBaseY, 0.08],
  ] as const) {
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, thickness, perimeterSegments, 1, true),
      railMaterial,
    );
    rail.name = name;
    rail.position.y = y;
    rail.scale.set(wallRadiusX, 1, wallRadiusZ);
    upperRim.add(rail);
  }
  upperRim.userData.openSky = !indoor;
  upperRim.userData.boundary = 'top of stands';
  upperRim.userData.height = rimTopY;
  stadium.userData.upperRimHeight = rimTopY;
  stadium.add(upperRim);
  if (indoor) {
    const roofHeight = Math.max(20, topStandHeight + 6);
    const radiusX = innerX + outerSeatRadius;
    const radiusZ = innerZ + outerSeatRadius;
    const ceiling = new THREE.Group();
    ceiling.name = 'wtsl-indoor-ceiling';
    ceiling.userData.height = roofHeight;
    ceiling.userData.passThrough = true;
    const underside = new THREE.MeshStandardMaterial({
      color: 0x647079, roughness: 0.94, metalness: 0,
      emissive: 0x35414b, emissiveIntensity: 0.65, side: THREE.BackSide,
    });
    // Upward normals + BackSide: visible looking up from inside, invisible
    // looking down from above. No roof collision or exterior shell is added.
    const panelGeometry = new THREE.CircleGeometry(1, 96);
    panelGeometry.rotateX(-Math.PI / 2);
    const panel = new THREE.Mesh(panelGeometry, underside);
    panel.name = 'wtsl-indoor-ceiling-panel';
    panel.position.y = roofHeight;
    panel.scale.set(radiusX, 1, radiusZ);
    ceiling.add(panel);
    const fascia = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, roofHeight - topStandHeight, 96, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x39464f, roughness: 0.96,
        emissive: 0x1b252d, emissiveIntensity: 0.5, side: THREE.BackSide,
      }),
    );
    fascia.name = 'wtsl-indoor-upper-bowl-fascia';
    fascia.position.y = (roofHeight + topStandHeight) / 2;
    fascia.scale.set(radiusX, 1, radiusZ);
    ceiling.add(fascia);
    const beamMaterial = new THREE.MeshStandardMaterial({
      color: 0x29343c, roughness: 0.8, metalness: 0.3,
      emissive: 0x10191f, emissiveIntensity: 0.45, side: THREE.BackSide,
    });
    const beam = (width: number, length: number, x: number, z: number) => {
      const geometry = new THREE.PlaneGeometry(width, length);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, beamMaterial);
      mesh.position.set(x, roofHeight - 0.12, z);
      ceiling.add(mesh);
    };
    for (const fraction of [-0.6, -0.3, 0, 0.3, 0.6]) {
      beam(0.48, 2 * radiusZ * Math.sqrt(1 - fraction ** 2), fraction * radiusX, 0);
    }
    for (const fraction of [-0.45, 0, 0.45]) {
      beam(2 * radiusX * Math.sqrt(1 - fraction ** 2), 0.38, 0, fraction * radiusZ);
    }
    const lightGeometry = new THREE.PlaneGeometry(3.2, 0.65);
    lightGeometry.rotateX(-Math.PI / 2);
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xe7e2d2, side: THREE.BackSide });
    for (const x of [-12, 12]) for (const z of [-8, 8]) {
      const fixture = new THREE.Mesh(lightGeometry, lightMaterial);
      fixture.position.set(x, roofHeight - 0.2, z);
      ceiling.add(fixture);
    }
    stadium.add(ceiling);
  }
  return stadium;
}
