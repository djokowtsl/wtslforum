import * as THREE from 'three';

/** Crowd garments must remain solid from rear views; preserve their maps and colors. */
export function makeCrowdClothingOpaque(material: THREE.Material) {
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}
