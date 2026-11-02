import type { Te4ViewerData } from './te4DmoTypes';

export type Te4ViewerHandedness = ['left' | 'right', 'left' | 'right'];

function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function embedTe4ViewerHtml(
  html: string,
  viewer: Te4ViewerData,
  handedness: Te4ViewerHandedness = ['right', 'right'],
): string {
  if (!html.includes('__DATA__') || !html.includes('__HANDEDNESS__')) {
    throw new Error('The replay player template is incomplete.');
  }

  return html
    .replace('__DATA__', () => inlineJson(viewer))
    .replace('__HANDEDNESS__', () => inlineJson(handedness));
}
