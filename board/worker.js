/**
 * 타자연습 기록판 API · Cloudflare Worker
 *
 *   GET  /board?lang=ko&text=anthem&limit=20   지문별 순위
 *   POST /score                                 기록 등록
 *
 * D1 바인딩 이름: DB
 */

const ALLOWED_ORIGINS = [
  'https://loong-kid.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

// 지문마다 줄 수가 정해져 있다. 클라이언트가 보낸 값을 그대로 믿지 않는다.
const TEXTS = {
  ko: { anthem: 16, seosi: 9, azalea: 12, grape: 12, constitution: 23 },
  en: { gettysburg: 32 }
};

const RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 }; // IP당 1시간 20건

function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) }
  });
}

// 원본 IP는 저장하지 않는다. 도배 제한에만 쓰는 단방향 해시.
async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(ip + '|' + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 닉네임 정리 — 제어문자 제거, 공백 압축, 길이 제한. */
function cleanNick(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
  return s.length ? s : null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // ── 순위 조회 ───────────────────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/board') {
      const lang = url.searchParams.get('lang') || '';
      const textId = url.searchParams.get('text') || '';
      if (!TEXTS[lang] || !TEXTS[lang][textId]) {
        return json({ error: '알 수 없는 지문입니다.' }, 400, origin);
      }
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 1), 50);

      // 닉네임 하나당 최고 기록 한 줄만 보여준다.
      const { results } = await env.DB.prepare(
        `SELECT nick, MAX(rate) AS rate, acc, ms, created_at
           FROM scores
          WHERE lang = ?1 AND text_id = ?2
          GROUP BY nick
          ORDER BY rate DESC, ms ASC
          LIMIT ?3`
      ).bind(lang, textId, limit).all();

      return json({ lang, text: textId, rows: results || [] }, 200, origin);
    }

    // ── 기록 등록 ───────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/score') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: '본문을 읽을 수 없습니다.' }, 400, origin);
      }

      const { lang, text: textId, rate, acc, strokes, ms } = body;

      if (!TEXTS[lang] || !TEXTS[lang][textId]) {
        return json({ error: '알 수 없는 지문입니다.' }, 400, origin);
      }
      const nick = cleanNick(body.nick);
      if (!nick) return json({ error: '닉네임을 입력해 주세요.' }, 400, origin);

      const nums = { rate, acc, strokes, ms };
      for (const [k, v] of Object.entries(nums)) {
        if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
          return json({ error: k + ' 값이 올바르지 않습니다.' }, 400, origin);
        }
      }

      // 줄 수는 서버가 안다. 클라이언트 값을 쓰지 않는다.
      const lineCount = TEXTS[lang][textId];

      // 도배 제한
      const ipHash = await hashIp(
        request.headers.get('CF-Connecting-IP') || '0.0.0.0',
        env.IP_SALT || 'typing-practice'
      );
      const since = Date.now() - RATE_LIMIT.windowMs;
      const recent = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ?1 AND created_at > ?2'
      ).bind(ipHash, since).first();
      if (recent && recent.n >= RATE_LIMIT.max) {
        return json({ error: '잠시 후에 다시 시도해 주세요.' }, 429, origin);
      }

      // 나머지 검증은 전부 D1의 CHECK 제약이 한다.
      // 여기서 통과시켜도 값이 서로 맞지 않으면 INSERT가 실패한다.
      try {
        await env.DB.prepare(
          `INSERT INTO scores (lang, text_id, nick, rate, acc, strokes, ms, line_count, ip_hash, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
        ).bind(lang, textId, nick, rate, acc, strokes, ms, lineCount, ipHash, Date.now()).run();
      } catch (e) {
        // CHECK 위반은 여기로 온다.
        return json({ error: '기록이 검증을 통과하지 못했습니다.' }, 422, origin);
      }

      // 등록 직후의 순위를 돌려줘서 클라이언트가 한 번 더 조회하지 않게 한다.
      const rank = await env.DB.prepare(
        `SELECT COUNT(*) + 1 AS rank FROM (
           SELECT nick, MAX(rate) AS rate FROM scores
            WHERE lang = ?1 AND text_id = ?2 GROUP BY nick
         ) WHERE rate > ?3`
      ).bind(lang, textId, rate).first();

      return json({ ok: true, nick, rank: rank ? rank.rank : null }, 201, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  }
};
