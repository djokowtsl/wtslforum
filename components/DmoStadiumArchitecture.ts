import * as THREE from 'three';

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

function makeRibbonTexture() {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const background = context.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, '#122f3b');
  background.addColorStop(1, '#071a24');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#d9b954';
  context.fillRect(0, 0, canvas.width, 9);
  context.fillRect(0, canvas.height - 9, canvas.width, 9);
  for (const x of [70, 465, 860]) {
    context.fillStyle = '#f3f1e7';
    context.font = '700 72px Arial, sans-serif';
    context.fillText('WTSL', x, 105);
    context.fillStyle = '#b9c8c6';
    context.font = '600 18px Arial, sans-serif';
    context.fillText('WORLD TENNIS SUPER LEAGUE', x + 3, 139);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  return texture;
}

function makeScreenTexture() {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, '#123542');
  background.addColorStop(1, '#081b26');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#d9b954';
  context.fillRect(0, 0, canvas.width, 14);
  context.fillRect(0, canvas.height - 14, canvas.width, 14);
  context.textAlign = 'center';
  context.fillStyle = '#f5f3e9';
  context.font = '700 144px Arial, sans-serif';
  context.fillText('WTSL', canvas.width / 2, 276);
  context.fillStyle = '#c2ceca';
  context.font = '600 30px Arial, sans-serif';
  context.fillText('WORLD TENNIS SUPER LEAGUE', canvas.width / 2, 337);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  return texture;
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

export function buildStadiumArchitecture() {
  const stadium = new THREE.Group();
  stadium.name = 'wtsl-stadium-superstructure';

  const steel = new THREE.MeshStandardMaterial({ color: 0x596a68, roughness: 0.58, metalness: 0.18 });
  const ribbonTexture = makeRibbonTexture();
  const ribbonMaterial = new THREE.MeshBasicMaterial({
    color: ribbonTexture ? 0xffffff : 0x123542,
    ...(ribbonTexture ? { map: ribbonTexture } : {}),
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const screenTexture = makeScreenTexture();
  const screenMaterial = new THREE.MeshBasicMaterial({
    color: screenTexture ? 0xffffff : 0x123542,
    ...(screenTexture ? { map: screenTexture } : {}),
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const decks = new THREE.Group();
  decks.name = 'wtsl-stadium-tiered-bowl';
  stadium.add(decks);
  // A single lightweight, open 360-degree rake replaces the old isolated
  // deck slabs and their retaining fascias. The ellipse follows all four
  // sides of the court, then climbs outward so the spectator bowl fills the
  // view without a roof, exterior wall, or facade.
  decks.name = 'wtsl-continuous-inward-facing-bowl';
  const bowlPositions: number[] = [];
  const bowlColors: number[] = [];
  const bowlIndices: number[] = [];
  const perimeterSegments = 112;
  const seatRows = 18;
  const innerX = 27.8;
  const innerZ = 18.8;
  const rowWidth = 1.62;
  const rowRise = 0.94;
  const baseY = 2.7;
  for (let row = 0; row < seatRows; row += 1) {
    const innerRadius = row * rowWidth;
    const outerRadius = (row + 1) * rowWidth;
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

  const upperSeatRows = Array.from({ length: 18 }, (_, row) => {
    const radius = row * rowWidth + rowWidth / 2;
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
  const emptySeatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.1, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x334146, roughness: 0.86 }),
    totalSeats,
  );
  const emptySeatBackMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.48, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x3b494b, roughness: 0.82 }),
    totalSeats,
  );
  emptySeatMesh.name = 'wtsl-continuous-bowl-seats';
  emptySeatBackMesh.name = 'wtsl-continuous-bowl-seat-backs';
  emptySeatMesh.userData = { rows: upperSeatRows.length, inwardFacing: true };
  emptySeatBackMesh.userData = { rows: upperSeatRows.length, inwardFacing: true };
  const seatTransform = new THREE.Object3D();
  let seatIndex = 0;
  for (const row of upperSeatRows) {
    const y = baseY + row.row * rowRise + rowRise / 2;
    for (let index = 0; index < row.count; index += 1) {
      const angle = (index / row.count) * Math.PI * 2;
      const x = Math.cos(angle) * row.ellipseX;
      const z = Math.sin(angle) * row.ellipseZ;
      const facing = Math.atan2(-Math.cos(angle), -Math.sin(angle));

      seatTransform.position.set(x, y + 0.06, z);
      seatTransform.rotation.set(0, facing, 0);
      seatTransform.scale.set(1, 1, 1);
      seatTransform.updateMatrix();
      emptySeatMesh.setMatrixAt(seatIndex, seatTransform.matrix);

      seatTransform.position.set(
        x - Math.sin(facing) * 0.16,
        y + 0.34,
        z - Math.cos(facing) * 0.16,
      );
      seatTransform.updateMatrix();
      emptySeatBackMesh.setMatrixAt(seatIndex, seatTransform.matrix);
      seatIndex += 1;
    }
  }
  emptySeatMesh.instanceMatrix.needsUpdate = true;
  emptySeatBackMesh.instanceMatrix.needsUpdate = true;
  emptySeatMesh.castShadow = false;
  emptySeatBackMesh.castShadow = false;
  emptySeatMesh.receiveShadow = true;
  emptySeatBackMesh.receiveShadow = true;
  decks.add(emptySeatMesh, emptySeatBackMesh);

  const boards = new THREE.Group();
  boards.name = 'wtsl-stadium-advertising-boards';
  stadium.add(boards);
  for (const side of [-1, 1]) {
    addPlane(boards, 'wtsl-advertising-board-baseline', 46, 0.78,
      [0, 2.58, side * 18.05], side > 0 ? Math.PI : 0, ribbonMaterial);
    addPlane(boards, 'wtsl-advertising-board-sideline', 35, 0.78,
      [side * 27.56, 2.58, 0], -side * Math.PI / 2, ribbonMaterial);
  }

  const scoreboards = new THREE.Group();
  scoreboards.name = 'wtsl-stadium-scoreboards';
  stadium.add(scoreboards);
  for (const side of [-1, 1]) {
    addBox(scoreboards, 'wtsl-scoreboard-frame', [15.5, 4.7, 0.5],
      [0, 10.65, side * 27.15], steel);
    addPlane(scoreboards, 'wtsl-scoreboard-screen', 14.6, 3.9,
      [0, 10.65, side * 26.87], side > 0 ? Math.PI : 0, screenMaterial);
  }

  return stadium;
}
