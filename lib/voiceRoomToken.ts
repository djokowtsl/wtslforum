import { createHmac } from 'node:crypto';

export const VOICE_ROOM_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const VOICE_ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

export function isValidVoiceRoom(room: string) {
  return VOICE_ROOM_PATTERN.test(room);
}

/** Broadcast IDs are UUIDs, so the stable lowercase value fits the room-code contract. */
export function voiceRoomForBroadcast(broadcastId: string) {
  const room = broadcastId.toLowerCase();
  return isValidVoiceRoom(room) ? room : '';
}

export function normalizeVoiceRoomName(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Player';
}

export function createVoiceRoomSignature(secret: string, room: string, expiresAt: number, name: string) {
  const payload = JSON.stringify([room, expiresAt, normalizeVoiceRoomName(name)]);
  return createHmac('sha256', secret).update(payload).digest('hex');
}
