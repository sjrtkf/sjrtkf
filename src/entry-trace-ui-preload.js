'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('entryTrace',{command:action=>ipcRenderer.invoke('entry-trace:command',action),onState:fn=>ipcRenderer.on('entry-trace:state',(_e,s)=>fn(s))});
