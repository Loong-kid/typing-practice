-- 타자연습 기록판 · D1 (SQLite) 스키마
--
-- 조작 방지는 L1 「상식 필터」 수준이다. 애플리케이션 코드가 아니라
-- 테이블 제약으로 막는다 — Worker에 버그가 생겨도 DB가 마지막 문을 잠근다.

DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lang       TEXT    NOT NULL,   -- 'ko' | 'en'
  text_id    TEXT    NOT NULL,   -- anthem, seosi, azalea, grape, constitution, gettysburg
  nick       TEXT    NOT NULL,
  rate       INTEGER NOT NULL,   -- 한국어=타/분, 영어=WPM
  acc        INTEGER NOT NULL,   -- 정확도 %
  strokes    INTEGER NOT NULL,   -- 정타 수
  ms         INTEGER NOT NULL,   -- 완주에 걸린 밀리초
  line_count INTEGER NOT NULL,   -- 지문 줄 수
  ip_hash    TEXT    NOT NULL,   -- 원본 IP는 저장하지 않는다. 도배 제한 용도로만 씀
  created_at INTEGER NOT NULL,   -- epoch ms

  -- ── 값의 범위 ────────────────────────────────────────────────
  CHECK (lang IN ('ko', 'en')),
  CHECK (length(text_id) BETWEEN 1 AND 32),
  CHECK (length(nick) BETWEEN 1 AND 12),
  CHECK (trim(nick) <> ''),
  CHECK (acc BETWEEN 0 AND 100),
  CHECK (strokes BETWEEN 1 AND 100000),
  CHECK (line_count BETWEEN 1 AND 500),
  CHECK (ms >= 1000),

  -- ── 사람이 낼 수 있는 속도의 천장 ────────────────────────────
  -- 한글 공인 기록이 900타 언저리, 영문 세계기록이 220 WPM 언저리다.
  -- 넉넉히 잡되 99999 같은 장난은 여기서 걸린다.
  CHECK (
    (lang = 'ko' AND rate BETWEEN 1 AND 1200) OR
    (lang = 'en' AND rate BETWEEN 1 AND 300)
  ),

  -- ── 줄당 최소 시간 ───────────────────────────────────────────
  -- 한 줄을 0.3초 미만으로 칠 수는 없다.
  CHECK (ms >= line_count * 300),

  -- ── 세 값이 서로 맞아야 한다 (핵심 제약) ─────────────────────
  -- rate 하나만 크게 불러도 소용없다. strokes·ms와 계산이 맞지 않으면 거부된다.
  --   한국어: rate = strokes ÷ (ms/60000)
  --   영어  : rate = (strokes/5) ÷ (ms/60000)
  -- 반올림 오차를 감안해 ±2 만 허용.
  CHECK (
    (lang = 'ko' AND abs(rate - (strokes * 60000.0 / ms)) <= 2) OR
    (lang = 'en' AND abs(rate - (strokes * 12000.0 / ms)) <= 2)
  )
);

-- 지문별 순위 조회용
CREATE INDEX idx_scores_board ON scores (lang, text_id, rate DESC);
-- 도배 제한 조회용
CREATE INDEX idx_scores_rate_limit ON scores (ip_hash, created_at);
