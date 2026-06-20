import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  selectKifuFile: (): Promise<string | null> => ipcRenderer.invoke('select-kifu-file')
})
