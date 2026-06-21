import type { Move, PositionEntry } from './types'

// SFEN → (指し手表記 → 回数)
export type PositionStats = Record<string, Record<string, number>>

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九']

export function moveLabel(move: Move): string {
  if (move.isSpecial) return move.specialType ?? move.piece
  const rank = RANK_KANJI[move.toRank - 1] ?? String(move.toRank)
  const dest = `${move.toFile}${rank}`
  if (move.isDrop) return `${dest}${move.piece}打`
  return `${dest}${move.piece}${move.isPromotion ? '成' : ''}`
}

export function aggregatePositions(entries: PositionEntry[], stats: PositionStats): void {
  for (const { sfen, nextMove } of entries) {
    if (nextMove === null) continue
    const label = moveLabel(nextMove)
    if (!stats[sfen]) stats[sfen] = {}
    stats[sfen][label] = (stats[sfen][label] ?? 0) + 1
  }
}

export function logPositionStats(stats: PositionStats, sfen: string, label: string): void {
  const moves = stats[sfen]
  if (!moves) {
    console.log(`${label}\n(データなし)`)
    return
  }
  const total = Object.values(moves).reduce((s, n) => s + n, 0)
  const sorted = Object.entries(moves).sort((a, b) => b[1] - a[1])
  const lines = sorted.map(([m, n]) => `  ${m}: ${n} (${((n / total) * 100).toFixed(1)}%)`)
  console.log(`${label}\n総数: ${total}\n\n${lines.join('\n')}`)
}
