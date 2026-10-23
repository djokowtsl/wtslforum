import {
  createCourtProjector,
  type LiveCourtCamera,
  type LiveCourtProjectedPoint,
  type LiveCourtWorldPoint,
} from './liveCourtProjection';
import type { Te4CourtSurface } from './te4DmoTypes';

type Project = (x: number, y: number, z: number) => LiveCourtProjectedPoint;

const backdropCache = new WeakMap<
  HTMLCanvasElement,
  { key: string; canvas: HTMLCanvasElement }
>();

const audienceColors = ['#f0bd73', '#87c9c4', '#e48782', '#d8dfeb', '#8eacd8', '#e9dfc7'];

function drawStadiumCrowd(context: CanvasRenderingContext2D, project: Project) {
  const polygon = (points: LiveCourtWorldPoint[], fill: string, stroke?: string) => {
    context.beginPath();
    points.forEach(([x, y, z], index) => {
      const [screenX, screenY] = project(x, y, z);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 2;
      context.stroke();
    }
  };

  const sky = context.createLinearGradient(0, 0, 0, 520);
  sky.addColorStop(0, '#0a1527');
  sky.addColorStop(0.56, '#1b3044');
  sky.addColorStop(1, '#101d2c');
  context.fillStyle = sky;
  context.fillRect(0, 0, 900, 520);

  polygon([[-2350, -1450, 0], [2350, -1450, 0], [2350, -690, 0], [-2350, -690, 0]], '#1b2b40', '#3e5265');
  polygon([[-2350, 690, 0], [2350, 690, 0], [2350, 1450, 0], [-2350, 1450, 0]], '#19283b', '#3e5265');
  polygon([[-2320, -700, 0], [-1440, -700, 0], [-1440, 700, 0], [-2320, 700, 0]], '#1b2b40', '#3e5265');
  polygon([[1440, -700, 0], [2320, -700, 0], [2320, 700, 0], [1440, 700, 0]], '#1b2b40', '#3e5265');
  const wallColor = '#26364b';
  const wallRim = '#64778e';
  for (const side of [-1, 1]) {
    const y = side * 1450;
    polygon([
      [-2350, y, 0],
      [2350, y, 0],
      [2350, y, 620],
      [-2350, y, 620],
    ], wallColor, '#42556c');
    polygon([
      [-2350, y, 620],
      [2350, y, 620],
      [2350, y - side * 62, 620],
      [-2350, y - side * 62, 620],
    ], wallRim, '#8797aa');
  }
  for (const end of [-1, 1]) {
    const x = end * 2320;
    polygon([
      [x, -1450, 0],
      [x, 1450, 0],
      [x, 1450, 620],
      [x, -1450, 620],
    ], wallColor, '#42556c');
    polygon([
      [x, -1450, 620],
      [x, 1450, 620],
      [x - end * 62, 1450, 620],
      [x - end * 62, -1450, 620],
    ], wallRim, '#8797aa');
  }
  context.save();
  context.strokeStyle = 'rgba(174,190,210,.18)';
  context.lineWidth = 2;
  for (let x = -2100; x <= 2100; x += 350) {
    for (const y of [-1450, 1450]) {
      const [bottomX, bottomY] = project(x, y, 0);
      const [topX, topY] = project(x, y, 620);
      context.beginPath();
      context.moveTo(bottomX, bottomY);
      context.lineTo(topX, topY);
      context.stroke();
    }
  }
  for (let y = -1150; y <= 1150; y += 350) {
    for (const x of [-2320, 2320]) {
      const [bottomX, bottomY] = project(x, y, 0);
      const [topX, topY] = project(x, y, 620);
      context.beginPath();
      context.moveTo(bottomX, bottomY);
      context.lineTo(topX, topY);
      context.stroke();
    }
  }
  context.restore();

  const drawSpectator = (x: number, y: number, z: number, index: number) => {
    const [screenX, screenY, scale] = project(x, y, z);
    if (screenX < -12 || screenX > 912 || screenY < -12 || screenY > 532) return;
    const head = Math.max(1.1, Math.min(3.1, scale * 9));
    const bodyWidth = head * 1.25;
    const bodyHeight = head * 2.1;
    context.fillStyle = audienceColors[index % audienceColors.length];
    context.fillRect(screenX - bodyWidth / 2, screenY + head * 0.5, bodyWidth, bodyHeight);
    context.beginPath();
    context.arc(screenX, screenY, head, 0, Math.PI * 2);
    context.fill();
    if (index % 5 === 0) {
      context.beginPath();
      context.moveTo(screenX - bodyWidth * 0.38, screenY + head);
      context.lineTo(screenX - bodyWidth * 1.15, screenY - head * 0.6);
      context.moveTo(screenX + bodyWidth * 0.38, screenY + head);
      context.lineTo(screenX + bodyWidth * 1.15, screenY - head * 0.6);
      context.strokeStyle = audienceColors[(index + 2) % audienceColors.length];
      context.lineWidth = Math.max(0.8, head * 0.45);
      context.lineCap = 'round';
      context.stroke();
    }
  };

  let spectatorIndex = 0;
  for (let row = 0; row < 7; row += 1) {
    const z = 38 + row * 30;
    const offset = row % 2 ? 45 : 0;
    for (let column = 0; column < 39; column += 1) {
      const x = -2050 + column * 108 + offset;
      drawSpectator(x, -790 - row * 92, z, spectatorIndex++);
      drawSpectator(x, 790 + row * 92, z, spectatorIndex++);
    }
    for (let column = 0; column < 15; column += 1) {
      const y = -690 + column * 96 + offset;
      drawSpectator(-1510 - row * 92, y, z, spectatorIndex++);
      drawSpectator(1510 + row * 92, y, z, spectatorIndex++);
    }
  }

  context.save();
  context.strokeStyle = 'rgba(179,203,226,.24)';
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(450, 74, 425, 175, 0, Math.PI, Math.PI * 2);
  context.stroke();
  context.strokeStyle = 'rgba(228,240,255,.42)';
  context.lineWidth = 1;
  for (const x of [95, 275, 625, 805]) {
    context.beginPath();
    context.moveTo(x - 20, 26);
    context.lineTo(x + 20, 26);
    context.stroke();
    const glow = context.createRadialGradient(x, 33, 1, x, 33, 45);
    glow.addColorStop(0, 'rgba(255,249,215,.28)');
    glow.addColorStop(1, 'rgba(255,249,215,0)');
    context.fillStyle = glow;
    context.fillRect(x - 45, 10, 90, 54);
  }
  context.restore();
}

function renderStaticScene(
  context: CanvasRenderingContext2D,
  surface: Te4CourtSurface,
  camera: LiveCourtCamera,
  zoom: number,
  stadium: boolean,
) {
  const width = context.canvas.width;
  const height = context.canvas.height;
  const palette = stadium
    ? {
      hard: { court: '#4c6b99', apron: '#263752' },
      clay: { court: '#9c5a4c', apron: '#353d4c' },
      grass: { court: '#63795b', apron: '#2e3d4b' },
      unknown: { court: '#566b89', apron: '#2a3a52' },
    }[surface]
    : {
      hard: { court: '#6b83a7', apron: '#d4dce8' },
      clay: { court: '#bd715d', apron: '#ebe1d7' },
      grass: { court: '#728d6a', apron: '#e0e6dc' },
      unknown: { court: '#7c91ad', apron: '#e0e6ec' },
    }[surface];

  const rawProject = createCourtProjector(camera, zoom);
  const project: Project = (x, y, z) => rawProject([x, y, z]);
  const polygon = (
    points: LiveCourtWorldPoint[],
    fill: string | null,
    stroke: string | null,
  ) => {
    context.beginPath();
    points.forEach(([x, y, z], index) => {
      const [screenX, screenY] = project(x, y, z);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (stroke) {
      context.strokeStyle = stroke;
      context.stroke();
    }
  };
  const line = (points: LiveCourtWorldPoint[], color: string, widthValue: number) => {
    if (points.length < 2) return;
    context.beginPath();
    points.forEach(([x, y, z], index) => {
      const [screenX, screenY] = project(x, y, z);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    context.strokeStyle = color;
    context.lineWidth = widthValue;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
  };

  context.clearRect(0, 0, width, height);
  if (stadium) drawStadiumCrowd(context, project);
  else {
    context.fillStyle = '#f3dfae';
    context.fillRect(0, 0, width, height);
  }

  polygon([[-1450, -700, 0], [1450, -700, 0], [1450, 700, 0], [-1450, 700, 0]], palette.apron, null);
  polygon([[-1275, -590, 0], [1275, -590, 0], [1275, 590, 0], [-1275, 590, 0]], palette.court, null);
  const fixtureColor = '#53647c';
  const fixtureHighlight = '#9da8b7';
  const drawPlayerBench = (centerX: number) => {
    const benchY = 675;
    for (const x of [centerX - 91, centerX + 91]) {
      for (const y of [benchY - 20, benchY + 20]) {
        line([[x, y, 0], [x, y, 52]], fixtureColor, 4);
      }
    }
    polygon([
      [centerX - 127, benchY - 31, 54],
      [centerX + 127, benchY - 31, 54],
      [centerX + 127, benchY + 31, 54],
      [centerX - 127, benchY + 31, 54],
    ], '#647188', fixtureHighlight);
    polygon([
      [centerX - 127, benchY + 25, 58],
      [centerX + 127, benchY + 25, 58],
      [centerX + 127, benchY + 37, 142],
      [centerX - 127, benchY + 37, 142],
    ], '#45536a', fixtureHighlight);
    line([
      [centerX - 105, benchY - 20, 26],
      [centerX + 105, benchY - 20, 26],
    ], fixtureColor, 5);
    line([
      [centerX - 105, benchY + 20, 26],
      [centerX + 105, benchY + 20, 26],
    ], fixtureColor, 5);
  };
  drawPlayerBench(-240);
  drawPlayerBench(240);

  for (const end of [-1, 1]) {
    const x = end * 1350;
    for (const y of [-94, 94]) {
      line([[x - end * 20, y, 0], [x - end * 20, y, 52]], fixtureColor, 4);
      line([[x + end * 20, y, 0], [x + end * 20, y, 52]], fixtureColor, 4);
    }
    polygon([
      [x - 28, -115, 54],
      [x + 28, -115, 54],
      [x + 28, 115, 54],
      [x - 28, 115, 54],
    ], '#647188', fixtureHighlight);
    polygon([
      [x + end * 28, -115, 58],
      [x + end * 28, 115, 58],
      [x + end * 28, 115, 138],
      [x + end * 28, -115, 138],
    ], '#45536a', fixtureHighlight);
  }

  // Courtside umpire chair and seated official, on the far side of the net.
  line([[0, 630, 0], [0, 630, 164]], fixtureColor, 5);
  line([[0, 692, 0], [0, 692, 164]], fixtureColor, 5);
  polygon([
    [-48, 620, 164],
    [48, 620, 164],
    [48, 700, 164],
    [-48, 700, 164],
  ], '#647188', fixtureHighlight);
  polygon([
    [-40, 700, 170],
    [40, 700, 170],
    [40, 700, 236],
    [-40, 700, 236],
  ], '#45536a', fixtureHighlight);
  polygon([
    [-22, 636, 195],
    [22, 636, 195],
    [18, 660, 235],
    [-18, 660, 235],
  ], '#526d93', null);
  line([[-12, 640, 200], [-22, 610, 168]], '#d2a17f', 5);
  line([[12, 640, 200], [22, 610, 168]], '#d2a17f', 5);
  line([[-12, 640, 194], [-18, 620, 170]], fixtureColor, 6);
  line([[12, 640, 194], [18, 620, 170]], fixtureColor, 6);
  const umpireHead = project(0, 648, 267);
  context.beginPath();
  context.arc(umpireHead[0], umpireHead[1], 7, 0, Math.PI * 2);
  context.fillStyle = '#d2a17f';
  context.fill();
  context.strokeStyle = '#353744';
  context.lineWidth = 2;
  context.stroke();
  if (surface === 'grass') {
    for (let y = -520; y < 560; y += 180) {
      polygon([[-1270, y, 0], [1270, y, 0], [1270, y + 78, 0], [-1270, y + 78, 0]], 'rgba(255,255,255,.055)', null);
    }
  }

  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const lineColor = 'rgba(250,252,255,.94)';
  [
    [-1189, -549, 1189, -549],
    [-1189, 549, 1189, 549],
    [-1189, -411, 1189, -411],
    [-1189, 411, 1189, 411],
    [-1189, -549, -1189, 549],
    [1189, -549, 1189, 549],
    [-640, -411, -640, 411],
    [640, -411, 640, 411],
    [-640, 0, 640, 0],
  ].forEach(([x1, y1, x2, y2]) => {
    polygon([[x1, y1, 0], [x2, y2, 0]], null, lineColor);
  });
  polygon([[0, -549, 0], [0, 549, 0], [0, 549, 107], [0, -549, 107]], 'rgba(255,255,255,.18)', lineColor);
  for (let y = -540; y <= 540; y += 54) {
    line([[0, y, 8], [0, y, 100]], 'rgba(241,246,250,.34)', 0.8);
  }
  for (let z = 16; z <= 96; z += 16) {
    line([[0, -549, z], [0, 549, z]], 'rgba(241,246,250,.3)', 0.8);
  }
  line([[0, -560, 0], [0, -560, 120]], '#edf3f7', 3);
  line([[0, 560, 0], [0, 560, 120]], '#edf3f7', 3);
}

export function drawLiveCourtBackdrop(
  context: CanvasRenderingContext2D,
  surface: Te4CourtSurface,
  camera: LiveCourtCamera,
  zoom: number,
  stadium: boolean,
) {
  const canvas = context.canvas;
  const key = `${surface}:${camera.azimuth}:${camera.elevation}:${zoom}:${stadium}`;
  let cached = backdropCache.get(canvas);
  if (!cached || cached.key !== key || cached.canvas.width !== canvas.width || cached.canvas.height !== canvas.height) {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const layerContext = layer.getContext('2d');
    if (!layerContext) return;
    renderStaticScene(layerContext, surface, camera, zoom, stadium);
    cached = { key, canvas: layer };
    backdropCache.set(canvas, cached);
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(cached.canvas, 0, 0);
}

export function drawLiveCourtCrowdMotion(
  context: CanvasRenderingContext2D,
  project: Project,
  timestampMs: number,
) {
  context.save();
  context.lineCap = 'round';
  for (let index = 0; index < 24; index += 1) {
    const column = index % 12;
    const row = Math.floor(index / 12);
    const x = -1700 + column * 305;
    const y = row === 0 ? -820 - (column % 3) * 96 : 820 + (column % 3) * 96;
    const z = 55 + (column % 3) * 30;
    const phase = index * 0.71;
    const cheer = 0.5 + 0.5 * Math.sin(timestampMs * 0.003 + phase);
    const [screenX, screenY, scale] = project(x, y, z);
    if (screenX < -10 || screenX > 910 || screenY < -10 || screenY > 530) continue;
    const armLength = Math.max(2, Math.min(8, scale * (12 + cheer * 20)));
    const shoulderY = screenY + Math.max(1, scale * 3);
    context.beginPath();
    context.moveTo(screenX - 1, shoulderY);
    context.lineTo(screenX - armLength, shoulderY - armLength);
    context.moveTo(screenX + 1, shoulderY);
    context.lineTo(screenX + armLength, shoulderY - armLength);
    context.strokeStyle = audienceColors[(index + 1) % audienceColors.length];
    context.lineWidth = Math.max(0.8, scale * 2);
    context.stroke();
  }
  context.restore();
}
