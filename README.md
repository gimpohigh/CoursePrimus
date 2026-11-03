# 김포고 선택과목 안내

[과목 선택 사이트](https://gimpohigh.github.io/course/) · [담당자 문의함](https://gimpohigh.github.io/reportchat/)

사이트는 GitHub Pages에서 열립니다. 로그인, 과목 선택, 저장 슬롯, 문의, 채팅 기록, 실시간 접속자 집계는 기존 Firebase 프로젝트의 Authentication과 Realtime Database를 사용합니다.

## AI 채팅을 무료로 켜는 방법

이 사이트는 운영자가 지정한 **Cloudflare Workers Free** 서버에서 OpenAI의 공개 모델 `gpt-oss-20b`를 실행하도록 구성했습니다. 카드, OpenAI API 키, Firebase Blaze가 필요하지 않습니다. [모델 설명](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/) · [무료 한도](https://developers.cloudflare.com/workers-ai/platform/pricing/)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 학교 사이트를 운영할 계정으로 로그인하고 **Workers Free**를 사용하세요. 유료 플랜이나 AI Gateway 크레딧을 켜지 마세요.
2. 이 저장소를 내려받고 `free-ai`에 들어가 해당 폴더의 배포 안내대로 Worker를 배포합니다. GitHub와 Cloudflare 계정을 서로 연결할 필요는 없습니다.
3. 배포가 끝나면 Cloudflare 대시보드에 표시된 **본인 Worker의 공개 주소**를 확인합니다. 저장소 최상위 폴더에서 아래 명령을 실행하세요(Node.js 22 이상). 꺾쇠 부분에는 실제 주소를 넣습니다.

   ```console
   node free-ai/verify-endpoint.mjs "https://<이름>.<내-계정>.workers.dev"
   ```

   이 명령은 인증정보 없이 서버 종류와 브라우저 접근 설정을 확인하고 최상위에 `ai-config.json`을 만듭니다. 그 파일을 이 저장소의 `main`에 올리면 기존 채팅창이 연결됩니다. 설정 파일에는 공개 주소만 들어갑니다. 운영 연결을 끄려면 `{"workerUrl":null}`로 되돌리세요.

AI를 사용할 때만 인증용 Firebase 토큰을 지정된 Worker에 보냅니다. 모델에는 최근 AI 대화와 선택 과목·중점과정 정보가 전달됩니다. 관리자 문의함이나 Firebase 사용자 목록을 모델에 보내지 않습니다. Free 플랜에서 일일 제공량(계정 전체 10,000 Neurons)을 넘으면 추가 요청이 중단되며 한국 시간 오전 9시에 초기화됩니다. 별도 유료 API로 전환하지 않습니다.

`firebase/`에 보관한 Firebase Functions 코드는 과거의 **유료 대안**입니다. 이 무료 구성에는 배포하지 않습니다.
