# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

将棋の棋譜を分析するデスクトップアプリ。目的は定跡データベースを作ること、自分で集めた棋譜を研究しやすくすること。

**このアプリの主役は棋譜ではなく局面。**
棋譜は統計生成のための材料。最終目的は「この局面で何が指されているか」を調査すること。

## Tech Stack

- Electron + React + TypeScript
- SQLite（better-sqlite3）
- iconv-lite（Shift_JIS 対応）

## Commands

```bash
# 開発起動（VS Code から起動する場合は必ず環境変数を外す）
unset ELECTRON_RUN_AS_NODE && npm run dev

# 型チェック
npx tsc --noEmit
```

## Architecture

```
src/
  main/
    index.ts   # Electronメインプロセス。IPC ハンドラ、起動処理
    db.ts      # SQLite 操作（better-sqlite3）
  preload/
    index.ts   # contextBridge で window.api を公開
  renderer/src/
    App.tsx    # React UI 全体（単一ファイル）
  shared/
    types.ts   # 共通型定義（KifuFile, Move, BoardState, PositionEntry）
    kifu.ts    # KIF パーサー
    ki2.ts     # KI2 パーサー
    csa.ts     # CSA パーサー
    board.ts   # 盤面状態・SFEN 変換・手の適用
    moveGen.ts # 合法手生成（移動先ハイライト用）
    stats.ts   # 局面統計の集計ロジック
```

### DB スキーマ（主要テーブル）

```sql
kifus      (id, file_path UNIQUE, file_name, created_at)
positions  (id, kifu_id, sfen, move_number, next_move)
kifu_moves (id, kifu_id, move_number, from_file, from_rank, to_file, to_rank, piece, is_drop, is_promotion)
tags       (id, name UNIQUE)
kifu_tags  (kifu_id, tag_id)
```

`positions.next_move` は moveLabel() で生成した文字列（例: `７六歩`）。
`getPositionStats` は `sfen` で検索し、タグ絞り込みがあれば JOIN して集計する。

### IPC チャンネル一覧

| チャンネル | 処理 |
|---|---|
| `select-kifu-file` | ファイルダイアログを開き、パスを返す |
| `get-kifu-list` | 全棋譜を返す（`exists: boolean` 付き） |
| `add-tag` / `remove-tag` | タグ操作 |
| `save-pasted-kif` | テキストを .kif として保存 → 取り込み |
| `delete-kifu` | 棋譜を DB から削除 |
| `update-kifu-path` | パス変更 → 再取り込み（ファイル再指定） |
| `reimport-kifu` | 既存棋譜の positions を再構築 |
| `apply-move-string` | 手文字列 → 次の SFEN（DB lookup） |
| `get-position-stats` | SFEN + タグで次の手一覧を集計 |

## 実装済み機能

### 棋譜管理
- KIF / KI2 / CSA ファイルの読み込み（複数選択対応）
- KIFテキストのペースト取り込み（ファイル名自動推測）
- 棋譜の削除・再読み込み
- ファイル再指定（`exists=false` の棋譜を正しいパスに再マッピング）
- 起動時の自動再取り込み（positions が空の棋譜を自動修復）
- Shift_JIS 自動判定（`iconv-lite` 導入済み）

### タグ管理
- タグの付与・削除（インライン入力 + サジェスト）
- タグによる棋譜リスト絞り込み（部分一致）

### 局面・統計
- インタラクティブ将棋盤（駒クリックで移動先ハイライト、持ち駒打ち対応）
- 成り確認ダイアログ・強制成り
- 局面統計（手ごとの件数・割合・バーグラフ）
- タグで統計を絞り込み
- 盤上に統計矢印オーバーレイ（上位3手）
- 統計パネルの手クリックで局面を進める（DB lookup）
- 手動で駒を動かして局面を進める（リアルタイム SFEN 計算）
- 1手戻る / 初期局面リセット

## 今後の予定機能

1. **棋譜を1局選択して手順を再生**完了。（←→ キーで手順を進める）
2. **フォルダごと一括取り込み**完了。
3. **棋譜の検索・フィルタ**（先手名・後手名・日付）完了。
4. **複数タグの AND/OR 絞り込み**完了。
5. **局面から棋譜リストへのリンク**（この局面が含まれる棋譜一覧）完了。
6. **一括タグ付け**（複数棋譜に同じタグ）完了。

## Development Notes

### VS Code + Claude Code の注意

`ELECTRON_RUN_AS_NODE=1` が環境変数に残っていると Electron が起動しない。
起動前に `unset ELECTRON_RUN_AS_NODE` を実行すること。

### reimport-kifu の設計

Phase 1（パース）と Phase 2（DB 書き込み）を分離。
`validCount === 0` のときは DB を一切変更しない。
これによりパース失敗時のデータ破壊を防いでいる。

### KifuFile.exists

`getAllKifus` が `existsSync` で毎回チェックして返す。
`exists=false` の棋譜は UI で赤字表示 + 「再指定」ボタンを表示。

### 実装しないもの

AI解析・クラウド同期・アカウント機能・定跡ツリー・グラフ描画・スマホ対応。
必要になってから検討する。
