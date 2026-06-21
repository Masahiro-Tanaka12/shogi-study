import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join, basename } from 'path'
import { readFile } from 'fs/promises'
import { parseKif } from '../shared/kifu'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '将棋研究アプリ',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('select-kifu-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'KIF ファイル', extensions: ['kif'] }]
  })
  return filePaths[0] ?? null
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'ファイル',
        submenu: [
          {
          label: '棋譜を開く',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow()
            if (!win) return
            const { filePaths } = await dialog.showOpenDialog(win, {
              properties: ['openFile', 'multiSelections'],
              filters: [{ name: 'KIF ファイル', extensions: ['kif'] }]
            })
            if (filePaths.length === 0) return
            const files = filePaths.map(p => ({ fileName: basename(p), path: p, tags: [] }))
            win.webContents.send('kifu-file-opened', files)

            for (const p of filePaths) {
              const content = await readFile(p, 'utf-8')
              const moves = parseKif(content)
              console.log(`[kifu] ${basename(p)}: ${moves.length} 手`)
              console.log(moves)
            }
          }
        },
          { type: 'separator' },
          { label: '終了', role: 'quit' }
        ]
      }
    ])
  )
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
