import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'

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
