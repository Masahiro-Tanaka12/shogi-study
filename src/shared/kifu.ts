// KIF形式パーサー（UTF-8のみ対応）
// Shift-JIS で保存された KIF ファイルは文字化けする。
// 対応が必要になったら iconv-lite を導入すること（CLAUDE.md 参照）。

import type { Move } from './types'

const TO_FILE: Record<string, number> = {
  '１': 1, '２': 2, '３': 3, '４': 4, '５': 5,
  '６': 6, '７': 7, '８': 8, '９': 9
}

const TO_RANK: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9
}

const SPECIAL_MOVES = new Set([
  '投了', '中断', '詰み', '千日手', '時間切れ', '入玉勝ち', '反則勝ち', '反則負け'
])

export function parseKif(content: string): Move[] {
  const lines = content.split(/\r?\n/)
  const moves: Move[] = []
  let inMoves = false
  let prevToFile: number | undefined
  let prevToRank: number | undefined

  for (const line of lines) {
    if (line.startsWith('#')) continue

    const trimmed = line.trim()

    if (trimmed.startsWith('手数')) {
      inMoves = true
      continue
    }

    // 本譜のみ対象。変化手順は無視する。
    if (trimmed.startsWith('変化')) break

    if (!inMoves || !trimmed) continue

    // 「同」は全角スペースを挟む場合があるため専用パターンで取得する
    const m = /^\s*(\d+)\s+(同\s*\S+|\S+)/.exec(line)
    if (!m) continue

    const moveNumber = parseInt(m[1], 10)
    const notation = m[2]

    if (SPECIAL_MOVES.has(notation)) {
      moves.push({
        moveNumber,
        toFile: 0, toRank: 0,
        piece: notation,
        isDrop: false, isPromotion: false,
        isSpecial: true, specialType: notation
      })
      continue
    }

    let toFile: number
    let toRank: number
    let rest: string

    if (notation[0] === '同') {
      // 前の手と同じ升への指し手
      if (!prevToFile || !prevToRank) continue
      toFile = prevToFile
      toRank = prevToRank
      // 「同」と後続の空白（全角スペース含む）を除去して駒部分だけ取り出す
      rest = notation.replace(/^同[　\s]*/, '')
    } else {
      toFile = TO_FILE[notation[0]]
      toRank = TO_RANK[notation[1]]
      if (!toFile || !toRank) continue
      rest = notation.slice(2)
    }

    prevToFile = toFile
    prevToRank = toRank

    if (rest.endsWith('打')) {
      moves.push({
        moveNumber, toFile, toRank,
        piece: rest.slice(0, -1),
        isDrop: true, isPromotion: false, isSpecial: false
      })
      continue
    }

    const originMatch = /\((\d)(\d)\)$/.exec(rest)
    if (!originMatch) continue

    const beforeOrigin = rest.slice(0, rest.lastIndexOf('('))
    const isPromotion = beforeOrigin.endsWith('成')
    const piece = isPromotion ? beforeOrigin.slice(0, -1) : beforeOrigin

    moves.push({
      moveNumber, toFile, toRank,
      fromFile: parseInt(originMatch[1], 10),
      fromRank: parseInt(originMatch[2], 10),
      piece, isDrop: false, isPromotion, isSpecial: false
    })
  }

  return moves
}
