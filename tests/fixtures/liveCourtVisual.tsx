/** Local-only browser fixture. Not mounted by any application route. */
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import DmoLiveCourt3D from '../../components/DmoLiveCourt3D';
import { makePlayer, poseLimb } from '../../components/DmoLiveCourt3DScene';
import { playLiveCourtEffect } from '../../lib/liveCourtAudio';
import type { Te4LiveSnapshot } from '../../lib/te4DmoLive';

const court: number[][] = [];
const indices: number[] = [];
const events: NonNullable<Te4LiveSnapshot['trajectoryEvents']> = [];
for (let frame = 0; frame < 1200; frame++) {
  const shot = Math.floor(frame / 60);
  const progress = (frame % 60) / 60;
  const direction = shot % 2 === 0 ? 1 : -1;
  const ballX = direction * (-1500 + progress * 3000);
  const ballZ = Math.sin(frame * 0.018) * 260;
  const bounce = progress < 0.72
    ? (1 - progress / 0.72) * (80 + progress * 450)
    : ((progress - 0.72) / 0.28) * 90;
  court.push([ballX, ballZ, bounce + 4, -1600 + Math.sin(frame * 0.008) * 180,
    Math.sin(frame * 0.022) * 220, 1550 + Math.cos(frame * 0.009) * 180,
    -Math.sin(frame * 0.021) * 230]);
  indices.push(frame);
  if (frame % 60 === 0) events.push({
    frame, kind: 'shot', player: shot % 2 === 0 ? 1 : 2,
    shotType: frame % 600 === 0 ? 'serve' : 'rally', speedKmh: 110,
  });
  if (frame === 570) events.push({ frame, kind: 'point-end' });
}
const snapshot = {
  version: 1, filename: 'synthetic-browser-fixture.dmo', players: ['Player One', 'Player Two'],
  stadium: new URLSearchParams(location.search).has('indoor') ? 'Indoor stadium' : 'Philippe Chatrier',
  frameCount: court.length, courtFrameCount: court.length, frameRate: 60,
  court, courtFrameIndices: indices, trajectoryEvents: events,
  // Deliberately no soundEvents: fallback contact derivation is exercised.
} as Te4LiveSnapshot;

function PlayerPortrait() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(900, 800);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa8c8dd);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x596a69, 2));
    const light = new THREE.DirectionalLight(0xfff2df, 3);
    light.position.set(3, 6, 5);
    scene.add(light);
    const rig = makePlayer(0x9bc2bf, 0x203d48, false);
    const rigTwo = makePlayer(0xd77b68, 0x313b50, true);
    [rig, rigTwo].forEach((player, index) => {
      player.root.position.x = index === 0 ? -0.55 : 0.55;
      player.root.rotation.y = index === 0 ? 0.2 : -0.2;
      for (const side of [-1, 1]) {
        const hip = new THREE.Vector3(side * 0.13, 0.90, 0);
        const knee = new THREE.Vector3(side * 0.14, 0.47, 0.03);
        const foot = new THREE.Vector3(side * 0.15, 0.10, 0);
        const shoulder = new THREE.Vector3(side * 0.24, 1.47, 0);
        const elbow = new THREE.Vector3(side * 0.31, 1.17, 0.03);
        const hand = new THREE.Vector3(side * 0.30, 0.94, 0.11);
        const left = side < 0;
        poseLimb(left ? player.leftLeg : player.rightLeg, hip, knee);
        poseLimb(left ? player.leftCalf : player.rightCalf, knee, foot);
        poseLimb(left ? player.leftArm : player.rightArm, shoulder, elbow);
        poseLimb(left ? player.leftForearm : player.rightForearm, elbow, hand);
        (left ? player.leftKnee : player.rightKnee).position.copy(knee);
        (left ? player.leftElbow : player.rightElbow).position.copy(elbow);
        (left ? player.leftHand : player.rightHand).position.copy(hand);
      }
      player.racket.position.copy(player.rightHand.position);
      scene.add(player.root);
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: 0xb57858, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(30, 900 / 800, 0.1, 50);
    camera.position.set(0.2, 1.15, 4.4);
    camera.lookAt(0, 0.95, 0);
    host.current?.append(renderer.domElement);
    renderer.render(scene, camera);
    return () => { renderer.dispose(); renderer.domElement.remove(); };
  }, []);
  return <div ref={host} />;
}

async function checkAudio() {
  const results: Record<string, { rms: number; peak: number }> = {};
  for (const kind of ['racket', 'bounce', 'footstep', 'slide'] as const) {
    const context = new OfflineAudioContext(1, 44100 * 0.6, 44100);
    playLiveCourtEffect(context, kind, 'clay', 0.9);
    const data = (await context.startRendering()).getChannelData(0);
    results[kind] = {
      rms: Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length),
      peak: Math.max(...data.map(Math.abs)),
    };
  }
  Object.assign(window, { courtAudioCheck: results });
  document.documentElement.dataset.audioCheck = JSON.stringify(results);
}
void checkAudio();
function CourtBroadcastReview() {
  return <main style={{ minHeight: '100vh', padding: 12, background: '#09171e', color: '#fff' }}>
    <p style={{ margin: '0 0 10px', font: '13px sans-serif' }}>Local test fixture · synthetic motion, actual production scene</p>
    {new URLSearchParams(location.search).has('portrait') ? <PlayerPortrait />
      : <DmoLiveCourt3D snapshot={snapshot} surface="clay" playbackSpeed={1} fullReplay stadiumAtmosphere />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<CourtBroadcastReview />);
