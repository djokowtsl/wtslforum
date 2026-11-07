import * as THREE from 'three';

/** Warm, mid-to-high value atlas pixels are the skin regions in these two rigs. */
export function isCrowdSkinPixel(red: number, green: number, blue: number) {
  return red > 90 && green > 45 && blue > 24
    && red - green > 12
    && green - blue > 5
    && red / Math.max(1, green) < 1.65;
}

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
