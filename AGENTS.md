# Kaplia Meet Agent Instructions

This file contains operational instructions for agents and maintainers working in this repository. Keep product-facing overview content in `README.md`; keep setup, deployment, build, and troubleshooting instructions here.

## Project Layout

- `app/` is the Electron client with a Vite renderer.
- `server/` is a Node.js signaling server using Express and WebSocket.
- `deploy/` contains Docker Compose, Caddy reverse proxy, and coturn config examples.
- `build-deploy/` may contain packaged deploy artifacts.

## Local Development

Start the signaling server:

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Start the Electron app in another terminal:

```bash
cd app
npm install
npm run dev
```

Local dev defaults:

- Signaling WebSocket: `ws://localhost:8080/ws`
- Renderer origin: `http://127.0.0.1:5173`
- ICE config: `http://localhost:8080/ice-config`

For local development without coturn, leave `TURN_HOST` and `TURN_SECRET` empty in `server/.env`; the server will return a public STUN fallback only.

## Configure The Server URL In Electron

For development, override the runtime URL:

```bash
cd app
KAPLIA_SIGNALING_URL=wss://meet.kaplia.pro/ws npm run dev
```

For distributable macOS/Windows builds, edit `app/electron/config.js` before building:

```js
module.exports = {
  defaultSignalingUrl: "wss://meet.kaplia.pro/ws"
};
```

Use a domain with a valid TLS certificate for production WSS. A raw public IP can work only if a trusted certificate is provided for it, which is usually less convenient than DNS plus Caddy.

## Ubuntu 24.04 VPS Deployment

Point a DNS record such as `meet.kaplia.pro` to the VPS public IP `167.233.126.127`.

If the same hostname is used for signaling and TURN/STUN, set the Cloudflare DNS record to **DNS only**. Cloudflare orange-cloud proxying does not proxy normal TURN/STUN traffic on `3478/5349` UDP/TCP.

Install Docker and UFW:

```bash
sudo apt update
sudo apt install -y ca-certificates curl ufw
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in so the Docker group applies.

Configure firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp
sudo ufw enable
sudo ufw status
```

Configure environment:

```bash
cp server/.env.example server/.env
cp deploy/.env.example deploy/.env
cp deploy/coturn/turnserver.conf.example deploy/coturn/turnserver.conf
openssl rand -base64 32
```

Set these values:

- `deploy/.env`: `MEET_DOMAIN=meet.kaplia.pro`
- `server/.env`: `TURN_HOST=meet.kaplia.pro`
- `server/.env`: `TURN_REALM=meet.kaplia.pro`
- `server/.env`: `TURN_SECRET=<the openssl value>`
- `server/.env`: `ALLOWED_ORIGINS=app://kaplia-meet,http://localhost:5173,http://127.0.0.1:5173`
- `deploy/coturn/turnserver.conf`: `external-ip=167.233.126.127`
- `deploy/coturn/turnserver.conf`: `realm=meet.kaplia.pro`
- `deploy/coturn/turnserver.conf`: `server-name=meet.kaplia.pro`
- `deploy/coturn/turnserver.conf`: `static-auth-secret=<same TURN_SECRET>`

Start services:

```bash
cd deploy
docker compose up -d --build
docker compose ps
```

Check HTTPS/WSS-facing endpoints:

```bash
curl https://meet.kaplia.pro/health
curl https://meet.kaplia.pro/ice-config
```

`/ice-config` should return `turnAvailable: true` in production. Do not paste returned TURN credentials into logs or public tickets.

## TURN/STUN Notes

coturn listens on:

- `3478/udp` and `3478/tcp` for STUN/TURN
- `5349/tcp` and optionally `5349/udp` for TURN over TLS/DTLS if valid certs are mounted
- `49152-65535/udp` as the relay port range

The server generates temporary TURN credentials using TURN REST API style:

```text
username = <unix-expiry>:<random>
password = base64(hmac-sha1(TURN_SECRET, username))
```

The Electron client never receives `TURN_SECRET`; it only receives temporary `username` and `credential` values from `/ice-config`.

To verify TURN:

1. Confirm `curl https://meet.kaplia.pro/ice-config` returns `turn:` URLs and `turnAvailable: true`.
2. Use the WebRTC Trickle ICE sample with the temporary URL, username, and credential from `/ice-config`.
3. Start a call from two different networks. The room screen should show `Connected, relayed via TURN` when WebRTC stats expose a selected relay candidate.

## Build Electron Apps

Install app dependencies:

```bash
cd app
npm install
```

Build renderer assets:

```bash
npm run build
```

macOS DMG:

```bash
npm run dist:mac
```

Windows installer and portable EXE:

```bash
npm run dist:win
```

`dist:win` creates both an NSIS installer (`*-setup.exe`) and a portable executable (`*-portable.exe`). Use the portable build for quick testing when Windows should not create an uninstall entry.

Windows builds are most reliable on Windows or CI. Cross-building from macOS can require extra tooling and may not produce signed installers. Development Windows builds are unsigned; production distribution should use a real Windows code-signing certificate.

Artifacts are written to `app/dist/`.

## Windows Uninstall Troubleshooting

If an old Windows uninstall entry shows an NSIS integrity error, the local `Uninstall.exe` from that previous install is likely damaged.

Recommended recovery:

1. Install the newest `*-setup.exe` over the existing app to refresh the uninstall entry.
2. Uninstall again from Windows Apps.
3. If that still fails, close the app, remove `%LOCALAPPDATA%\Programs\Kaplia Meet`, and use Microsoft's Program Install and Uninstall troubleshooter to remove the stale Apps entry.

## Signaling Protocol

Client to server:

- `join`: join an existing room.
- `signal`: forward WebRTC offer, answer, or ICE candidate to the other participant.
- `leave`: leave the room.

Server to client:

- `joined`: room join confirmed.
- `peer-joined`: the second participant arrived; existing peer creates the offer.
- `signal`: forwarded WebRTC signaling payload.
- `peer-left`: the other participant disconnected or left.
- `error`: validation, full room, or room-not-found errors.

## Security Defaults

- Secrets live in `.env`; TURN secrets are never hardcoded in the Electron client.
- Signaling origin checks are controlled by `ALLOWED_ORIGINS`.
- Room creation is rate limited by `CREATE_ROOM_LIMIT_PER_MINUTE`.
- Room IDs are validated server-side and client-side.
- Room state is in-memory and expires after `ROOM_EMPTY_TTL_SECONDS` when empty.
- Received file names are sanitized before saving on macOS/Windows.
- HTTPS/WSS is terminated by Caddy.

## Verification Checklist

Before handing off app changes:

```bash
cd app
node -c electron/main.js
node -c electron/preload.js
npm audit
npm run build
```

For release artifacts:

```bash
cd app
npm run dist:win -- --publish=never
npm run dist:mac -- --publish=never
```

Remove temporary unpacked folders from `app/dist/` before presenting artifacts:

```bash
rm -rf dist/mac dist/mac-arm64 dist/win-unpacked dist/builder-effective-config.yaml dist/builder-debug.yml dist/.DS_Store
```
