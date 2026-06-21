// 盤面状態の生成と手の適用
// 現在は平手初期局面のみ対応。駒落ち局面は未実装。

import type { Move, Player, Square, BoardState } from './types'

// 成り駒の表示名（単一全角文字に統一）
const PROMOTED_DISPLAY: Record<string, string> = {
  '歩': 'と', '香': '杏', '桂': '圭', '銀': '全', '角': '馬', '飛': '龍',
}

function cellStr(sq: Square | null): string {
  if (!sq) return '   '
  const name = sq.promoted ? (PROMOTED_DISPLAY[sq.piece] ?? sq.piece) : sq.piece
  return sq.player === 'sente' ? ` ${name}` : `v${name}`
}

function handStr(hand: Record<string, number>): string {
  const entries = Object.entries(hand)
  if (entries.length === 0) return 'なし'
  return entries.map(([p, n]) => (n === 1 ? p : `${p}${n}`)).join(' ')
}

const PIECE_TO_SFEN: Record<string, string> = {
  '歩': 'P', '香': 'L', '桂': 'N', '銀': 'S', '金': 'G',
  '角': 'B', '飛': 'R', '王': 'K', '玉': 'K',
}

const HAND_ORDER = ['飛', '角', '金', '銀', '桂', '香', '歩']

export function boardToSfen(state: BoardState): string {
  // 盤面: ランク1→9、各ランク内はファイル9→1
  const ranks: string[] = []
  for (let r = 0; r < 9; r++) {
    let rank = ''
    let empty = 0
    for (let f = 8; f >= 0; f--) {
      const sq = state.board[r][f]
      if (!sq) {
        empty++
      } else {
        if (empty > 0) { rank += empty; empty = 0 }
        const letter = PIECE_TO_SFEN[sq.piece] ?? '?'
        const sfenPiece = sq.promoted ? `+${letter}` : letter
        rank += sq.player === 'sente' ? sfenPiece : sfenPiece.toLowerCase()
      }
    }
    if (empty > 0) rank += empty
    ranks.push(rank)
  }

  // 手番
  const side = state.sideToMove === 'sente' ? 'b' : 'w'

  // 持ち駒: 飛角金銀桂香歩順、先手→後手
  let hands = ''
  for (const p of HAND_ORDER) {
    const n = state.senteHand[p] ?? 0
    if (n > 0) hands += (n > 1 ? String(n) : '') + PIECE_TO_SFEN[p]
  }
  for (const p of HAND_ORDER) {
    const n = state.goteHand[p] ?? 0
    if (n > 0) hands += (n > 1 ? String(n) : '') + (PIECE_TO_SFEN[p]?.toLowerCase() ?? '?')
  }
  if (!hands) hands = '-'

  // 手数（次に指す手番号 = moveCount + 1）
  return `${ranks.join('/')} ${side} ${hands} ${state.moveCount + 1}`
}

export function debugBoard(state: BoardState): void {
  const RANK_LABEL = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
  const SEP = ' +---------------------------+'

  const lines: string[] = ['']
  lines.push(`後手持ち駒: ${handStr(state.goteHand)}`)
  lines.push('  ９ ８ ７ ６ ５ ４ ３ ２ １')
  lines.push(SEP)

  for (let r = 0; r < 9; r++) {
    // files 9→1 は index 8→0
    const row = '|' + Array.from({ length: 9 }, (_, i) => cellStr(state.board[r][8 - i])).join('|') + `|${RANK_LABEL[r]}`
    lines.push(row)
  }

  lines.push(SEP)
  lines.push(`先手持ち駒: ${handStr(state.senteHand)}`)
  lines.push(`手番: ${state.sideToMove === 'sente' ? '先手' : '後手'}  (${state.moveCount} 手目終了)`)
  lines.push('')

  console.log(lines.join('\n'))
}

// KIF の成り駒名 → 基本駒名（持ち駒にするとき / 盤面管理用）
const BASE_PIECE: Record<string, string> = {
  '歩': '歩', '香': '香', '桂': '桂', '銀': '銀', '金': '金',
  '角': '角', '飛': '飛', '王': '王', '玉': '玉',
  'と': '歩', '成香': '香', '成桂': '桂', '成銀': '銀',
  '馬': '角', '龍': '飛', '竜': '飛',
}

function sq(piece: string, player: Player): Square {
  return { piece, promoted: false, player }
}

// 平手初期局面を返す
export function createInitialBoard(): BoardState {
  const _ = null
  // board[rank-1][file-1]: file 1 = index 0, file 9 = index 8
  const board: (Square | null)[][] = [
    // rank 1（後手の大駒段）: file 1→9
    [sq('香','gote'), sq('桂','gote'), sq('銀','gote'), sq('金','gote'), sq('玉','gote'), sq('金','gote'), sq('銀','gote'), sq('桂','gote'), sq('香','gote')],
    // rank 2: 後手角=2二(index 1)、後手飛=8二(index 7)
    [_, sq('角','gote'), _, _, _, _, _, sq('飛','gote'), _],
    // rank 3（後手の歩段）
    [sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote'), sq('歩','gote')],
    // rank 4–6（空）
    [_, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _],
    [_, _, _, _, _, _, _, _, _],
    // rank 7（先手の歩段）
    [sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente'), sq('歩','sente')],
    // rank 8: 先手飛=2八(index 1)、先手角=8八(index 7)
    [_, sq('飛','sente'), _, _, _, _, _, sq('角','sente'), _],
    // rank 9（先手の大駒段）: file 1→9
    [sq('香','sente'), sq('桂','sente'), sq('銀','sente'), sq('金','sente'), sq('王','sente'), sq('金','sente'), sq('銀','sente'), sq('桂','sente'), sq('香','sente')],
  ]

  return {
    board,
    senteHand: {},
    goteHand: {},
    sideToMove: 'sente',
    moveCount: 0,
  }
}

export function applyMove(state: BoardState, move: Move): BoardState {
  // 投了・中断などの特殊手は盤面を変えない
  if (move.isSpecial) {
    return { ...state, moveCount: move.moveNumber }
  }

  const player: Player = move.moveNumber % 2 === 1 ? 'sente' : 'gote'
  const next: Player = player === 'sente' ? 'gote' : 'sente'

  const board = state.board.map(row => [...row])
  const senteHand = { ...state.senteHand }
  const goteHand  = { ...state.goteHand }

  const toR = move.toRank - 1
  const toF = move.toFile - 1

  if (move.isDrop) {
    const hand = player === 'sente' ? senteHand : goteHand
    hand[move.piece] = (hand[move.piece] ?? 0) - 1
    if (hand[move.piece] === 0) delete hand[move.piece]
    board[toR][toF] = { piece: move.piece, promoted: false, player }
  } else {
    const fromR = move.fromRank! - 1
    const fromF = move.fromFile! - 1

    // 駒を取る
    const captured = board[toR][toF]
    if (captured) {
      const base = BASE_PIECE[captured.piece] ?? captured.piece
      const capHand = player === 'sente' ? senteHand : goteHand
      capHand[base] = (capHand[base] ?? 0) + 1
    }

    const moving = board[fromR][fromF]
    if (!moving) {
      // 盤面不整合（バグ検出用）
      console.error(`[board] move ${move.moveNumber}: no piece at (${move.fromFile},${move.fromRank})`)
      return state
    }

    board[fromR][fromF] = null
    board[toR][toF] = {
      piece: moving.piece,
      promoted: moving.promoted || move.isPromotion,
      player,
    }
  }

  return { board, senteHand, goteHand, sideToMove: next, moveCount: move.moveNumber }
}

// moves 全体（または upToMove 手目まで）を初期局面から適用して BoardState を返す
export function buildBoardState(moves: Move[], upToMove?: number): BoardState {
  let state = createInitialBoard()
  for (const move of moves) {
    if (upToMove !== undefined && move.moveNumber > upToMove) break
    if (move.isSpecial) {
      state = applyMove(state, move)
      break
    }
    state = applyMove(state, move)
  }
  return state
}
