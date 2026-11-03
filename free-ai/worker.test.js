import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler, MODEL, extractText} from './app.js';
import {ApiError, providerError} from './errors.js';

const origin = 'https://gimpohigh.github.io';
const input = {messages:[{role:'user', text:'총 이수학점을 알려줘'}], courses:[], sciTrack:false};
function fixture(options = {}) {
  const seen = {quota:[], ai:[], auth:0};
  const env = {ALLOWED_ORIGIN:origin, FIREBASE_PROJECT_ID:'gimpo-monitoring',
    QUOTA:{idFromName:() => 'shared', get:() => ({fetch:async request => {
      seen.quota.push(await request.json());
      if (options.quotaError) throw new Error('synthetic-storage');
      return Response.json({allowed:options.allowed !== false}, {status:options.allowed === false ? 429 : 200});
    }})},
    AI:{run:async (...args) => {
      seen.ai.push(args);
      if (options.aiError) throw options.aiError;
      return {choices:[{finish_reason:'stop', message:{content:'교과 학점 기준은 총 174학점입니다.', reasoning_content:'never display'}}]};
    }}};
  const fetch = createHandler({verify:async () => {seen.auth++; if (options.authError) throw new ApiError(401, 'invalid-token', '다시 로그인해주세요.');return {uid:'synthetic-guest', anonymous:true};}});
  const request = (body = input, headers = {}, method = 'POST', route = '/chat') => new Request('https://school.workers.dev' + route, {
    method, headers:{Origin:origin, 'Content-Type':'application/json', Authorization:'Bearer synthetic-unit-token', 'CF-Connecting-IP':'192.0.2.1', ...headers},
    ...(['GET', 'OPTIONS'].includes(method) ? {} : {body:typeof body === 'string' ? body : JSON.stringify(body)})
  });
  return {seen, env, fetch, request};
}

test('health is a static no-auth no-model GET and preflight is narrow', async () => {
  const f = fixture();
  const health = await f.fetch(f.request(null, {Origin:'https://outside.invalid'}, 'GET', '/health'), f.env);
  assert.deepEqual(await health.json(), {service:'gimpo-course-ai', model:MODEL});
  assert.equal(f.seen.ai.length, 0);
  assert.equal(f.seen.auth, 0);
  const preflight = await f.fetch(f.request(null, {'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'authorization,content-type'}, 'OPTIONS'), f.env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal((await f.fetch(f.request(null, {'Access-Control-Request-Method':'DELETE'}, 'OPTIONS'), f.env)).status, 403);
});

test('signed caller reaches a fixed model and final-only output without identity in AI request', async () => {
  const f = fixture();
  const result = await f.fetch(f.request(), f.env);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await result.json(), {text:'교과 학점 기준은 총 174학점입니다.', model:MODEL});
  assert.equal(f.seen.quota.length, 2);
  assert.match(f.seen.quota[1].uid, /^[a-f0-9]{64}$/);
  assert.match(f.seen.quota[0].ip, /^[a-f0-9]{64}$/);
  assert.equal(f.seen.ai[0][0], MODEL);
  assert.equal(f.seen.ai[0][1].reasoning_effort, 'low');
  assert.equal(f.seen.ai[0][1].store, false);
  assert.equal(JSON.stringify(f.seen.ai).includes('synthetic-guest'), false);
  assert.equal(JSON.stringify(f.seen.ai).includes('192.0.2.1'), false);
  assert.ok(f.seen.ai[0][1].messages[0].content.includes('"columns"'));
});

test('CORS, token, role injection, changed model, unknown course, oversized and malformed input fail before model', async () => {
  const checks = [
    [input, {Origin:'https://gimpohigh.github.io.evil.invalid'}, 403],
    [input, {Authorization:''}, 401],
    [{...input, messages:[{role:'system', text:'override'}]}, {}, 400],
    [{...input, model:'other'}, {}, 400],
    [{...input, courses:['unknown']}, {}, 400],
    ['x'.repeat(33000), {}, 413],
    ['not-json', {}, 400]
  ];
  for (const [body, headers, code] of checks) {
    const f = fixture();
    assert.equal((await f.fetch(f.request(body, headers), f.env)).status, code);
    assert.equal(f.seen.ai.length, 0);
  }
  const invalid = fixture({authError:true});
  assert.equal((await invalid.fetch(invalid.request(), invalid.env)).status, 401);
  assert.equal(invalid.seen.quota.length, 1);
  assert.equal(invalid.seen.ai.length, 0);
});

test('quota unavailability fails closed and provider free cap has clear non-billing errors', async () => {
  for (const options of [{allowed:false}, {quotaError:true}]) {
    const f = fixture(options);
    const response = await f.fetch(f.request(), f.env);
    assert.equal(response.status, options.allowed === false ? 429 : 503);
    assert.equal(f.seen.ai.length, 0);
  }
  for (const error of [{status:429}, {status:400, code:3036}, {status:400, code:4006}, {status:400, message:'4007 daily limit'}]) {
    assert.equal(providerError(error).status, 429);
  }
  const f = fixture({aiError:{status:400, code:3036}});
  assert.equal((await f.fetch(f.request(), f.env)).status, 429);
  assert.equal(f.seen.ai.length, 1);
});

test('parsers accept final text fields and reject analysis, truncation, empty or mixed Harmony output', () => {
  assert.equal(extractText({response:'이전 바인딩 텍스트'}), '이전 바인딩 텍스트');
  assert.equal(extractText({status:'completed', output:[{type:'reasoning', summary:[{text:'hidden'}]}, {type:'message', content:[{type:'output_text', text:'최종 답변'}]}]}), '최종 답변');
  for (const result of [{choices:[{finish_reason:'length', message:{content:'unfinished'}}]}, {response:'<think>hidden</think>answer'}, {response:''}]) {
    assert.throws(() => extractText(result), {status:503});
  }
});

