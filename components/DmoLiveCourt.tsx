'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { TE4_DMO_FRAMES_PER_SECOND } from '@/lib/te4DmoLive';
import type { Te4DmoReplaySpeed, Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { Te4CourtSurface } from '@/lib/te4DmoTypes';
import {
  createCourtProjector,
  findCourtRacketContact,
  type LiveCourtCamera,
  type LiveCourtProjectedPoint,
  type LiveCourtWorldPoint,
} from '@/lib/liveCourtProjection';
import {
  advanceLiveCourtPlayhead,
  interpolateLiveCourtFrame,
  latestLiveCourtMotionEvent,
  mergeLiveCourtEvents,
  mergeLiveCourtSamples,
  type LiveCourtCoordinates,
  type LiveCourtMotionEvent,
  type LiveCourtSample,
} from '@/lib/liveCourtMotion';
import styles from './DmoLiveCourt.module.css';

type WorldPoint = LiveCourtWorldPoint;
type ProjectedPoint = LiveCourtProjectedPoint;
type Props = {
  snapshot: Te4LiveSnapshot;
  surface: Te4CourtSurface;
  playbackSpeed: Te4DmoReplaySpeed;
};

const surfacePalette: Record<Te4CourtSurface, { court: string; apron: string }> = {
  hard: { court: '#28779b', apron: '#c8d7e0' },
  clay: { court: '#b55f3d', apron: '#d3a27f' },
  grass: { court: '#367b45', apron: '#294c32' },
  unknown: { court: '#526b79', apron: '#aebbc2' },
};

function normalize3(vector: WorldPoint): WorldPoint {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function drawScene(
  context: CanvasRenderingContext2D,
  samples: LiveCourtSample[],
  trajectoryEvents: LiveCourtMotionEvent[],
  players: [string, string],
  surface: Te4CourtSurface,
  camera: LiveCourtCamera,
  zoom: number,
  cursor: number,
  playbackSpeed: Te4DmoReplaySpeed,
) {
  const width = 900;
  const height = 520;
  const palette = surfacePalette[surface];
  context.clearRect(0, 0, width, height);
  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#0a1524');
  backdrop.addColorStop(1, '#192430');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const rawProject = createCourtProjector(camera, zoom);
  const project = (x: number, y: number, z: number): ProjectedPoint => rawProject([x, y, z]);
  const polygon = (
    points: WorldPoint[],
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

  const line = (points: WorldPoint[], color: string, widthValue: number) => {
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

  const drawFigure = (
    x: number,
    y: number,
    z: number,
    figureHeight: number,
    color: string,
    across: 'x' | 'y',
    wave = false,
    skinColor = '#d6a77e',
  ) => {
    const acrossPoint = (offset: number, at: number): WorldPoint => (
      across === 'x' ? [x + offset, y, z + at] : [x, y + offset, z + at]
    );
    const widthValue = figureHeight * 0.32;
    const shoulderLeft = acrossPoint(-widthValue * 0.45, figureHeight * 0.72);
    const shoulderRight = acrossPoint(widthValue * 0.45, figureHeight * 0.72);
    const hipLeft = acrossPoint(-widthValue * 0.3, figureHeight * 0.4);
    const hipRight = acrossPoint(widthValue * 0.3, figureHeight * 0.4);
    const footLeft = acrossPoint(-widthValue * 0.32, 0);
    const footRight = acrossPoint(widthValue * 0.32, 0);
    const kneeLeft = acrossPoint(-widthValue * 0.28, figureHeight * 0.2);
    const kneeRight = acrossPoint(widthValue * 0.28, figureHeight * 0.2);
    const [, , scale] = project(x, y, z);
    const limbWidth = Math.max(1.6, figureHeight * scale * 0.095);
    const limb = (points: WorldPoint[]) => {
      line(points, 'rgba(15,25,36,.88)', limbWidth + 1.8);
      line(points, skinColor, limbWidth);
    };
    const leftElbow = acrossPoint(-widthValue * 0.68, figureHeight * 0.52);
    const rightElbow = acrossPoint(widthValue * 0.68, figureHeight * 0.54);
    const leftHand = acrossPoint(-widthValue * 0.72, figureHeight * (wave ? 0.98 : 0.32));
    const rightHand = acrossPoint(widthValue * 0.72, figureHeight * 0.34);
    polygon([
      shoulderLeft,
      shoulderRight,
      acrossPoint(widthValue * 0.4, figureHeight * 0.57),
      hipRight,
      hipLeft,
      acrossPoint(-widthValue * 0.4, figureHeight * 0.57),
    ], color, 'rgba(15,25,36,.82)');
    limb([hipLeft, kneeLeft, footLeft]);
    limb([hipRight, kneeRight, footRight]);
    limb([shoulderLeft, leftElbow, leftHand]);
    limb([shoulderRight, rightElbow, rightHand]);
    const [headX, headY, headScale] = project(x, y, z + figureHeight * 0.88);
    const headRadius = Math.max(1.8, figureHeight * headScale * 0.105);
    context.fillStyle = skinColor;
    context.beginPath();
    context.arc(headX, headY, headRadius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#26323f';
    context.beginPath();
    context.arc(headX, headY - Math.max(1, figureHeight * headScale * 0.025), headRadius, Math.PI, Math.PI * 2);
    context.fill();
  };

  const crowdColors = ['#d1d7dc', '#e29b62', '#8ca9c0', '#b7c984', '#9e91c8', '#d77f78', '#e0d4b6'];
  const crowdSkinTones = ['#f0c8a7', '#d6a77e', '#bd8967', '#9b6c51'];
  polygon([[-1650, 700, 0], [1650, 700, 0], [1650, 1080, 320], [-1650, 1080, 320]], '#263646', '#526579');
  polygon([[-1650, -700, 0], [1650, -700, 0], [1650, -1080, 320], [-1650, -1080, 320]], '#263646', '#526579');
  polygon([[1450, -760, 0], [1450, 760, 0], [1850, 760, 300], [1850, -760, 300]], '#202f40', '#526579');
  polygon([[-1450, -760, 0], [-1450, 760, 0], [-1850, 760, 300], [-1850, -760, 300]], '#202f40', '#526579');
  for (let row = 1; row <= 3; row += 1) {
    const offset = 700 + row * 95;
    const railHeight = row * 80;
    line([[-1580, offset, railHeight], [1580, offset, railHeight]], 'rgba(201,216,232,.23)', 1.4);
    line([[-1580, -offset, railHeight], [1580, -offset, railHeight]], 'rgba(201,216,232,.23)', 1.4);
  }
  for (let row = 0; row < 4; row += 1) {
    for (let seat = 0; seat < 34; seat += 1) {
      const x = -1450 + seat * 86 + (row % 2) * 43;
      const z = 20 + row * 46;
      const y = 755 + row * 82;
      const colorIndex = (seat * 3 + row * 5) % crowdColors.length;
      const skinIndex = (seat * 5 + row * 3) % crowdSkinTones.length;
      drawFigure(x, y, z, 86, crowdColors[colorIndex], 'x', (seat + row * 4) % 11 === 0, crowdSkinTones[skinIndex]);
      drawFigure(
        x,
        -y,
        z,
        86,
        crowdColors[(seat * 5 + row * 2 + 1) % crowdColors.length],
        'x',
        (seat + row * 3) % 13 === 0,
        crowdSkinTones[(skinIndex + 2) % crowdSkinTones.length],
      );
    }
    for (let seat = 0; seat < 16; seat += 1) {
      const y = -640 + seat * 84;
      const z = 20 + row * 46;
      const x = 1485 + row * 88;
      const skinIndex = (seat * 3 + row * 7) % crowdSkinTones.length;
      drawFigure(
        x,
        y,
        z,
        86,
        crowdColors[(seat * 2 + row * 3) % crowdColors.length],
        'y',
        (seat + row) % 10 === 0,
        crowdSkinTones[skinIndex],
      );
      drawFigure(
        -x,
        y,
        z,
        86,
        crowdColors[(seat * 4 + row + 2) % crowdColors.length],
        'y',
        (seat + row * 2) % 12 === 0,
        crowdSkinTones[(skinIndex + 1) % crowdSkinTones.length],
      );
    }
  }

  polygon([[-1450, -700, 0], [1450, -700, 0], [1450, 700, 0], [-1450, 700, 0]], palette.apron, null);
  polygon([[-1275, -590, 0], [1275, -590, 0], [1275, 590, 0], [-1275, 590, 0]], palette.court, null);
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

  line([[0, 610, 0], [0, 610, 290]], '#d9e1e9', 5);
  polygon([[-42, 590, 250], [42, 590, 250], [42, 630, 250], [-42, 630, 250]], '#e4e9ee', '#17212b');
  drawFigure(0, 610, 275, 118, '#edf2f6', 'x');
  for (const x of [-1_240, 1_240]) {
    for (const y of [-570, 570]) drawFigure(x, y, 0, 126, '#f2f0df', 'y');
  }
  for (const y of [-575, 575]) drawFigure(0, y, 0, 108, '#d9e7f2', 'x');

  if (!samples.length) {
    context.fillStyle = 'rgba(8,19,40,.72)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#f1f5fb';
    context.font = '700 18px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('Waiting for court positions', width / 2, height / 2);
    return;
  }

  const current = interpolateLiveCourtFrame(
    samples,
    cursor,
    TE4_DMO_FRAMES_PER_SECOND * playbackSpeed / 2,
  );
  if (!current) return;
  const value = (index: number) => current[index];
  const ball = { x: value(0), y: value(1), z: Math.max(0, value(2)) };
  const activeTrajectory = latestLiveCourtMotionEvent(trajectoryEvents, cursor);
  if (activeTrajectory?.kind === 'shot') {
    const trailStart = Math.max(
      activeTrajectory.frame,
      cursor - TE4_DMO_FRAMES_PER_SECOND * 0.25 * playbackSpeed,
    );
    const trail = samples
      .filter((sample) => sample.frame >= trailStart && sample.frame <= cursor)
      .map((sample) => project(sample.values[0], sample.values[1], sample.values[2]));
    const lastSample = samples[samples.length - 1];
    if (cursor > lastSample.frame) trail.push(project(ball.x, ball.y, ball.z));
    for (let index = 1; index < trail.length; index += 1) {
      const opacity = 0.1 + 0.48 * index / Math.max(1, trail.length - 1);
      context.beginPath();
      context.moveTo(trail[index - 1][0], trail[index - 1][1]);
      context.lineTo(trail[index][0], trail[index][1]);
      context.strokeStyle = `rgba(250,204,21,${opacity.toFixed(3)})`;
      context.lineWidth = 1.4 + opacity;
      context.shadowColor = 'rgba(250,204,21,.2)';
      context.shadowBlur = 2;
      context.stroke();
    }
    context.shadowBlur = 0;
  }

  const [ballShadowX, ballShadowY, ballScale] = project(ball.x, ball.y, 0);
  const [ballX, ballY] = project(ball.x, ball.y, ball.z);
  context.fillStyle = 'rgba(0,0,0,.3)';
  context.beginPath();
  context.ellipse(ballShadowX, ballShadowY, 5 * ballScale, 3 * ballScale, 0, 0, Math.PI * 2);
  context.fill();

  const playerActors = [
    { x: value(3), y: value(4), color: '#eaa134', name: players[0], id: 1 as const },
    { x: value(5), y: value(6), color: '#e05d64', name: players[1], id: 2 as const },
  ];
  const contactPlayer = findCourtRacketContact(ball, playerActors, activeTrajectory, cursor);

  const drawPlayer = (player: typeof playerActors[number]) => {
    const { x, y, color, name, id } = player;
    const towardBall = normalize3([ball.x - x, ball.y - y, 0]);
    const facing: WorldPoint = Math.hypot(ball.x - x, ball.y - y) > 1
      ? towardBall
      : [id === 1 ? 1 : -1, 0, 0];
    const across: WorldPoint = [-facing[1], facing[0], 0];
    const point = (acrossOffset: number, forwardOffset: number, z: number): WorldPoint => [
      x + across[0] * acrossOffset + facing[0] * forwardOffset,
      y + across[1] * acrossOffset + facing[1] * forwardOffset,
      z,
    ];
    const limb = (start: WorldPoint, end: WorldPoint, limbColor: string, thickness: number) => {
      const scale = (project(...start)[2] + project(...end)[2]) / 2;
      line([start, end], '#17212b', Math.max(2.8, thickness * scale + 3));
      line([start, end], limbColor, Math.max(1.8, thickness * scale));
    };
    const joint = (center: WorldPoint, radius: number, fill: string) => {
      const [jointX, jointY, scale] = project(...center);
      const jointRadius = Math.max(2.5, radius * scale);
      context.beginPath();
      context.arc(jointX, jointY, jointRadius + 1, 0, Math.PI * 2);
      context.fillStyle = '#17212b';
      context.fill();
      context.beginPath();
      context.arc(jointX, jointY, jointRadius, 0, Math.PI * 2);
      context.fillStyle = fill;
      context.fill();
    };
    const shoulderLeft = point(-28, 0, 134);
    const shoulderRight = point(28, 0, 134);
    const hipLeft = point(-19, -2, 78);
    const hipRight = point(19, -2, 78);
    const kneeLeft = point(-22, 12, 40);
    const kneeRight = point(22, -8, 40);
    const footLeft = point(-24, 18, 5);
    const footRight = point(24, -14, 5);
    const skin = '#d9ad8e';
    const shorts = id === 1 ? '#16566b' : '#743747';
    const torso = [
      shoulderLeft,
      shoulderRight,
      point(22, 0, 120),
      point(20, -2, 101),
      point(18, -2, 82),
      point(-18, -2, 82),
      point(-20, -2, 101),
      point(-22, 0, 120),
    ];
    const [groundX, groundY, groundScale] = project(x, y, 0);
    context.fillStyle = 'rgba(0,0,0,.28)';
    context.beginPath();
    context.ellipse(groundX, groundY, 35 * groundScale, 18 * groundScale, 0, 0, Math.PI * 2);
    context.fill();
    limb(hipLeft, kneeLeft, skin, 21);
    limb(kneeLeft, footLeft, skin, 17);
    limb(hipRight, kneeRight, skin, 21);
    limb(kneeRight, footRight, skin, 17);
    joint(kneeLeft, 9, skin);
    joint(kneeRight, 9, skin);
    limb(footLeft, point(-24, 40, 3), '#f2f4f7', 16);
    limb(footRight, point(24, 8, 3), '#f2f4f7', 16);
    polygon([
      point(-8, 4, 153),
      point(8, 4, 153),
      point(9, 4, 132),
      point(-9, 4, 132),
    ], skin, null);
    polygon(torso, color, '#17212b');
    line([point(-15, 1, 117), point(15, 1, 117)], 'rgba(255,255,255,.5)', 2.4);
    polygon([hipLeft, hipRight, point(15, 8, 55), point(-15, 8, 55)], shorts, '#17212b');
    line([point(-16, 8, 73), point(16, 8, 73)], 'rgba(255,255,255,.3)', 1.8);

    const head = point(0, 9, 164);
    const [headX, headY, headScale] = project(...head);
    const headRadius = Math.max(4.8, 11 * headScale);
    context.fillStyle = skin;
    context.beginPath();
    context.arc(headX, headY, headRadius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#17212b';
    context.lineWidth = Math.max(1, headScale * 3);
    context.stroke();
    const [hairX, hairY] = project(head[0], head[1], head[2] + 3);
    context.fillStyle = '#26313c';
    context.beginPath();
    context.ellipse(hairX, hairY, headRadius * 0.92, headRadius * 0.48, 0, Math.PI, Math.PI * 2);
    context.fill();

    const isHitting = contactPlayer === id;
    const racketDirection: WorldPoint = isHitting
      ? normalize3([ball.x - shoulderRight[0], ball.y - shoulderRight[1], ball.z - shoulderRight[2]])
      : normalize3([facing[0] + across[0] * 0.2, facing[1] + across[1] * 0.2, 0.28]);
    const racketLength = 56;
    const racketCenter: WorldPoint = isHitting
      ? [ball.x, ball.y, ball.z]
      : [
        shoulderRight[0] + facing[0] * 82 + across[0] * 16,
        shoulderRight[1] + facing[1] * 82 + across[1] * 16,
        108,
      ];
    const hand: WorldPoint = isHitting
      ? [
        racketCenter[0] - racketDirection[0] * racketLength,
        racketCenter[1] - racketDirection[1] * racketLength,
        racketCenter[2] - racketDirection[2] * racketLength,
      ]
      : [
        shoulderRight[0] + facing[0] * 27 + across[0] * 13,
        shoulderRight[1] + facing[1] * 27 + across[1] * 13,
        105,
      ];
    const elbow: WorldPoint = [
      (shoulderRight[0] + hand[0]) / 2 + across[0] * 12,
      (shoulderRight[1] + hand[1]) / 2 + across[1] * 12,
      (shoulderRight[2] + hand[2]) / 2 - 6,
    ];
    const freeElbow = point(-39, 18, 105);
    const freeHand = point(-51, 26, 89);
    limb(shoulderLeft, freeElbow, skin, 16);
    limb(freeElbow, freeHand, skin, 14);
    limb(shoulderRight, elbow, skin, 16);
    limb(elbow, hand, skin, 14);
    joint(freeElbow, 7, skin);
    joint(elbow, 7, skin);
    joint(freeHand, 6, skin);
    joint(hand, 6, skin);
    line([hand, racketCenter], '#dce4eb', Math.max(1.2, racketLength * headScale * 0.045));

    const racketAcross: WorldPoint = across;
    const racketRadius = 14;
    const racketHalfHeight = 20;
    const framePoints: WorldPoint[] = [];
    for (let step = 0; step <= 20; step += 1) {
      const angle = step * Math.PI * 2 / 20;
      framePoints.push([
        racketCenter[0] + racketAcross[0] * racketRadius * Math.cos(angle),
        racketCenter[1] + racketAcross[1] * racketRadius * Math.cos(angle),
        racketCenter[2] + racketHalfHeight * Math.sin(angle),
      ]);
    }
    line(framePoints, '#e9eef4', Math.max(1.2, racketRadius * headScale * 0.08));
    for (let strand = -2; strand <= 2; strand += 1) {
      const offset = strand * 4.5;
      const halfSpan = racketRadius * Math.sqrt(Math.max(0, 1 - (offset / racketRadius) ** 2));
      line([
        [racketCenter[0] - racketAcross[0] * halfSpan, racketCenter[1] - racketAcross[1] * halfSpan, racketCenter[2] + offset],
        [racketCenter[0] + racketAcross[0] * halfSpan, racketCenter[1] + racketAcross[1] * halfSpan, racketCenter[2] + offset],
      ], 'rgba(31,43,54,.72)', Math.max(0.7, headScale * 2));
    }
    if (isHitting) {
      const [contactX, contactY] = project(ball.x, ball.y, ball.z);
      context.beginPath();
      context.arc(contactX, contactY, Math.max(5, 16 * headScale), 0, Math.PI * 2);
      context.strokeStyle = 'rgba(245,216,91,.82)';
      context.lineWidth = 1.5;
      context.stroke();
    }

    context.font = `700 ${Math.max(9, 8 + headScale * 8)}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(12,20,29,.82)';
    context.strokeText(name, headX, headY - headRadius - 4);
    context.fillStyle = '#ffffff';
    context.fillText(name, headX, headY - headRadius - 4);
  };

  playerActors
    .sort((a, b) => project(b.x, b.y, 0)[3] - project(a.x, a.y, 0)[3])
    .forEach(drawPlayer);
  const ballRadius = Math.max(1.8, 3.4 * ballScale);
  context.fillStyle = '#e8f84a';
  context.strokeStyle = '#f6ff9c';
  context.lineWidth = 1;
  context.shadowColor = 'rgba(232,248,74,.65)';
  context.shadowBlur = contactPlayer ? 8 : 3;
  context.beginPath();
  context.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
}

function playSynthesizedCue(context: AudioContext, kind: 'racket' | 'bounce') {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const racket = kind === 'racket';
  oscillator.type = racket ? 'triangle' : 'sine';
  oscillator.frequency.setValueAtTime(racket ? 720 : 390, now);
  oscillator.frequency.exponentialRampToValueAtTime(racket ? 260 : 150, now + (racket ? 0.055 : 0.09));
  gain.gain.setValueAtTime(racket ? 0.035 : 0.028, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (racket ? 0.06 : 0.1));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (racket ? 0.06 : 0.1));
}

function DmoLiveCourt({ snapshot, surface, playbackSpeed }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraDragRef = useRef<{ x: number; y: number } | null>(null);
  const sampleBufferRef = useRef<LiveCourtSample[]>([]);
  const trajectoryEventsRef = useRef<LiveCourtMotionEvent[]>([]);
  const playheadRef = useRef<number | null>(null);
  const previousSnapshotRef = useRef({
    filename: snapshot.filename,
    players: snapshot.players,
    frameCount: snapshot.frameCount,
  });
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastSoundFrameRef = useRef(Math.max(0, snapshot.frameCount - 3));
  const playedSoundEventsRef = useRef(new Set<string>());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundError, setSoundError] = useState('');
  const sceneRef = useRef({
    samples: sampleBufferRef.current,
    trajectoryEvents: trajectoryEventsRef.current,
    players: snapshot.players,
    surface,
    playbackSpeed,
    camera: { azimuth: 42, elevation: 38 },
    zoom: 1,
  });
  const [cameraAzimuth, setCameraAzimuth] = useState(42);
  const [cameraElevation, setCameraElevation] = useState(38);
  const [zoom, setZoom] = useState(1);
  sceneRef.current = {
    samples: sampleBufferRef.current,
    trajectoryEvents: trajectoryEventsRef.current,
    players: snapshot.players,
    surface,
    playbackSpeed,
    camera: { azimuth: cameraAzimuth, elevation: cameraElevation },
    zoom,
  };

  useEffect(() => {
    const previousSnapshot = previousSnapshotRef.current;
    const identityChanged = snapshot.filename !== previousSnapshot.filename
      || snapshot.players[0] !== previousSnapshot.players[0]
      || snapshot.players[1] !== previousSnapshot.players[1]
      || snapshot.frameCount < previousSnapshot.frameCount;
    if (identityChanged) {
      sampleBufferRef.current = [];
      trajectoryEventsRef.current = [];
      playheadRef.current = null;
    }
    previousSnapshotRef.current = {
      filename: snapshot.filename,
      players: snapshot.players,
      frameCount: snapshot.frameCount,
    };

    const courtFrameCount = Math.max(
      1,
      Math.floor(snapshot.courtFrameCount ?? snapshot.court.length),
    );
    const firstFrame = Math.max(0, snapshot.frameCount - courtFrameCount);
    const incomingSamples: LiveCourtSample[] = snapshot.court.flatMap((frame, index) => {
      if (frame.length < 7 || !frame.slice(0, 7).every(Number.isFinite)) return [];
      const frameIndex = snapshot.courtFrameIndices?.[index]
        ?? firstFrame + Math.round(
          index * Math.max(0, courtFrameCount - 1) / Math.max(1, snapshot.court.length - 1),
        );
      const values = frame.slice(0, 7) as LiveCourtCoordinates;
      return [{ frame: frameIndex, values }];
    });
    const maxFrameSpan = TE4_DMO_FRAMES_PER_SECOND * 10 * playbackSpeed;
    sampleBufferRef.current = mergeLiveCourtSamples(
      sampleBufferRef.current,
      incomingSamples,
      maxFrameSpan,
    );
    const earliestFrame = sampleBufferRef.current[0]?.frame ?? firstFrame;
    trajectoryEventsRef.current = mergeLiveCourtEvents(
      trajectoryEventsRef.current,
      snapshot.trajectoryEvents ?? [],
      earliestFrame,
    );
    if (playheadRef.current === null && sampleBufferRef.current.length) {
      playheadRef.current = sampleBufferRef.current[0].frame;
    } else if (playheadRef.current !== null && playheadRef.current < earliestFrame) {
      playheadRef.current = earliestFrame;
    }
    sceneRef.current = {
      ...sceneRef.current,
      samples: sampleBufferRef.current,
      trajectoryEvents: trajectoryEventsRef.current,
    };
  }, [snapshot, playbackSpeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let animation = 0;
    let lastTime = performance.now();
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const tick = (now: number) => {
      const elapsed = Math.min(80, Math.max(0, now - lastTime));
      lastTime = now;
      const current = sceneRef.current;
      const samples = current.samples;
      if (!motionPreference.matches && samples.length > 1) {
        playheadRef.current = advanceLiveCourtPlayhead(
          playheadRef.current,
          elapsed,
          current.playbackSpeed,
          samples,
          TE4_DMO_FRAMES_PER_SECOND,
        );
      }
      const cursor = motionPreference.matches
        ? samples[samples.length - 1]?.frame ?? 0
        : playheadRef.current ?? samples[0]?.frame ?? 0;
      drawScene(
        context,
        samples,
        current.trajectoryEvents,
        current.players,
        current.surface,
        current.camera,
        current.zoom,
        cursor,
        current.playbackSpeed,
      );
      animation = window.requestAnimationFrame(tick);
    };
    animation = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animation);
  }, []);

  useEffect(() => {
    if (!soundEnabled) return;
    const context = audioContextRef.current;
    if (!context || context.state !== 'running') return;
    if (snapshot.frameCount < lastSoundFrameRef.current) {
      playedSoundEventsRef.current.clear();
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
    }

    for (const event of snapshot.soundEvents ?? []) {
      const key = `${event.frame}:${event.kind}`;
      if (event.frame < lastSoundFrameRef.current || playedSoundEventsRef.current.has(key)) continue;
      playSynthesizedCue(context, event.kind);
      playedSoundEventsRef.current.add(key);
    }
    lastSoundFrameRef.current = Math.max(lastSoundFrameRef.current, snapshot.frameCount - 3);

    const oldestRetainedFrame = snapshot.frameCount - 600;
    for (const key of playedSoundEventsRef.current) {
      if (Number(key.slice(0, key.indexOf(':'))) < oldestRetainedFrame) {
        playedSoundEventsRef.current.delete(key);
      }
    }
  }, [snapshot.frameCount, snapshot.soundEvents, soundEnabled]);

  useEffect(() => () => {
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const toggleSound = async () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      return;
    }
    try {
      if (!audioContextRef.current) audioContextRef.current = new AudioContext();
      await audioContextRef.current.resume();
      lastSoundFrameRef.current = Math.max(0, snapshot.frameCount - 3);
      setSoundError('');
      setSoundEnabled(true);
    } catch {
      setSoundError('Sound could not be enabled in this browser.');
    }
  };

  return (
    <section className={styles.scene} aria-label="Live court view">
      <div className={styles.sceneToolbar}>
        <div className={styles.sceneTitle}>
          <strong>LIVE COURT</strong>
        </div>
        <div className={styles.sceneControls}>
          <label className={styles.cameraControl}>
            <span>ORBIT</span>
            <input
              aria-label="Camera orbit angle"
              type="range"
              min="0"
              max="359"
              step="1"
              value={cameraAzimuth}
              onChange={(event) => setCameraAzimuth(Number(event.currentTarget.value))}
            />
            <output>{Math.round(cameraAzimuth)}°</output>
          </label>
          <label className={styles.cameraControl}>
            <span>ELEVATION</span>
            <input
              aria-label="Camera elevation"
              type="range"
              min="5"
              max="90"
              step="1"
              value={cameraElevation}
              onChange={(event) => setCameraElevation(Number(event.currentTarget.value))}
            />
            <output>{cameraElevation}°</output>
          </label>
          <button
            type="button"
            aria-label="Reset court camera"
            title="Reset court camera"
            onClick={() => {
              setCameraAzimuth(42);
              setCameraElevation(38);
              setZoom(1);
            }}
          >
            <RotateCcw size={14} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))}>
            <Minus size={15} />
          </button>
          <input
            className={styles.zoomRange}
            aria-label="Court zoom"
            type="range"
            min="0.7"
            max="1.8"
            step="0.1"
            value={zoom}
            onChange={(event) => setZoom(Number(event.currentTarget.value))}
          />
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, Math.round((value + 0.1) * 10) / 10))}>
            <Plus size={15} />
          </button>
          <output>{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label={soundEnabled ? 'Mute synthesized court sounds' : 'Enable synthesized court sounds'}
            aria-pressed={soundEnabled}
            title={soundEnabled ? 'Mute synthesized court sounds' : 'Enable synthesized court sounds'}
            onClick={() => void toggleSound()}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
        </div>
      </div>
      <div className={styles.viewport}>
        <canvas
          ref={canvasRef}
          width={900}
          height={520}
          role="img"
          aria-label={`Interactive tennis court with ${snapshot.players[0]} and ${snapshot.players[1]}; drag to orbit the camera`}
          title="Drag to rotate the camera"
          onPointerDown={(event) => {
            cameraDragRef.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const previous = cameraDragRef.current;
            if (!previous) return;
            const deltaX = event.clientX - previous.x;
            const deltaY = event.clientY - previous.y;
            setCameraAzimuth((value) => {
              const next = (value + deltaX * 0.55) % 360;
              return Math.round((next + 360) % 360);
            });
            setCameraElevation((value) => Math.max(5, Math.min(90, Math.round(value - deltaY * 0.35))));
            cameraDragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={() => { cameraDragRef.current = null; }}
          onPointerCancel={() => { cameraDragRef.current = null; }}
        />
      </div>
      <div className={styles.legend}>
        <span><i className={styles.playerOne} />{snapshot.players[0]}</span>
        <span><i className={styles.playerTwo} />{snapshot.players[1]}</span>
        <span><i className={styles.ball} />Ball</span>
        <span className={styles.sceneNote}>Drag to orbit · adjust angle and elevation</span>
      </div>
      {soundError && <p role="status">{soundError}</p>}
    </section>
  );
}

export default memo(DmoLiveCourt);
