-- 001 · 중도 기록 지원 — lines_done 칸 추가
--
-- SQLite 는 ALTER TABLE 로 CHECK 제약을 붙일 수 없다. 그래서 새 테이블을
-- 만들고 기존 행을 옮긴다. 이미 있던 기록은 전부 완주 기록이므로
-- lines_done = line_count 로 채운다.

ALTER TABLE scores RENAME TO scores_old;

CREATE TABLE scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lang       TEXT    NOT NULL,
  text_id    TEXT    NOT NULL,
  nick       TEXT    NOT NULL,
  rate       INTEGER NOT NULL,
  acc        INTEGER NOT NULL,
  strokes    INTEGER NOT NULL,
  ms         INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  lines_done INTEGER NOT NULL,
  ip_hash    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,

  CHECK (lang IN ('ko', 'en')),
  CHECK (length(text_id) BETWEEN 1 AND 32),
  CHECK (length(nick) BETWEEN 1 AND 12),
  CHECK (trim(nick) <> ''),
  CHECK (acc BETWEEN 0 AND 100),
  CHECK (strokes BETWEEN 1 AND 100000),
  CHECK (line_count BETWEEN 1 AND 500),
  CHECK (lines_done BETWEEN 1 AND line_count),
  CHECK (ms >= 1000),
  CHECK (
    (lang = 'ko' AND rate BETWEEN 1 AND 1200) OR
    (lang = 'en' AND rate BETWEEN 1 AND 300)
  ),
  CHECK (ms >= lines_done * 300),
  CHECK (
    (lang = 'ko' AND abs(rate - (strokes * 60000.0 / ms)) <= 2) OR
    (lang = 'en' AND abs(rate - (strokes * 12000.0 / ms)) <= 2)
  )
);

INSERT INTO scores (id, lang, text_id, nick, rate, acc, strokes, ms, line_count, lines_done, ip_hash, created_at)
SELECT id, lang, text_id, nick, rate, acc, strokes, ms, line_count, line_count, ip_hash, created_at
  FROM scores_old;

DROP TABLE scores_old;

CREATE INDEX idx_scores_board ON scores (lang, text_id, rate DESC);
CREATE INDEX idx_scores_rate_limit ON scores (ip_hash, created_at);
