// Run from the course checkout after copying the public URL of YOUR Worker
// from its Cloudflare dashboard. No credentials or student data are used.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const origin = 'https://gimpohigh.github.io';
const model = '@cf/openai/gpt-oss-20b';
const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const basePattern = new RegExp('^https://(' + label + ')\\.(' + label + ')\\.workers\\.dev(?:/(?:chat)?)?$');

export async function verify(raw, request = fetch) {
  if (typeof raw !== 'string' || !basePattern.test(raw))
    throw new Error('본인 Cloudflare 대시보드에 표시된 https://이름.계정.workers.dev 주소를 입력하세요.');
  const base = new URL(raw).origin;
  const options = {redirect: 'error', signal: AbortSignal.timeout(15000)};
  const health = await request(base + '/health', options);
  if (!health.ok) throw new Error('이 주소에서 서버 상태를 확인할 수 없습니다.');
  const status = await health.json();
  if (status?.service !== 'gimpo-course-ai' || status?.model !== model)
    throw new Error('김포고 무료 GPT 서버 응답과 일치하지 않습니다.');
  const preflight = await request(base + '/chat', {...options, method:'OPTIONS', headers:{
    'Origin':origin, 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'authorization, content-type'
  }});
  const list = (name) => (preflight.headers.get(name) || '').toLowerCase().split(',').map(s => s.trim());
  if (!preflight.ok || preflight.headers.get('Access-Control-Allow-Origin') !== origin ||
      !list('Access-Control-Allow-Methods').includes('post') ||
      !['authorization','content-type'].every(h => list('Access-Control-Allow-Headers').includes(h)))
    throw new Error('이 서버가 학교 사이트의 채팅 요청을 허용하지 않습니다.');
  return {workerUrl: base + '/chat'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = await verify(process.argv[2]);
    const output = resolve(process.cwd(), 'ai-config.json');
    await writeFile(output, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log('공개 주소와 사이트 연결 설정을 확인했습니다. ' + output + ' 파일을 course 저장소 루트에 올리세요.');
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
