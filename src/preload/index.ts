import { contextBridge, ipcRenderer } from 'electron'

type KifuFile = { fileName: string; path: string; tags: string[]; exists: boolean; senteName?: string; goteName?: string; gameDate?: string }
type PositionKifu = KifuFile & { moveNumber: number | null }

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
  getPositionKifus: (sfen: string, tags: string[], mode: 'AND' | 'OR'): Promise<PositionKifu[]> =>
    ipcRenderer.invoke('get-position-kifus', sfen, tags, mode),
  getPositionStats: (sfen: string, tags: string[], mode: 'AND' | 'OR'): Promise<{ move: string; count: number }[]> =>
    ipcRenderer.invoke('get-position-stats', sfen, tags, mode),
  scrapeTest: (): Promise<{ hash: string; player1: string; player2: string; moves: number; filePath: string }> =>
    ipcRenderer.invoke('scrape-test'),
  scrapeStart: (params: { player?: string; strategy?: string; maxGames?: number }): Promise<void> =>
    ipcRenderer.invoke('scrape-start', params),
  scrapeCancel: (): Promise<void> =>
    ipcRenderer.invoke('scrape-cancel'),
  onKifuFileOpened: (callback: (files: KifuFile[]) => void): (() => void) => {
    const listener = (_: unknown, files: KifuFile[]) => callback(files)
    ipcRenderer.on('kifu-file-opened', listener)
    return () => ipcRenderer.removeListener('kifu-file-opened', listener)
  },
  onScrapeProgress: (callback: (p: { done: number; total: number; latestFileName?: string }) => void): (() => void) => {
    const listener = (_: unknown, p: { done: number; total: number; latestFileName?: string }) => callback(p)
    ipcRenderer.on('scrape-progress', listener)
    return () => ipcRenderer.removeListener('scrape-progress', listener)
  },
  onScrapeDone: (callback: (r: { imported: number; skipped: number; failed: number; cancelled?: boolean }) => void): (() => void) => {
    const listener = (_: unknown, r: { imported: number; skipped: number; failed: number; cancelled?: boolean }) => callback(r)
    ipcRenderer.on('scrape-done', listener)
    return () => ipcRenderer.removeListener('scrape-done', listener)
  },
  onScrapeError: (callback: (msg: string) => void): (() => void) => {
    const listener = (_: unknown, msg: string) => callback(msg)
    ipcRenderer.on('scrape-error', listener)
    return () => ipcRenderer.removeListener('scrape-error', listener)
  },
})
