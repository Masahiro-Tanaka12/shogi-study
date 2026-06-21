import type { Square, Player } from './types'

type Board = (Square | null)[][]

function isBlocked(board: Board, fromF: number, fromR: number, toF: number, toR: number): boolean {
  const df = Math.sign(toF - fromF)
  const dr = Math.sign(toR - fromR)
  let f = fromF + df, r = fromR + dr
  while (f !== toF || r !== toR) {
    if (board[r - 1][f - 1]) return true
    f += df; r += dr
  }
  return false
}

function goldOk(df: number, dr: number, fwd: number): boolean {
  return (df === 0 && (dr === fwd || dr === -fwd)) ||
    (Math.abs(df) === 1 && (dr === fwd || dr === 0))
}

function canReach(
  board: Board,
  fromF: number, fromR: number,
  toF: number, toR: number,
  piece: string, promoted: boolean, fwd: number
): boolean {
  const df = toF - fromF, dr = toR - fromR
  if (df === 0 && dr === 0) return false

  if (promoted) {
    switch (piece) {
      case '歩': case '香': case '桂': case '銀':
        return goldOk(df, dr, fwd)
      case '角':
        return (Math.abs(df) <= 1 && Math.abs(dr) <= 1) ||
          (Math.abs(df) === Math.abs(dr) && df !== 0 && !isBlocked(board, fromF, fromR, toF, toR))
      case '飛':
        return (Math.abs(df) === 1 && Math.abs(dr) === 1) ||
          ((df === 0 || dr === 0) && !isBlocked(board, fromF, fromR, toF, toR))
      default: return false
    }
  }

  switch (piece) {
    case '歩': return df === 0 && dr === fwd
    case '香': return df === 0 && Math.sign(dr) === fwd && !isBlocked(board, fromF, fromR, toF, toR)
    case '桂': return Math.abs(df) === 1 && dr === fwd * 2
    case '銀': return (Math.abs(df) === 1 && Math.abs(dr) === 1) || (df === 0 && dr === fwd)
    case '金': return goldOk(df, dr, fwd)
    case '角': return Math.abs(df) === Math.abs(dr) && df !== 0 && !isBlocked(board, fromF, fromR, toF, toR)
    case '飛': return (df === 0 || dr === 0) && !isBlocked(board, fromF, fromR, toF, toR)
    case '王': case '玉': return Math.abs(df) <= 1 && Math.abs(dr) <= 1
    default: return false
  }
}

// board 上で player の basePiece（promoted状態込み）が (toFile, toRank) に到達できる升一覧を返す
export function findFromSquares(
  board: Board,
  toFile: number, toRank: number,
  basePiece: string, promoted: boolean,
  player: Player
): [number, number][] {
  const fwd = player === 'sente' ? -1 : 1
  const results: [number, number][] = []
  for (let r = 1; r <= 9; r++) {
    for (let f = 1; f <= 9; f++) {
      const sq = board[r - 1][f - 1]
      if (!sq || sq.player !== player || sq.piece !== basePiece || sq.promoted !== promoted) continue
      if (canReach(board, f, r, toFile, toRank, basePiece, promoted, fwd)) {
        results.push([f, r])
      }
    }
  }
  return results
}
