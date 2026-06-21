import Database from 'better-sqlite3'
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
  if (existing) return { id: existing.id, isNew: false }

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

export function getAllKifus(db: Db): KifuFile[] {
  const rows = db
    .prepare('SELECT file_path, file_name FROM kifus ORDER BY created_at DESC')
    .all() as { file_path: string; file_name: string }[]
  return rows.map(r => ({ path: r.file_path, fileName: r.file_name, tags: [] }))
}
