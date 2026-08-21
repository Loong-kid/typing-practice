# 기록판 API

타자연습 기록판의 백엔드. **Cloudflare Worker + D1(SQLite)** 하나로 끝난다.
서버를 띄워두는 게 아니라 요청이 올 때만 실행되고, 무료 한도 안에서 돌아간다.

| | 무료 한도 | 이 사이트 예상 |
|---|---|---|
| Worker | 하루 10만 요청 | 한참 못 미침 |
| D1 | 하루 읽기 500만 행 / 쓰기 10만 행, 저장 5GB | 한참 못 미침 |

Supabase 대신 고른 이유: **무료 Supabase 프로젝트는 7일간 활동이 없으면 일시정지**된다.
방문이 뜸한 개인 사이트에서는 어느 날 기록판이 죽어 있게 된다. Worker는 잠들지 않는다.

## 배포 (한 번만)

```bash
npm install -g wrangler
wrangler login

cd board

# 1. D1 만들기 — 출력된 database_id 를 wrangler.toml 에 붙여넣는다
wrangler d1 create typing-board

# 2. wrangler.toml 열어서 두 곳을 채운다
#    - database_id
#    - IP_SALT  (아무 임의 문자열)

# 3. 스키마 적용
wrangler d1 execute typing-board --remote --file=./schema.sql

# 4. 배포 — 끝나면 https://typing-board.<계정>.workers.dev 주소가 나온다
wrangler deploy
```

마지막에 나온 주소를 `../index.html` 맨 위 `BOARD_API` 에 넣으면 기록판이 켜진다.
비워두면 사이트는 기록판 없이 그대로 동작한다.

## API

### `GET /board?lang=ko&text=anthem&limit=20`

지문별 순위. 닉네임 하나당 최고 기록 한 줄만 나온다.

```json
{ "lang": "ko", "text": "anthem",
  "rows": [ { "nick": "공도일", "rate": 412, "acc": 97, "ms": 83155, "created_at": 1755400000000 } ] }
```

### `POST /score`

```json
{ "lang": "ko", "text": "anthem", "nick": "공도일",
  "rate": 412, "acc": 97, "strokes": 571, "ms": 83155 }
```

성공하면 `201`과 함께 등록 직후 순위를 돌려준다. 검증에 걸리면 `422`.

## 조작 방지 — L1 「상식 필터」

**정적 사이트의 기록판은 원리상 완벽히 못 막는다.** 브라우저가 보낸 값을 서버가
믿을 수밖에 없기 때문이다. 그래서 "말도 안 되는 값"을 막는 선에서 멈췄다.

검증은 애플리케이션 코드가 아니라 **테이블 CHECK 제약**에 있다. Worker에 버그가
생겨도 DB가 마지막 문을 잠근다.

| 제약 | 막는 것 |
|---|---|
| `rate` 상한 (한글 1200타 / 영문 300WPM) | `rate: 99999` |
| `ms >= line_count * 300` | 0.5초 완주 |
| `acc BETWEEN 0 AND 100` | 정확도 200% |
| **`abs(rate - strokes*60000/ms) <= 2`** | **세 값을 따로 위조하는 것** |
| 닉네임 길이·공백 | 빈 닉네임, 도배용 긴 문자열 |

마지막 제약이 핵심이다. `rate` 하나만 올려도 `strokes`·`ms`와 계산이 맞지 않으면
거부된다. 셋을 모두 맞춰 위조하려면 시간을 줄여야 하는데 그러면 줄당 최소 시간에 걸린다.

그 밖에:

- **줄 수는 서버가 안다.** 클라이언트가 보낸 `line_count` 는 쓰지 않는다.
- **IP당 1시간 20건** 도배 제한. 원본 IP는 저장하지 않고 SHA-256 해시만 남긴다.
- CORS는 `loong-kid.github.io` 와 로컬 개발 주소만 허용.

**뜻있는 사람이 작정하면 여전히 뚫린다.** 타자연습 장난감이라 여기서 멈춘 것이고,
더 올리려면 줄별 기록 전체를 보내 서버가 재계산하거나(L2), 키 입력 타임스탬프의
분포를 검사해야 한다(L3).

## 이상한 기록 지우기

```bash
wrangler d1 execute typing-board --remote --command \
  "DELETE FROM scores WHERE id = 123"
```
