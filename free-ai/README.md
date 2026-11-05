# 김포고 무료 AI 연결

기존 Firebase 로그인과 GitHub Pages 화면에서 OpenAI의 공개 가중치 모델 `gpt-oss-20b`를 호출합니다. 모델 실행은 Cloudflare Workers AI가 담당합니다. OpenAI API 키를 발급하거나 Firebase 요금제를 변경할 필요가 없습니다.

[Cloudflare에 배포](https://deploy.workers.cloudflare.com/?url=https://github.com/gimpohigh/course/tree/main/free-ai)

Cloudflare 공식 배포 버튼은 공개 저장소의 하위 폴더를 새로운 저장소 루트로 복사합니다. 이 폴더는 모든 소스, 과목표, npm 의존성과 lockfile을 포함해 독립적으로 빌드됩니다. Workers AI와 SQLite Durable Objects는 `wrangler.jsonc`로 자동 연결합니다. Cloudflare 계정으로 로그인한 뒤 **Workers Free** 요금제를 사용하세요.

## 무료 범위

- Workers AI는 계정 전체에서 하루 10,000 Neurons를 무료로 제공합니다. Workers Free에서 초과 요청은 오류로 종료됩니다. 사용량은 UTC 자정, 한국 시간 오전 9시에 초기화됩니다.
- 현재 고정 모델 `@cf/openai/gpt-oss-20b`는 유료 요금제 필수 모델에 포함되지 않습니다. 다른 유료 모델이나 AI Gateway 선불 결제를 연결하지 않습니다.
- 자체 한도는 하루 전체 50회, 로그인한 회원 UID당 10회, 익명 UID당 3회, UID당 분당 2회입니다. IP당 분당 10회/하루 80회도 함께 검사합니다. 긴 질문이나 다른 앱의 사용량에 따라 Cloudflare 무료량이 50회보다 먼저 끝날 수 있습니다.
- 글로벌·UID·IP 카운터는 한 개의 SQLite Durable Object에서 트랜잭션으로 처리합니다. 카운터 저장소를 확인하지 못하면 모델을 실행하지 않습니다.
- Workers Free에는 HTTP 호출당 CPU 10ms, 일일 100,000건 등의 플랫폼 제한도 적용됩니다. 실제 학교 이용량에서의 응답 속도와 한국어 답변 품질은 배포 후 확인해야 합니다.

## 접속과 보관

서버는 Firebase 공식 공개 인증서의 RS256 서명, issuer, audience, 만료 시각, 발급·인증 시각, UID를 검사합니다. 수명이 1시간을 넘는 토큰은 거부합니다. 학교 사이트의 Origin과 유효한 Firebase 로그인 토큰이 모두 필요합니다. 회원 가입 없이 Firebase 익명 로그인을 한 방문자도 이용할 수 있습니다.

이 검증은 현재 토큰의 유효성을 확인합니다. 관리자가 사용자를 정지하거나 세션을 철회한 직후에도 이미 발급한 토큰의 만료까지 최대 1시간 동안 AI를 이용할 수 있습니다. 이 서버에는 Firebase 관리자 키, DB 권한, 사용자 목록 조회 권한이 없습니다.

질문·최근 대화·선택 과목 정보는 답변 생성을 위해 Cloudflare로 전송됩니다. AI 요청에 Firebase 토큰·UID·IP를 넣지 않습니다. 자체 사용량 카운터에는 UID 해시와 날짜별 IP 해시만 저장하고, UTC 날짜가 바뀌면 그날의 카운터로 교체합니다. 앱은 사용자 질문이나 토큰을 로그로 출력하지 않으며 Worker observability 수집도 꺼져 있습니다. Cloudflare가 수행하는 서비스 데이터 처리는 공식 데이터 이용 정책을 따릅니다.

## 직접 배포

이 폴더에서 다음 명령을 실행합니다.

```sh
npm ci --ignore-scripts
npm test
npm run check
node runtime-smoke.cjs
npx wrangler login
npm run deploy
```

`npm run check`는 배포 파일을 묶는 로컬 dry-run입니다. `runtime-smoke.cjs`는 로컬 workerd에서 health와 실제 SQLite 카운터를 점검하며 AI를 호출하지 않습니다. 배포 결과로 받은 `https://이름.하위도메인.workers.dev` 주소를 사용합니다.

## 사이트 연결 계약

- 공개 `GET /health`는 AI나 인증·카운터를 호출하지 않고 아래 JSON만 반환합니다.

```json
{"service":"gimpo-course-ai","model":"@cf/openai/gpt-oss-20b"}
```

- `POST /chat`은 `Origin: https://gimpohigh.github.io`, `Authorization: Bearer <Firebase ID token>`, `Content-Type: application/json`을 사용합니다.
- 본문은 `{messages:[{role:"user"|"assistant",text:"..."}],courses:["과목ID"],sciTrack:false}`입니다. 최근 대화 12개, 각 4,000자, 대화 총 16,000자, JSON 전체 32KiB 이내입니다. 모델명과 시스템 프롬프트는 서버가 고정합니다.
- 성공 응답은 `{text:"최종 한국어 답변",model:"@cf/openai/gpt-oss-20b"}`이며 text는 최대 8,000자입니다. 모델 출력은 기본 최대 768토큰, 상세 설명 요청 시 최대 2,048토큰이며, reasoning effort는 low입니다. 내부 분석 문장은 반환하지 않습니다.
- 실패 응답은 `{error:{code:"...",message:"사용자 안내"}}`입니다. 잘못된 입력은 400/413/415, 인증은 401/403, 이용량은 429, 서버·불완전한 답변은 503/504로 구분합니다. 무료 한도 초과가 서버에서 HTTP 400과 내부 코드 3036/4006/4007로 오는 경우도 429로 안내합니다.
- 기존 사이트의 `ai-config.json`에는 `workerUrl`을 이 Worker의 `/chat` 주소로 지정합니다. 인증 토큰은 프런트엔드에서 `getIdToken()`으로 받아 요청할 때만 전달합니다.

## 검증한 범위

서명된 합성 JWT의 서명 변조·다른 프로젝트·만료·미래 시각·긴 수명 거부, 인증서 캐시·키 교체·리디렉션 거부, CORS·모델 변경·과목 ID 검증, 무료 한도 및 동시 요청을 검사했습니다. 로컬 workerd의 SQLite 카운터는 동시 요청 20건 중 분당 한도인 2건만 통과시켰습니다.

2026년 11월 3일 학교 운영 계정의 Workers Free에 배포했습니다. 실제 Firebase 익명 계정으로 질문을 보내 모델 답변을 확인했고, 토큰이 없는 요청은 401, 허용하지 않은 사이트의 요청은 403으로 거부되는 것을 확인했습니다. [운영 서버 상태](https://gimpo-course-ai.gimporeport0310.workers.dev/health)

## 공식 근거

- [Workers AI 무료량과 요금제](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [gpt-oss-20b 모델과 바인딩 호출](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)
- [SQLite Durable Objects 무료 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Cloudflare AI 오류 코드](https://developers.cloudflare.com/workers-ai/platform/errors/)
- [하위 폴더 배포 버튼](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Firebase ID 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [OpenAI gpt-oss 모델의 Apache 2.0 라이선스](https://developers.openai.com/api/docs/models/gpt-oss-20b)
- [Cloudflare 데이터 이용](https://developers.cloudflare.com/workers-ai/platform/data-usage/)

2026년 11월 5일 요청 반영

학교 과목 113개와 운영자 제공 조건은 `courses.json`, `school-context.json`에 보관합니다. 질문에 관련된 자료를 골라 GPT에 전달하며, 수강연습의 기존 과목표·검증 조건은 변경하지 않습니다. 송율근 입력에는 운영자가 지정한 제작자 소개를 반환합니다. 일반 답변은 핵심 중심이고, 상세 요청에는 설명을 늘립니다. 대학별 공식 모집요강 없이 지원 필수를 단정한 문장은 확인 안내로 교정합니다.
