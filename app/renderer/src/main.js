import "./styles.css";

const roomIdInput = document.querySelector("#room-id-input");
const createRoomButton = document.querySelector("#create-room-button");
const joinRoomButton = document.querySelector("#join-room-button");
const signalingDot = document.querySelector("#signaling-dot");
const signalingStatus = document.querySelector("#signaling-status");
const homeError = document.querySelector("#home-error");
const homeSaveDirectory = document.querySelector("#home-save-directory");
const homeChooseSaveDirectoryButton = document.querySelector("#home-choose-save-directory-button");
const homeScreen = document.querySelector("#home-screen");
const roomScreen = document.querySelector("#room-screen");
const roomTitle = document.querySelector("#room-title");
const copyRoomButton = document.querySelector("#copy-room-button");
const webrtcDot = document.querySelector("#webrtc-dot");
const webrtcStatus = document.querySelector("#webrtc-status");
const localVideo = document.querySelector("#local-video");
const remoteVideo = document.querySelector("#remote-video");
const localPlaceholder = document.querySelector("#local-placeholder");
const remotePlaceholder = document.querySelector("#remote-placeholder");
const videoGrid = document.querySelector("#video-grid");
const localTile = document.querySelector("#local-tile");
const remoteTile = document.querySelector("#remote-tile");
const localTileLabel = document.querySelector("#local-tile-label");
const remoteTileLabel = document.querySelector("#remote-tile-label");
const muteButton = document.querySelector("#mute-button");
const cameraButton = document.querySelector("#camera-button");
const screenShareButton = document.querySelector("#screen-share-button");
const stopScreenShareButton = document.querySelector("#stop-screen-share-button");
const screenShareBanner = document.querySelector("#screen-share-banner");
const devicesButton = document.querySelector("#devices-button");
const devicesPanel = document.querySelector("#devices-panel");
const closeDevicesButton = document.querySelector("#close-devices-button");
const cameraSelect = document.querySelector("#camera-select");
const microphoneSelect = document.querySelector("#microphone-select");
const speakerSelect = document.querySelector("#speaker-select");
const qualityButton = document.querySelector("#quality-button");
const qualityPanel = document.querySelector("#quality-panel");
const closeQualityButton = document.querySelector("#close-quality-button");
const qualityStatus = document.querySelector("#quality-status");
const qualityRoute = document.querySelector("#quality-route");
const qualityResolution = document.querySelector("#quality-resolution");
const qualityFps = document.querySelector("#quality-fps");
const qualityVideoBitrate = document.querySelector("#quality-video-bitrate");
const qualityAudioBitrate = document.querySelector("#quality-audio-bitrate");
const qualityPacketLoss = document.querySelector("#quality-packet-loss");
const qualityRtt = document.querySelector("#quality-rtt");
const safetyCode = document.querySelector("#safety-code");
const screenPicker = document.querySelector("#screen-picker");
const screenSourceList = document.querySelector("#screen-source-list");
const cancelScreenPickerButton = document.querySelector("#cancel-screen-picker-button");
const leaveButton = document.querySelector("#leave-button");
const roomError = document.querySelector("#room-error");
const clearChatButton = document.querySelector("#clear-chat-button");
const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendChatButton = document.querySelector("#send-chat-button");
const fileSaveDirectory = document.querySelector("#file-save-directory");
const chooseSaveDirectoryButton = document.querySelector("#choose-save-directory-button");
const sendFileButton = document.querySelector("#send-file-button");
const fileDropZone = document.querySelector("#file-drop-zone");

const ROOM_ID_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const reconnectBaseDelay = 900;
const reconnectMaxDelay = 8000;
const FILE_CHUNK_SIZE = 64 * 1024;
const FILE_BUFFER_LIMIT = 1024 * 1024;
const FILE_BUFFER_LOW_THRESHOLD = 512 * 1024;
const CHAT_MAX_CHARS = 8000;
const QUALITY_POLL_INTERVAL_MS = 2000;

let config = null;
let socket = null;
let socketReconnectTimer = null;
let socketReconnectAttempt = 0;
let socketReadyResolvers = [];
let currentRoomId = "";
let localStream = null;
let peerConnection = null;
let iceServers = [];
let statsTimer = null;
let lastStatsSnapshot = null;
let manuallyLeft = false;
let micMuted = false;
let cameraOff = false;
let appBusy = false;
let fileBridge = null;
let saveDirectory = "";
let fileDataChannel = null;
let chatDataChannel = null;
let activeOutgoingTransfer = null;
let activeIncomingTransfer = null;
let incomingWriteQueue = Promise.resolve();
let fileReadyResolvers = new Map();
let fileSavedResolvers = new Map();
let transferItems = new Map();
let outgoingFileQueue = [];
let fileQueueRunning = false;
let videoMain = localStorage.getItem("kaplia-video-main") === "local" ? "local" : "remote";
let pipCorner = localStorage.getItem("kaplia-pip-corner") || "bottom-right";
let pipDragState = null;
let suppressNextVideoClick = false;
let selectedCameraId = localStorage.getItem("kaplia-camera-id") || "";
let selectedMicrophoneId = localStorage.getItem("kaplia-microphone-id") || "";
let selectedSpeakerId = localStorage.getItem("kaplia-speaker-id") || "";
let screenStream = null;
let isScreenSharing = false;
let isPeerScreenSharing = false;

function normalizeRoomId(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "-");
}

function getHttpUrl(pathname) {
  const url = new URL(config.signalingUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function setHomeError(message = "") {
  homeError.textContent = message;
}

function setRoomError(message = "") {
  roomError.textContent = message;
}

function setSignalingState(state, message) {
  signalingDot.classList.toggle("connected", state === "connected");
  signalingDot.classList.toggle("failed", state === "failed");
  signalingStatus.textContent = message;
}

function setWebRtcState(state, message) {
  webrtcDot.classList.toggle("connected", state === "connected");
  webrtcDot.classList.toggle("failed", state === "failed");
  webrtcStatus.textContent = message;
}

function setBusy(isBusy) {
  appBusy = isBusy;
  setHomeControlsState();
}

function setAppWindowMode(mode) {
  window.kaplia?.appWindow?.setMode?.(mode).catch(() => {});
}

function setHomeControlsState() {
  const canStartCall = Boolean(fileBridge && saveDirectory) && !appBusy;
  createRoomButton.disabled = !canStartCall;
  joinRoomButton.disabled = !canStartCall;
  homeChooseSaveDirectoryButton.disabled = !fileBridge || appBusy;
}

function formatBytes(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatBitrate(kbps) {
  if (!Number.isFinite(kbps) || kbps <= 0) {
    return "-";
  }

  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }

  return `${Math.round(kbps)} kbps`;
}

function setSelectOptions(select, devices, fallbackLabel) {
  const currentValue = select.value;
  select.replaceChildren();

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `${fallbackLabel} ${index + 1}`;
    select.append(option);
  });

  if (devices.some((device) => device.deviceId === currentValue)) {
    select.value = currentValue;
  }
}

function getVideoSender() {
  return peerConnection?.getSenders().find((sender) => sender.track?.kind === "video") || null;
}

function getAudioSender() {
  return peerConnection?.getSenders().find((sender) => sender.track?.kind === "audio") || null;
}

function getDisplayPath(directory) {
  if (!directory) {
    return "Not configured";
  }

  return directory.replace(/^\/Users\/[^/]+/, "~");
}

function updateSaveDirectoryUi(directory) {
  saveDirectory = directory || "";
  const displayPath = getDisplayPath(saveDirectory);
  homeSaveDirectory.textContent = displayPath;
  homeSaveDirectory.title = saveDirectory;
  fileSaveDirectory.textContent = displayPath;
  fileSaveDirectory.title = saveDirectory;
  setHomeControlsState();
  setFileControlsState();
  setChatControlsState();
}

function setFileControlsState() {
  const hasBridge = Boolean(fileBridge);
  const channelOpen = fileDataChannel?.readyState === "open";
  chooseSaveDirectoryButton.disabled = !hasBridge;
  sendFileButton.disabled = !hasBridge || !saveDirectory || !channelOpen;

  if (!hasBridge) {
    fileDropZone.textContent = "File transfer unavailable";
  } else if (!saveDirectory) {
    fileDropZone.textContent = "Choose a save folder first";
  } else if (!channelOpen) {
    fileDropZone.textContent = "Files available after peer connects";
  } else if (activeOutgoingTransfer || outgoingFileQueue.length) {
    fileDropZone.textContent = "Drop files to add them to the queue";
  } else {
    fileDropZone.textContent = "Drop files to send";
  }
}

function setChatControlsState() {
  const channelOpen = chatDataChannel?.readyState === "open";
  const hasDraft = chatInput.value.trim().length > 0;
  sendChatButton.disabled = !channelOpen || !hasDraft;
  chatInput.disabled = !channelOpen;
  clearChatButton.disabled = chatMessages.childElementCount === 0;
}

function updateChatInputHeight() {
  chatInput.style.height = "auto";
  const maxHeight = Number.parseInt(window.getComputedStyle(chatInput).maxHeight, 10) || 132;
  const nextHeight = Math.min(chatInput.scrollHeight, maxHeight);
  chatInput.style.height = `${nextHeight}px`;
}

function scrollChatToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function notifyChatActivity() {
  window.requestAnimationFrame(scrollChatToBottom);
}

function normalizePipCorner(corner) {
  return ["top-left", "top-right", "bottom-left", "bottom-right"].includes(corner)
    ? corner
    : "bottom-right";
}

function getPipTile() {
  return videoMain === "local" ? remoteTile : localTile;
}

function applyVideoLayout() {
  pipCorner = normalizePipCorner(pipCorner);
  videoGrid.classList.toggle("local-main", videoMain === "local");
  videoGrid.classList.remove("pip-top-left", "pip-top-right", "pip-bottom-left", "pip-bottom-right");
  videoGrid.classList.add(`pip-${pipCorner}`);
  [localTile, remoteTile].forEach((tile) => {
    tile.style.left = "";
    tile.style.top = "";
    tile.style.right = "";
    tile.style.bottom = "";
    tile.classList.remove("is-dragging");
  });
}

function toggleVideoMain() {
  videoMain = videoMain === "local" ? "remote" : "local";
  localStorage.setItem("kaplia-video-main", videoMain);
  applyVideoLayout();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getNearestPipCorner(pointerX, pointerY) {
  const rect = videoGrid.getBoundingClientRect();
  const horizontal = pointerX - rect.left < rect.width / 2 ? "left" : "right";
  const vertical = pointerY - rect.top < rect.height / 2 ? "top" : "bottom";
  return `${vertical}-${horizontal}`;
}

function startPipDrag(event) {
  if (event.button !== 0) {
    return;
  }

  const tile = event.target.closest(".video-tile");
  if (!tile || tile !== getPipTile()) {
    return;
  }

  const tileRect = tile.getBoundingClientRect();
  pipDragState = {
    pointerId: event.pointerId,
    tile,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - tileRect.left,
    offsetY: event.clientY - tileRect.top,
    moved: false
  };

  tile.setPointerCapture(event.pointerId);
  tile.classList.add("is-dragging");
  event.preventDefault();
}

function movePipDrag(event) {
  if (!pipDragState || event.pointerId !== pipDragState.pointerId) {
    return;
  }

  const dx = event.clientX - pipDragState.startX;
  const dy = event.clientY - pipDragState.startY;
  if (Math.hypot(dx, dy) > 4) {
    pipDragState.moved = true;
  }

  const gridRect = videoGrid.getBoundingClientRect();
  const tileRect = pipDragState.tile.getBoundingClientRect();
  const margin = 12;
  const left = clamp(event.clientX - gridRect.left - pipDragState.offsetX, margin, gridRect.width - tileRect.width - margin);
  const top = clamp(event.clientY - gridRect.top - pipDragState.offsetY, margin, gridRect.height - tileRect.height - margin);

  pipDragState.tile.style.left = `${left}px`;
  pipDragState.tile.style.top = `${top}px`;
  pipDragState.tile.style.right = "auto";
  pipDragState.tile.style.bottom = "auto";
}

function finishPipDrag(event) {
  if (!pipDragState || event.pointerId !== pipDragState.pointerId) {
    return;
  }

  const { tile, moved } = pipDragState;

  if (tile.hasPointerCapture(event.pointerId)) {
    tile.releasePointerCapture(event.pointerId);
  }

  if (moved) {
    pipCorner = getNearestPipCorner(event.clientX, event.clientY);
    localStorage.setItem("kaplia-pip-corner", pipCorner);
    suppressNextVideoClick = true;
    window.setTimeout(() => {
      suppressNextVideoClick = false;
    }, 0);
  }

  pipDragState = null;
  applyVideoLayout();
}

function cancelPipDrag(event) {
  if (!pipDragState || event.pointerId !== pipDragState.pointerId) {
    return;
  }

  pipDragState = null;
  applyVideoLayout();
}

function appendTextWithLinks(container, text) {
  const pattern = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  let cursor = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) {
      container.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    const rawUrl = match[0];
    const trailingMatch = rawUrl.match(/[.,!?;:]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const visibleUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    const href = visibleUrl.startsWith("www.") ? `https://${visibleUrl}` : visibleUrl;

    try {
      const parsed = new URL(href);
      const link = document.createElement("a");
      link.href = parsed.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = visibleUrl;
      container.append(link);
    } catch (error) {
      container.append(document.createTextNode(visibleUrl));
    }

    if (trailing) {
      container.append(document.createTextNode(trailing));
    }

    cursor = match.index + rawUrl.length;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    container.append(document.createTextNode(text.slice(cursor)));
  }
}

function createChatShell(direction, options = {}) {
  const message = document.createElement("article");
  message.className = `chat-message ${direction === "outgoing" ? "outgoing" : "incoming"}`;

  if (options.kind) {
    message.classList.add(options.kind);
  }

  const meta = document.createElement("div");
  meta.className = "chat-message-meta";
  meta.textContent = direction === "outgoing" ? "You" : "Peer";

  const body = document.createElement("div");
  body.className = "chat-message-body";

  message.append(meta, body);
  chatMessages.append(message);
  setChatControlsState();

  if (options.notify !== false) {
    notifyChatActivity();
  } else {
    window.requestAnimationFrame(scrollChatToBottom);
  }

  return {
    message,
    body
  };
}

function addChatMessage(direction, text, options = {}) {
  const shell = createChatShell(direction, options);
  shell.body.classList.add("chat-text");
  appendTextWithLinks(shell.body, text);
  return shell.message;
}

function createTransferItem(id, direction, fileName, size) {
  const isOutgoing = direction === "Sending" || direction === "Queued";
  const shell = createChatShell(isOutgoing ? "outgoing" : "incoming", {
    kind: "file-message",
    notify: !isOutgoing
  });
  const item = document.createElement("div");
  item.className = "file-transfer-item";

  const topline = document.createElement("div");
  topline.className = "file-transfer-topline";

  const name = document.createElement("div");
  name.className = "file-transfer-name";
  name.textContent = `${direction}: ${fileName}`;

  const status = document.createElement("div");
  status.className = "file-transfer-status";
  status.textContent = `0% of ${formatBytes(size)}`;

  const track = document.createElement("div");
  track.className = "file-progress-track";

  const bar = document.createElement("div");
  bar.className = "file-progress-bar";

  topline.append(name, status);
  track.append(bar);
  item.append(topline, track);
  shell.body.append(item);

  const entry = {
    item: shell.message,
    status,
    bar,
    size
  };

  transferItems.set(id, entry);
  setFileControlsState();
  setChatControlsState();
  window.requestAnimationFrame(scrollChatToBottom);
  return entry;
}

function updateTransferItem(id, received, statusText) {
  const entry = transferItems.get(id);
  if (!entry) {
    return;
  }

  const percent = entry.size > 0 ? Math.min(100, Math.round((received / entry.size) * 100)) : 100;
  entry.bar.style.width = `${percent}%`;
  entry.status.textContent = statusText || `${percent}% of ${formatBytes(entry.size)}`;
}

function clearTransferItems() {
  transferItems.clear();
  setFileControlsState();
}

function clearChatHistory(options = {}) {
  const { notifyPeer = false } = options;
  clearTransferItems();
  chatMessages.replaceChildren();
  setChatControlsState();

  if (notifyPeer && chatDataChannel?.readyState === "open") {
    sendChatControlMessage({
      kind: "chat-clear"
    });
  }
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("Signaling server is not connected.");
  }

  socket.send(JSON.stringify(message));
}

function waitForSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socketReadyResolvers = socketReadyResolvers.filter((entry) => entry.resolve !== resolve);
      reject(new Error("Timed out while connecting to signaling server."));
    }, 7000);

    socketReadyResolvers.push({
      resolve: () => {
        window.clearTimeout(timeout);
        resolve();
      },
      reject
    });
  });
}

function resolveSocketWaiters() {
  const waiters = socketReadyResolvers;
  socketReadyResolvers = [];
  waiters.forEach((entry) => entry.resolve());
}

function rejectSocketWaiters(error) {
  const waiters = socketReadyResolvers;
  socketReadyResolvers = [];
  waiters.forEach((entry) => entry.reject(error));
}

function connectSignaling() {
  window.clearTimeout(socketReconnectTimer);

  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
    return;
  }

  setSignalingState("connecting", "Connecting to signaling server");
  socket = new WebSocket(config.signalingUrl);

  socket.addEventListener("open", () => {
    socketReconnectAttempt = 0;
    setSignalingState("connected", "Signaling server connected");
    resolveSocketWaiters();

    if (currentRoomId && !manuallyLeft) {
      sendMessage({ type: "join", roomId: currentRoomId });
    }
  });

  socket.addEventListener("message", async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleSignalingMessage(message);
    } catch (error) {
      setRoomError(error.message || "Could not process signaling message.");
    }
  });

  socket.addEventListener("close", () => {
    rejectSocketWaiters(new Error("Signaling server disconnected."));
    setSignalingState("failed", "Signaling server disconnected");

    if (currentRoomId && !manuallyLeft) {
      setRoomError("Signaling disconnected. Reconnecting...");
    }

    const delay = Math.min(reconnectBaseDelay * 2 ** socketReconnectAttempt, reconnectMaxDelay);
    socketReconnectAttempt += 1;
    socketReconnectTimer = window.setTimeout(connectSignaling, delay);
  });

  socket.addEventListener("error", () => {
    setSignalingState("failed", "Signaling server connection error");
  });
}

async function handleSignalingMessage(message) {
  switch (message.type) {
    case "joined":
      currentRoomId = message.roomId;
      setRoomError(message.peerCount === 2 ? "" : "Waiting for another participant...");
      setWebRtcState("connecting", message.peerCount === 2 ? "Connecting" : "Waiting for peer");
      break;
    case "peer-joined":
      setRoomError("");
      setWebRtcState("connecting", "Connecting");
      await createAndSendOffer();
      break;
    case "peer-left":
      handlePeerLeft();
      break;
    case "signal":
      await handlePeerSignal(message.signal);
      break;
    case "error":
      const errorMessage = message.message || "Signaling error.";
      setRoomError(errorMessage);
      if (message.code === "room-full" || message.code === "room-not-found") {
        await leaveCall(false);
        setHomeError(errorMessage);
      }
      break;
    default:
      break;
  }
}

async function fetchIceServers() {
  const response = await fetch(getHttpUrl("/ice-config"), {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Could not load STUN/TURN configuration.");
  }

  const payload = await response.json();
  return payload.iceServers || [];
}

async function requestLocalMedia() {
  if (localStream && localStream.active) {
    return localStream;
  }

  const constraints = {
    audio: {
      ...(selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: {
      ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 }
    }
  };

  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (!selectedCameraId && !selectedMicrophoneId) {
      throw error;
    }

    selectedCameraId = "";
    selectedMicrophoneId = "";
    localStorage.removeItem("kaplia-camera-id");
    localStorage.removeItem("kaplia-microphone-id");
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
  }

  localVideo.srcObject = localStream;
  syncTrackState();
  await refreshDeviceList();
  return localStream;
}

function syncTrackState() {
  if (!localStream) {
    return;
  }

  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !micMuted;
  });

  localStream.getVideoTracks().forEach((track) => {
    track.enabled = !cameraOff;
  });

  muteButton.textContent = micMuted ? "Unmute mic" : "Mute mic";
  cameraButton.textContent = cameraOff ? "Camera on" : "Camera off";
  localPlaceholder.classList.toggle("hidden", (isScreenSharing || !cameraOff) && localStream.getVideoTracks().length > 0);
}

async function refreshDeviceList() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const speakers = devices.filter((device) => device.kind === "audiooutput");

  setSelectOptions(cameraSelect, cameras, "Camera");
  setSelectOptions(microphoneSelect, microphones, "Microphone");
  setSelectOptions(speakerSelect, speakers, "Speaker");

  if (selectedCameraId && cameras.some((device) => device.deviceId === selectedCameraId)) {
    cameraSelect.value = selectedCameraId;
  }

  if (selectedMicrophoneId && microphones.some((device) => device.deviceId === selectedMicrophoneId)) {
    microphoneSelect.value = selectedMicrophoneId;
  }

  if (selectedSpeakerId && speakers.some((device) => device.deviceId === selectedSpeakerId)) {
    speakerSelect.value = selectedSpeakerId;
  }

  speakerSelect.disabled = typeof remoteVideo.setSinkId !== "function" || speakers.length === 0;
}

async function switchCamera(deviceId) {
  selectedCameraId = deviceId;
  localStorage.setItem("kaplia-camera-id", deviceId);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 }
    },
    audio: false
  });
  const [newTrack] = stream.getVideoTracks();
  const oldTrack = localStream?.getVideoTracks()[0];

  if (oldTrack) {
    localStream.removeTrack(oldTrack);
    oldTrack.stop();
  }

  localStream.addTrack(newTrack);
  newTrack.enabled = !cameraOff;

  if (!isScreenSharing) {
    await getVideoSender()?.replaceTrack(newTrack);
    localVideo.srcObject = localStream;
  }

  syncTrackState();
  await refreshDeviceList();
}

async function switchMicrophone(deviceId) {
  selectedMicrophoneId = deviceId;
  localStorage.setItem("kaplia-microphone-id", deviceId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  });
  const [newTrack] = stream.getAudioTracks();
  const oldTrack = localStream?.getAudioTracks()[0];

  if (oldTrack) {
    localStream.removeTrack(oldTrack);
    oldTrack.stop();
  }

  localStream.addTrack(newTrack);
  newTrack.enabled = !micMuted;
  await getAudioSender()?.replaceTrack(newTrack);
  syncTrackState();
  await refreshDeviceList();
}

async function switchSpeaker(deviceId) {
  selectedSpeakerId = deviceId;
  localStorage.setItem("kaplia-speaker-id", deviceId);

  if (typeof remoteVideo.setSinkId === "function") {
    await remoteVideo.setSinkId(deviceId);
  }
}

function updateScreenShareUi() {
  screenShareBanner.classList.toggle("hidden", !isScreenSharing);
  screenShareButton.textContent = isScreenSharing ? "Sharing screen" : "Share screen";
  screenShareButton.disabled = isScreenSharing || !peerConnection;
  localTileLabel.textContent = isScreenSharing ? "Your screen" : "You";
  remoteTileLabel.textContent = isPeerScreenSharing ? "Remote screen" : "Remote";
}

async function getScreenSources() {
  if (!window.kaplia?.screens?.getSources) {
    throw new Error("Screen sharing is available only in the Electron app.");
  }

  const sources = await window.kaplia.screens.getSources();
  return sources.filter((source) => source.id);
}

function chooseScreenSource(sources) {
  return new Promise((resolve) => {
    screenSourceList.replaceChildren();
    screenPicker.classList.remove("hidden");

    const cleanup = (source = null) => {
      screenPicker.classList.add("hidden");
      screenSourceList.replaceChildren();
      cancelScreenPickerButton.removeEventListener("click", onCancel);
      resolve(source);
    };

    const onCancel = () => cleanup(null);
    cancelScreenPickerButton.addEventListener("click", onCancel);

    sources.forEach((source, index) => {
      const button = document.createElement("button");
      button.className = "screen-source-button";
      button.type = "button";

      if (source.thumbnail) {
        const image = document.createElement("img");
        image.src = source.thumbnail;
        image.alt = "";
        button.append(image);
      }

      const label = document.createElement("span");
      label.textContent = source.name || `Screen ${index + 1}`;
      button.append(label);
      button.addEventListener("click", () => cleanup(source));
      screenSourceList.append(button);
    });
  });
}

async function getDesktopStream(source) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: source.id,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30
      }
    }
  });
}

async function startScreenShare() {
  if (isScreenSharing) {
    return;
  }

  const sources = await getScreenSources();
  if (!sources.length) {
    throw new Error("No screens are available for sharing.");
  }

  const source = sources.length === 1 ? sources[0] : await chooseScreenSource(sources);
  if (!source) {
    return;
  }

  screenStream = await getDesktopStream(source);
  const [screenTrack] = screenStream.getVideoTracks();
  const sender = getVideoSender();

  if (!sender) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
    throw new Error("Video sender is not ready yet.");
  }

  await sender.replaceTrack(screenTrack);
  localVideo.srcObject = screenStream;
  isScreenSharing = true;
  cameraButton.disabled = true;
  screenTrack.addEventListener("ended", () => {
    stopScreenShare().catch((error) => setRoomError(error.message || "Could not stop screen sharing."));
  });

  if (chatDataChannel?.readyState === "open") {
    sendChatControlMessage({
      kind: "screen-share-status",
      active: true
    });
  }
  updateScreenShareUi();
  setRoomError("You are sharing your screen.");
}

async function stopScreenShare() {
  if (!isScreenSharing) {
    return;
  }

  const cameraTrack = localStream?.getVideoTracks()[0] || null;
  await getVideoSender()?.replaceTrack(cameraTrack);

  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
  }

  screenStream = null;
  isScreenSharing = false;
  cameraButton.disabled = false;
  localVideo.srcObject = localStream;
  syncTrackState();

  if (chatDataChannel?.readyState === "open") {
    sendChatControlMessage({
      kind: "screen-share-status",
      active: false
    });
  }

  updateScreenShareUi();
  setRoomError("");
}

function resetScreenShareState() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
  }

  screenStream = null;
  isScreenSharing = false;
  isPeerScreenSharing = false;
  cameraButton.disabled = false;
  localVideo.srcObject = localStream;
  updateScreenShareUi();
}

async function chooseSaveDirectory(options = {}) {
  const { required = false } = options;

  if (!fileBridge) {
    setHomeError("File storage is unavailable in this runtime.");
    return false;
  }

  const result = await fileBridge.chooseSaveDirectory();
  updateSaveDirectoryUi(result.saveDirectory);

  if (!result.saveDirectory) {
    const message = "Choose a save folder before creating or joining rooms.";

    if (required) {
      setHomeError(message);
    }

    return false;
  }

  setHomeError("");
  setRoomError("");
  return true;
}

async function ensureSaveDirectoryConfigured(options = {}) {
  if (fileBridge && saveDirectory) {
    return true;
  }

  return chooseSaveDirectory({
    required: options.prompt !== false
  });
}

async function loadFileSettings(options = {}) {
  fileBridge = window.kaplia?.files || null;

  if (!fileBridge) {
    homeSaveDirectory.textContent = "Unavailable";
    fileSaveDirectory.textContent = "Unavailable";
    setHomeError("File storage is unavailable in this runtime.");
    setHomeControlsState();
    setFileControlsState();
    setChatControlsState();
    return;
  }

  const settings = await fileBridge.getSettings();
  updateSaveDirectoryUi(settings.saveDirectory);

  if (!settings.saveDirectory && options.promptIfMissing) {
    await chooseSaveDirectory({ required: true });
  }
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return new Uint8Array(value);
}

function getChunkArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function sendFileControlMessage(message) {
  if (!fileDataChannel || fileDataChannel.readyState !== "open") {
    throw new Error("File channel is not open.");
  }

  fileDataChannel.send(JSON.stringify(message));
}

function sendChatControlMessage(message) {
  if (!chatDataChannel || chatDataChannel.readyState !== "open") {
    throw new Error("Chat channel is not open.");
  }

  chatDataChannel.send(JSON.stringify(message));
}

function waitForFileReady(transferId) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      fileReadyResolvers.delete(transferId);
      reject(new Error("Peer did not accept the file transfer."));
    }, 10000);

    fileReadyResolvers.set(transferId, {
      resolve: () => {
        window.clearTimeout(timeout);
        resolve();
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function settleFileReady(transferId, error = null) {
  const resolver = fileReadyResolvers.get(transferId);
  if (!resolver) {
    return;
  }

  fileReadyResolvers.delete(transferId);

  if (error) {
    resolver.reject(error);
  } else {
    resolver.resolve();
  }
}

function waitForFileSaved(transferId) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      fileSavedResolvers.delete(transferId);
      reject(new Error("Peer did not confirm saved file checksum."));
    }, 30000);

    fileSavedResolvers.set(transferId, {
      resolve: (message) => {
        window.clearTimeout(timeout);
        resolve(message);
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function settleFileSaved(transferId, message = null, error = null) {
  const resolver = fileSavedResolvers.get(transferId);
  if (!resolver) {
    return;
  }

  fileSavedResolvers.delete(transferId);

  if (error) {
    resolver.reject(error);
  } else {
    resolver.resolve(message);
  }
}

function rejectAllFileReady(error) {
  fileReadyResolvers.forEach((resolver) => resolver.reject(error));
  fileReadyResolvers.clear();
  fileSavedResolvers.forEach((resolver) => resolver.reject(error));
  fileSavedResolvers.clear();
}

function enqueueIncomingWrite(task) {
  const nextTask = incomingWriteQueue.catch(() => {}).then(task);
  incomingWriteQueue = nextTask;
  return nextTask;
}

async function waitForFileChannelBuffer() {
  if (!fileDataChannel || fileDataChannel.readyState !== "open") {
    throw new Error("File channel is not open.");
  }

  if (fileDataChannel.bufferedAmount <= FILE_BUFFER_LIMIT) {
    return;
  }

  await new Promise((resolve, reject) => {
    const channel = fileDataChannel;
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      window.clearInterval(interval);
    };
    const onLow = () => {
      if (channel.bufferedAmount <= FILE_BUFFER_LOW_THRESHOLD) {
        cleanup();
        resolve();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("File channel closed during transfer."));
    };
    const interval = window.setInterval(onLow, 50);

    channel.addEventListener("bufferedamountlow", onLow);
    channel.addEventListener("close", onClose, { once: true });
    onLow();
  });
}

function closeFileDataChannel() {
  rejectAllFileReady(new Error("File channel closed."));

  if (fileDataChannel) {
    fileDataChannel.close();
  }

  fileDataChannel = null;
  activeOutgoingTransfer = null;
  outgoingFileQueue = [];
  fileQueueRunning = false;

  if (activeIncomingTransfer && fileBridge) {
    fileBridge.cancelReceive({ transferId: activeIncomingTransfer.id }).catch(() => {});
  }

  activeIncomingTransfer = null;
  setFileControlsState();
}

function closeChatDataChannel() {
  if (chatDataChannel) {
    chatDataChannel.close();
  }

  chatDataChannel = null;
  setChatControlsState();
}

function setupFileDataChannel(channel) {
  if (fileDataChannel && fileDataChannel !== channel) {
    fileDataChannel.close();
  }

  fileDataChannel = channel;
  fileDataChannel.binaryType = "arraybuffer";
  fileDataChannel.bufferedAmountLowThreshold = FILE_BUFFER_LOW_THRESHOLD;

  fileDataChannel.addEventListener("open", () => {
    setFileControlsState();
  });

  fileDataChannel.addEventListener("close", () => {
    if (fileDataChannel === channel) {
      closeFileDataChannel();
    }
  });

  fileDataChannel.addEventListener("error", () => {
    setRoomError("File channel error. Audio/video may still be connected.");
  });

  fileDataChannel.addEventListener("message", (event) => {
    handleFileChannelMessage(event).catch((error) => {
      if (activeIncomingTransfer) {
        const transferId = activeIncomingTransfer.id;
        try {
          sendFileControlMessage({
            kind: "file-error",
            id: transferId,
            message: error.message || "File transfer failed."
          });
        } catch (notifyError) {
          // The data channel may already be closed.
        }
        fileBridge?.cancelReceive({ transferId }).catch(() => {});
        updateTransferItem(transferId, activeIncomingTransfer.received, error.message || "Failed");
        activeIncomingTransfer = null;
      }

      setRoomError(error.message || "File transfer error.");
    });
  });

  setFileControlsState();
}

function setupChatDataChannel(channel) {
  if (chatDataChannel && chatDataChannel !== channel) {
    chatDataChannel.close();
  }

  chatDataChannel = channel;

  chatDataChannel.addEventListener("open", () => {
    setChatControlsState();
    if (isScreenSharing) {
      sendChatControlMessage({
        kind: "screen-share-status",
        active: true
      });
    }
  });

  chatDataChannel.addEventListener("close", () => {
    if (chatDataChannel === channel) {
      chatDataChannel = null;
      setChatControlsState();
    }
  });

  chatDataChannel.addEventListener("error", () => {
    setRoomError("Chat channel error. Audio/video may still be connected.");
  });

  chatDataChannel.addEventListener("message", (event) => {
    handleChatChannelMessage(event).catch((error) => {
      setRoomError(error.message || "Chat message error.");
    });
  });

  setChatControlsState();
}

function createLocalFileDataChannel() {
  if (!peerConnection) {
    return;
  }

  setupFileDataChannel(peerConnection.createDataChannel("kaplia-files", {
    ordered: true
  }));
}

function createLocalChatDataChannel() {
  if (!peerConnection) {
    return;
  }

  setupChatDataChannel(peerConnection.createDataChannel("kaplia-chat", {
    ordered: true
  }));
}

async function handleChatChannelMessage(event) {
  if (typeof event.data !== "string") {
    return;
  }

  const message = JSON.parse(event.data);

  if (message.kind === "chat-message") {
    const text = String(message.text || "");
    if (text) {
      addChatMessage("incoming", text);
    }
    return;
  }

  if (message.kind === "chat-clear" || message.kind === "file-history-clear") {
    clearChatHistory({ notifyPeer: false });
    return;
  }

  if (message.kind === "screen-share-status") {
    isPeerScreenSharing = Boolean(message.active);
    updateScreenShareUi();
    setRoomError(isPeerScreenSharing ? "Peer is sharing their screen." : "");
    return;
  }
}

function sendChatMessage() {
  const text = chatInput.value;

  if (!text.trim()) {
    return;
  }

  if (text.length > CHAT_MAX_CHARS) {
    setRoomError(`Message is too long. Limit is ${CHAT_MAX_CHARS} characters.`);
    return;
  }

  const message = {
    kind: "chat-message",
    id: crypto.randomUUID(),
    text,
    sentAt: Date.now()
  };

  sendChatControlMessage(message);
  addChatMessage("outgoing", text, { notify: false });
  chatInput.value = "";
  updateChatInputHeight();
  setChatControlsState();
}

async function handleFileChannelMessage(event) {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data);

    if (message.kind === "file-meta") {
      await handleIncomingFileMeta(message);
      return;
    }

    if (message.kind === "file-ready") {
      settleFileReady(message.id);
      return;
    }

    if (message.kind === "file-saved") {
      settleFileSaved(message.id, message);
      updateTransferItem(message.id, Number(message.size || 0), "Peer saved and verified");
      return;
    }

    if (message.kind === "file-history-clear") {
      clearChatHistory({ notifyPeer: false });
      return;
    }

    if (message.kind === "file-complete") {
      await handleIncomingFileComplete(message.id);
      return;
    }

    if (message.kind === "file-error") {
      const transferError = new Error(message.message || "Peer rejected the file transfer.");
      settleFileReady(message.id, transferError);
      settleFileSaved(message.id, null, transferError);
      if (activeIncomingTransfer?.id === message.id) {
        fileBridge?.cancelReceive({ transferId: message.id }).catch(() => {});
        updateTransferItem(message.id, activeIncomingTransfer.received, message.message || "Failed");
        activeIncomingTransfer = null;
      }
      updateTransferItem(
        message.id,
        activeOutgoingTransfer?.sent || transferItems.get(message.id)?.size || 0,
        message.message || "Failed"
      );
      return;
    }

    return;
  }

  await enqueueIncomingWrite(() => handleIncomingFileChunk(toUint8Array(event.data)));
}

async function handleIncomingFileMeta(message) {
  if (!fileBridge) {
    sendFileControlMessage({
      kind: "file-error",
      id: message.id,
      message: "Peer cannot save files in this runtime."
    });
    return;
  }

  if (activeIncomingTransfer) {
    sendFileControlMessage({
      kind: "file-error",
      id: message.id,
      message: "Peer is already receiving a file."
    });
    return;
  }

  const size = Number(message.size || 0);
  const fileName = String(message.name || "received-file");
  incomingWriteQueue = Promise.resolve();
  const started = await fileBridge.startReceive({
    transferId: message.id,
    fileName,
    size
  });

  activeIncomingTransfer = {
    id: message.id,
    name: started.fileName || fileName,
    size,
    received: 0,
    filePath: started.filePath,
    sha256: message.sha256 || ""
  };

  createTransferItem(message.id, "Receiving", activeIncomingTransfer.name, size);
  updateTransferItem(message.id, 0, `0% of ${formatBytes(size)}`);
  sendFileControlMessage({
    kind: "file-ready",
    id: message.id
  });
}

async function handleIncomingFileChunk(bytes) {
  if (!activeIncomingTransfer) {
    return;
  }

  const result = await fileBridge.writeReceiveChunk({
    transferId: activeIncomingTransfer.id,
    chunk: bytes
  });

  activeIncomingTransfer.received = result.received;
  updateTransferItem(
    activeIncomingTransfer.id,
    activeIncomingTransfer.received,
    `${formatBytes(activeIncomingTransfer.received)} / ${formatBytes(activeIncomingTransfer.size)}`
  );
}

async function handleIncomingFileComplete(transferId) {
  if (!activeIncomingTransfer || activeIncomingTransfer.id !== transferId) {
    return;
  }

  await incomingWriteQueue;
  const finished = await fileBridge.finishReceive({
    transferId,
    sha256: activeIncomingTransfer.sha256
  });

  updateTransferItem(transferId, activeIncomingTransfer.size, `Saved ${formatBytes(finished.received)}, verified`);
  sendFileControlMessage({
    kind: "file-saved",
    id: transferId,
    size: finished.received,
    sha256: finished.sha256
  });
  activeIncomingTransfer = null;
}

function enqueueFile(fileInfo) {
  if (!fileBridge) {
    throw new Error("File transfer is unavailable.");
  }

  if (!fileDataChannel || fileDataChannel.readyState !== "open") {
    throw new Error("Wait until the peer is connected before sending files.");
  }

  const transferId = crypto.randomUUID();
  const size = Number(fileInfo.size || 0);
  outgoingFileQueue.push({
    transferId,
    fileInfo,
    size
  });
  createTransferItem(transferId, "Queued", fileInfo.fileName, size);
  updateTransferItem(transferId, 0, `Queued · ${formatBytes(size)}`);
  setFileControlsState();
  processFileQueue().catch((error) => {
    setRoomError(error.message || "File queue failed.");
  });
}

async function processFileQueue() {
  if (fileQueueRunning) {
    return;
  }

  fileQueueRunning = true;

  try {
    while (outgoingFileQueue.length) {
      const next = outgoingFileQueue.shift();
      try {
        await sendQueuedFile(next);
      } catch (error) {
        setRoomError(error.message || "File transfer failed.");
        if (!fileDataChannel || fileDataChannel.readyState !== "open") {
          outgoingFileQueue = [];
          break;
        }
      }
    }
  } finally {
    fileQueueRunning = false;
    setFileControlsState();
  }
}

async function sendQueuedFile(queueItem) {
  const { transferId, fileInfo, size } = queueItem;
  activeOutgoingTransfer = {
    id: transferId,
    fileInfo,
    sent: 0,
    size
  };

  updateTransferItem(transferId, 0, `Sending · 0% of ${formatBytes(size)}`);
  setFileControlsState();

  try {
    sendFileControlMessage({
      kind: "file-meta",
      id: transferId,
      name: fileInfo.fileName,
      size,
      sha256: fileInfo.sha256 || "",
      lastModified: fileInfo.lastModified || 0
    });

    await waitForFileReady(transferId);

    for (let offset = 0; offset < size; offset += FILE_CHUNK_SIZE) {
      const length = Math.min(FILE_CHUNK_SIZE, size - offset);
      const chunk = await fileBridge.readChunk({
        path: fileInfo.path,
        offset,
        length
      });
      const bytes = toUint8Array(chunk);

      fileDataChannel.send(getChunkArrayBuffer(bytes));
      activeOutgoingTransfer.sent += bytes.byteLength;
      updateTransferItem(
        transferId,
        activeOutgoingTransfer.sent,
        `${formatBytes(activeOutgoingTransfer.sent)} / ${formatBytes(size)}`
      );

      await waitForFileChannelBuffer();
    }

    sendFileControlMessage({
      kind: "file-complete",
      id: transferId
    });
    updateTransferItem(transferId, size, "Sent, verifying...");
    await waitForFileSaved(transferId);
    updateTransferItem(transferId, size, `Sent and verified ${formatBytes(size)}`);
  } catch (error) {
    try {
      sendFileControlMessage({
        kind: "file-error",
        id: transferId,
        message: error.message || "File transfer failed."
      });
    } catch (notifyError) {
      // The channel may already be closed; keep the original transfer error visible.
    }
    updateTransferItem(transferId, activeOutgoingTransfer?.sent || 0, error.message || "Failed");
    throw error;
  } finally {
    activeOutgoingTransfer = null;
    setFileControlsState();
  }
}

async function chooseAndSendFile() {
  if (!fileBridge) {
    return;
  }

  const fileInfo = await fileBridge.chooseSendFile();
  if (fileInfo.canceled) {
    return;
  }

  const files = Array.isArray(fileInfo.files) ? fileInfo.files : [fileInfo];
  files.forEach(enqueueFile);
}

async function sendDroppedFile(file) {
  if (!fileBridge || !file) {
    return;
  }

  const filePath = fileBridge.getPathForFile(file);
  if (!filePath) {
    throw new Error("Could not read dropped file path.");
  }

  const fileInfo = await fileBridge.describePath(filePath);
  enqueueFile(fileInfo);
}

function createPeerConnection() {
  closePeerConnection(false);

  peerConnection = new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 4
  });

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.addEventListener("track", (event) => {
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteVideo.srcObject = remoteStream;
      remotePlaceholder.classList.add("hidden");
    }
  });

  peerConnection.addEventListener("datachannel", (event) => {
    if (event.channel.label === "kaplia-files") {
      setupFileDataChannel(event.channel);
    }

    if (event.channel.label === "kaplia-chat") {
      setupChatDataChannel(event.channel);
    }
  });

  peerConnection.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      sendSignal({
        type: "ice-candidate",
        candidate: event.candidate
      });
    }
  });

  peerConnection.addEventListener("iceconnectionstatechange", () => {
    const state = peerConnection.iceConnectionState;
    if (["failed", "disconnected"].includes(state)) {
      setWebRtcState("failed", state === "failed" ? "Failed" : "Disconnected");
    } else if (state === "connected" || state === "completed") {
      setWebRtcState("connected", "Connected");
      startStatsPolling();
    } else {
      setWebRtcState("connecting", state);
    }
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    const state = peerConnection.connectionState;
    if (state === "connected") {
      setWebRtcState("connected", "Connected");
      setRoomError("");
      startStatsPolling();
    }

    if (state === "failed") {
      setWebRtcState("failed", "Failed");
      setRoomError("WebRTC connection failed. Leave and rejoin the room.");
    }

    if (state === "disconnected") {
      setWebRtcState("failed", "Peer disconnected");
      setRoomError("Peer disconnected. Waiting for recovery or rejoin.");
    }
  });

  return peerConnection;
}

function sendSignal(signal) {
  if (!currentRoomId) {
    return;
  }

  sendMessage({
    type: "signal",
    roomId: currentRoomId,
    signal
  });
}

async function createAndSendOffer() {
  if (!peerConnection) {
    createPeerConnection();
  }

  if (!fileDataChannel || fileDataChannel.readyState === "closed") {
    createLocalFileDataChannel();
  }

  if (!chatDataChannel || chatDataChannel.readyState === "closed") {
    createLocalChatDataChannel();
  }

  if (isScreenSharing && screenStream) {
    await getVideoSender()?.replaceTrack(screenStream.getVideoTracks()[0]);
  }

  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true
  });
  await peerConnection.setLocalDescription(offer);
  updateSafetyCode().catch(() => {});

  sendSignal({
    type: "offer",
    description: peerConnection.localDescription
  });
}

async function handlePeerSignal(signal) {
  if (!peerConnection) {
    createPeerConnection();
  }

  if (signal.type === "offer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.description));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    updateSafetyCode().catch(() => {});
    sendSignal({
      type: "answer",
      description: peerConnection.localDescription
    });
  }

  if (signal.type === "answer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.description));
    updateSafetyCode().catch(() => {});
  }

  if (signal.type === "ice-candidate" && signal.candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

function extractSdpFingerprints(sdp = "") {
  return Array.from(sdp.matchAll(/^a=fingerprint:([^\s]+)\s+(.+)$/gim))
    .map((match) => `${match[1].toUpperCase()} ${match[2].replace(/\s+/g, "").toUpperCase()}`)
    .filter(Boolean);
}

async function updateSafetyCode() {
  const fingerprints = [
    ...extractSdpFingerprints(peerConnection?.localDescription?.sdp),
    ...extractSdpFingerprints(peerConnection?.remoteDescription?.sdp)
  ];
  const uniqueFingerprints = Array.from(new Set(fingerprints)).sort();

  if (uniqueFingerprints.length < 2 || !crypto.subtle) {
    safetyCode.textContent = "---";
    return;
  }

  const input = new TextEncoder().encode(uniqueFingerprints.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  safetyCode.textContent = `${hex.slice(0, 4)} ${hex.slice(4, 8)} ${hex.slice(8, 12)}`;
}

async function detectRelayType() {
  if (!peerConnection || peerConnection.connectionState !== "connected") {
    return;
  }

  const stats = await peerConnection.getStats();
  let selectedPair = null;
  let outboundVideo = null;
  let outboundAudio = null;
  let remoteInboundVideo = null;
  let remoteInboundAudio = null;

  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selectedPair = stats.get(report.selectedCandidatePairId);
    }

    if (report.type === "candidate-pair" && report.selected) {
      selectedPair = report;
    }

    if (report.type === "outbound-rtp" && !report.isRemote) {
      const kind = report.kind || report.mediaType;
      if (kind === "video") {
        outboundVideo = report;
      }
      if (kind === "audio") {
        outboundAudio = report;
      }
    }

    if (report.type === "remote-inbound-rtp") {
      const kind = report.kind || report.mediaType;
      if (kind === "video") {
        remoteInboundVideo = report;
      }
      if (kind === "audio") {
        remoteInboundAudio = report;
      }
    }
  });

  if (!selectedPair) {
    return;
  }

  const localCandidate = stats.get(selectedPair.localCandidateId);
  const remoteCandidate = stats.get(selectedPair.remoteCandidateId);
  const isRelayed = [localCandidate?.candidateType, remoteCandidate?.candidateType].includes("relay");
  const route = isRelayed ? "TURN relay" : "Direct P2P";
  const now = performance.now();
  const previous = lastStatsSnapshot;
  const videoBytes = Number(outboundVideo?.bytesSent || 0);
  const audioBytes = Number(outboundAudio?.bytesSent || 0);
  const elapsedSeconds = previous ? Math.max((now - previous.at) / 1000, 0.001) : 0;
  const videoKbps = previous ? ((videoBytes - previous.videoBytes) * 8) / elapsedSeconds / 1000 : 0;
  const audioKbps = previous ? ((audioBytes - previous.audioBytes) * 8) / elapsedSeconds / 1000 : 0;
  const videoTrackSettings = getVideoSender()?.track?.getSettings?.() || {};
  const width = outboundVideo?.frameWidth || videoTrackSettings.width || 0;
  const height = outboundVideo?.frameHeight || videoTrackSettings.height || 0;
  const fps = outboundVideo?.framesPerSecond || videoTrackSettings.frameRate || 0;
  const rtt = selectedPair.currentRoundTripTime || remoteInboundVideo?.roundTripTime || remoteInboundAudio?.roundTripTime || 0;
  const packetsLost = Number(remoteInboundVideo?.packetsLost || 0) + Number(remoteInboundAudio?.packetsLost || 0);
  const packetsSent = Number(outboundVideo?.packetsSent || 0) + Number(outboundAudio?.packetsSent || 0);
  const packetLossPercent = packetsSent > 0 ? (packetsLost / Math.max(packetsSent + packetsLost, 1)) * 100 : 0;

  lastStatsSnapshot = {
    at: now,
    videoBytes,
    audioBytes
  };

  qualityRoute.textContent = route;
  qualityResolution.textContent = width && height ? `${width}x${height}` : "-";
  qualityFps.textContent = fps ? `${Math.round(fps)}` : "-";
  qualityVideoBitrate.textContent = formatBitrate(videoKbps);
  qualityAudioBitrate.textContent = formatBitrate(audioKbps);
  qualityPacketLoss.textContent = packetsSent > 0 ? `${packetLossPercent.toFixed(1)}%` : "-";
  qualityRtt.textContent = rtt ? `${Math.round(rtt * 1000)} ms` : "-";

  const qualityLabel =
    packetLossPercent > 5 || rtt > 0.4
      ? "poor"
      : packetLossPercent > 2 || rtt > 0.2
        ? "fair"
        : "good";
  qualityStatus.textContent = `Quality: ${qualityLabel} · ${route}`;

  setWebRtcState("connected", isRelayed ? "Connected, relayed via TURN" : "Connected, direct P2P");
}

function startStatsPolling() {
  if (statsTimer) {
    return;
  }

  detectRelayType();
  statsTimer = window.setInterval(detectRelayType, QUALITY_POLL_INTERVAL_MS);
}

function stopStatsPolling() {
  window.clearInterval(statsTimer);
  statsTimer = null;
  lastStatsSnapshot = null;
}

function closePeerConnection(clearRemote = true) {
  stopStatsPolling();
  closeFileDataChannel();
  closeChatDataChannel();
  resetScreenShareState();

  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = null;
  updateScreenShareUi();
  safetyCode.textContent = "---";
  qualityStatus.textContent = "Quality: waiting";
  qualityRoute.textContent = "-";
  qualityResolution.textContent = "-";
  qualityFps.textContent = "-";
  qualityVideoBitrate.textContent = "-";
  qualityAudioBitrate.textContent = "-";
  qualityPacketLoss.textContent = "-";
  qualityRtt.textContent = "-";

  if (clearRemote) {
    remoteVideo.srcObject = null;
    remotePlaceholder.classList.remove("hidden");
  }
}

function handlePeerLeft() {
  setRoomError("Peer left the room. Waiting for another participant...");
  setWebRtcState("connecting", "Waiting for peer");
  closePeerConnection(true);

  if (localStream && localStream.active) {
    createPeerConnection();
  }
}

async function createRoom() {
  setHomeError("");
  setBusy(true);

  try {
    const hasSaveDirectory = await ensureSaveDirectoryConfigured();
    if (!hasSaveDirectory) {
      return;
    }

    await waitForSocket();
    const response = await fetch(getHttpUrl("/rooms"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Could not create room.");
    }

    roomIdInput.value = payload.roomId;
    await joinRoom(payload.roomId);
  } catch (error) {
    setHomeError(error.message);
  } finally {
    setBusy(false);
  }
}

async function joinRoom(roomIdValue) {
  const roomId = normalizeRoomId(roomIdValue || roomIdInput.value);
  setHomeError("");
  setRoomError("");

  const hasSaveDirectory = await ensureSaveDirectoryConfigured();
  if (!hasSaveDirectory) {
    return;
  }

  if (!ROOM_ID_PATTERN.test(roomId)) {
    setHomeError("Room ID must be 3-40 chars: letters, numbers, hyphens.");
    return;
  }

  setBusy(true);
  manuallyLeft = false;

  try {
    await waitForSocket();
    iceServers = await fetchIceServers();
    await requestLocalMedia();
    currentRoomId = roomId;
    createPeerConnection();
    sendMessage({ type: "join", roomId });
    showRoom(roomId);
  } catch (error) {
    setHomeError(error.message || "Could not join room.");
    await leaveCall(false);
  } finally {
    setBusy(false);
  }
}

function showRoom(roomId) {
  roomTitle.textContent = roomId;
  setAppWindowMode("room");
  homeScreen.classList.add("hidden");
  roomScreen.classList.remove("hidden");
  setWebRtcState("connecting", "Joining");
  updateScreenShareUi();
  refreshDeviceList().catch(() => {});
}

function showHome() {
  setAppWindowMode("home");
  roomScreen.classList.add("hidden");
  homeScreen.classList.remove("hidden");
}

async function leaveCall(notifyPeer = true) {
  manuallyLeft = true;

  if (notifyPeer && socket && socket.readyState === WebSocket.OPEN && currentRoomId) {
    sendMessage({ type: "leave", roomId: currentRoomId });
  }

  closePeerConnection(true);

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  localPlaceholder.classList.remove("hidden");
  currentRoomId = "";
  setRoomError("");
  setWebRtcState("connecting", "Idle");
  clearChatHistory({ notifyPeer: false });
  showHome();
}

createRoomButton.addEventListener("click", createRoom);

joinRoomButton.addEventListener("click", () => {
  joinRoom();
});

roomIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});

copyRoomButton.addEventListener("click", async () => {
  const roomIdToCopy = currentRoomId || roomTitle.textContent.trim();

  if (!roomIdToCopy || roomIdToCopy === "-") {
    return;
  }

  try {
    if (window.kaplia?.clipboard?.writeText) {
      await window.kaplia.clipboard.writeText(roomIdToCopy);
    } else {
      await navigator.clipboard.writeText(roomIdToCopy);
    }

    copyRoomButton.textContent = "Copied";
    setRoomError("");
    window.setTimeout(() => {
      copyRoomButton.textContent = "Copy ID";
    }, 1200);
  } catch (error) {
    setRoomError("Could not copy Room ID. Select it manually from the title.");
  }
});

homeChooseSaveDirectoryButton.addEventListener("click", () => {
  chooseSaveDirectory({ required: true }).catch((error) => {
    setHomeError(error.message || "Could not choose save folder.");
  });
});

chooseSaveDirectoryButton.addEventListener("click", () => {
  chooseSaveDirectory({ required: true }).catch((error) => {
    setRoomError(error.message || "Could not choose save folder.");
  });
});

sendFileButton.addEventListener("click", () => {
  chooseAndSendFile().catch((error) => {
    setRoomError(error.message || "Could not send file.");
  });
});

screenShareButton.addEventListener("click", () => {
  startScreenShare().catch((error) => {
    setRoomError(error.message || "Could not start screen sharing.");
    updateScreenShareUi();
  });
});

stopScreenShareButton.addEventListener("click", () => {
  stopScreenShare().catch((error) => {
    setRoomError(error.message || "Could not stop screen sharing.");
  });
});

devicesButton.addEventListener("click", () => {
  devicesPanel.classList.toggle("hidden");
  if (!devicesPanel.classList.contains("hidden")) {
    qualityPanel.classList.add("hidden");
    refreshDeviceList().catch((error) => {
      setRoomError(error.message || "Could not load device list.");
    });
  }
});

closeDevicesButton.addEventListener("click", () => {
  devicesPanel.classList.add("hidden");
});

qualityButton.addEventListener("click", () => {
  qualityPanel.classList.toggle("hidden");
  if (!qualityPanel.classList.contains("hidden")) {
    devicesPanel.classList.add("hidden");
  }
});

closeQualityButton.addEventListener("click", () => {
  qualityPanel.classList.add("hidden");
});

cameraSelect.addEventListener("change", () => {
  switchCamera(cameraSelect.value).catch((error) => {
    setRoomError(error.message || "Could not switch camera.");
  });
});

microphoneSelect.addEventListener("change", () => {
  switchMicrophone(microphoneSelect.value).catch((error) => {
    setRoomError(error.message || "Could not switch microphone.");
  });
});

speakerSelect.addEventListener("change", () => {
  switchSpeaker(speakerSelect.value).catch((error) => {
    setRoomError(error.message || "Could not switch speaker.");
  });
});

clearChatButton.addEventListener("click", () => {
  clearChatHistory({ notifyPeer: true });
});

videoGrid.addEventListener("pointerdown", startPipDrag);
videoGrid.addEventListener("pointermove", movePipDrag);
videoGrid.addEventListener("pointerup", finishPipDrag);
videoGrid.addEventListener("pointercancel", cancelPipDrag);

videoGrid.addEventListener("click", (event) => {
  const tile = event.target.closest(".video-tile");
  if (!tile) {
    return;
  }

  if (suppressNextVideoClick) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  toggleVideoMain();
});

[localTile, remoteTile].forEach((tile) => {
  tile.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleVideoMain();
    }
  });
});

chatInput.addEventListener("input", () => {
  updateChatInputHeight();
  setChatControlsState();
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    sendChatMessage();
  } catch (error) {
    setRoomError(error.message || "Could not send chat message.");
  }
});

document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types?.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }
});

document.addEventListener(
  "drop",
  (event) => {
    if (event.dataTransfer?.types?.includes("Files")) {
      if (fileDropZone.contains(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    }
  },
  true
);

fileDropZone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  fileDropZone.classList.add("is-dragging");
});

fileDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  fileDropZone.classList.add("is-dragging");
});

fileDropZone.addEventListener("dragleave", () => {
  fileDropZone.classList.remove("is-dragging");
});

fileDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  fileDropZone.classList.remove("is-dragging");

  const files = Array.from(event.dataTransfer.files || []);
  if (!files.length) {
    return;
  }

  files.forEach((file) => {
    sendDroppedFile(file).catch((error) => {
      setRoomError(error.message || "Could not send dropped file.");
    });
  });
});

muteButton.addEventListener("click", () => {
  micMuted = !micMuted;
  syncTrackState();
});

cameraButton.addEventListener("click", () => {
  cameraOff = !cameraOff;
  syncTrackState();
});

leaveButton.addEventListener("click", () => {
  leaveCall(true);
});

window.addEventListener("beforeunload", () => {
  if (socket && socket.readyState === WebSocket.OPEN && currentRoomId) {
    sendMessage({ type: "leave", roomId: currentRoomId });
  }
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  refreshDeviceList().catch(() => {});
});

async function boot() {
  setAppWindowMode("home");
  applyVideoLayout();
  config = window.kaplia?.getConfig
    ? await window.kaplia.getConfig()
    : {
        signalingUrl: import.meta.env.VITE_SIGNALING_URL || "ws://localhost:8080/ws",
        appOrigin: window.location.origin,
        isDev: true
      };
  updateScreenShareUi();
  updateChatInputHeight();
  await loadFileSettings({ promptIfMissing: true });
  connectSignaling();
}

boot().catch((error) => {
  setSignalingState("failed", "App configuration error");
  setHomeError(error.message);
});
