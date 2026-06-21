import { useState, useEffect, useRef } from 'react'
import type { KifuFile } from '../../shared/types'

interface MoveCount { move: string; count: number }

declare global {
  interface Window {
    api: {
      selectKifuFile: () => Promise<string | null>
      getKifuList: () => Promise<KifuFile[]>
      addTag: (kifuPath: string, tagName: string) => Promise<void>
      removeTag: (kifuPath: string, tagName: string) => Promise<void>
      applyMoveString: (sfen: string, move: string) => Promise<string | null>
      getPositionStats: (sfen: string, tagQuery: string) => Promise<MoveCount[]>
      onKifuFileOpened: (callback: (files: KifuFile[]) => void) => () => void
    }
  }
}

const COLS = ['9', '8', '7', '6', '5', '4', '3', '2', '1']
const ROWS = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

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

const PIECE_KANJI: Record<string, string> = {
  p: '歩', l: '香', n: '桂', s: '銀', g: '金', b: '角', r: '飛', k: '王'
}
const PROMOTED_KANJI: Record<string, string> = {
  p: 'と', l: '杏', n: '圭', s: '全', b: '馬', r: '竜'
}
const HAND_ORDER = ['r', 'b', 'g', 's', 'n', 'l', 'p']

function pieceText(cell: Cell): string {
  if (cell.promoted && PROMOTED_KANJI[cell.piece]) return PROMOTED_KANJI[cell.piece]
  return PIECE_KANJI[cell.piece] ?? cell.piece
}

function HandArea({ hand, isSente }: { hand: Record<string, number>; isSente: boolean }): JSX.Element {
  const entries = HAND_ORDER.filter(p => hand[p]).map(p => [p, hand[p]] as [string, number])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minHeight: '24px', padding: '4px 0' }}>
      <span style={{ fontSize: '11px', color: '#666', marginRight: '4px' }}>{isSente ? '先手' : '後手'}持ち駒:</span>
      {entries.length === 0
        ? <span style={{ fontSize: '12px', color: '#aaa' }}>なし</span>
        : entries.map(([p, n]) => (
            <span key={p} style={{ fontSize: '14px', color: isSente ? '#222' : '#c0392b' }}>
              {PIECE_KANJI[p]}{n > 1 ? `×${n}` : ''}
            </span>
          ))
      }
    </div>
  )
}

function ShogiBoard({ sfen }: { sfen: string }): JSX.Element {
  const parts = sfen.split(' ')
  const board = parseSfenBoard(parts[0])
  const { sente: senteHand, gote: goteHand } = parseSfenHand(parts[2] ?? '-')

  return (
    <div style={{ userSelect: 'none' }}>
      <HandArea hand={goteHand} isSente={false} />
      <div style={{ display: 'flex', paddingLeft: '20px' }}>
        {COLS.map(c => (
          <div key={c} style={{ width: '52px', textAlign: 'center', fontSize: '12px', color: '#666' }}>
            {c}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 52px)', border: '2px solid #444' }}>
          {board.flat().map((cell, i) => (
            <div
              key={i}
              style={{
                width: '52px', height: '56px', border: '1px solid #888', background: '#e8c87a',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {cell && (
                <span style={{
                  fontSize: '18px',
                  color: cell.sente ? '#1a1a1a' : '#c0392b',
                  display: 'inline-block',
                  transform: cell.sente ? 'none' : 'rotate(180deg)',
                  lineHeight: 1,
                }}>
                  {pieceText(cell)}
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {ROWS.map(r => (
            <div key={r} style={{ height: '56px', display: 'flex', alignItems: 'center', paddingLeft: '6px', fontSize: '12px', color: '#666' }}>
              {r}
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
              style={{ marginBottom: '6px', cursor: 'pointer', padding: '3px 4px', borderRadius: '4px' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
              onMouseLeave={e => (e.currentTarget.style.background = '')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#222' }}>
                <span>{prefix}{move}</span>
                <span style={{ color: '#555' }}>{count}回 ({pct}%)</span>
              </div>
              <div style={{ height: '4px', background: '#eee', borderRadius: '2px', marginTop: '2px' }}>
                <div style={{ height: '100%', width: `${barWidth}%`, background: '#2a5bd7', borderRadius: '2px' }} />
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
  const [currentSfen, setCurrentSfen] = useState(INITIAL_SFEN)
  const [sfenHistory, setSfenHistory] = useState<string[]>([])
  const [stats, setStats] = useState<MoveCount[]>([])

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

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif", overflow: 'hidden' }}>
      <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f5f0e8', gap: '12px' }}>
        <ShogiBoard sfen={currentSfen} />
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleBack}
            disabled={sfenHistory.length === 0}
            style={{
              padding: '5px 14px', fontSize: '12px', cursor: sfenHistory.length === 0 ? 'default' : 'pointer',
              border: '1px solid #aaa', borderRadius: '4px',
              background: sfenHistory.length === 0 ? '#f0f0f0' : '#fff',
              color: sfenHistory.length === 0 ? '#aaa' : '#333',
            }}
          >
            ◀ 1手戻る
          </button>
          <button
            onClick={handleReset}
            disabled={sfenHistory.length === 0 && currentSfen === INITIAL_SFEN}
            style={{
              padding: '5px 14px', fontSize: '12px',
              cursor: (sfenHistory.length === 0 && currentSfen === INITIAL_SFEN) ? 'default' : 'pointer',
              border: '1px solid #aaa', borderRadius: '4px',
              background: (sfenHistory.length === 0 && currentSfen === INITIAL_SFEN) ? '#f0f0f0' : '#fff',
              color: (sfenHistory.length === 0 && currentSfen === INITIAL_SFEN) ? '#aaa' : '#333',
            }}
          >
            初期局面
          </button>
        </div>
      </div>
      <div style={{ width: '300px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #ccc', background: '#fff' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #ccc', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 8px' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: '#333' }}>棋譜リスト</h3>
            <input
              value={tagQuery}
              onChange={e => setTagQuery(e.target.value)}
              placeholder="タグで絞り込み…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '5px 8px', fontSize: '12px',
                border: '1px solid #ccc', borderRadius: '4px', outline: 'none',
              }}
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

        <div style={{ flex: 1, padding: '16px', overflow: 'auto' }}>
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
      </div>
    </div>
  )
}

export default App
