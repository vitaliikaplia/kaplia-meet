require("dotenv").config();

const crypto = require("crypto");
const http = require("http");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { WebSocket, WebSocketServer } = require("ws");

const port = Number(process.env.PORT || 8080);
const wsPath = "/ws";
const roomIdPattern = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const maxMessageBytes = 64 * 1024;
const emptyRoomTtlMs = Number(process.env.ROOM_EMPTY_TTL_SECONDS || 900) * 1000;
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "app://kaplia-meet,http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const allowNoOrigin = process.env.ALLOW_NO_ORIGIN === "true";

const rooms = new Map();
const clients = new Map();

function isAllowedOrigin(origin) {
  if (!origin) {
    return allowNoOrigin;
  }

  return allowedOrigins.has(origin);
}

function normalizeRoomId(roomId) {
  return String(roomId || "").trim().toUpperCase();
}

function isValidRoomId(roomId) {
  return roomIdPattern.test(roomId);
}

function makeRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function createRoom() {
  let roomId = makeRoomId();
  while (rooms.has(roomId)) {
    roomId = makeRoomId();
  }

  rooms.set(roomId, {
    roomId,
    clients: new Set(),
    createdAt: Date.now(),
    emptySince: Date.now()
  });

  return roomId;
}

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function sendError(ws, code, message) {
  send(ws, {
    type: "error",
    code,
    message
  });
}

function leaveRoom(ws, notifyPeer = true) {
  const client = clients.get(ws);
  if (!client?.roomId) {
    return;
  }

  const room = rooms.get(client.roomId);
  if (room) {
    room.clients.delete(ws);

    if (notifyPeer) {
      room.clients.forEach((peer) => {
        send(peer, { type: "peer-left" });
      });
    }

    if (room.clients.size === 0) {
      room.emptySince = Date.now();
    }
  }

  client.roomId = null;
}

function joinRoom(ws, rawRoomId) {
  const roomId = normalizeRoomId(rawRoomId);

  if (!isValidRoomId(roomId)) {
    sendError(ws, "invalid-room-id", "Room ID must be 3-40 chars: letters, numbers, hyphens.");
    return;
  }

  const room = getRoom(roomId);
  if (!room) {
    sendError(ws, "room-not-found", "Room not found. Create it first.");
    return;
  }

  if (room.clients.has(ws)) {
    send(ws, {
      type: "joined",
      roomId,
      peerCount: room.clients.size
    });
    return;
  }

  if (room.clients.size >= 2) {
    sendError(ws, "room-full", "Room is full. MVP rooms allow only 2 participants.");
    return;
  }

  leaveRoom(ws, false);
  room.clients.add(ws);
  room.emptySince = null;
  clients.set(ws, {
    ...clients.get(ws),
    roomId
  });

  send(ws, {
    type: "joined",
    roomId,
    peerCount: room.clients.size
  });

  room.clients.forEach((peer) => {
    if (peer !== ws) {
      send(peer, {
        type: "peer-joined",
        roomId,
        peerId: clients.get(ws).id
      });
    }
  });
}

function forwardSignal(ws, message) {
  const client = clients.get(ws);
  const roomId = normalizeRoomId(message.roomId || client?.roomId);
  const room = getRoom(roomId);

  if (!client?.roomId || client.roomId !== roomId || !room?.clients.has(ws)) {
    sendError(ws, "not-in-room", "Join a room before sending WebRTC signaling.");
    return;
  }

  if (!message.signal || typeof message.signal !== "object") {
    sendError(ws, "invalid-signal", "Invalid WebRTC signaling payload.");
    return;
  }

  room.clients.forEach((peer) => {
    if (peer !== ws) {
      send(peer, {
        type: "signal",
        from: client.id,
        signal: message.signal
      });
    }
  });
}

function makeTurnCredentials() {
  const turnHost = process.env.TURN_HOST;
  const turnSecret = process.env.TURN_SECRET;
  const ttlSeconds = Number(process.env.TURN_TTL_SECONDS || 3600);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAt}:${crypto.randomBytes(8).toString("hex")}`;
  const credential = turnSecret
    ? crypto.createHmac("sha1", turnSecret).update(username).digest("base64")
    : "";

  return {
    turnHost,
    username,
    credential,
    ttlSeconds
  };
}

function buildIceConfig() {
  const { turnHost, username, credential, ttlSeconds } = makeTurnCredentials();
  const iceServers = [];

  if (turnHost) {
    iceServers.push({
      urls: [`stun:${turnHost}:3478`]
    });
  } else {
    iceServers.push({
      urls: ["stun:stun.l.google.com:19302"]
    });
  }

  if (turnHost && credential) {
    const turnUrls = [
      `turn:${turnHost}:3478?transport=udp`,
      `turn:${turnHost}:3478?transport=tcp`
    ];

    if (process.env.TURN_TLS_ENABLED === "true") {
      turnUrls.push(`turns:${turnHost}:5349?transport=tcp`);
    }

    iceServers.push({
      urls: turnUrls,
      username,
      credential
    });
  }

  return {
    iceServers,
    ttlSeconds,
    turnAvailable: Boolean(turnHost && credential)
  };
}

function cleanupRooms() {
  const now = Date.now();

  rooms.forEach((room, roomId) => {
    if (room.clients.size === 0 && room.emptySince && now - room.emptySince > emptyRoomTtlMs) {
      rooms.delete(roomId);
    }
  });
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed."));
    }
  })
);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    uptime: process.uptime()
  });
});

app.get("/ice-config", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(buildIceConfig());
});

app.post(
  "/rooms",
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.CREATE_ROOM_LIMIT_PER_MINUTE || 20),
    standardHeaders: true,
    legacyHeaders: false
  }),
  (req, res) => {
    const roomId = createRoom();
    res.status(201).json({
      roomId,
      maxParticipants: 2
    });
  }
);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(403).json({
    error: err.message || "Request rejected."
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: maxMessageBytes
});

wss.on("connection", (ws) => {
  clients.set(ws, {
    id: crypto.randomUUID(),
    roomId: null
  });

  ws.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      sendError(ws, "bad-json", "Invalid JSON message.");
      return;
    }

    if (!message || typeof message.type !== "string") {
      sendError(ws, "bad-message", "Invalid signaling message.");
      return;
    }

    if (message.type === "join") {
      joinRoom(ws, message.roomId);
      return;
    }

    if (message.type === "signal") {
      forwardSignal(ws, message);
      return;
    }

    if (message.type === "leave") {
      leaveRoom(ws, true);
      return;
    }

    sendError(ws, "unknown-type", "Unknown signaling message type.");
  });

  ws.on("close", () => {
    leaveRoom(ws, true);
    clients.delete(ws);
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname !== wsPath) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (!isAllowedOrigin(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

setInterval(cleanupRooms, 60 * 1000).unref();

server.listen(port, () => {
  console.log(`Kaplia Meet signaling server listening on :${port}`);
});
