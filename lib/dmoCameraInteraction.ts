import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** A touch to unlock audio is not a camera edit. Only actual manual motion is. */
export function observeDmoManualCamera(controls: OrbitControls, onMove: () => void) {
  let interacting = false;
  let notified = false;
  const position = controls.object.position.clone();
  const target = controls.target.clone();
  const start = () => {
    interacting = true;
    notified = false;
    position.copy(controls.object.position);
    target.copy(controls.target);
  };
  const change = () => {
    if (!interacting || notified) return;
    if (position.distanceToSquared(controls.object.position) <= 1e-8
      && target.distanceToSquared(controls.target) <= 1e-8) return;
    notified = true;
    onMove();
  };
  const end = () => { interacting = false; };
  controls.addEventListener('start', start);
  controls.addEventListener('change', change);
  controls.addEventListener('end', end);
  return () => {
    controls.removeEventListener('start', start);
    controls.removeEventListener('change', change);
    controls.removeEventListener('end', end);
  };
}

export function fullscreenCameraView<T extends string>(
  current: T | 'custom', selected: T, wasFullscreen: boolean, fullscreen: boolean,
): T | 'custom' {
  return fullscreen && !wasFullscreen && current === 'custom' ? selected : current;
}

/** Rotate a position or target halfway around the court's vertical axis. */
export function swapCourtEnd(point: { x: number; y: number; z: number }) {
  return { x: -point.x, y: point.y, z: -point.z };
}

/** A player camera from the other end is the other player's same camera. */
export function otherEndPlayerView<T extends string>(view: T): T {
  if (view.startsWith('player-one-')) return view.replace('player-one-', 'player-two-') as T;
  if (view.startsWith('player-two-')) return view.replace('player-two-', 'player-one-') as T;
  return view;
}
