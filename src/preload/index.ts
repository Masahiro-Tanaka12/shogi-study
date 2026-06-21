import { contextBridge, ipcRenderer } from 'electron'

type KifuFile = { fileName: string; path: string; tags: string[] }

contextBridge.exposeInMainWorld('api', {
  selectKifuFile: (): Promise<string | null> => ipcRenderer.invoke('select-kifu-file'),
  onKifuFileOpened: (callback: (files: KifuFile[]) => void): (() => void) => {
    const listener = (_: unknown, files: KifuFile[]) => callback(files)
    ipcRenderer.on('kifu-file-opened', listener)
    return () => ipcRenderer.removeListener('kifu-file-opened', listener)
  }
})
