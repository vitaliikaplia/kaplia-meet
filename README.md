# Kaplia Meet

Kaplia Meet is a minimal Electron desktop app for private 1-on-1 WebRTC calls. It is intentionally small: no accounts, no contact list, no database, and no full messenger layer. The goal is a stable Meet-like private call between two people.

The VPS is used only for WebSocket signaling and STUN/TURN discovery. Audio, video, chat messages, and file bytes are sent through WebRTC directly peer-to-peer when possible, or through coturn relay when NAT/CGNAT blocks direct ICE connectivity. Media is protected by WebRTC DTLS-SRTP between peers.

## What It Does

- Creates and joins simple room IDs for 1-on-1 calls.
- Shows the peer video as the main stage.
- Shows the local video as a draggable picture-in-picture tile.
- Lets either video tile be clicked to swap the main and picture-in-picture view.
- Supports microphone mute/unmute and camera on/off.
- Supports screen sharing with a visible sharing banner and a Stop sharing button.
- Supports camera, microphone, and speaker selection.
- Shows WebRTC connection state and call quality details.
- Detects direct P2P versus TURN relay when WebRTC stats expose that route.
- Shows a short safety code derived from peer DTLS fingerprints for verbal comparison.
- Keeps a persistent right-side in-call chat.
- Sends chat messages over a WebRTC data channel, not through the signaling server.
- Renders `https://`, `http://`, and `www.` links as clickable chat links.
- Sends files peer-to-peer over a WebRTC data channel.
- Queues multiple selected or dropped files and sends them one after another.
- Verifies file transfers with SHA-256 before marking a received file as saved.
- Requires the user to choose a local save folder before joining or creating rooms.
- Lets either peer clear local chat and transfer history for both connected participants.

## Architecture

- `app/` contains the Electron desktop client and Vite renderer.
- `server/` contains the Node.js signaling server using Express and WebSocket.
- `deploy/` contains production-oriented deployment examples for Caddy and coturn.
- `build-deploy/` contains packaged deployment artifacts.

Rooms are in-memory and limited to two participants. The signaling server forwards WebRTC offers, answers, and ICE candidates only. It does not store audio, video, files, chat messages, or call content.

## Server Responsibilities

- `POST /rooms` creates room IDs and is rate limited.
- `GET /ice-config` returns STUN/TURN configuration with temporary TURN REST credentials.
- `GET /health` returns service health.
- `WS /ws` handles room joins, leaves, and WebRTC signaling relay.

## Client Responsibilities

- Captures camera, microphone, and screen media with browser/Electron media APIs.
- Creates `RTCPeerConnection` instances with STUN/TURN configuration from the server.
- Exchanges offers, answers, and ICE candidates through WebSocket signaling.
- Sends chat and files over WebRTC data channels.
- Writes incoming files through the Electron main process so native file paths stay out of the renderer.
- Stores the selected save folder in local app settings.

## Security Model

- TURN secrets are never hardcoded in the Electron app.
- The client receives only temporary TURN usernames and credentials from `/ice-config`.
- Signaling origin checks are controlled server-side.
- Room IDs are validated client-side and server-side.
- Room state is in-memory and expires after empty-room TTL.
- Received file names are sanitized before saving on macOS or Windows.
- Production signaling uses HTTPS/WSS through Caddy.

## Current MVP Boundaries

- Rooms support exactly two participants.
- There are no user accounts or logins.
- There is no persistent chat history.
- There is no server-side media, chat, or file storage.
- File transfers are ordered with one active outgoing and incoming transfer at a time.
- Desktop builds are currently unsigned unless a platform signing certificate is provided.
