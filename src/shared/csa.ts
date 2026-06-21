import type { Move, Player } from './types'
import { createInitialBoard, applyMove } from './board'

// CSA 駒名 → 基本駒名（日本語）
const CSA_BASE: Record<string, string> = {
  'FU': '歩', 'KY': '香', 'KE': '桂', 'GI': '銀', 'KI': '金',
  'KA': '角', 'HI': '飛', 'OU': '玉',
  // 成り駒（移動後の形）→ 基本駒名
  'TO': '歩', 'NY': '香', 'NK': '桂', 'NG': '銀', 'UM': '角', 'RY': '飛',
}

const CSA_PROMOTED_RESULT = new Set(['TO', 'NY', 'NK', 'NG', 'UM', 'RY'])

const PROMOTED_NAME: Record<string, string> = {
  '歩': 'と', '香': '成香', '桂': '成桂', '銀': '成銀', '角': '馬', '飛': '龍',
}

const CSA_SPECIAL: Record<string, string> = {
  'TORYO': '投了', 'CHUDAN': '中断', 'SENNICHITE': '千日手',
  'TIME_UP': '時間切れ', 'ILLEGAL_MOVE': '反則負け', 'JISHOGI': '持将棋',
  'KACHI': '入玉勝ち', 'RESIGN': '投了',
}

// 標準CSA形式: +FFTTPP / -FFTTPP (FF=from, TT=to, PP=piece)
const MOVE_RE = /^([+\-])(\d)(\d)(\d)(\d)([A-Z]{2})$/

export function parseCsa(content: string): Move[] {
  const moves: Move[] = []
  let state = createInitialBoard()
  let moveNumber = 0

  for (const line of content.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("'") || t.startsWith('V') || t.startsWith('N') ||
        t.startsWith('$') || t.startsWith('P') || t === '+' || t === '-') continue

    // 特殊終局
    if (t.startsWith('%')) {
      const key = t.slice(1).split(/[,\s]/)[0]
      const specialType = CSA_SPECIAL[key] ?? key
      moveNumber++
      moves.push({
        moveNumber, toFile: 0, toRank: 0,
        piece: specialType, isDrop: false, isPromotion: false,
        isSpecial: true, specialType,
      })
      break
    }

    const m = MOVE_RE.exec(t)
    if (!m) continue

    const player: Player = m[1] === '+' ? 'sente' : 'gote'
    const fromFile = parseInt(m[2], 10)
    const fromRank = parseInt(m[3], 10)
    const toFile = parseInt(m[4], 10)
    const toRank = parseInt(m[5], 10)
    const csaPiece = m[6]

    const basePiece = CSA_BASE[csaPiece]
    if (!basePiece) continue

    moveNumber++
    const isDrop = fromFile === 0 && fromRank === 0
    const isPromotedResult = CSA_PROMOTED_RESULT.has(csaPiece)

    let isPromotion = false
    let movePiece = basePiece

    if (!isDrop) {
      const srcSq = state.board[fromRank - 1][fromFile - 1]
      if (isPromotedResult) {
        if (srcSq && !srcSq.promoted) {
          // この手で成る
          isPromotion = true
          movePiece = srcSq.piece
        } else {
          // 既に成り駒が移動
          movePiece = PROMOTED_NAME[basePiece] ?? basePiece
        }
      } else {
        movePiece = srcSq ? srcSq.piece : basePiece
      }
    }

    const move: Move = {
      moveNumber, toFile, toRank,
      fromFile: isDrop ? undefined : fromFile,
      fromRank: isDrop ? undefined : fromRank,
      piece: movePiece, isDrop, isPromotion, isSpecial: false,
    }

    moves.push(move)
    state = applyMove(state, move)
  }

  return moves
}
