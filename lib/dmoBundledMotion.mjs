const HEADER_BYTES = 52;
const QUATERNION_SCALE = 32767;

/**
 * CAnimList.CAnimInfo in the official TE4 Animation Modding SDK specifies
 * these markers at 30 Hz, independently of the AnimationClip sample rate.
 * A service-waiting marker is NOT a ball-contact marker.
 */
export function bundledAnimationEvents(info, kind, duration) {
  if (typeof info !== 'string' || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('The animation event metadata is incomplete.');
  }
  const tokens = info.trim().split(/\s+/);
  const expected = kind === 'strike' ? 2 : kind === 'serve' ? 3 : kind === 'serve-waiting' ? 4 : 0;
  if (!expected || tokens.length !== expected || tokens.some(t => !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t))) {
    throw new Error('The animation event metadata is unsupported.');
  }
  const times = tokens.map(t => Number(t) / 30);
  if (times.some(t => !Number.isFinite(t) || t < 0 || t > duration + .00001)) {
    throw new Error('The animation event markers exceed the recording.');
  }
  if (kind === 'serve-waiting') {
    return { kind, readyTime: times[0], loopStart: times[1], loopEnd: times[2], bounceThrowTime: times[3] };
  }
  return {
    kind, contactTime: times[0], maxExtensionTime: times[1],
    ...(kind === 'serve' ? { tossTime: times[2] } : {}),
  };
}

/** Decode only native-rig recordings; malformed or mismatched clips fail closed. */
export function decodeBundledMotion(buffer, schema) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) {
    throw new Error('The player recording is incomplete.');
  }
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'WTM1') {
    throw new Error('The player recording format is unsupported.');
  }
  const boneCount = view.getUint16(4, true);
  const pelvisIndex = view.getUint16(6, true);
  const frameCount = view.getUint32(8, true);
  const sampleRate = view.getFloat32(12, true);
  const duration = view.getFloat32(16, true);
  const rigHash = [...new Uint8Array(buffer, 20, 32)]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  const stride = 12 + boneCount * 8;
  if (
    !schema || schema.format !== 'WTM1'
    || rigHash !== schema.rigHash || boneCount !== schema.bones.length
    || pelvisIndex !== schema.pelvisIndex || pelvisIndex >= boneCount
    || boneCount < 1 || boneCount > 128
    || !Number.isFinite(duration) || duration <= 0 || duration > 120
    || !Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 120
    || frameCount !== Math.round(duration * sampleRate) + 1
    || buffer.byteLength !== HEADER_BYTES + frameCount * stride
  ) {
    throw new Error('The player recording does not match this player model.');
  }
  const positions = new Float32Array(frameCount * 3);
  const rotations = new Float32Array(frameCount * boneCount * 4);
  for (let frame = 0; frame < frameCount; frame++) {
    const start = HEADER_BYTES + frame * stride;
    for (let axis = 0; axis < 3; axis++) {
      const value = view.getFloat32(start + axis * 4, true);
      if (!Number.isFinite(value)) throw new Error('The player recording contains an invalid position.');
      positions[frame * 3 + axis] = value;
    }
    for (let bone = 0; bone < boneCount; bone++) {
      const offset = (frame * boneCount + bone) * 4;
      let norm = 0;
      for (let axis = 0; axis < 4; axis++) {
        const integer = view.getInt16(start + 12 + bone * 8 + axis * 2, true);
        if (integer === -32768) throw new Error('The player recording contains an invalid rotation.');
        const value = integer / QUATERNION_SCALE;
        rotations[offset + axis] = value;
        norm += value * value;
      }
      if (Math.abs(norm - 1) > 0.00012) throw new Error('The player recording contains an invalid rotation.');
      const scale = 1 / Math.sqrt(norm);
      for (let axis = 0; axis < 4; axis++) rotations[offset + axis] *= scale;
    }
  }
  return { boneCount, pelvisIndex, frameCount, sampleRate, duration, rigHash, positions, rotations };
}

/** The final frame can be a fractional sample; endpoints are never extrapolated. */
export function bundledMotionFrame(clip, seconds) {
  if (!Number.isFinite(seconds)) throw new Error('The player recording time must be finite.');
  const value = seconds >= clip.duration
    ? clip.frameCount - 1
    : Math.max(0, Math.min(clip.frameCount - 1, seconds * clip.sampleRate));
  return { first: Math.floor(value), second: Math.ceil(value), blend: value % 1 };
}
