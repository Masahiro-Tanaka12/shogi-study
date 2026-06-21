export interface KifuFile {
  fileName: string
  path: string
  tags: string[]
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
