import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceFrameRate = 100;
const outputFrameStep = 4;
const framesBeforeContact = 92;
const framesAfterContact = 108;

const captures = [
  {
    source: process.argv[2],
    output: 'tennis-volley-forehand.bvh',
    contactFrame: 493,
  },
  {
    source: process.argv[3],
    output: 'tennis-volley-backhand.bvh',
    contactFrame: 344,
  },
];

if (captures.some(capture => !capture.source)) {
  throw new Error(
    'Usage: node scripts/prepare-tennis-volley-mocap.mjs <jarua_VDerecha.bvh> <jarua_VReves.bvh>',
  );
}

const outputDirectory = path.resolve('public/models/dmo-humans');

for (const capture of captures) {
  const source = await readFile(capture.source, 'utf8');
  const motionHeader = /^MOTION\s*\r?\nFrames:\s*(\d+)\s*\r?\nFrame Time:\s*([\d.eE+-]+)\s*\r?\n/m;
  const match = motionHeader.exec(source);
  if (!match) throw new Error(`BVH motion header not found in ${capture.source}.`);

  const sourceFrameCount = Number(match[1]);
  const sourceFrameTime = Number(match[2]);
  if (Math.abs(sourceFrameTime - 1 / sourceFrameRate) > 1e-7) {
    throw new Error(`Expected ${sourceFrameRate} Hz source motion in ${capture.source}.`);
  }

  const motionStart = match.index + match[0].length;
  const sourceFrames = source.slice(motionStart).trim().split(/\r?\n/);
  if (sourceFrames.length !== sourceFrameCount) {
    throw new Error(
      `Expected ${sourceFrameCount} frame rows in ${capture.source}; found ${sourceFrames.length}.`,
    );
  }

  const firstFrame = capture.contactFrame - framesBeforeContact;
  const lastFrame = capture.contactFrame + framesAfterContact;
  if (firstFrame < 0 || lastFrame >= sourceFrames.length) {
    throw new Error(`Selected clip window is outside ${capture.source}.`);
  }

  const frames = [];
  for (let frame = firstFrame; frame <= lastFrame; frame += outputFrameStep) {
    frames.push(sourceFrames[frame]);
  }
  const contactOutputFrame = (capture.contactFrame - firstFrame) / outputFrameStep;
  if (!Number.isInteger(contactOutputFrame) || contactOutputFrame !== 23) {
    throw new Error(`Contact frame is not preserved in ${capture.output}.`);
  }

  const hierarchy = source.slice(0, match.index);
  const output = [
    `${hierarchy}MOTION`,
    `Frames: ${frames.length}`,
    `Frame Time: ${(outputFrameStep / sourceFrameRate).toFixed(8)}`,
    ...frames,
    '',
  ].join('\n');
  const destination = path.join(outputDirectory, capture.output);
  await writeFile(destination, output);
  console.log(`${capture.output}: frames ${firstFrame}–${lastFrame}, ${frames.length} samples, 25 Hz`);
}
