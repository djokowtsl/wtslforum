// WebRTC signaling only: audio remains peer-to-peer and is never recorded here.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const MAX_SIGNAL_BYTES = 40_000;
const MAX_PEERS_LIMIT = 8;
const MAX_ROOMS_LIMIT = 300;
const ROOM_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
const ID_PATTERN = /^[A-Za-z0-9-]{6,64}$/;

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'Player';
}

function isValidRoom(room) {
  return typeof room === 'string' && ROOM_PATTERN.test(room);
}

function signaturePayload(room, expiresAt, name) {
  return JSON.stringify([room, expiresAt, cleanName(name)]);
}

function signRoomToken(secret, room, expiresAt, name) {
  return crypto.createHmac('sha256', secret)
    .update(signaturePayload(room, expiresAt, name))
    .digest('hex');
}

function verifyRoomToken(secret, room, expiresAt, name, signature, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !isValidRoom(room) || !Number.isSafeInteger(expiresAt)) return false;
  if (expiresAt < nowSeconds - CLOCK_SKEW_SECONDS
    || expiresAt > nowSeconds + MAX_TOKEN_TTL_SECONDS + CLOCK_SKEW_SECONDS) return false;
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signRoomToken(secret, room, expiresAt, name), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function parseFrameAncestors(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (!items.length) throw new Error('FRAME_ANCESTORS must list the Forum origins allowed to embed voice rooms.');
  return items.map((item) => {
    let origin;
    try {
      const url = new URL(item);
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
        throw new Error('must be an origin without a path');
      }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        throw new Error('must use HTTPS (HTTP is allowed only for localhost)');
      }
      origin = url.origin;
    } catch (error) {
      throw new Error(`Invalid FRAME_ANCESTORS entry "${item}": ${error.message}`);
    }
    return origin;
  });
}

function parseBoundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function parseIceServers(value) {
  if (!value) return null;
  const servers = JSON.parse(value);
  if (!Array.isArray(servers) || servers.length > 16 || servers.some((server) =>
    !server || !(typeof server.urls === 'string' || Array.isArray(server.urls))
  )) {
    throw new Error('ICE_SERVERS must be a JSON array of ICE server objects.');
  }
  return servers;
}

function expectedRequestOrigin(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http'))
    .split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function hasSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).origin === expectedRequestOrigin(req);
  } catch {
    return false;
  }
}

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {}
}

function writeText(res, status, text, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(text);
}

function readJson(req, res, callback) {
  let size = 0;
  let rejected = false;
  const chunks = [];
  req.on('error', () => {});
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_SIGNAL_BYTES) {
      rejected = true;
      writeText(res, 413, 'request too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (rejected) return;
    try {
      callback(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      callback(null);
    }
  });
}

function validSignalData(type, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (type === 'offer' || type === 'answer') {
    return data.type === type && typeof data.sdp === 'string' && data.sdp.length <= 30_000;
  }
  if (type === 'ice') {
    return typeof data.candidate === 'string'
      && data.candidate.length <= 4_096
      && (data.sdpMid === null || data.sdpMid === undefined || typeof data.sdpMid === 'string')
      && (data.sdpMLineIndex === null || data.sdpMLineIndex === undefined
        || Number.isSafeInteger(data.sdpMLineIndex));
  }
  return false;
}

function createVoiceServer(options) {
  const roomSecret = options?.roomSecret;
  if (typeof roomSecret !== 'string' || Buffer.byteLength(roomSecret, 'utf8') < 32) {
    throw new Error('ROOM_SECRET must contain at least 32 bytes.');
  }
  const frameAncestors = parseFrameAncestors(options.frameAncestors);
  const maxPeers = parseBoundedInteger(options.maxPeers, 8, 2, MAX_PEERS_LIMIT, 'MAX_PEERS');
  const maxRooms = parseBoundedInteger(options.maxRooms, 300, 1, MAX_ROOMS_LIMIT, 'MAX_ROOMS');
  const iceServers = options.iceServers ?? null;
  const rooms = new Map();
  const commonHeaders = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  };

  function leave(room, id, response) {
    const peers = rooms.get(room);
    const peer = peers?.get(id);
    if (!peer || (response && peer.response !== response)) return;
    peers.delete(id);
    for (const other of peers.values()) send(other.response, 'peer-left', { id });
    if (!peers.size) rooms.delete(room);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/') && !hasSameOrigin(req)) {
      return writeText(res, 403, 'same-origin request required');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...commonHeaders, allow: 'GET, POST, OPTIONS' });
      return res.end();
    }
    if ((url.pathname === '/' || url.pathname === '/voice.html') && req.method === 'GET') {
      return fs.readFile(path.join(__dirname, 'voice.html'), (error, html) => {
        if (error) return writeText(res, 404, 'voice page unavailable');
        res.writeHead(200, {
          ...commonHeaders,
          'content-security-policy': `frame-ancestors ${frameAncestors.join(' ')}`,
          'content-type': 'text/html; charset=utf-8',
        });
        res.end(html);
      });
    }
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { ...commonHeaders, 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    }
    if (url.pathname === '/api/join' && req.method === 'GET') {
      const room = (url.searchParams.get('room') || '').toLowerCase();
      const id = url.searchParams.get('id') || '';
      const name = cleanName(url.searchParams.get('name'));
      const expiresAt = Number(url.searchParams.get('exp'));
      const signature = url.searchParams.get('sig') || '';
      if (!isValidRoom(room) || !ID_PATTERN.test(id)) return writeText(res, 400, 'bad room or id');
      if (!verifyRoomToken(roomSecret, room, expiresAt, name, signature)) {
        res.writeHead(200, {
          ...commonHeaders,
          'content-type': 'text/event-stream; charset=utf-8',
        });
        send(res, 'denied', {});
        return res.end();
      }

      let peers = rooms.get(room);
      if (!peers) {
        if (rooms.size >= maxRooms) return writeText(res, 503, 'too many rooms');
        peers = new Map();
        rooms.set(room, peers);
      }
      const reconnecting = peers.has(id);
      if (!reconnecting && peers.size >= maxPeers) {
        res.writeHead(200, { ...commonHeaders, 'content-type': 'text/event-stream; charset=utf-8' });
        send(res, 'full', { max: maxPeers });
        return res.end();
      }

      res.writeHead(200, {
        ...commonHeaders,
        'connection': 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-accel-buffering': 'no',
      });
      if (reconnecting) {
        try { peers.get(id).response.end(); } catch {}
      }
      const others = [...peers.entries()]
        .filter(([peerId]) => peerId !== id)
        .map(([peerId, peer]) => ({ id: peerId, name: peer.name }));
      peers.set(id, { response: res, name, hits: [] });
      send(res, 'welcome', { you: id, peers: others, ice: iceServers, max: maxPeers });
      if (!reconnecting) {
        for (const [peerId, peer] of peers) {
          if (peerId !== id) send(peer.response, 'peer-joined', { id, name });
        }
      }
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n'); } catch {}
      }, 15_000);
      heartbeat.unref?.();
      res.on('close', () => {
        clearInterval(heartbeat);
        leave(room, id, res);
      });
      return;
    }
    if (url.pathname === '/api/signal' && req.method === 'POST') {
      return readJson(req, res, (message) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          return writeText(res, 400, 'invalid request');
        }
        const room = String(message.room || '').toLowerCase();
        const from = String(message.from || '');
        const to = String(message.to || '');
        const name = cleanName(message.name);
        const expiresAt = Number(message.exp);
        const type = message.type;
        if (!isValidRoom(room) || !ID_PATTERN.test(from) || !ID_PATTERN.test(to)
          || !validSignalData(type, message.data)) {
          return writeText(res, 400, 'invalid signal');
        }
        if (!verifyRoomToken(roomSecret, room, expiresAt, name, message.sig)) {
          return writeText(res, 403, 'valid room signature required');
        }
        const peers = rooms.get(room);
        const sender = peers?.get(from);
        const recipient = peers?.get(to);
        if (!sender || !recipient) {
          res.writeHead(204, commonHeaders);
          return res.end();
        }
        const now = Date.now();
        sender.hits = sender.hits.filter((hit) => now - hit < 10_000);
        if (sender.hits.length >= 300) return writeText(res, 429, 'too many signals');
        sender.hits.push(now);
        res.writeHead(204, commonHeaders);
        res.end();
        send(recipient.response, 'signal', { from, type, data: message.data });
      });
    }
    return writeText(res, 404, 'not found');
  });
}

if (require.main === module) {
  try {
    const port = parseBoundedInteger(process.env.PORT, 8787, 1, 65_535, 'PORT');
    const server = createVoiceServer({
      roomSecret: process.env.ROOM_SECRET,
      frameAncestors: process.env.FRAME_ANCESTORS,
      maxPeers: process.env.MAX_PEERS === undefined ? 8 : Number(process.env.MAX_PEERS),
      maxRooms: process.env.MAX_ROOMS === undefined ? 300 : Number(process.env.MAX_ROOMS),
      iceServers: parseIceServers(process.env.ICE_SERVERS),
    });
    server.listen(port, '0.0.0.0', () => {
      console.log(`TE4 voice signaling listening on port ${port}`);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Voice server configuration failed.');
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_TOKEN_TTL_SECONDS,
  cleanName,
  createVoiceServer,
  isValidRoom,
  parseFrameAncestors,
  signRoomToken,
  verifyRoomToken,
};
