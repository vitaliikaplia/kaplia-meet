const { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, net, protocol, shell } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { defaultSignalingUrl } = require("./config");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererDistPath = path.join(__dirname, "..", "renderer-dist");
const customScheme = "app";
const customHost = "kaplia-meet";
const maxChunkBytes = 256 * 1024;
const grantedSendPaths = new Set();
const receiveSessions = new Map();
const windowModes = {
  home: {
    width: 600,
    height: 520,
    minWidth: 600,
    minHeight: 520,
    resizable: false
  },
  room: {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    resizable: true
  }
};
let mainWindow = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: customScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

function getSignalingUrl() {
  return (
    process.env.KAPLIA_SIGNALING_URL ||
    process.env.SIGNALING_URL ||
    defaultSignalingUrl
  );
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getDefaultSaveDirectory() {
  return path.join(app.getPath("downloads"), "Kaplia Meet");
}

async function readSettings() {
  try {
    const raw = await fs.promises.readFile(getSettingsPath(), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.promises.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fs.promises.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2));
}

async function getSaveDirectory() {
  const settings = await readSettings();
  const saveDirectory = settings.saveDirectory;

  if (!saveDirectory) {
    throw new Error("Choose a save folder before receiving files.");
  }

  await fs.promises.mkdir(saveDirectory, { recursive: true });
  return saveDirectory;
}

async function getConfiguredSaveDirectory() {
  const settings = await readSettings();

  if (!settings.saveDirectory) {
    return "";
  }

  await fs.promises.mkdir(settings.saveDirectory, { recursive: true });
  return settings.saveDirectory;
}

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "received-file")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/^\.+$/, "received-file");
  const safeName = cleaned.slice(0, 180) || "received-file";
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

  if (reservedWindowsNames.test(baseName)) {
    return `_${safeName}`;
  }

  return safeName;
}

async function makeUniqueFilePath(directory, fileName) {
  const safeName = sanitizeFileName(fileName);
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  let candidate = path.join(directory, safeName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName} (${index})${extension}`);
    index += 1;
  }

  return candidate;
}

async function describeSendFile(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("File path was not provided.");
  }

  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error("Please choose a file.");
  }

  grantedSendPaths.add(filePath);

  return {
    canceled: false,
    path: filePath,
    fileName: path.basename(filePath),
    size: stat.size,
    lastModified: stat.mtimeMs,
    sha256: await hashFile(filePath)
  };
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon"
  };
  return types[ext] || "application/octet-stream";
}

function resolveRendererFile(requestUrl) {
  const parsed = new URL(requestUrl);
  let pathname = decodeURIComponent(parsed.pathname);

  if (parsed.host !== customHost) {
    return null;
  }

  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }

  const resolved = path.normalize(path.join(rendererDistPath, pathname));
  if (!resolved.startsWith(rendererDistPath)) {
    return null;
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return resolved;
  }

  return path.join(rendererDistPath, "index.html");
}

function registerAppProtocol() {
  protocol.handle(customScheme, async (request) => {
    const filePath = resolveRendererFile(request.url);

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    const fileUrl = pathToFileURL(filePath).toString();
    const response = await net.fetch(fileUrl);
    return new Response(response.body, {
      headers: {
        "Content-Type": getContentType(filePath)
      }
    });
  });
}

function applyWindowMode(mode) {
  if (!mainWindow) {
    return { ok: false };
  }

  const nextMode = windowModes[mode] ? mode : "home";
  const bounds = windowModes[nextMode];

  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(bounds.minWidth, bounds.minHeight);

  if (nextMode === "home") {
    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    }

    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    }
  }

  if (!mainWindow.isFullScreen() && !mainWindow.isMaximized()) {
    mainWindow.setSize(bounds.width, bounds.height, true);
    mainWindow.center();
  }

  mainWindow.setResizable(bounds.resizable);
  return { ok: true, mode: nextMode };
}

function createWindow() {
  const initialWindow = windowModes.home;

  mainWindow = new BrowserWindow({
    width: initialWindow.width,
    height: initialWindow.height,
    minWidth: initialWindow.minWidth,
    minHeight: initialWindow.minHeight,
    resizable: initialWindow.resizable,
    title: "Kaplia Meet",
    backgroundColor: "#141416",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(["media", "camera", "microphone", "display-capture"].includes(permission));
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL(`${customScheme}://${customHost}/index.html`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("config:get", () => ({
  signalingUrl: getSignalingUrl(),
  appOrigin: `${customScheme}://${customHost}`,
  isDev
}));

ipcMain.handle("clipboard:writeText", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return { ok: true };
});

ipcMain.handle("window:setMode", (_event, mode) => applyWindowMode(mode));

ipcMain.handle("screens:getSources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: 520,
      height: 320
    }
  });

  return sources.map((source, index) => ({
    id: source.id,
    name: source.name || `Screen ${index + 1}`,
    displayId: source.display_id || "",
    thumbnail: source.thumbnail?.isEmpty() ? "" : source.thumbnail.toDataURL()
  }));
});

ipcMain.handle("files:getSettings", async () => ({
  saveDirectory: await getConfiguredSaveDirectory()
}));

ipcMain.handle("files:chooseSaveDirectory", async () => {
  const currentSaveDirectory = await getConfiguredSaveDirectory();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose save folder",
    defaultPath: currentSaveDirectory || getDefaultSaveDirectory(),
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths.length) {
    return {
      canceled: true,
      saveDirectory: currentSaveDirectory
    };
  }

  const settings = await readSettings();
  settings.saveDirectory = result.filePaths[0];
  await writeSettings(settings);

  return {
    canceled: false,
    saveDirectory: await getSaveDirectory()
  };
});

ipcMain.handle("files:chooseSendFile", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose file to send",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "All files",
        extensions: ["*"]
      }
    ]
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  const files = await Promise.all(result.filePaths.map((filePath) => describeSendFile(filePath)));
  return {
    canceled: false,
    files,
    ...files[0]
  };
});

ipcMain.handle("files:describePath", async (_event, filePath) => describeSendFile(filePath));

ipcMain.handle("files:readChunk", async (_event, payload) => {
  const filePath = payload?.path;
  const offset = Number(payload?.offset || 0);
  const length = Math.min(Number(payload?.length || 0), maxChunkBytes);

  if (!grantedSendPaths.has(filePath)) {
    throw new Error("File access was not granted by the file picker.");
  }

  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) {
    throw new Error("Invalid file chunk request.");
  }

  const handle = await fs.promises.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
});

ipcMain.handle("files:startReceive", async (_event, payload) => {
  const transferId = String(payload?.transferId || "");
  const fileName = sanitizeFileName(payload?.fileName);
  const size = Number(payload?.size || 0);

  if (!transferId) {
    throw new Error("Transfer id was not provided.");
  }

  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Invalid incoming file size.");
  }

  if (receiveSessions.has(transferId)) {
    throw new Error("Incoming transfer already exists.");
  }

  const saveDirectory = await getSaveDirectory();
  const filePath = await makeUniqueFilePath(saveDirectory, fileName);
  const handle = await fs.promises.open(filePath, "w");

  receiveSessions.set(transferId, {
    filePath,
    hash: crypto.createHash("sha256"),
    handle,
    received: 0,
    size
  });

  return {
    filePath,
    fileName: path.basename(filePath),
    saveDirectory
  };
});

ipcMain.handle("files:writeReceiveChunk", async (_event, payload) => {
  const transferId = String(payload?.transferId || "");
  const session = receiveSessions.get(transferId);
  const chunk = payload?.chunk;

  if (!session) {
    throw new Error("Incoming transfer was not started.");
  }

  const buffer = Buffer.from(chunk);
  if (session.received + buffer.byteLength > session.size) {
    throw new Error("Incoming file is larger than expected.");
  }

  await session.handle.write(buffer, 0, buffer.byteLength, session.received);
  session.hash.update(buffer);
  session.received += buffer.byteLength;

  return {
    received: session.received,
    size: session.size
  };
});

ipcMain.handle("files:finishReceive", async (_event, payload) => {
  const transferId = String(payload?.transferId || "");
  const expectedSha256 = String(payload?.sha256 || "");
  const session = receiveSessions.get(transferId);

  if (!session) {
    throw new Error("Incoming transfer was not started.");
  }

  await session.handle.close();
  receiveSessions.delete(transferId);

  if (session.received !== session.size) {
    throw new Error("Incoming file ended before all bytes were received.");
  }

  const sha256 = session.hash.digest("hex");

  if (expectedSha256 && sha256 !== expectedSha256) {
    await fs.promises.unlink(session.filePath).catch(() => {});
    throw new Error("Incoming file hash mismatch. File was deleted.");
  }

  return {
    filePath: session.filePath,
    received: session.received,
    sha256
  };
});

ipcMain.handle("files:cancelReceive", async (_event, payload) => {
  const transferId = String(payload?.transferId || "");
  const session = receiveSessions.get(transferId);

  if (!session) {
    return { canceled: true };
  }

  receiveSessions.delete(transferId);
  await session.handle.close().catch(() => {});
  await fs.promises.unlink(session.filePath).catch(() => {});

  return { canceled: true };
});

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
