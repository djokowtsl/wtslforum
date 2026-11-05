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

function addColumns(parent: THREE.Group, material: THREE.Material, indoor: boolean) {
  const height = indoor ? 13.6 : 11.2;
  const columns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, height, 0.42),
    material,
    24,
  );
  columns.name = 'wtsl-stadium-support-columns';
  columns.castShadow = false;
  columns.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let x = -24; x <= 24; x += 8) {
    for (const side of [-1, 1]) {
      dummy.position.set(x, height / 2, side * 28.4);
      dummy.updateMatrix();
      columns.setMatrixAt(count++, dummy.matrix);
    }
  }
  for (let z = -16; z <= 16; z += 8) {
    for (const side of [-1, 1]) {
      dummy.position.set(side * 37.2, height / 2, z);
      dummy.updateMatrix();
      columns.setMatrixAt(count++, dummy.matrix);
    }
  }
  columns.count = count;
  columns.instanceMatrix.needsUpdate = true;
  parent.add(columns);
}

export function buildStadiumArchitecture(indoor: boolean) {
  const stadium = new THREE.Group();
  stadium.name = 'wtsl-stadium-superstructure';

  const concrete = new THREE.MeshStandardMaterial({ color: 0x687572, roughness: 0.92 });
  const fascia = new THREE.MeshStandardMaterial({ color: 0x283d42, roughness: 0.82 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x596a68, roughness: 0.58, metalness: 0.18 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x17323a, roughness: 0.3, metalness: 0.28 });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: indoor ? 0x87918d : 0xa0aaa4,
    roughness: 0.72,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
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
  const levels = [
    { y: 3.85, baselineZ: 20.5, sidelineX: 29.1, baselineWidth: 54, sidelineLength: 39 },
    { y: 5.55, baselineZ: 22.7, sidelineX: 31.3, baselineLength: 43 },
    { y: 7.25, baselineZ: 24.9, sidelineX: 33.5, baselineLength: 47 },
  ];
  for (const [index, level] of levels.entries()) {
    const width = level.baselineWidth ?? 54 + index * 2;
    const sidelineLength = level.sidelineLength ?? 39 + index * 4;
    for (const side of [-1, 1]) {
      addBox(decks, `wtsl-baseline-upper-deck-${index}`, [width, 0.3, 1.9],
        [0, level.y, side * level.baselineZ], concrete);
      addBox(decks, `wtsl-sideline-upper-deck-${index}`, [1.9, 0.3, sidelineLength],
        [side * level.sidelineX, level.y, 0], concrete);
      addBox(decks, `wtsl-baseline-riser-${index}`, [width, 1.0, 0.2],
        [0, level.y - 0.65, side * (level.baselineZ - 0.9)], fascia);
      addBox(decks, `wtsl-sideline-riser-${index}`, [0.2, 1.0, sidelineLength],
        [side * (level.sidelineX - 0.9), level.y - 0.65, 0], fascia);
    }
  }

  const concourse = new THREE.Group();
  concourse.name = 'wtsl-stadium-concourse';
  stadium.add(concourse);
  for (const side of [-1, 1]) {
    addBox(concourse, 'wtsl-baseline-concourse-fascia', [58, 1.55, 0.62],
      [0, 9.35, side * 28.0], fascia);
    addBox(concourse, 'wtsl-sideline-concourse-fascia', [0.62, 1.55, 47],
      [side * 36.8, 9.35, 0], fascia);
    addBox(concourse, 'wtsl-baseline-concourse-trim', [58.4, 0.16, 0.72],
      [0, 10.18, side * 28.0], steel);
    addBox(concourse, 'wtsl-sideline-concourse-trim', [0.72, 0.16, 47.4],
      [side * 36.8, 10.18, 0], steel);
  }

  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(5.6, 0.62, 0.08), glass, 16);
  windows.name = 'wtsl-stadium-concourse-windows';
  windows.castShadow = false;
  const windowTransform = new THREE.Object3D();
  let windowIndex = 0;
  for (let x = -21; x <= 21; x += 14) {
    for (const side of [-1, 1]) {
      windowTransform.position.set(x, 9.4, side * 27.66);
      windowTransform.updateMatrix();
      windows.setMatrixAt(windowIndex++, windowTransform.matrix);
    }
  }
  for (let z = -14; z <= 14; z += 14) {
    for (const side of [-1, 1]) {
      windowTransform.position.set(side * 36.46, 9.4, z);
      windowTransform.rotation.y = side * Math.PI / 2;
      windowTransform.updateMatrix();
      windows.setMatrixAt(windowIndex++, windowTransform.matrix);
    }
  }
  windows.count = windowIndex;
  windows.instanceMatrix.needsUpdate = true;
  concourse.add(windows);

  addColumns(stadium, steel, indoor);
  for (const side of [-1, 1]) {
    addBox(stadium, 'wtsl-baseline-roof-truss', [58, 0.24, 0.28],
      [0, indoor ? 13.95 : 12.05, side * 27.6], steel);
    addBox(stadium, 'wtsl-sideline-roof-truss', [0.28, 0.24, 45],
      [side * 36.4, indoor ? 13.95 : 12.05, 0], steel);
    addBox(stadium, indoor ? 'wtsl-indoor-roof-wing' : 'wtsl-open-air-canopy',
      [58, 0.2, 5.1], [0, indoor ? 14.45 : 12.45, side * 26.9], canopyMaterial);
    addBox(stadium, indoor ? 'wtsl-indoor-roof-wing' : 'wtsl-open-air-canopy',
      [5.1, 0.2, 45], [side * 35.8, indoor ? 14.45 : 12.45, 0], canopyMaterial);
  }

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
