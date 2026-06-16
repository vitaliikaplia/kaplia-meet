const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("kaplia", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:writeText", text)
  },
  appWindow: {
    setMode: (mode) => ipcRenderer.invoke("window:setMode", mode)
  },
  screens: {
    getSources: () => ipcRenderer.invoke("screens:getSources")
  },
  files: {
    getSettings: () => ipcRenderer.invoke("files:getSettings"),
    chooseSaveDirectory: () => ipcRenderer.invoke("files:chooseSaveDirectory"),
    chooseSendFile: () => ipcRenderer.invoke("files:chooseSendFile"),
    describePath: (filePath) => ipcRenderer.invoke("files:describePath", filePath),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    readChunk: (payload) => ipcRenderer.invoke("files:readChunk", payload),
    startReceive: (payload) => ipcRenderer.invoke("files:startReceive", payload),
    writeReceiveChunk: (payload) => ipcRenderer.invoke("files:writeReceiveChunk", payload),
    finishReceive: (payload) => ipcRenderer.invoke("files:finishReceive", payload),
    cancelReceive: (payload) => ipcRenderer.invoke("files:cancelReceive", payload),
    showItemInFolder: (payload) => ipcRenderer.invoke("files:showItemInFolder", payload)
  }
});
