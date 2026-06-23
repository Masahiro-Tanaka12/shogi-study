import { useState, useEffect, useRef, useCallback } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { KifuFile, Move, Player } from '../../shared/types'
import { sfenToBoard, applyMove, boardToSfen } from '../../shared/board'
import { findToSquares, findDropSquares } from '../../shared/moveGen'
import boardUrl from './assets/shogi/light_878x960.png'

interface MoveCount {
  move: string
  count: number
  fromFile: number | null
  fromRank: number | null
  toFile: number | null
  toRank: number | null
  isDrop: number | null
}

declare global {
  interface Window {
    api: {
      selectKifuFile: () => Promise<string | null>
      getKifuList: () => Promise<KifuFile[]>
      addTag: (kifuPath: string, tagName: string) => Promise<void>
      removeTag: (kifuPath: string, tagName: string) => Promise<void>
      savePastedKif: (text: string, suggestedName: string) => Promise<KifuFile[] | null>
      deleteKifu: (kifuPath: string) => Promise<KifuFile[]>
      updateKifuPath: (oldPath: string, newPath: string) => Promise<KifuFile[]>
      reimportKifu: (kifuPath: string) => Promise<KifuFile[]>
      getKifuSfens: (kifuPath: string) => Promise<string[]>
      getKifuMoveLabels: (kifuPath: string) => Promise<string[]>
      importFolder: () => Promise<{ imported: number; skipped: number; failed: number; total: number; kifuList: KifuFile[] } | null>
      applyMoveString: (sfen: string, move: string) => Promise<string | null>
      getPositionStats: (sfen: string, tags: string[], mode: 'AND' | 'OR') => Promise<MoveCount[]>
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

const ARROW_STYLES = [
  { opacity: 0.85, strokeWidth: 0.18 },
  { opacity: 0.50, strokeWidth: 0.14 },
  { opacity: 0.28, strokeWidth: 0.11 },
]

interface ShogiBoardProps {
  sfen: string
  boardW: number
  selection: BoardSelection
  arrowMoves: MoveCount[]
  onSquareClick: (file: number, rank: number) => void
  onHandClick: (piece: string, isSente: boolean) => void
}

function ShogiBoard({ sfen, boardW, selection, arrowMoves, onSquareClick, onHandClick }: ShogiBoardProps): JSX.Element {
  const parts = sfen.split(' ')
  const board = parseSfenBoard(parts[0])
  const { sente: senteHand, gote: goteHand } = parseSfenHand(parts[2] ?? '-')

  const validDestSet = new Set(
    (selection?.validDests ?? []).map(([f, r]) => `${f},${r}`)
  )

  return (
    <div style={{ userSelect: 'none' }}>
      <HandArea hand={goteHand} isSente={false} selection={selection} onHandClick={onHandClick} />
      <div style={{ position: 'relative', width: boardW, aspectRatio: '878 / 960' }}>
        <img
          src={boardUrl}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          alt=""
          draggable={false}
        />
        <svg
          style={{
            position: 'absolute',
            top: '1.1458%',
            bottom: '1.3542%',
            left: '1.3668%',
            right: '1.4806%',
            width: 'calc(100% - 1.3668% - 1.4806%)',
            height: 'calc(100% - 1.1458% - 1.3542%)',
            pointerEvents: 'none',
            zIndex: 10,
            overflow: 'visible',
          }}
          viewBox="0 0 9 9"
          preserveAspectRatio="none"
        >
          <defs>
            {ARROW_STYLES.map((s, i) => (
              <marker
                key={i}
                id={`stat-arrowhead-${i}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="3.5"
                markerHeight="3.5"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 Z" fill={`rgba(220,30,30,${s.opacity})`} />
              </marker>
            ))}
          </defs>
          {arrowMoves.slice(0, 3).map((m, i) => {
            const style = ARROW_STYLES[i]
            const x2 = 9.5 - (m.toFile ?? 0)
            const y2 = (m.toRank ?? 0) - 0.5
            if (m.isDrop || m.fromFile == null || m.fromRank == null) {
              return (
                <circle
                  key={i}
                  cx={x2}
                  cy={y2}
                  r={0.3}
                  fill={`rgba(220,30,30,${style.opacity})`}
                />
              )
            }
            const x1 = 9.5 - m.fromFile
            const y1 = m.fromRank - 0.5
            // 矢印が短いとき頭が消えないよう線端を少し手前で止める
            const dx = x2 - x1
            const dy = y2 - y1
            const len = Math.sqrt(dx * dx + dy * dy)
            const trim = len > 0 ? 0.15 / len : 0
            const ex = x2 - dx * trim
            const ey = y2 - dy * trim
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={ex}
                y2={ey}
                stroke={`rgba(220,30,30,${style.opacity})`}
                strokeWidth={style.strokeWidth}
                strokeLinecap="round"
                markerEnd={`url(#stat-arrowhead-${i})`}
              />
            )
          })}
        </svg>
        <div style={{
          position: 'absolute',
          top: '1.1458%',    // 11px / 960px
          bottom: '1.3542%', // 13px / 960px
          left: '1.3668%',   // 12px / 878px
          right: '1.4806%',  // 13px / 878px
          display: 'grid',
          gridTemplateColumns: '94fr 95fr 95fr 95fr 95fr 95fr 94fr 95fr 95fr',
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
  isReplaying: boolean
  allTags: { name: string; count: number }[]
  onTagAdd: (tagName: string) => void
  onTagRemove: (tagName: string) => void
  onDelete: () => void
  onReimport: () => Promise<void>
  onRelocate: () => Promise<void>
  onReplay: () => Promise<void>
}

function KifuListItem({ kifu, isReplaying, allTags, onTagAdd, onTagRemove, onDelete, onReimport, onRelocate, onReplay }: KifuListItemProps): JSX.Element {
  const [input, setInput] = useState('')
  const [hovered, setHovered] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reimporting, setReimporting] = useState(false)
  const [relocating, setRelocating] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleReimport(e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    setReimporting(true)
    try {
      await onReimport()
    } finally {
      setReimporting(false)
    }
  }

  async function handleRelocate(e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    setRelocating(true)
    try {
      await onRelocate()
    } finally {
      setRelocating(false)
    }
  }

  const candidates = allTags.filter(t =>
    !kifu.tags.includes(t.name) &&
    (input === '' || t.name.includes(input.replace(/^#+/, '')))
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') { setShowDropdown(false); return }
    if (e.key !== 'Enter') return
    const name = input.trim().replace(/^#+/, '')
    if (name && !kifu.tags.includes(name)) {
      onTagAdd(name)
    }
    setInput('')
  }

  return (
    <li
      onDoubleClick={() => { if (kifu.exists) onReplay() }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirming(false) }}
      style={{
        padding: '8px', borderRadius: '4px', cursor: 'default',
        background: isReplaying ? '#e8f0ff' : hovered ? '#f5f5f5' : '',
        outline: isReplaying ? '2px solid #d33' : 'none',
        outlineOffset: '-1px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: kifu.exists ? '#333' : '#c44', wordBreak: 'break-all' }}>
            {kifu.fileName}
            {!kifu.exists && (
              <span style={{ marginLeft: '4px', fontSize: '10px', color: '#c44' }}>（ファイルなし）</span>
            )}
          </div>
          {(kifu.senteName || kifu.goteName || kifu.gameDate) && (
            <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>
              {kifu.senteName && <span>▲{kifu.senteName}</span>}
              {kifu.senteName && kifu.goteName && <span style={{ margin: '0 3px' }}>vs</span>}
              {kifu.goteName && <span>△{kifu.goteName}</span>}
              {kifu.gameDate && <span style={{ marginLeft: '6px', color: '#aaa' }}>{kifu.gameDate}</span>}
            </div>
          )}
        </div>
        {!kifu.exists && !confirming && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
            <button
              onClick={handleRelocate}
              disabled={relocating}
              title="ファイルの場所を再指定"
              style={{
                padding: '1px 6px', fontSize: '11px',
                border: '1px solid #e90', borderRadius: '4px',
                cursor: relocating ? 'default' : 'pointer',
                background: '#fff7ee', color: relocating ? '#aaa' : '#c60',
              }}
            >
              {relocating ? '処理中…' : '再指定'}
            </button>
          </div>
        )}
        {kifu.exists && hovered && !confirming && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onReplay() }}
              title="棋譜を表示"
              style={{
                padding: '1px 6px', fontSize: '11px',
                border: '1px solid #8a8', borderRadius: '4px',
                cursor: 'pointer', background: '#f0fff0', color: '#363',
              }}
            >
              表示
            </button>
            <button
              onClick={handleReimport}
              disabled={reimporting}
              title="棋譜ファイルを再読み込み"
              style={{
                padding: '1px 6px', fontSize: '11px',
                border: '1px solid #8ab', borderRadius: '4px',
                cursor: reimporting ? 'default' : 'pointer',
                background: '#fff', color: reimporting ? '#aaa' : '#369',
              }}
            >
              {reimporting ? '読込中…' : '再読込'}
            </button>
            <button
              onClick={e => { e.stopPropagation(); setConfirming(true) }}
              title="棋譜を削除"
              style={{
                padding: '1px 6px', fontSize: '11px',
                border: '1px solid #e88', borderRadius: '4px', cursor: 'pointer',
                background: '#fff', color: '#c33',
              }}
            >
              削除
            </button>
          </div>
        )}
        {confirming && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              style={{
                padding: '1px 8px', fontSize: '11px', border: 'none',
                borderRadius: '4px', cursor: 'pointer', background: '#c33', color: '#fff',
              }}
            >
              削除する
            </button>
            <button
              onClick={e => { e.stopPropagation(); setConfirming(false) }}
              style={{
                padding: '1px 6px', fontSize: '11px',
                border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer',
                background: '#fff', color: '#555',
              }}
            >
              キャンセル
            </button>
          </div>
        )}
      </div>

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

        <div style={{ position: 'relative', display: 'inline-block' }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setShowDropdown(false)}
            placeholder="タグ追加…"
            style={{
              width: '72px', fontSize: '11px', border: 'none',
              borderBottom: '1px solid #ccc', outline: 'none',
              background: 'transparent', color: '#555',
            }}
          />
          {showDropdown && candidates.length > 0 && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 2px)',
              left: 0,
              zIndex: 200,
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              minWidth: '120px',
              maxHeight: '160px',
              overflowY: 'auto',
            }}>
              {candidates.map(t => (
                <div
                  key={t.name}
                  onMouseDown={e => {
                    e.preventDefault()
                    onTagAdd(t.name)
                    setInput('')
                    inputRef.current?.focus()
                  }}
                  style={{ padding: '5px 10px', fontSize: '12px', cursor: 'pointer', color: '#333', whiteSpace: 'nowrap' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ color: '#2a5bd7' }}>#{t.name}</span>
                  <span style={{ marginLeft: '6px', fontSize: '10px', color: '#aaa' }}>{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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

// ---- MoveListPanel ----

interface MoveListPanelProps {
  moves: string[]
  sfens: string[]
  currentIndex: number
  onJump: (index: number) => void
}

function MoveListPanel({ moves, sfens, currentIndex, onJump }: MoveListPanelProps): JSX.Element {
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentIndex])

  const itemStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    background: active ? '#e8f0ff' : '',
    borderLeft: active ? '3px solid #2a5bd7' : '3px solid transparent',
  })

  return (
    <div>
      <div
        ref={currentIndex === 0 ? activeRef : null}
        onClick={() => onJump(0)}
        style={itemStyle(currentIndex === 0)}
        onMouseEnter={e => { if (currentIndex !== 0) e.currentTarget.style.background = '#f5f5f5' }}
        onMouseLeave={e => { if (currentIndex !== 0) e.currentTarget.style.background = '' }}
      >
        <span style={{ fontSize: '11px', color: '#aaa', minWidth: '28px', textAlign: 'right' }}>0</span>
        <span style={{ color: '#555' }}>開始局面</span>
      </div>
      {moves.map((move, i) => {
        const idx = i + 1
        const active = currentIndex === idx
        const prefix = (sfens[i]?.split(' ')[1] === 'b') ? '▲' : '△'
        return (
          <div
            key={idx}
            ref={active ? activeRef : null}
            onClick={() => onJump(idx)}
            style={itemStyle(active)}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f5f5f5' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = '' }}
          >
            <span style={{ fontSize: '11px', color: '#aaa', minWidth: '28px', textAlign: 'right' }}>{idx}</span>
            <span>{prefix}{move}</span>
          </div>
        )
      })}
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
  const [tagMode, setTagMode] = useState<'AND' | 'OR'>('OR')
  const [filterQuery, setFilterQuery] = useState('')
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [folderImporting, setFolderImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; failed: number; total: number } | null>(null)
  const [currentSfen, setCurrentSfen] = useState(INITIAL_SFEN)
  const [sfenHistory, setSfenHistory] = useState<string[]>([])
  const [stats, setStats] = useState<MoveCount[]>([])
  const [selection, setSelection] = useState<BoardSelection>(null)
  const [promoteResolver, setPromoteResolver] = useState<((v: boolean) => void) | null>(null)
  const [showTagSearch, setShowTagSearch] = useState(false)
  const [replayKifu, setReplayKifu] = useState<KifuFile | null>(null)
  const [replaySfens, setReplaySfens] = useState<string[]>([])
  const [replayMoves, setReplayMoves] = useState<string[]>([])
  const [replayIndex, setReplayIndex] = useState(0)
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
    const tags = tagQuery.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean)
    window.api.getPositionStats(currentSfen, tags, tagMode).then(setStats)
  }, [currentSfen, tagQuery, tagMode])

  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (!replayKifu) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setReplayIndex(i => {
          const next = Math.min(i + 1, replaySfens.length - 1)
          setCurrentSfen(replaySfens[next])
          return next
        })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setReplayIndex(i => {
          const prev = Math.max(i - 1, 0)
          setCurrentSfen(replaySfens[prev])
          return prev
        })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [replayKifu, replaySfens])

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
    if (replayKifu) return
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
  }, [currentSfen, selection, promoteResolver, replayKifu])

  // 持ち駒クリックハンドラ
  const handleHandClick = useCallback((pieceChar: string, isSente: boolean) => {
    if (replayKifu) return
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
  }, [currentSfen, selection, replayKifu])

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

  async function handleImportFolder(): Promise<void> {
    setFolderImporting(true)
    try {
      const result = await window.api.importFolder()
      if (!result) return
      setKifuList(result.kifuList)
      setImportResult({ imported: result.imported, skipped: result.skipped, failed: result.failed, total: result.total })
      setTimeout(() => setImportResult(null), 4000)
    } finally {
      setFolderImporting(false)
    }
  }

  async function handleKifuDelete(kifuPath: string): Promise<void> {
    const updated = await window.api.deleteKifu(kifuPath)
    setKifuList(updated)
  }

  async function handleKifuReimport(kifuPath: string): Promise<void> {
    const updated = await window.api.reimportKifu(kifuPath)
    setKifuList(updated)
    const tags = tagQuery.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean)
    const newStats = await window.api.getPositionStats(currentSfen, tags, tagMode)
    setStats(newStats)
  }

  async function handleKifuReplay(kifu: KifuFile): Promise<void> {
    const [sfens, moves] = await Promise.all([
      window.api.getKifuSfens(kifu.path),
      window.api.getKifuMoveLabels(kifu.path),
    ])
    if (sfens.length === 0) return
    setReplayKifu(kifu)
    setReplaySfens(sfens)
    setReplayMoves(moves)
    setReplayIndex(0)
    setCurrentSfen(sfens[0])
    setSfenHistory([])
    setSelection(null)
  }

  function handleReplayJump(index: number): void {
    setReplayIndex(index)
    setCurrentSfen(replaySfens[index])
  }

  function handleReplayStep(delta: number): void {
    setReplayIndex(i => {
      const next = Math.max(0, Math.min(i + delta, replaySfens.length - 1))
      setCurrentSfen(replaySfens[next])
      return next
    })
  }

  function handleReplayEnd(): void {
    setReplayKifu(null)
    setReplaySfens([])
    setReplayMoves([])
    setReplayIndex(0)
    setCurrentSfen(INITIAL_SFEN)
    setSfenHistory([])
    setSelection(null)
  }

  async function handleKifuRelocate(oldPath: string): Promise<void> {
    const newPath = await window.api.selectKifuFile()
    if (!newPath) return
    const updated = await window.api.updateKifuPath(oldPath, newPath)
    setKifuList(updated)
    const tags = tagQuery.replace(/^#+/, '').trim().split(/\s+/).filter(Boolean)
    const newStats = await window.api.getPositionStats(currentSfen, tags, tagMode)
    setStats(newStats)
  }

  const rawTagInput = tagQuery.replace(/^#+/, '').trim()
  const parsedTags = rawTagInput === '' ? [] : rawTagInput.split(/\s+/).filter(Boolean)
  const activeSearch = tagQuery.endsWith(' ') ? '' : (parsedTags[parsedTags.length - 1] ?? '')

  const tagFiltered = parsedTags.length === 0 ? kifuList
    : tagMode === 'OR'
      ? kifuList.filter(f => parsedTags.some(tag => f.tags.some(t => t.includes(tag))))
      : kifuList.filter(f => parsedTags.every(tag => f.tags.some(t => t.includes(tag))))

  const fq = filterQuery.trim().toLowerCase()
  const filtered = fq
    ? tagFiltered.filter(f =>
        f.fileName.toLowerCase().includes(fq) ||
        (f.senteName?.toLowerCase().includes(fq) ?? false) ||
        (f.goteName?.toLowerCase().includes(fq) ?? false) ||
        (f.gameDate?.includes(fq) ?? false)
      )
    : tagFiltered

  const allTags = (() => {
    const counts = new Map<string, number>()
    for (const k of kifuList) {
      for (const tag of k.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  })()

  const tagSearchCandidates = allTags.filter(t =>
    activeSearch === '' || t.name.includes(activeSearch)
  )

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
                arrowMoves={stats.slice(0, 3)}
                onSquareClick={handleSquareClick}
                onHandClick={handleHandClick}
              />
              {replayKifu ? (
                // ── 再生コントロールバー ──
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    onClick={() => handleReplayStep(-1)}
                    disabled={replayIndex === 0}
                    style={{ ...btnBase, cursor: replayIndex === 0 ? 'default' : 'pointer', background: replayIndex === 0 ? '#f0f0f0' : '#fff', color: replayIndex === 0 ? '#aaa' : '#333' }}
                  >
                    ◀ 前の手
                  </button>
                  <span style={{ fontSize: '12px', color: '#555', whiteSpace: 'nowrap' }}>
                    {replayKifu.fileName}　{replayIndex}手目 / 全{replaySfens.length - 1}手
                  </span>
                  <button
                    onClick={() => handleReplayStep(1)}
                    disabled={replayIndex === replaySfens.length - 1}
                    style={{ ...btnBase, cursor: replayIndex === replaySfens.length - 1 ? 'default' : 'pointer', background: replayIndex === replaySfens.length - 1 ? '#f0f0f0' : '#fff', color: replayIndex === replaySfens.length - 1 ? '#aaa' : '#333' }}
                  >
                    次の手 ▶
                  </button>
                  <button
                    onClick={handleReplayEnd}
                    style={{ ...btnBase, cursor: 'pointer', background: '#fff', color: '#c33', borderColor: '#e88' }}
                  >
                    × 終了
                  </button>
                </div>
              ) : (
                // ── 通常モードのボタン行 ──
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
                  <button
                    onClick={() => { if (stats.length > 0) handleMoveClick(stats[0].move) }}
                    disabled={stats.length === 0}
                    style={{ ...btnBase, cursor: stats.length === 0 ? 'default' : 'pointer', background: stats.length === 0 ? '#f0f0f0' : '#fff', color: stats.length === 0 ? '#aaa' : '#333' }}
                  >
                    次の手（最多） ▶
                  </button>
                </div>
              )}
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
            {replayKifu ? (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: '#333' }}>手順</h3>
                <MoveListPanel
                  moves={replayMoves}
                  sfens={replaySfens}
                  currentIndex={replayIndex}
                  onJump={handleReplayJump}
                />
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '14px', color: '#333' }}>統計</h3>
                {parsedTags.length > 0 && (
                  <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#2a5bd7' }}>
                    絞り込み中: {parsedTags.map(t => `#${t}`).join(tagMode === 'AND' ? ' かつ ' : ' または ')}
                  </p>
                )}
                {stats.length === 0 ? (
                  <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>データがありません</p>
                ) : (
                  <StatsPanel stats={stats} prefix={sidePrefix(currentSfen)} onMoveClick={handleMoveClick} />
                )}
              </>
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
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={handleImportFolder}
                    disabled={folderImporting}
                    title="フォルダ内の棋譜をまとめて取り込む"
                    style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #ccc', borderRadius: '4px', cursor: folderImporting ? 'default' : 'pointer', background: '#fff', color: folderImporting ? '#aaa' : '#555' }}
                  >
                    {folderImporting ? '取り込み中…' : '+ フォルダから追加'}
                  </button>
                  <button
                    onClick={() => setShowPasteModal(true)}
                    title="KIFテキストを貼り付けて追加"
                    style={{ fontSize: '11px', padding: '3px 8px', border: '1px solid #ccc', borderRadius: '4px', cursor: 'pointer', background: '#fff', color: '#555' }}
                  >
                    + テキストから追加
                  </button>
                </div>
                {importResult && (
                  <div style={{
                    marginTop: '6px', padding: '5px 10px', borderRadius: '4px', fontSize: '11px',
                    background: importResult.failed > 0 ? '#fff3f3' : '#f0fff4',
                    border: `1px solid ${importResult.failed > 0 ? '#f5c6cb' : '#b2dfdb'}`,
                    color: '#333',
                  }}>
                    取り込み完了: 全{importResult.total}件 — 追加 {importResult.imported}件 / スキップ {importResult.skipped}件{importResult.failed > 0 ? ` / エラー ${importResult.failed}件` : ''}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'stretch' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    value={tagQuery}
                    onChange={e => setTagQuery(e.target.value)}
                    onFocus={() => setShowTagSearch(true)}
                    onBlur={() => setShowTagSearch(false)}
                    placeholder="タグで絞り込み…（スペース区切りで複数）"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', outline: 'none' }}
                  />
                  {showTagSearch && tagSearchCandidates.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 2px)',
                      left: 0,
                      right: 0,
                      zIndex: 200,
                      background: '#fff',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}>
                      {tagSearchCandidates.map(t => (
                        <div
                          key={t.name}
                          onMouseDown={e => {
                            e.preventDefault()
                            const base = tagQuery.replace(/^#+/, '')
                            if (base === '' || base.endsWith(' ')) {
                              setTagQuery(base + t.name)
                            } else {
                              const tokens = base.split(/\s+/)
                              tokens[tokens.length - 1] = t.name
                              setTagQuery(tokens.join(' '))
                            }
                            setShowTagSearch(false)
                          }}
                          style={{ padding: '5px 10px', fontSize: '12px', cursor: 'pointer', color: '#333', whiteSpace: 'nowrap' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                          onMouseLeave={e => (e.currentTarget.style.background = '')}
                        >
                          <span style={{ color: '#2a5bd7' }}>#{t.name}</span>
                          <span style={{ marginLeft: '6px', fontSize: '10px', color: '#aaa' }}>{t.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setTagMode(m => m === 'OR' ? 'AND' : 'OR')}
                  title={tagMode === 'OR' ? 'OR：いずれかのタグに一致（クリックで AND に切替）' : 'AND：すべてのタグに一致（クリックで OR に切替）'}
                  style={{
                    padding: '0 10px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    background: tagMode === 'AND' ? '#2a5bd7' : '#fff',
                    color: tagMode === 'AND' ? '#fff' : '#666',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {tagMode}
                </button>
              </div>
              <input
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                placeholder="先手・後手・日付で検索…"
                style={{ width: '100%', boxSizing: 'border-box', marginTop: '4px', padding: '5px 8px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px', outline: 'none' }}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
              {filtered.length === 0 ? (
                <p style={{ fontSize: '13px', color: '#999', margin: '8px' }}>
                  {parsedTags.length > 0 || fq ? '検索条件に一致する棋譜がありません' : '棋譜がありません'}
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {filtered.map(f => (
                    <KifuListItem
                      key={f.path}
                      kifu={f}
                      isReplaying={replayKifu?.path === f.path}
                      allTags={allTags}
                      onTagAdd={name => handleTagAdd(f.path, name)}
                      onTagRemove={name => handleTagRemove(f.path, name)}
                      onDelete={() => handleKifuDelete(f.path)}
                      onReimport={() => handleKifuReimport(f.path)}
                      onRelocate={() => handleKifuRelocate(f.path)}
                      onReplay={() => handleKifuReplay(f)}
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
