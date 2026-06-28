import { BrowserWindow, ipcMain, net, app } from 'electron'
import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'

export interface ShogiDB2GameData {
  id: number
  player1: string
  player2: string
  tournament?: string
  strategy?: string
  result?: string
  start_at?: string
  moves: Array<{ num: number; csa: string; label: string }>
}

export function buildCsaText(data: ShogiDB2GameData): string {
  const dateStr = data.start_at ? data.start_at.slice(0, 10) : ''
  const lines: string[] = []
  if (data.player1) lines.push(`N+${data.player1}`)
  if (data.player2) lines.push(`N-${data.player2}`)
  if (dateStr) lines.push(`$START_TIME:${dateStr}`)
  if (data.tournament) lines.push(`$EVENT:${data.tournament}`)
  if (data.strategy) lines.push(`$OPENING:${data.strategy}`)
  lines.push('+')
  for (const move of data.moves) {
    lines.push(move.csa)
  }
  return lines.join('\n')
}

function safeFilename(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 40)
}

export function buildFileName(data: ShogiDB2GameData, hash?: string): string {
  const date = data.start_at ? data.start_at.slice(0, 10) : 'unknown'
  const p1 = safeFilename(data.player1 || '先手')
  const p2 = safeFilename(data.player2 || '後手')
  const suffix = hash ? `_${hash.slice(0, 8)}` : ''
  return `${date}_${p1}_vs_${p2}${suffix}.csa`
}

export interface ScrapeParams {
  player?: string
  strategy?: string
  maxGames?: number
}

// shogidb2.com の URL 構造:
//   棋士: /player/[名前] 、戦形: /strategy/[戦形名] 、最新: /latest
//   ページネーション: ?q=&page=N
// 棋士と戦形の同時指定はサイトが対応していないため棋士を優先する。
export function buildSearchUrl(params: ScrapeParams): string {
  if (params.player) {
    return `https://shogidb2.com/player/${encodeURIComponent(params.player)}?q=`
  }
  if (params.strategy) {
    return `https://shogidb2.com/strategy/${encodeURIComponent(params.strategy)}?q=`
  }
  return 'https://shogidb2.com/latest?q='
}

export async function fetchGameHashesPaginated(baseUrl: string, maxPages = 5): Promise<string[]> {
  const all: string[] = []
  const seen = new Set<string>()
  for (let page = 1; page <= maxPages; page++) {
    // baseUrl は ?q= で終わる前提。ページ2以降は &page=N を追加。
    const url = page === 1 ? baseUrl : `${baseUrl}&page=${page}`
    const hashes = await fetchGameHashes(url)
    const fresh = hashes.filter(h => !seen.has(h))
    if (fresh.length === 0) break
    for (const h of fresh) { seen.add(h); all.push(h) }
    if (page < maxPages) await new Promise<void>(r => setTimeout(r, 500))
  }
  return all
}

// HTMLページから /games/[hash] を抽出
export async function fetchGameHashes(pageUrl: string): Promise<string[]> {
  const res = await net.fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShogiStudy/1.0)' },
  })
  const html = await res.text()
  const seen = new Set<string>()
  const re = /\/games\/([a-f0-9]{30,})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    seen.add(m[1])
  }
  return [...seen]
}

// preload は contextIsolation: false で動かす。
// class 構文で WebSocket を継承してメッセージを傍受し、
// phx_reply の kif イベントを ipcRenderer で main に転送する。
const PRELOAD_CONTENT = `
'use strict'
const { ipcRenderer } = require('electron')

const OrigWS = globalThis.WebSocket

class PatchedWS extends OrigWS {
  constructor(url, protocols) {
    if (protocols !== undefined) {
      super(url, protocols)
    } else {
      super(url)
    }
    this.addEventListener('message', function(evt) {
      try {
        const parsed = JSON.parse(evt.data)
        if (!Array.isArray(parsed) || parsed[3] !== 'phx_reply') return
        const diff = parsed[4] && parsed[4].response && parsed[4].response.diff
        if (!diff || !diff.e) return
        for (const entry of diff.e) {
          if (entry[0] === 'kif' && entry[1] && entry[1].data) {
            ipcRenderer.send('scraper-game-data', entry[1].data)
          }
        }
      } catch (_) {}
    })
  }
}

globalThis.WebSocket = PatchedWS

window.addEventListener('DOMContentLoaded', function() {
  // LiveView の WebSocket 接続が完了するまで待ってからクリック
  setTimeout(function() {
    var anchors = document.querySelectorAll('a')
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i].textContent && anchors[i].textContent.trim() === 'KIF形式') {
        anchors[i].click()
        return
      }
    }
    ipcRenderer.send('scraper-error', 'KIF形式ボタンが見つかりません')
  }, 3000)
})
`

let preloadPath: string | null = null

export async function initScraperPreload(): Promise<void> {
  preloadPath = join(app.getPath('userData'), 'scraper-preload.js')
  await writeFile(preloadPath, PRELOAD_CONTENT, 'utf-8')
}

export async function ensureScrapedDir(): Promise<string> {
  const dir = join(app.getPath('userData'), 'scraped')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  return dir
}

// 1件スクレイプ: 隠し BrowserWindow でゲームページをロードし、
// WebSocket の phx_reply から棋譜 JSON を取得して返す。
export async function scrapeGame(gameHash: string): Promise<ShogiDB2GameData> {
  if (!preloadPath) throw new Error('scraper not initialized (call initScraperPreload first)')

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath!,
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    const timeoutHandle = setTimeout(() => {
      cleanup()
      reject(new Error(`scrape timeout: ${gameHash}`))
    }, 20000)

    function onData(_: Electron.IpcMainEvent, data: ShogiDB2GameData) {
      if (!data?.moves?.length) return
      cleanup()
      resolve(data)
    }

    function onError(_: Electron.IpcMainEvent, msg: string) {
      cleanup()
      reject(new Error(msg))
    }

    function cleanup() {
      clearTimeout(timeoutHandle)
      ipcMain.removeListener('scraper-game-data', onData)
      ipcMain.removeListener('scraper-error', onError)
      try { win.close() } catch { /* already closed */ }
    }

    ipcMain.on('scraper-game-data', onData)
    ipcMain.on('scraper-error', onError)
    win.loadURL(`https://shogidb2.com/games/${gameHash}`)
  })
}
