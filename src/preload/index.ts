import { contextBridge, ipcRenderer } from 'electron'

type KifuFile = { fileName: string; path: string; tags: string[] }

contextBridge.exposeInMainWorld('api', {
  selectKifuFile: (): Promise<string | null> => ipcRenderer.invoke('select-kifu-file'),
  getKifuList: (): Promise<KifuFile[]> => ipcRenderer.invoke('get-kifu-list'),
  addTag: (kifuPath: string, tagName: string): Promise<void> => ipcRenderer.invoke('add-tag', kifuPath, tagName),
  removeTag: (kifuPath: string, tagName: string): Promise<void> => ipcRenderer.invoke('remove-tag', kifuPath, tagName),
  savePastedKif: (text: string, suggestedName: string): Promise<KifuFile[] | null> =>
    ipcRenderer.invoke('save-pasted-kif', text, suggestedName),
  deleteKifu: (kifuPath: string): Promise<KifuFile[]> =>
    ipcRenderer.invoke('delete-kifu', kifuPath),
  updateKifuPath: (oldPath: string, newPath: string): Promise<KifuFile[]> =>
    ipcRenderer.invoke('update-kifu-path', oldPath, newPath),
  reimportKifu: (kifuPath: string): Promise<KifuFile[]> =>
    ipcRenderer.invoke('reimport-kifu', kifuPath),
  getKifuSfens: (kifuPath: string): Promise<string[]> =>
    ipcRenderer.invoke('get-kifu-sfens', kifuPath),
  getKifuMoveLabels: (kifuPath: string): Promise<string[]> =>
    ipcRenderer.invoke('get-kifu-move-labels', kifuPath),
  importFolder: (): Promise<{ imported: number; skipped: number; failed: number; total: number; kifuList: { fileName: string; path: string; tags: string[] }[] } | null> =>
    ipcRenderer.invoke('import-folder'),
  applyMoveString: (sfen: string, move: string): Promise<string | null> =>
    ipcRenderer.invoke('apply-move-string', sfen, move),
  getPositionStats: (sfen: string, tagQuery: string): Promise<{ move: string; count: number }[]> =>
    ipcRenderer.invoke('get-position-stats', sfen, tagQuery),
  onKifuFileOpened: (callback: (files: KifuFile[]) => void): (() => void) => {
    const listener = (_: unknown, files: KifuFile[]) => callback(files)
    ipcRenderer.on('kifu-file-opened', listener)
    return () => ipcRenderer.removeListener('kifu-file-opened', listener)
  }
})
