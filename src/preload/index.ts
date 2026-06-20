import { contextBridge } from 'electron'

// IPC APIはここに追加していく
contextBridge.exposeInMainWorld('api', {})
