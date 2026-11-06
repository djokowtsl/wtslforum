# WTSL voice-room signaling service

This small Node service serves the embedded voice-room page and relays WebRTC
signaling. Audio is sent directly between browsers; it is not recorded or
relayed by this service. The full-mesh room limit is capped at eight people.

## Required environment

- `ROOM_SECRET`: at least 32 random bytes, shared with the Forum's
  `VOICE_ROOM_SECRET`.
- `FRAME_ANCESTORS`: space-separated HTTPS origins allowed to embed the page.
  For production, use `https://wtslforum.com https://www.wtslforum.com`.
- `PORT`: supplied by the hosting provider; defaults to `8787` locally.
- `ICE_SERVERS`: optional JSON array of STUN/TURN servers.

The service fails at startup when the signing secret or embed allowlist is
missing or invalid. Do not use a wildcard frame allowlist or an empty signing
secret in production.

## Hosting on the current Replit VM

The Forum remains on Vercel, while this persistent signaling service runs as a
second process on the existing Replit Reserved VM beside the Python bot. The
runtime copy is maintained in the bot workspace under `services/voice-room`;
keep its `server.js` and `voice.html` synchronized with this directory. Replit
maps local port `8787` to public port `8081`.

Configure the Vercel `wtslforum` Production environment:

- `VOICE_ROOM_SECRET`: the same value as the Replit `ROOM_SECRET`.
- `NEXT_PUBLIC_VOICE_SERVER`: the Replit production origin followed by `:8081`,
  with no trailing slash.

The Forum hides the voice panel when the server URL is unset and signs each
room for six hours. Only Forum admins currently receive room tokens, matching
the livestream page's maintenance restriction. The signature binds the room,
display name, and expiration.

## Local check

Set a local-only secret of at least 32 bytes and an ancestor origin, then run:

```sh
ROOM_SECRET='replace-with-a-local-random-value-at-least-32-bytes' \
FRAME_ANCESTORS='http://localhost:3000' \
npm start
```

Use `http://localhost:8787/health` to check that the process is responding.
Microphone access requires HTTPS or localhost.

## Privacy and capacity

WebRTC audio is peer-to-peer. Other room participants may be able to see a
participant's network IP address. Rooms are limited to eight people; listen-only
participants still use a peer connection. Use a TURN provider through
`ICE_SERVERS` if some networks cannot establish peer connections.
