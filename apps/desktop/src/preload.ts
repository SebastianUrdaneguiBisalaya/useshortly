import { contextBridge } from "electron";

// Nothing privileged is exposed yet - add explicit, narrow bridges here
// (never the full `ipcRenderer` or any Node API) as the renderer needs them.
contextBridge.exposeInMainWorld("desktop", {
  version: process.versions.electron,
});