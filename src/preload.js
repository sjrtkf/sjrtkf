const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('helper', {
  run: (action, payload) => ipcRenderer.invoke('helper:run', action, payload),
  onState: callback => ipcRenderer.on('helper:state', (_event, state) => callback(state))
});
