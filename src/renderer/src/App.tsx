import { useState, useEffect, useRef, useCallback } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { KifuFile, Move, Player } from '../../shared/types'
import { sfenToBoard, applyMove, boardToSfen } from '../../shared/board'
import { findToSquares, findDropSquares } from '../../shared/moveGen'
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

// ---- 駒の成り判定ヘルパー ----

const NON_PROMOTABLE = new Set(['金', '王', '玉'])

function canPromote(piece: string, promoted: boolean): boolean {
  return !promoted && !NON_PROMOTABLE.has(piece)
}

function inPromotionZone(player: Player, rank: number): boolean {
  return player === 'sente' ? rank <= 3 : rank >= 7
}

// 打ち歩詰め判定は省略（MVP範囲外）
function mustPromote(piece: string, player: Player, toRank: number): boolean {
  if (piece === '歩' || piece === '香') {
    return player === 'sente' ? toRank === 1 : toRank === 9
  }
  if (piece === '桂') {
    return player === 'sente' ? toRank <= 2 : toRank >= 8
  }
  return false
}

// ---- SFENテキストからファイル名を推測 ----

function suggestFileName(text: string): string {
  const sente = text.match(/^先手[：:]\s*(.+)$/m)?.[1]?.trim()
  const gote  = text.match(/^後手[：:]\s*(.+)$/m)?.[1]?.trim()
  if (sente && gote) return `${sente}vs${gote}.kif`
  const date = text.match(/^開始日時[：:]\s*(\d{4})[\/-](\d{2})[\/-](\d{2})/m)
  if (date) return `${date[1]}${date[2]}${date[3]}.kif`
  return `kifu_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.kif`
}

// ---- 成り確認ダイアログ ----

interface PromoteDialogProps {
  onResolve: (promote: boolean) => void
}

function PromoteDialog({ onResolve }: PromoteDialogProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: '8px', padding: '24px 32px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
        }}
      >
        <p style={{ margin: 0, fontSize: '15px', color: '#222' }}>成りますか？</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => onResolve(true)}
            style={{
              padding: '8px 24px', fontSize: '14px', border: 'none',
              borderRadius: '4px', cursor: 'pointer',
              background: '#2a5bd7', color: '#fff',
            }}
          >
            成る
          </button>
          <button
            onClick={() => onResolve(false)}
            style={{
              padding: '8px 24px', fontSize: '14px',
              border: '1px solid #aaa', borderRadius: '4px', cursor: 'pointer',
              background: '#fff', color: '#333',
            }}
          >
            不成
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- KIFペーストモーダル ----

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

// ---- 駒画像 ----

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

// SFEN lowercase → 日本語駒名（持ち駒クリック用）
const SFEN_TO_JP: Record<string, string> = {
  'p': '歩', 'l': '香', 'n': '桂', 's': '銀', 'g': '金', 'b': '角', 'r': '飛',
}

// ---- 選択状態 ----

type BoardSelection =
  | { kind: 'board'; fromFile: number; fromRank: number; validDests: [number, number][] }
  | { kind: 'hand'; piece: string; validDests: [number, number][] }
  | null

// ---- HandArea ----

interface HandAreaProps {
  hand: Record<string, number>
  isSente: boolean
  selection: BoardSelection
  onHandClick: (piece: string, isSente: boolean) => void
}

function HandArea({ hand, isSente, selection, onHandClick }: HandAreaProps): JSX.Element {
  const entries = HAND_ORDER.filter(p => hand[p]).map(p => [p, hand[p]] as [string, number])
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minHeight: '44px', padding: '4px 0' }}>
      <span style={{ fontSize: '11px', color: '#666', marginRight: '2px', whiteSpace: 'nowrap' }}>
        {isSente ? '先手' : '後手'}持ち駒:
      </span>
      {entries.length === 0
        ? <span style={{ fontSize: '12px', color: '#aaa' }}>なし</span>
        : entries.map(([p, n]) => {
            const jpPiece = SFEN_TO_JP[p] ?? p
            const isSelected = selection?.kind === 'hand' && selection.piece === jpPiece
            return (
              <div
                key={p}
                onClick={() => onHandClick(p, isSente)}
                style={{
                  position: 'relative', display: 'inline-block', cursor: 'pointer',
                  outline: isSelected ? '2px solid #2a5bd7' : 'none',
                  borderRadius: '2px',
                  background: isSelected ? 'rgba(42,91,215,0.12)' : 'transparent',
                }}
              >
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
            )
          })
      }
    </div>
  )
}

// ---- ResizeHandle ----

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

// ---- ShogiBoard ----

interface ShogiBoardProps {
  sfen: string
  boardW: number
  selection: BoardSelection
  onSquareClick: (file: number, rank: number) => void
  onHandClick: (piece: string, isSente: boolean) => void
}

function ShogiBoard({ sfen, boardW, selection, onSquareClick, onHandClick }: ShogiBoardProps): JSX.Element {
  const boardH = Math.round(boardW * 960 / 878)
  const boardPad = Math.round(boardW * 18 / 878)
  const parts = sfen.split(' ')
  const board = parseSfenBoard(parts[0])
  const { sente: senteHand, gote: goteHand } = parseSfenHand(parts[2] ?? '-')

  const validDestSet = new Set(
    (selection?.validDests ?? []).map(([f, r]) => `${f},${r}`)
  )

  return (
    <div style={{ userSelect: 'none' }}>
      <HandArea hand={goteHand} isSente={false} selection={selection} onHandClick={onHandClick} />
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
          {board.flat().map((cell, i) => {
            // SFEN board は file 9→1 × rank 1→9 の順で並ぶ
            const rank = Math.floor(i / 9) + 1
            const file = 9 - (i % 9)
            const isSelected = selection?.kind === 'board'
              && selection.fromFile === file && selection.fromRank === rank
            const isValidDest = validDestSet.has(`${file},${rank}`)

            return (
              <div
                key={i}
                onClick={() => onSquareClick(file, rank)}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {/* 選択中の駒ハイライト */}
                {isSelected && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(42,91,215,0.35)',
                    pointerEvents: 'none',
                  }} />
                )}
                {/* 移動先候補ハイライト */}
                {isValidDest && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: cell
                      ? 'rgba(220,40,40,0.35)'   // 相手駒あり = 赤（取れる）
                      : 'rgba(40,180,80,0.35)',   // 空升 = 緑
                    pointerEvents: 'none',
                  }} />
                )}
                {cell && (
                  <img
                    src={getPieceUrl(cell.piece, cell.sente, cell.promoted)}
                    style={{ width: '90%', height: '90%', objectFit: 'contain', position: 'relative' }}
                    alt=""
                    draggable={false}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      <HandArea hand={senteHand} isSente={true} selection={selection} onHandClick={onHandClick} />
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

// ---- App ----

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
  const [selection, setSelection] = useState<BoardSelection>(null)
  const [promoteResolver, setPromoteResolver] = useState<((v: boolean) => void) | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const [boardW, setBoardW] = useState(486)

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
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

  // 成り確認を Promise で待つ
  function askPromote(): Promise<boolean> {
    return new Promise(resolve => {
      setPromoteResolver(() => resolve)
    })
  }

  function handlePromoteResolve(v: boolean): void {
    setPromoteResolver(null)
    promoteResolver?.(v)
  }

  // 統計パネルの手クリック（DB lookup）
  async function handleMoveClick(move: string): Promise<void> {
    const nextSfen = await window.api.applyMoveString(currentSfen, move)
    if (!nextSfen) return
    setSfenHistory(h => [...h, currentSfen])
    setCurrentSfen(nextSfen)
    setSelection(null)
  }

  function handleBack(): void {
    setSelection(null)
    setSfenHistory(h => {
      if (h.length === 0) return h
      const prev = [...h]
      const sfen = prev.pop()!
      setCurrentSfen(sfen)
      return prev
    })
  }

  function handleReset(): void {
    setSelection(null)
    setSfenHistory([])
    setCurrentSfen(INITIAL_SFEN)
  }

  // 盤面セルのクリックハンドラ
  const handleSquareClick = useCallback(async (file: number, rank: number) => {
    const state = sfenToBoard(currentSfen)
    const player = state.sideToMove

    if (selection) {
      const isValidDest = selection.validDests.some(([f, r]) => f === file && r === rank)

      if (isValidDest) {
        // 手を生成する
        let move: Move

        if (selection.kind === 'board') {
          const fromSq = state.board[selection.fromRank - 1][selection.fromFile - 1]!
          let isPromotion = false

          if (canPromote(fromSq.piece, fromSq.promoted)) {
            const enters = inPromotionZone(player, rank)
            const leaves = inPromotionZone(player, selection.fromRank)
            if (mustPromote(fromSq.piece, player, rank)) {
              isPromotion = true
            } else if (enters || leaves) {
              isPromotion = await askPromote()
            }
          }

          move = {
            moveNumber: state.moveCount + 1,
            fromFile: selection.fromFile, fromRank: selection.fromRank,
            toFile: file, toRank: rank,
            piece: fromSq.piece, isDrop: false, isPromotion, isSpecial: false,
          }
        } else {
          // 持ち駒を打つ
          move = {
            moveNumber: state.moveCount + 1,
            toFile: file, toRank: rank,
            piece: selection.piece, isDrop: true, isPromotion: false, isSpecial: false,
          }
        }

        const newState = applyMove(state, move)
        const newSfen = boardToSfen(newState)
        setSfenHistory(h => [...h, currentSfen])
        setCurrentSfen(newSfen)
        setSelection(null)
        return
      }

      // 有効な行き先でない場合: 同じ手番の駒なら選択切替
      const clicked = state.board[rank - 1][file - 1]
      if (clicked?.player === player) {
        const dests = findToSquares(state.board, file, rank, player)
        setSelection({ kind: 'board', fromFile: file, fromRank: rank, validDests: dests })
        return
      }

      // 何もなければ選択解除
      setSelection(null)
      return
    }

    // 選択なし: 手番の駒をクリックで選択
    const sq = state.board[rank - 1][file - 1]
    if (sq?.player === player) {
      const dests = findToSquares(state.board, file, rank, player)
      setSelection({ kind: 'board', fromFile: file, fromRank: rank, validDests: dests })
    }
  }, [currentSfen, selection, promoteResolver])

  // 持ち駒クリックハンドラ
  const handleHandClick = useCallback((pieceChar: string, isSente: boolean) => {
    const state = sfenToBoard(currentSfen)
    const player = state.sideToMove
    const clickedPlayer: Player = isSente ? 'sente' : 'gote'

    // 手番の持ち駒のみ選択可能
    if (clickedPlayer !== player) { setSelection(null); return }

    const jpPiece = SFEN_TO_JP[pieceChar] ?? pieceChar
    const hand = isSente ? state.senteHand : state.goteHand

    // 同じ持ち駒を再クリックで選択解除
    if (selection?.kind === 'hand' && selection.piece === jpPiece) {
      setSelection(null)
      return
    }

    const dests = findDropSquares(state.board, jpPiece, hand, player)
    setSelection({ kind: 'hand', piece: jpPiece, validDests: dests })
  }, [currentSfen, selection])

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
      {promoteResolver && <PromoteDialog onResolve={handlePromoteResolve} />}

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
              <ShogiBoard
                sfen={currentSfen}
                boardW={boardW}
                selection={selection}
                onSquareClick={handleSquareClick}
                onHandClick={handleHandClick}
              />
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
