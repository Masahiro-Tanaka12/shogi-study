import type { Move, Player } from './types'
import { createInitialBoard, applyMove } from './board'
import { findFromSquares } from './moveGen'

const TO_FILE: Record<string, number> = {
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
}

const TO_RANK: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
}

// KI2 表記駒名 → { ボード上の基本駒名, 既成り状態 }
const KI2_PIECE: Record<string, { base: string; promoted: boolean }> = {
  '歩': { base: '歩', promoted: false },
  '香': { base: '香', promoted: false },
  '桂': { base: '桂', promoted: false },
  '銀': { base: '銀', promoted: false },
  '金': { base: '金', promoted: false },
  '角': { base: '角', promoted: false },
  '飛': { base: '飛', promoted: false },
  '王': { base: '王', promoted: false },
  '玉': { base: '玉', promoted: false },
  'と': { base: '歩', promoted: true },
  '成香': { base: '香', promoted: true },
  '成桂': { base: '桂', promoted: true },
  '成銀': { base: '銀', promoted: true },
  '馬': { base: '角', promoted: true },
  '龍': { base: '飛', promoted: true },
  '竜': { base: '飛', promoted: true },
}

// moveLabel 用の成り駒表示名
const PROMOTED_NAME: Record<string, string> = {
  '歩': 'と', '香': '成香', '桂': '成桂', '銀': '成銀', '角': '馬', '飛': '龍',
}

// グループ: (1)▲△▽  (2)行き先  (3)駒名  (4)成|打
const MOVE_RE = /([▲△▽])(同[　 ]*|[１-９1-9][一二三四五六七八九])(成[香桂銀]|[歩香桂銀金角飛王玉と馬龍竜])(成|打)?/g

export function parseKi2(content: string): Move[] {
  const moves: Move[] = []
  let state = createInitialBoard()
  let moveNumber = 0
  let prevToFile: number | undefined
  let prevToRank: number | undefined

  MOVE_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = MOVE_RE.exec(content)) !== null) {
    const playerMarker = match[1]
    const destStr = match[2]
    const pieceStr = match[3]
    const suffix = match[4] ?? ''

    moveNumber++
    const player: Player = playerMarker === '▲' ? 'sente' : 'gote'

    let toFile: number
    let toRank: number
    if (destStr.startsWith('同')) {
      if (!prevToFile || !prevToRank) continue
      toFile = prevToFile
      toRank = prevToRank
    } else {
      toFile = TO_FILE[destStr[0]]
      toRank = TO_RANK[destStr[1]]
      if (!toFile || !toRank) continue
    }

    const info = KI2_PIECE[pieceStr]
    if (!info) continue

    const isDrop = suffix === '打'
    const isPromotion = suffix === '成'

    let movePiece: string
    if (isDrop || isPromotion) {
      movePiece = info.base
    } else if (info.promoted) {
      movePiece = PROMOTED_NAME[info.base] ?? info.base
    } else {
      movePiece = info.base
    }

    const move: Move = {
      moveNumber, toFile, toRank,
      piece: movePiece, isDrop, isPromotion, isSpecial: false,
    }

    if (!isDrop) {
      const candidates = findFromSquares(state.board, toFile, toRank, info.base, info.promoted, player)
      if (candidates.length === 0) {
        console.warn(`[ki2] ${moveNumber}手目: 移動元が見つかりません (${pieceStr}→${toFile}${toRank})`)
        continue
      }
      // 候補が複数ある場合は最初を採用（打ち込み禁止ルールにより通常一意）
      move.fromFile = candidates[0][0]
      move.fromRank = candidates[0][1]
    }

    moves.push(move)
    prevToFile = toFile
    prevToRank = toRank
    state = applyMove(state, move)
  }

  // 終局手（投了・中断等）
  const tail = content.slice(-300)
  const specMatch = /投了|中断|千日手|持将棋|時間切れ|反則/.exec(tail)
  if (specMatch) {
    const specialType = specMatch[0]
    moves.push({
      moveNumber: moveNumber + 1, toFile: 0, toRank: 0,
      piece: specialType, isDrop: false, isPromotion: false,
      isSpecial: true, specialType,
    })
  }

  return moves
}
