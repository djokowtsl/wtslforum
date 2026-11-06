/** Standalone static inspection of the production-default skinned player.
 * Synthetic carry targets, NOT evidence of real-replay visual approval.
 * The local harness supplies the real GLB/BVH bytes; no application auth route is changed.
 */
import * as THREE from 'three';
import { attachHumanPlayer, loadHumanModel } from '../../components/DmoHumanModels';
import { makePlayer, poseLimb } from '../../components/DmoLiveCourt3DScene';

declare global {
  interface Window { armVisualAssets: Record<string, string> }
}

const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const name = String(input).split('/').pop()!;
  const base64 = window.armVisualAssets[name];
  if (!base64) return originalFetch(input, init);
  return new Response(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
};

async function main() {
  const template = await loadHumanModel('male', 'player', new AbortController().signal);
  for (const handedness of ['right', 'left'] as const) {
    for (const [label, handY, swing] of [
      ['Walk', 0.74, 0],
      ['Jog / hand forward', 1.1, 0.22],
      ['Jog / hand back', 0.8, -0.16],
    ] as const) {
      const article = document.createElement('article');
      const title = document.createElement('h2');
      title.textContent = `${handedness} handed · ${label}`;
      article.append(title);
      document.body.append(article);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(360, 470);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xcbd3d8);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x626b72, 2));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(3, 5, 4);
      scene.add(light);
      const rig = makePlayer(0x275c77, 0x203d48);
      const dominantSign = handedness === 'right' ? -1 : 1;
      rig.root.userData.dominantHandedness = handedness;
      rig.root.userData.relaxedCarry = 1;
      const shoulder = (sign: number) => new THREE.Vector3(sign * 0.23, 1.44, 0);
      for (const sign of [-1, 1]) {
        const dominant = sign === dominantSign;
        const elbow = new THREE.Vector3(sign * 0.48, 1.23, 0.16);
        const wrist = new THREE.Vector3(sign * 0.25, dominant ? Math.max(0.74, handY) : handY, swing);
        const arm = sign > 0 ? rig.leftArm : rig.rightArm;
        const forearm = sign > 0 ? rig.leftForearm : rig.rightForearm;
        poseLimb(arm, shoulder(sign), elbow);
        poseLimb(forearm, elbow, wrist);
        if (dominant) rig.racket.position.copy(wrist);
        const thigh = sign > 0 ? rig.rightLeg : rig.leftLeg;
        const calf = sign > 0 ? rig.rightCalf : rig.leftCalf;
        const knee = new THREE.Vector3(sign * 0.15, 0.5, 0.02);
        poseLimb(thigh, new THREE.Vector3(sign * 0.13, 0.9, 0), knee);
        poseLimb(calf, knee, new THREE.Vector3(sign * 0.15, 0.12, 0));
      }
      const attached = attachHumanPlayer(template, rig, 0x275c77);
      attached.update();
      scene.add(rig.root);
      const camera = new THREE.PerspectiveCamera(30, 360 / 470, 0.05, 30);
      camera.position.set(handedness === 'right' ? 2.7 : -2.7, 1.9, 4.1);
      camera.lookAt(0, 1.0, 0);
      renderer.render(scene, camera);
      article.append(renderer.domElement);
    }
  }
  document.documentElement.dataset.ready = 'true';
}
main().catch(error => {
  document.body.textContent = String(error?.stack ?? error);
  document.documentElement.dataset.error = String(error);
});
