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
      context.fillStyle = '#d9b954';
      context.fillRect(0, 0, canvas.width, 12);
      context.fillRect(0, canvas.height - 12, canvas.width, 12);
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
  // concourses separate the tiers without adding retaining walls or a roof.
  const bowlPositions: number[] = [];
  const bowlColors: number[] = [];
  const bowlIndices: number[] = [];
  const perimeterSegments = 112;
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
      const inner = firstVertex + segment;
      const innerNext = firstVertex + next;
      const outer = firstVertex + perimeterSegments + segment;
      const outerNext = firstVertex + perimeterSegments + next;
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
      count: Math.round((Math.PI * 2 * averageRadius) / 0.86),
    };
  });
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
  const seatTransform = new THREE.Object3D();
  let seatIndex = 0;
  for (const row of upperSeatRows) {
    const y = baseY + row.row * rowRise + rowRise / 2;
    for (let index = 0; index < row.count; index += 1) {
      const angle = (index / row.count) * Math.PI * 2;
      const x = Math.cos(angle) * row.ellipseX;
      const z = Math.sin(angle) * row.ellipseZ;
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
  return stadium;
}
