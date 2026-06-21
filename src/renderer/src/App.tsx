import { useState, useEffect, useRef } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { KifuFile } from '../../shared/types'
import boardUrl from './assets/shogi/light_878x960.png'

interface MoveCount { move: string; count: number }

declare global {
  interface Window {
    api: {
      selectKifuFile: () => Promise<string | null>
      getKifuList: () => Promise<KifuFile[]>
      addTag: (kifuPath: string, tagName: string) => Promise<void>
      removeTag: (kifuPath: string, tagName: string) => Promise<void>
      savePastedKif: (text: string, suggestedName: string) => Promise<KifuFile[] | null>
      applyMoveString: (sfen: string, move: string) => Promise<string | null>
      getPositionStats: (sfen: string, tagQuery: string) => Promise<MoveCount[]>
      onKifuFileOpened: (callback: (files: KifuFile[]) => void) => () => void
    }
  }
}

function suggestFileName(text: string): string {
  const sente = text.match(/^先手[：:]\s*(.+)$/m)?.[1]?.trim()
  const gote  = text.match(/^後手[：:]\s*(.+)$/m)?.[1]?.trim()
  if (sente && gote) return `${sente}vs${gote}.kif`
  const date = text.match(/^開始日時[：:]\s*(\d{4})[\/-](\d{2})[\/-](\d{2})/m)
  if (date) return `${date[1]}${date[2]}${date[3]}.kif`
  return `kifu_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.kif`
}

function PasteKifModal({ onClose, onSaved }: { onClose: () => void; onSaved: (files: KifuFile[]) => void }): JSX.Element {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const v = e.target.value
    setText(v)
    if (!fileName || fileName === suggestFileName(text)) {
      setFileName(suggestFileName(v))
    }
  }

  async function handleSave(): Promise<void> {
    if (!text.trim()) return
    setSaving(true)
    try {
      const result = await window.api.savePastedKif(text, fileName || suggestFileName(text))
      if (result) onSaved(result)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '8px', padding: '24px',
          width: '480px', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: '12px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '15px', color: '#222' }}>KIFテキストから追加</h3>

        <textarea
          autoFocus
          value={text}
          onChange={handleTextChange}
          placeholder="KIFテキストをここに貼り付けてください…"
          style={{
            width: '100%', boxSizing: 'border-box', height: '220px',
            fontFamily: 'monospace', fontSize: '12px',
            border: '1px solid #ccc', borderRadius: '4px',
            padding: '8px', resize: 'vertical', outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '12px', color: '#555', whiteSpace: 'nowrap' }}>ファイル名:</label>
          <input
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            style={{
              flex: 1, fontSize: '12px', padding: '4px 8px',
              border: '1px solid #ccc', borderRadius: '4px', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{ padding: '6px 16px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: '#fff' }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={!text.trim() || saving}
            style={{
              padding: '6px 16px', fontSize: '12px', border: 'none', borderRadius: '4px', cursor: text.trim() && !saving ? 'pointer' : 'default',
              background: text.trim() && !saving ? '#2a5bd7' : '#9ab0ec', color: '#fff',
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

const _pieceModules = import.meta.glob('./assets/shogi/*.png', { eager: true }) as Record<string, { default: string }>
const PIECE_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(_pieceModules).map(([path, mod]) => [path.split('/').pop()!.replace('.png', ''), mod.default])
)

function getPieceUrl(piece: string, sente: boolean, promoted: boolean): string {
  const side = sente ? 'black' : 'white'
  let name: string
  if (promoted) {
    const promMap: Record<string, string> = {
      p: 'prom_pawn', l: 'prom_lance', n: 'prom_knight', s: 'prom_silver', b: 'horse', r: 'dragon',
    }
    name = promMap[piece] ?? piece
  } else {
    const baseMap: Record<string, string> = {
      p: 'pawn', l: 'lance', n: 'knight', s: 'silver', g: 'gold', b: 'bishop', r: 'rook',
      k: sente ? 'king2' : 'king',
    }
    name = baseMap[piece] ?? piece
  }
  return PIECE_URLS[`${side}_${name}`] ?? ''
}

interface Cell { piece: string; sente: boolean; promoted: boolean }

function parseSfenBoard(boardPart: string): (Cell | null)[][] {
  return boardPart.split('/').map(row => {
    const cells: (Cell | null)[] = []
    let promoted = false
    for (const ch of row) {
      if (ch === '+') { promoted = true; continue }
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push(null)
        promoted = false
        continue
      }
      const sente = ch === ch.toUpperCase()
      cells.push({ piece: ch.toLowerCase(), sente, promoted })
      promoted = false
    }
    return cells
  })
}

function parseSfenHand(handPart: string): { sente: Record<string, number>; gote: Record<string, number> } {
  if (handPart === '-') return { sente: {}, gote: {} }
  const sente: Record<string, number> = {}
  const gote: Record<string, number> = {}
  let count = 0
  for (const ch of handPart) {
    if (/\d/.test(ch)) { count = count * 10 + Number(ch); continue }
    const n = count || 1
    count = 0
    const key = ch.toLowerCase()
    if (ch === ch.toUpperCase()) sente[key] = (sente[key] ?? 0) + n
    else gote[key] = (gote[key] ?? 0) + n
  }
  return { sente, gote }
}

const HAND_ORDER = ['r', 'b', 'g', 's', 'n', 'l', 'p']

function HandArea({ hand, isSente }: { hand: Record<string, number>; isSente: boolean }): JSX.Element {
  const entries = HAND_ORDER.filter(p => hand[p]).map(p => [p, hand[p]] as [string, number])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '44px', padding: '4px 0' }}>
      <span style={{ fontSize: '11px', color: '#666', marginRight: '2px', whiteSpace: 'nowrap' }}>
        {isSente ? '先手' : '後手'}持ち駒:
      </span>
      {entries.length === 0
        ? <span style={{ fontSize: '12px', color: '#aaa' }}>なし</span>
        : entries.map(([p, n]) => (
            <div key={p} style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={getPieceUrl(p, isSente, false)}
                style={{ width: '32px', height: '35px', objectFit: 'contain', display: 'block' }}
                alt=""
                draggable={false}
              />
              {n > 1 && (
                <span style={{
                  position: 'absolute', bottom: 1, right: -1,
                  fontSize: '10px', color: '#c00', fontWeight: 'bold', lineHeight: 1,
                }}>
                  {n}
                </span>
              )}
            </div>
          ))
      }
    </div>
  )
}

function ResizeHandle(): JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <Separator
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '6px',
        background: hovered ? '#c8d8f0' : '#e4e4e4',
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.12s',
      }}
    >
      <div style={{
        width: '2px',
        height: '36px',
        borderRadius: '1px',
        background: hovered ? '#2a5bd7' : '#b8b8b8',
        transition: 'background 0.12s',
      }} />
    </Separator>
  )
}

function ShogiBoard({ sfen, boardW }: { sfen: string; boardW: number }): JSX.Element {
  const boardH = Math.round(boardW * 960 / 878)
  const boardPad = Math.round(boardW * 18 / 878)
  const parts = sfen.split(' ')
  const board = parseSfenBoard(parts[0])
  const { sente: senteHand, gote: goteHand } = parseSfenHand(parts[2] ?? '-')

  return (
    <div style={{ userSelect: 'none' }}>
      <HandArea hand={goteHand} isSente={false} />
      <div style={{ position: 'relative', width: boardW, height: boardH }}>
        <img
          src={boardUrl}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          alt=""
          draggable={false}
        />
        <div style={{
          position: 'absolute',
          top: boardPad, left: boardPad, right: boardPad, bottom: boardPad,
          display: 'grid',
          gridTemplateColumns: 'repeat(9, 1fr)',
          gridTemplateRows: 'repeat(9, 1fr)',
        }}>
          {board.flat().map((cell, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {cell && (
                <img
                  src={getPieceUrl(cell.piece, cell.sente, cell.promoted)}
                  style={{ width: '90%', height: '90%', objectFit: 'contain' }}
                  alt=""
                  draggable={false}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <HandArea hand={senteHand} isSente={true} />
    </div>
  )
}

// ---- KifuListItem ----

interface KifuListItemProps {
  kifu: KifuFile
  onTagAdd: (tagName: string) => void
  onTagRemove: (tagName: string) => void
}

function KifuListItem({ kifu, onTagAdd, onTagRemove }: KifuListItemProps): JSX.Element {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter') return
    const name = input.trim()
    if (name && !kifu.tags.includes(name)) {
      onTagAdd(name)
    }
    setInput('')
  }

  return (
    <li
      onDoubleClick={() => console.log(kifu.fileName)}
      style={{ padding: '8px', borderRadius: '4px', cursor: 'default' }}
      onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
      onMouseLeave={e => (e.currentTarget.style.background = '')}
    >
      <div style={{ fontSize: '13px', color: '#333', marginBottom: '4px' }}>{kifu.fileName}</div>

      {/* タグバッジ */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        {kifu.tags.map(tag => (
          <span
            key={tag}
            title="クリックで削除"
            onClick={() => onTagRemove(tag)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '3px',
              padding: '1px 6px', borderRadius: '10px',
              background: '#e0eaff', color: '#2a5bd7',
              fontSize: '11px', cursor: 'pointer',
            }}
          >
            #{tag}
            <span style={{ fontSize: '10px', color: '#7a9ce0' }}>✕</span>
          </span>
        ))}

        {/* タグ入力欄 */}
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="タグ追加…"
          style={{
            width: '72px', fontSize: '11px', border: 'none',
            borderBottom: '1px solid #ccc', outline: 'none',
            background: 'transparent', color: '#555',
          }}
        />
      </div>
    </li>
  )
}

// ---- App ----

// ---- StatsPanel ----

function StatsPanel({ stats, prefix, onMoveClick }: { stats: MoveCount[]; prefix: string; onMoveClick: (move: string) => void }): JSX.Element {
  const total = stats.reduce((s, r) => s + r.count, 0)
  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#555' }}>総数: {total}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {stats.map(({ move, count }) => {
          const pct = ((count / total) * 100).toFixed(1)
          const barWidth = Math.round((count / total) * 100)
          return (
            <li
              key={move}
              onClick={() => onMoveClick(move)}
              style={{ marginBottom: '8px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#222', marginBottom: '3px' }}>
                <span>{prefix}{move}</span>
                <span style={{ color: '#555', fontSize: '12px' }}>{count}局 {pct}%</span>
              </div>
              <div style={{ height: '6px', background: '#dde4f0', borderRadius: '3px' }}>
                <div style={{ height: '100%', width: `${barWidth}%`, background: '#2a5bd7', borderRadius: '3px' }} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const INITIAL_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1'

function sidePrefix(sfen: string): string {
  return sfen.split(' ')[1] === 'b' ? '▲' : '△'
}

function App(): JSX.Element {
  const [kifuList, setKifuList] = useState<KifuFile[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [currentSfen, setCurrentSfen] = useState(INITIAL_SFEN)
  const [sfenHistory, setSfenHistory] = useState<string[]>([])
  const [stats, setStats] = useState<MoveCount[]>([])
  const mainRef = useRef<HTMLDivElement>(null)
  const [boardW, setBoardW] = useState(486)

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      // 150px = gote hand (52) + sente hand (52) + nav (40) + gaps (6)
      const avW = width - 24
      const avH = height - 150
      setBoardW(Math.max(180, Math.floor(Math.min(avW, avH * (878 / 960)))))
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    window.api.getKifuList().then(files => setKifuList(files))

    const cleanup = window.api.onKifuFileOpened(files => {
      setKifuList(prev => {
        const existingPaths = new Set(prev.map(f => f.path))
        const newFiles = files.filter(f => !existingPaths.has(f.path))
        return [...prev, ...newFiles]
      })
    })
    return cleanup
  }, [])

  useEffect(() => {
    window.api.getPositionStats(currentSfen, tagQuery).then(setStats)
  }, [currentSfen, tagQuery])

  async function handleMoveClick(move: string): Promise<void> {
    const nextSfen = await window.api.applyMoveString(currentSfen, move)
    if (!nextSfen) return
    setSfenHistory(h => [...h, currentSfen])
    setCurrentSfen(nextSfen)
  }

  function handleBack(): void {
    setSfenHistory(h => {
      if (h.length === 0) return h
      const prev = [...h]
      const sfen = prev.pop()!
      setCurrentSfen(sfen)
      return prev
    })
  }

  function handleReset(): void {
    setSfenHistory([])
    setCurrentSfen(INITIAL_SFEN)
  }

  function handleTagAdd(kifuPath: string, tagName: string): void {
    window.api.addTag(kifuPath, tagName)
    setKifuList(prev =>
      prev.map(f =>
        f.path === kifuPath && !f.tags.includes(tagName)
          ? { ...f, tags: [...f.tags, tagName] }
          : f
      )
    )
  }

  function handleTagRemove(kifuPath: string, tagName: string): void {
    window.api.removeTag(kifuPath, tagName)
    setKifuList(prev =>
      prev.map(f =>
        f.path === kifuPath
          ? { ...f, tags: f.tags.filter(t => t !== tagName) }
          : f
      )
    )
  }

  const query = tagQuery.trim().replace(/^#+/, '')
  const filtered = query
    ? kifuList.filter(f => f.tags.some(t => t.includes(query)))
    : kifuList

  const backDisabled = sfenHistory.length === 0
  const resetDisabled = sfenHistory.length === 0 && currentSfen === INITIAL_SFEN
  const btnBase: React.CSSProperties = { padding: '5px 14px', fontSize: '12px', border: '1px solid #aaa', borderRadius: '4px' }

  return (
    <div style={{ height: '100vh', fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", overflow: 'hidden' }}>
      {showPasteModal && (
        <PasteKifModal
          onClose={() => setShowPasteModal(false)}
          onSaved={files => setKifuList(files)}
        />
      )}

      <Group orientation="horizontal" style={{ height: '100%' }}>
        {/* ── 盤パネル ── */}
        <Panel defaultSize={45} minSize={25}>
          <div
            ref={mainRef}
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f5f0e8',
              overflow: 'hidden',
              padding: '12px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ShogiBoard sfen={currentSfen} boardW={boardW} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                <button
                  onClick={handleBack}
                  disabled={backDisabled}
                  style={{ ...btnBase, cursor: backDisabled ? 'default' : 'pointer', background: backDisabled ? '#f0f0f0' : '#fff', color: backDisabled ? '#aaa' : '#333' }}
                >
                  ◀ 1手戻る
                </button>
                <button
                  onClick={handleReset}
                  disabled={resetDisabled}
                  style={{ ...btnBase, cursor: resetDisabled ? 'default' : 'pointer', background: resetDisabled ? '#f0f0f0' : '#fff', color: resetDisabled ? '#aaa' : '#333' }}
                >
                  初期局面
                </button>
              </div>
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        {/* ── 統計パネル ── */}
        <Panel defaultSize={25} minSize={12}>
          <div style={{
            height: '100%',
            overflowY: 'auto',
            padding: '12px 16px',
            boxSizing: 'border-box',
            background: '#fafafa',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: '#333' }}>統計</h3>
            {tagQuery.trim() && (
              <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#2a5bd7' }}>
                絞り込み中: #{tagQuery.trim()}
              </p>
            )}
            {stats.length === 0 ? (
              <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>データがありません</p>
            ) : (
              <StatsPanel stats={stats} prefix={sidePrefix(currentSfen)} onMoveClick={handleMoveClick} />
            )}
          </div>
        </Panel>

        <ResizeHandle />

        {/* ── 棋譜リストパネル ── */}
        <Panel defaultSize={30} minSize={15}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fff' }}>
            <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '14px', color: '#333' }}>棋譜リスト</h3>
                <button
                  onClick={() => setShowPasteModal(true)}
                  title="KIFテキストを貼り付けて追加"
                  style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: '#fff', color: '#555' }}
                >
                  + テキストから追加
                </button>
              </div>
              <input
                value={tagQuery}
                onChange={e => setTagQuery(e.target.value)}
                placeholder="タグで絞り込み…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', outline: 'none' }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {filtered.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#999', margin: '8px' }}>
                  {query ? 'タグが一致する棋譜がありません' : '棋譜がありません'}
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {filtered.map(f => (
                    <KifuListItem
                      key={f.path}
                      kifu={f}
                      onTagAdd={name => handleTagAdd(f.path, name)}
                      onTagRemove={name => handleTagRemove(f.path, name)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}

export default App
