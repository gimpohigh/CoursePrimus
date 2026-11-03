import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verify} from './verify-endpoint.mjs';

test('never sends to a non-Worker, a preview host, a URL with userinfo, or a redirected endpoint', async () => {
  for (const input of ['https://real.workers.dev.evil.test', 'https://h.w.workers.dev@evil.test', 'https://p.w.a.workers.dev', 'https://w.a.workers.dev/chat?at=evil', 'http://w.a.workers.dev']) {
    await assert.rejects(verify(input, () => assert.fail('must not send any request')), /대시보드/);
  }
  await assert.rejects(verify('https://worker.school.workers.dev', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('redirect blocked');
  }), /redirect blocked/);
});

test('activates only a matching health response and working production CORS', async () => {
  const base = 'https://worker.school.workers.dev';
  const model = '@cf/openai/gpt-oss-20b';
  const transport = (allowOrigin, id) => async (url, init) => {
    if (url === base + '/health') return Response.json({service:id, model});
    assert.equal(url, base + '/chat');
    assert.equal(init.method, 'OPTIONS');
    assert.equal(init.headers.Authorization, undefined);
    return new Response(null, {status:204, headers:{'Access-Control-Allow-Origin':allowOrigin,
      'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
  };
  const origin = 'https://gimpohigh.github.io';
  assert.deepEqual(await verify(base + '/chat', transport(origin, 'gimpo-course-ai')), {workerUrl:base + '/chat'});
  await assert.rejects(verify(base, transport('*', 'gimpo-course-ai')), /채팅 요청/);
  await assert.rejects(verify(base, transport(origin, 'other')), /응답과 일치/);
});
