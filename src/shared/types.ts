export interface KifuMeta {
  senteName?: string
  goteName?: string
  gameDate?: string  // YYYY-MM-DD
}

export interface KifuFile {
  fileName: string
  path: string
  tags: string[]
  exists: boolean
  senteName?: string
  goteName?: string
  gameDate?: string
}

export interface Move {
  moveNumber: number
  toFile: number     // 1–9（筋）
  toRank: number     // 1–9（段）
  fromFile?: number  // 打ちの場合は undefined
  fromRank?: number
  piece: string      // KIF駒名（歩, 飛, 成銀, …）
  isDrop: boolean
  isPromotion: boolean
  isSpecial: boolean // 投了・中断・詰み 等
  specialType?: string
}

export type Player = 'sente' | 'gote'

export interface Square {
  piece: string    // 基本駒名: 歩, 香, 桂, 銀, 金, 角, 飛, 王, 玉
  promoted: boolean
  player: Player
}

export interface BoardState {
  // board[rank-1][file-1] — board[0][0] = 1一, board[0][8] = 9一
  board: (Square | null)[][]
  senteHand: Record<string, number>
  goteHand: Record<string, number>
  sideToMove: Player
  moveCount: number
}

export interface PositionEntry {
  sfen: string
  nextMove: Move | null  // null = 最終局面（次の手なし）
}

export interface PositionKifu extends KifuFile {
  moveNumber: number | null  // この局面が最初に登場する手数
}
