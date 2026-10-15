'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('probe',{command:action=>ipcRenderer.invoke('probe:command',action),onState:fn=>ipcRenderer.on('probe:state',(_e,s)=>fn(s))});
