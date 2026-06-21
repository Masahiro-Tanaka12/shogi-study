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

// (fromFile, fromRank) の駒が移動できる行き先一覧を返す（自駒の升は除外済み）
export function findToSquares(
  board: Board,
  fromFile: number, fromRank: number,
  player: Player
): [number, number][] {
  const sq = board[fromRank - 1][fromFile - 1]
  if (!sq || sq.player !== player) return []
  const fwd = player === 'sente' ? -1 : 1
  const results: [number, number][] = []
  for (let r = 1; r <= 9; r++) {
    for (let f = 1; f <= 9; f++) {
      const target = board[r - 1][f - 1]
      if (target?.player === player) continue
      if (canReach(board, fromFile, fromRank, f, r, sq.piece, sq.promoted, fwd)) {
        results.push([f, r])
      }
    }
  }
  return results
}

// 持ち駒 piece を打てる升一覧（二歩・行き場なし禁止込み）
export function findDropSquares(
  board: Board,
  piece: string,
  hand: Record<string, number>,
  player: Player
): [number, number][] {
  if (!hand[piece] || hand[piece] <= 0) return []
  const results: [number, number][] = []
  for (let r = 1; r <= 9; r++) {
    for (let f = 1; f <= 9; f++) {
      if (board[r - 1][f - 1]) continue // 空升のみ
      if (piece === '歩') {
        // 二歩チェック
        const nifu = Array.from({ length: 9 }, (_, i) => board[i][f - 1])
          .some(s => s?.player === player && s.piece === '歩' && !s.promoted)
        if (nifu) continue
        if ((player === 'sente' && r === 1) || (player === 'gote' && r === 9)) continue
      } else if (piece === '香') {
        if ((player === 'sente' && r === 1) || (player === 'gote' && r === 9)) continue
      } else if (piece === '桂') {
        if (player === 'sente' && r <= 2) continue
        if (player === 'gote' && r >= 8) continue
      }
      results.push([f, r])
    }
  }
  return results
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
