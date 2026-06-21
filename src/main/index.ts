import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join, basename } from 'path'
import { readFile } from 'fs/promises'
import iconv from 'iconv-lite'
import { parseKif } from '../shared/kifu'
import { buildBoardState, boardToSfen, debugBoard, enumeratePositions, createInitialBoard } from '../shared/board'
import { aggregatePositions, logPositionStats, type PositionStats } from '../shared/stats'
import { initDb, insertKifuIfNew, insertPositions, getAllKifus, addTag, removeTag, getPositionStats, getNextSfen, type Db } from './db'

const allStats: PositionStats = {}
const INITIAL_SFEN = boardToSfen(createInitialBoard())

let db: Db

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

async function processKifFile(p: string): Promise<void> {
  const buf = await readFile(p)
  const utf8 = buf.toString('utf-8')
  const content = utf8.includes('�') ? iconv.decode(buf, 'Shift_JIS') : utf8
  const moves = parseKif(content)
  console.log(`[kifu] ${basename(p)}: ${moves.length} 手`)
  const state = buildBoardState(moves)
  console.log('[sfen]', boardToSfen(state))
  debugBoard(state)

  const positions = enumeratePositions(moves)
  console.log(`[positions] ${positions.length} 局面 (expected: ${moves.length + 1})`)

  const { id: kifuId, isNew } = insertKifuIfNew(db, p, basename(p))
  if (isNew) {
    insertPositions(db, kifuId, positions)
    console.log(`[db] saved: ${basename(p)} (id=${kifuId})`)
  } else {
    console.log(`[db] skip: ${basename(p)} already exists (id=${kifuId})`)
  }
  aggregatePositions(positions, allStats)
}

ipcMain.handle('select-kifu-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'KIF ファイル', extensions: ['kif'] }]
  })
  return filePaths[0] ?? null
})

ipcMain.handle('get-kifu-list', () => {
  return getAllKifus(db)
})

ipcMain.handle('add-tag', (_event, kifuPath: string, tagName: string) => {
  addTag(db, kifuPath, tagName)
})

ipcMain.handle('remove-tag', (_event, kifuPath: string, tagName: string) => {
  removeTag(db, kifuPath, tagName)
})

ipcMain.handle('apply-move-string', (_event, sfen: string, move: string) => {
  return getNextSfen(db, sfen, move)
})

ipcMain.handle('get-position-stats', (_event, sfen: string, tagQuery: string) => {
  const normalizedTag = tagQuery.replace(/^#+/, '').trim()
  const result = getPositionStats(db, sfen, normalizedTag || undefined)
  console.log(`[stats] sfen="${sfen}" tag="${tagQuery}"→"${normalizedTag}" → ${result.length} 手`)
  return result
})

app.whenReady().then(async () => {
  db = initDb(join(app.getPath('userData'), 'shogi-study.db'))
  console.log('[db] opened:', join(app.getPath('userData'), 'shogi-study.db'))

  const corrupted = db.prepare(`
    SELECT DISTINCT k.file_path
    FROM kifus k
    WHERE NOT EXISTS (
      SELECT 1 FROM positions p WHERE p.kifu_id = k.id AND p.next_move IS NOT NULL
    )
  `).all() as { file_path: string }[]

  if (corrupted.length > 0) {
    console.log(`[db] 壊れた棋譜 ${corrupted.length} 件を自動再取込み中...`)
    for (const { file_path } of corrupted) {
      try {
        await processKifFile(file_path)
      } catch (e) {
        console.log(`[db] 再取込み失敗 (ファイルが見つからない可能性): ${file_path}`)
      }
    }
    console.log('[db] 自動再取込み完了')
    logPositionStats(allStats, INITIAL_SFEN, '初期局面')
  }

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
                await processKifFile(p)
              }

              logPositionStats(allStats, INITIAL_SFEN, '初期局面')
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
