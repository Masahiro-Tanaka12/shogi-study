import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { basename } from 'path'
import type { KifuFile, PositionEntry } from '../shared/types'
import { moveLabel } from '../shared/stats'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS kifus (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path   TEXT NOT NULL UNIQUE,
    file_name   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS positions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kifu_id     INTEGER NOT NULL REFERENCES kifus(id) ON DELETE CASCADE,
    sfen        TEXT NOT NULL,
    move_number INTEGER,
    next_move   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_positions_sfen ON positions(sfen);
  CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS kifu_tags (
    kifu_id INTEGER NOT NULL REFERENCES kifus(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (kifu_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS kifu_moves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kifu_id      INTEGER NOT NULL REFERENCES kifus(id) ON DELETE CASCADE,
    move_number  INTEGER NOT NULL,
    from_file    INTEGER,
    from_rank    INTEGER,
    to_file      INTEGER NOT NULL,
    to_rank      INTEGER NOT NULL,
    piece        TEXT NOT NULL,
    is_drop      INTEGER NOT NULL DEFAULT 0,
    is_promotion INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_kifu_moves_kifu ON kifu_moves(kifu_id);
`

export type Db = Database.Database

export function initDb(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

// 新規棋譜なら INSERT して { id, isNew: true } を返す。
// 既存棋譜なら INSERT せず { id, isNew: false } を返す。
export function insertKifuIfNew(
  db: Db,
  filePath: string,
  fileName: string
): { id: number; isNew: boolean } {
  const existing = db.prepare('SELECT id FROM kifus WHERE file_path = ?').get(filePath) as { id: number } | undefined
  if (existing) {
    const { n } = db.prepare(
      'SELECT COUNT(*) as n FROM positions WHERE kifu_id = ? AND next_move IS NOT NULL'
    ).get(existing.id) as { n: number }
    if (n > 0) return { id: existing.id, isNew: false }
    // 指し手なし = 文字化けによる壊れた取込み → positions/kifu_moves を削除して再取込みを許可（タグは保持）
    db.prepare('DELETE FROM positions WHERE kifu_id = ?').run(existing.id)
    db.prepare('DELETE FROM kifu_moves WHERE kifu_id = ?').run(existing.id)
    console.log(`[db] re-import: ${filePath} (corrupted positions cleared)`)
    return { id: existing.id, isNew: true }
  }

  const result = db.prepare('INSERT INTO kifus (file_path, file_name) VALUES (?, ?)').run(filePath, fileName)
  return { id: result.lastInsertRowid as number, isNew: true }
}

export function insertPositions(db: Db, kifuId: number, entries: PositionEntry[]): void {
  const insert = db.prepare(
    'INSERT INTO positions (kifu_id, sfen, move_number, next_move) VALUES (?, ?, ?, ?)'
  )
  const insertAll = db.transaction((rows: PositionEntry[]) => {
    for (const { sfen, nextMove } of rows) {
      insert.run(
        kifuId,
        sfen,
        nextMove?.moveNumber ?? null,
        nextMove ? moveLabel(nextMove) : null
      )
    }
  })
  insertAll(entries)
}

export function insertKifuMoves(db: Db, kifuId: number, entries: PositionEntry[]): void {
  const insert = db.prepare(`
    INSERT INTO kifu_moves (kifu_id, move_number, from_file, from_rank, to_file, to_rank, piece, is_drop, is_promotion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertAll = db.transaction((rows: PositionEntry[]) => {
    for (const { nextMove } of rows) {
      if (!nextMove || nextMove.isSpecial) continue
      insert.run(
        kifuId,
        nextMove.moveNumber,
        nextMove.fromFile ?? null,
        nextMove.fromRank ?? null,
        nextMove.toFile,
        nextMove.toRank,
        nextMove.piece,
        nextMove.isDrop ? 1 : 0,
        nextMove.isPromotion ? 1 : 0,
      )
    }
  })
  insertAll(entries)
}

export function getAllKifus(db: Db): KifuFile[] {
  const rows = db.prepare(`
    SELECT k.file_path, k.file_name,
           GROUP_CONCAT(t.name) AS tag_names
    FROM kifus k
    LEFT JOIN kifu_tags kt ON kt.kifu_id = k.id
    LEFT JOIN tags t       ON t.id = kt.tag_id
    GROUP BY k.id
    ORDER BY k.created_at DESC
  `).all() as { file_path: string; file_name: string; tag_names: string | null }[]

  return rows.map(r => ({
    path: r.file_path,
    fileName: r.file_name,
    tags: r.tag_names ? r.tag_names.split(',') : [],
    exists: existsSync(r.file_path),
  }))
}

export function addTag(db: Db, kifuPath: string, tagName: string): void {
  const kifu = db.prepare('SELECT id FROM kifus WHERE file_path = ?').get(kifuPath) as { id: number } | undefined
  if (!kifu) return

  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName)
  const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number }
  db.prepare('INSERT OR IGNORE INTO kifu_tags (kifu_id, tag_id) VALUES (?, ?)').run(kifu.id, tag.id)
}

export function deleteKifu(db: Db, kifuPath: string): void {
  db.prepare('DELETE FROM kifus WHERE file_path = ?').run(kifuPath)
}

export function updateKifuPath(db: Db, oldPath: string, newPath: string): void {
  db.prepare('UPDATE kifus SET file_path=?, file_name=? WHERE file_path=?')
    .run(newPath, basename(newPath), oldPath)
}

export function clearKifuPositions(db: Db, kifuPath: string): { positions: number; moves: number } {
  const kifu = db.prepare('SELECT id FROM kifus WHERE file_path = ?').get(kifuPath) as { id: number } | undefined
  if (!kifu) return { positions: 0, moves: 0 }
  const positions = db.prepare('DELETE FROM positions WHERE kifu_id = ?').run(kifu.id).changes
  const moves = db.prepare('DELETE FROM kifu_moves WHERE kifu_id = ?').run(kifu.id).changes
  return { positions, moves }
}

export function removeTag(db: Db, kifuPath: string, tagName: string): void {
  const kifu = db.prepare('SELECT id FROM kifus WHERE file_path = ?').get(kifuPath) as { id: number } | undefined
  if (!kifu) return

  const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined
  if (!tag) return

  db.prepare('DELETE FROM kifu_tags WHERE kifu_id = ? AND tag_id = ?').run(kifu.id, tag.id)
}

export interface MoveCount {
  move: string
  count: number
  fromFile: number | null
  fromRank: number | null
  toFile: number | null
  toRank: number | null
  isDrop: number | null
}

export function getNextSfen(db: Db, sfen: string, move: string): string | null {
  const row = db.prepare(`
    SELECT p2.sfen
    FROM positions p1
    JOIN positions p2 ON p2.kifu_id = p1.kifu_id AND p2.move_number = p1.move_number + 1
    WHERE p1.sfen = ? AND p1.next_move = ?
    LIMIT 1
  `).get(sfen, move) as { sfen: string } | undefined
  return row?.sfen ?? null
}

export function getPositionStats(db: Db, sfen: string, tagQuery?: string): MoveCount[] {
  if (tagQuery) {
    return db.prepare(`
      SELECT p.next_move AS move, COUNT(*) AS count,
             km.from_file AS fromFile, km.from_rank AS fromRank,
             km.to_file   AS toFile,   km.to_rank   AS toRank,
             km.is_drop   AS isDrop
      FROM positions p
      LEFT JOIN kifu_moves km ON km.kifu_id = p.kifu_id AND km.move_number = p.move_number
      JOIN kifu_tags kt ON kt.kifu_id = p.kifu_id
      JOIN tags t       ON t.id = kt.tag_id
      WHERE p.sfen = ? AND p.next_move IS NOT NULL AND t.name LIKE ?
      GROUP BY p.next_move
      ORDER BY count DESC
    `).all(sfen, `%${tagQuery}%`) as MoveCount[]
  }

  return db.prepare(`
    SELECT p.next_move AS move, COUNT(*) AS count,
           km.from_file AS fromFile, km.from_rank AS fromRank,
           km.to_file   AS toFile,   km.to_rank   AS toRank,
           km.is_drop   AS isDrop
    FROM positions p
    LEFT JOIN kifu_moves km ON km.kifu_id = p.kifu_id AND km.move_number = p.move_number
    WHERE p.sfen = ? AND p.next_move IS NOT NULL
    GROUP BY p.next_move
    ORDER BY count DESC
  `).all(sfen) as MoveCount[]
}
