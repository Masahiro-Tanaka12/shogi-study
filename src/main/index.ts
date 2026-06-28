import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'

if (process.platform === 'win32') {
  const out = process.stdout as unknown as { reconfigure?: (o: { encoding: BufferEncoding }) => void }
  const err = process.stderr as unknown as { reconfigure?: (o: { encoding: BufferEncoding }) => void }
  out.reconfigure?.({ encoding: 'utf8' })
  err.reconfigure?.({ encoding: 'utf8' })
}
import { join, basename, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import iconv from 'iconv-lite'
import { parseKif } from '../shared/kifu'
import { parseKi2 } from '../shared/ki2'
import { parseCsa } from '../shared/csa'
import { buildBoardState, boardToSfen, debugBoard, enumeratePositions, createInitialBoard } from '../shared/board'
import { aggregatePositions, logPositionStats, type PositionStats } from '../shared/stats'
import { initDb, insertKifuIfNew, insertPositions, insertKifuMoves, getAllKifus, addTag, removeTag, deleteKifu, updateKifuPath, clearKifuPositions, updateKifuMeta, getPositionStats, getPositionKifus, getNextSfen, getKifuSfens, getKifuMoveLabels, type Db } from './db'
import { initScraperPreload, ensureScrapedDir, fetchGameHashes, fetchGameHashesPaginated, buildSearchUrl, scrapeGame, buildCsaText, buildFileName, type ScrapeParams } from './scraper'

const allStats: PositionStats = {}
const INITIAL_SFEN = boardToSfen(createInitialBoard())

let db: Db
let mainWindow: BrowserWindow | null = null
let scrapeController: AbortController | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'KifuDateBase',
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

function findKifuFiles(dir: string): string[] {
  const results: string[] = []
  function walk(current: string): void {
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (['.kif', '.ki2', '.csa'].includes(extname(entry.name).toLowerCase())) results.push(full)
      }
    } catch { /* permission error など */ }
  }
  walk(dir)
  return results
}

async function processKifFile(p: string): Promise<{ isNew: boolean }> {
  const buf = await readFile(p)
  const utf8 = buf.toString('utf-8')
  const hasReplacement = utf8.includes('�')
  const encoding = hasReplacement ? 'Shift_JIS' : 'UTF-8'
  const content = hasReplacement ? iconv.decode(buf, 'Shift_JIS') : utf8
  const ext = extname(p).toLowerCase()
  const { moves, meta } = ext === '.ki2' ? parseKi2(content)
    : ext === '.csa' ? parseCsa(content)
    : parseKif(content)
  const positions = enumeratePositions(moves)
  console.log(`[kifu] ${basename(p)}: encoding=${encoding}, 手数=${moves.length}, positions=${positions.length}`)
  const state = buildBoardState(moves)
  console.log('[sfen]', boardToSfen(state))
  debugBoard(state)

  const { id: kifuId, isNew } = insertKifuIfNew(db, p, basename(p))
  if (isNew) {
    insertPositions(db, kifuId, positions)
    insertKifuMoves(db, kifuId, positions)
    console.log(`[db] saved: ${basename(p)} (id=${kifuId})`)
  } else {
    console.log(`[db] skip: ${basename(p)} already exists (id=${kifuId})`)
  }
  updateKifuMeta(db, kifuId, meta)
  aggregatePositions(positions, allStats)
  return { isNew }
}

ipcMain.handle('select-kifu-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: '棋譜ファイル', extensions: ['kif', 'ki2', 'csa'] }]
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

ipcMain.handle('save-pasted-kif', async (_event, text: string, suggestedName: string) => {
  const win = BrowserWindow.getFocusedWindow()
  const { filePath, canceled } = await dialog.showSaveDialog(win ?? new BrowserWindow(), {
    defaultPath: suggestedName,
    filters: [{ name: 'KIF ファイル', extensions: ['kif'] }],
  })
  if (canceled || !filePath) return null

  await writeFile(filePath, text, 'utf-8')
  await processKifFile(filePath)
  return getAllKifus(db)
})

ipcMain.handle('delete-kifu', (_event, kifuPath: string) => {
  deleteKifu(db, kifuPath)
  return getAllKifus(db)
})

ipcMain.handle('update-kifu-path', async (_event, oldPath: string, newPath: string) => {
  updateKifuPath(db, oldPath, newPath)
  await processKifFile(newPath)
  return getAllKifus(db)
})

ipcMain.handle('reimport-kifu', async (_event, kifuPath: string) => {
  // ── Phase 1: パース（DB に触れない） ─────────────────────────
  let buf: Buffer
  try {
    buf = await readFile(kifuPath)
  } catch {
    console.log(`[reimport] ファイル読み込み失敗: ${basename(kifuPath)}`)
    return getAllKifus(db)
  }
  const utf8 = buf.toString('utf-8')
  const content = utf8.includes('�') ? iconv.decode(buf, 'Shift_JIS') : utf8
  const ext = extname(kifuPath).toLowerCase()
  const { moves, meta } = ext === '.ki2' ? parseKi2(content)
    : ext === '.csa' ? parseCsa(content)
    : parseKif(content)
  const positions = enumeratePositions(moves)

  const validCount = moves.filter(m => !m.isSpecial).length
  console.log(`[reimport] ${basename(kifuPath)}: ${validCount} 手を検出`)
  if (validCount === 0) {
    console.log(`[reimport] スキップ: 有効な手が 0 件のため DB は変更しません`)
    return getAllKifus(db)
  }

  // ── Phase 2: DB 更新（パース成功後のみ実行、将来 db.transaction でまとめて原子化可） ──
  const row = db.prepare('SELECT id FROM kifus WHERE file_path = ?').get(kifuPath) as { id: number } | undefined
  if (!row) return getAllKifus(db)
  console.log(`[reimport] kifu_id=${row.id} path=${kifuPath}`)
  const deleted = clearKifuPositions(db, kifuPath)
  console.log(`[reimport] 削除: positions=${deleted.positions}, kifu_moves=${deleted.moves}`)
  insertPositions(db, row.id, positions)
  insertKifuMoves(db, row.id, positions)
  updateKifuMeta(db, row.id, meta)
  const insertedMoves = positions.filter(e => e.nextMove && !e.nextMove.isSpecial).length
  console.log(`[reimport] 挿入: positions=${positions.length}, kifu_moves=${insertedMoves}`)
  console.log(`[reimport] 完了: ${basename(kifuPath)} (${validCount} 手, ${positions.length} 局面)`)

  return getAllKifus(db)
})

ipcMain.handle('apply-move-string', (_event, sfen: string, move: string) => {
  return getNextSfen(db, sfen, move)
})

ipcMain.handle('get-kifu-sfens', (_event, kifuPath: string) => {
  return getKifuSfens(db, kifuPath)
})

ipcMain.handle('get-kifu-move-labels', (_event, kifuPath: string) => {
  return getKifuMoveLabels(db, kifuPath)
})

ipcMain.handle('import-folder', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const { filePaths, canceled } = await dialog.showOpenDialog(win ?? new BrowserWindow(), {
    properties: ['openDirectory'],
    title: 'フォルダを選択',
  })
  if (canceled || filePaths.length === 0) return null

  const files = findKifuFiles(filePaths[0])
  let imported = 0, skipped = 0, failed = 0
  for (const p of files) {
    try {
      const { isNew } = await processKifFile(p)
      if (isNew) imported++
      else skipped++
    } catch {
      failed++
      console.log(`[import-folder] 失敗: ${basename(p)}`)
    }
  }
  const total = imported + skipped + failed
  console.log(`[import-folder] 完了: total=${total}, imported=${imported}, skipped=${skipped}, failed=${failed}`)
  return { imported, skipped, failed, total, kifuList: getAllKifus(db) }
})

ipcMain.handle('get-position-kifus', (_event, sfen: string, tags: string[], mode: 'AND' | 'OR') => {
  const normalizedTags = (tags ?? []).map((t: string) => t.replace(/^#+/, '').trim()).filter(Boolean)
  return getPositionKifus(db, sfen, normalizedTags, mode ?? 'OR')
})

ipcMain.handle('scrape-test', async () => {
  console.log('[scrape-test] /latest からゲームハッシュ取得...')
  const hashes = await fetchGameHashes('https://shogidb2.com/latest')
  if (hashes.length === 0) throw new Error('ゲームが見つかりません')
  const hash = hashes[0]
  console.log(`[scrape-test] hash=${hash}`)

  console.log('[scrape-test] 棋譜データ取得中 (最大20秒)...')
  const data = await scrapeGame(hash)
  console.log(`[scrape-test] 取得完了: ${data.player1} vs ${data.player2} (${data.moves.length}手)`)

  const csaText = buildCsaText(data)
  const scrapedDir = await ensureScrapedDir()
  const filePath = join(scrapedDir, buildFileName(data))
  await writeFile(filePath, csaText, 'utf-8')
  console.log(`[scrape-test] 保存: ${filePath}`)

  await processKifFile(filePath)
  console.log('[scrape-test] DB 取り込み完了')

  if (mainWindow && !mainWindow.isDestroyed()) {
    const added = getAllKifus(db).filter(k => k.path === filePath)
    mainWindow.webContents.send('kifu-file-opened', added)
  }

  return { hash, player1: data.player1, player2: data.player2, moves: data.moves.length, filePath }
})

ipcMain.handle('scrape-start', (_event, params: ScrapeParams) => {
  scrapeController?.abort()
  const controller = new AbortController()
  scrapeController = controller
  const { signal } = controller

  ;(async () => {
    try {
      const maxGames = params.maxGames ?? 50
      const maxPages = Math.ceil(maxGames / 10) + 1
      const url = buildSearchUrl(params)
      console.log(`[scrape] URL: ${url}, maxPages=${maxPages}`)
      const hashes = (await fetchGameHashesPaginated(url, maxPages)).slice(0, maxGames)
      console.log(`[scrape] ${hashes.length} 件を収集します`)

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scrape-progress', { done: 0, total: hashes.length })
      }

      const scrapedDir = await ensureScrapedDir()
      let imported = 0, skipped = 0, failed = 0

      for (let i = 0; i < hashes.length; i++) {
        if (signal.aborted) break
        const hash = hashes[i]
        try {
          const data = await scrapeGame(hash)
          const filePath = join(scrapedDir, buildFileName(data, hash))
          await writeFile(filePath, buildCsaText(data), 'utf-8')
          const { isNew } = await processKifFile(filePath)
          if (isNew) {
            imported++
            if (mainWindow && !mainWindow.isDestroyed()) {
              const added = getAllKifus(db).filter(k => k.path === filePath)
              mainWindow.webContents.send('kifu-file-opened', added)
            }
          } else {
            skipped++
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scrape-progress', {
              done: i + 1, total: hashes.length, latestFileName: buildFileName(data, hash),
            })
          }
        } catch {
          failed++
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scrape-progress', { done: i + 1, total: hashes.length })
          }
        }
        if (i < hashes.length - 1 && !signal.aborted) {
          await new Promise<void>(r => setTimeout(r, 1500))
        }
      }

      if (!signal.aborted && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scrape-done', { imported, skipped, failed })
      }
    } catch (e) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('scrape-error', String(e))
      }
    }
  })()
})

ipcMain.handle('scrape-cancel', () => {
  scrapeController?.abort()
  scrapeController = null
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scrape-done', { imported: 0, skipped: 0, failed: 0, cancelled: true })
  }
})

ipcMain.handle('get-position-stats', (_event, sfen: string, tags: string[], mode: 'AND' | 'OR') => {
  const normalizedTags = (tags ?? []).map((t: string) => t.replace(/^#+/, '').trim()).filter(Boolean)
  const result = getPositionStats(db, sfen, normalizedTags, mode ?? 'OR')
  console.log(`[stats] sfen="${sfen}" tags=${JSON.stringify(normalizedTags)} mode=${mode} → ${result.length} 手`)
  return result
})

app.whenReady().then(async () => {
  db = initDb(join(app.getPath('userData'), 'shogi-study.db'))
  await initScraperPreload()
  console.log('[db] opened:', join(app.getPath('userData'), 'shogi-study.db'))

  // ── DB 実データ確認 ──────────────────────────────────────────
  const { kifuCount }    = db.prepare('SELECT COUNT(*) as kifuCount FROM kifus').get() as { kifuCount: number }
  const { posCount }     = db.prepare('SELECT COUNT(*) as posCount FROM positions').get() as { posCount: number }
  const { movesCount }   = db.prepare('SELECT COUNT(*) as movesCount FROM kifu_moves').get() as { movesCount: number }
  console.log(`[db] kifus=${kifuCount}, positions=${posCount}, kifu_moves=${movesCount}`)

  const perKifu = db.prepare(`
    SELECT k.id, k.file_name, COUNT(p.id) as pos_count
    FROM kifus k
    LEFT JOIN positions p ON p.kifu_id = k.id
    GROUP BY k.id
    ORDER BY k.id
  `).all() as { id: number; file_name: string; pos_count: number }[]
  console.log('[db] per-kifu positions:')
  for (const row of perKifu) {
    console.log(`  id=${row.id} pos=${row.pos_count} ${row.file_name}`)
  }
  // ────────────────────────────────────────────────────────────

  const allKifuPaths = db.prepare('SELECT id, file_path FROM kifus ORDER BY id').all() as { id: number; file_path: string }[]
  for (const { id, file_path } of allKifuPaths) {
    console.log(`[reimport-check]\nid=${id}\nexists=${existsSync(file_path)}\npath=${file_path}`)
  }

  const corrupted = db.prepare(`
    SELECT DISTINCT k.id, k.file_path
    FROM kifus k
    WHERE NOT EXISTS (
      SELECT 1 FROM positions p WHERE p.kifu_id = k.id AND p.next_move IS NOT NULL
    )
  `).all() as { id: number; file_path: string }[]

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
                filters: [{ name: '棋譜ファイル', extensions: ['kif', 'ki2', 'csa'] }]
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
      },
      {
        label: '開発',
        submenu: [
          {
            label: 'DevTools を開く',
            accelerator: 'F12',
            click: () => BrowserWindow.getFocusedWindow()?.webContents.toggleDevTools(),
          },
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
