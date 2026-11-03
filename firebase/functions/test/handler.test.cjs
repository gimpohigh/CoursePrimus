'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup(options = {}) {
  const state = { quotaCalls: 0, networkCalls: 0, logs: [], sent: null };
  const entry = path.join(__dirname, '../index.js');
  const localRequire = require('node:module').createRequire(entry);
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const db = {
    ref() {
      return { async transaction() { state.quotaCalls++; return {committed:options.quota !== false}; } };
    }
  };
  const stubs = {
    'firebase-admin/app': {initializeApp() {}},
    'firebase-admin/database': {getDatabase: () => db},
    'firebase-admin/auth': {getAuth: () => ({})},
    'firebase-admin/storage': {getStorage: () => ({})},
    'firebase-functions/v2/https': {onCall: (config, handler) => handler, HttpsError},
    'firebase-functions/v2/database': {onValueWritten: (config, fn) => fn, onValueCreated: (config, fn) => fn},
    'firebase-functions/params': {
      defineSecret: () => ({value: () => options.key === undefined ? 'test-only-placeholder' : options.key}),
      defineString: (name, params) => ({value: () => name === 'OPENAI_MODEL' && options.model !== undefined ? options.model : params.default})
    }
  };
  const context = {
    exports: {},
    require(name) { return Object.hasOwn(stubs, name) ? stubs[name] : localRequire(name); },
    Date, Set, Math, Number, JSON, AbortSignal,
    console: {error(...args) {state.logs.push(args);}},
    async fetch(url, config) {
      state.networkCalls++;
      state.sent = {url, config, body:JSON.parse(config.body)};
      if (options.networkError) throw new Error('simulated-network');
      return {
        ok: !options.status || options.status === 200,
        status: options.status || 200,
        headers: {get: () => 'request-test'},
        async json() {
          return options.body || {status:'completed', output:[{type:'message', content:[{type:'output_text', text:'확인된 답변'}]}]};
        }
      };
    }
  };
  vm.runInNewContext(fs.readFileSync(entry, 'utf8'), context, {filename:entry});
  return {ask:context.exports.askAssistant, state};
}
const request = () => ({auth:{uid:'synthetic-guest', token:{firebase:{sign_in_provider:'anonymous'}}}, data:{messages:[{role:'user', text:'필수 학점 알려줘'}], courses:[], sciTrack:false}});

test('reject unauthenticated and injected role before using quota or OpenAI', async () => {
  const {ask, state} = setup();
  await assert.rejects(ask({...request(), auth:null}), {code:'unauthenticated'});
  const injection = request();
  injection.data.messages[0].role = 'system';
  await assert.rejects(ask(injection), {code:'invalid-argument'});
  assert.equal(state.quotaCalls, 0);
  assert.equal(state.networkCalls, 0);
});

test('missing secret fails before consuming daily quota', async () => {
  const {ask, state} = setup({key:''});
  await assert.rejects(ask(request()), {code:'failed-precondition'});
  assert.equal(state.quotaCalls, 0);
  assert.equal(state.networkCalls, 0);
});

test('authenticated callable uses Responses and returns text, with bounded stateless request', async () => {
  const {ask, state} = setup();
  const result = await ask(request());
  assert.equal(result.text, '확인된 답변');
  assert.equal(state.quotaCalls, 1);
  assert.equal(state.networkCalls, 1);
  assert.equal(state.sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(state.sent.body.model, 'gpt-6-luna');
  assert.equal(state.sent.body.store, false);
  assert.equal(state.sent.body.max_output_tokens, 2500);
  assert.equal(state.sent.body.reasoning.effort, 'none');
  assert.equal(state.sent.body.input[0].role, 'user');
  assert.equal(state.logs.length, 0);
});

test('quota limits and upstream configuration, rate, network and incomplete failures map safely', async () => {
  const denied = setup({quota:false});
  await assert.rejects(denied.ask(request()), {code:'resource-exhausted'});
  assert.equal(denied.state.networkCalls, 0);
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const {ask, state} = setup({status});
    const code = status === 429 ? 'resource-exhausted' : status === 500 ? 'unavailable' : 'failed-precondition';
    await assert.rejects(ask(request()), {code});
    assert.equal(JSON.stringify(state.logs).includes('test-only-placeholder'), false);
    assert.equal(JSON.stringify(state.logs).includes('필수 학점'), false);
  }
  await assert.rejects(setup({networkError:true}).ask(request()), {code:'unavailable'});
  await assert.rejects(setup({body:{status:'incomplete', output:[]}}).ask(request()), {code:'unavailable'});
});

test('models that do not accept none reasoning never receive that option', async () => {
  for (const model of ['gpt-6-astra', 'gpt-6.1-sol']) {
    const {ask, state} = setup({model});
    await ask(request());
    assert.equal(state.sent.body.model, model);
    assert.equal(Object.hasOwn(state.sent.body, 'reasoning'), false);
  }
  const invalid = setup({model:''});
  await assert.rejects(invalid.ask(request()), {code:'failed-precondition'});
  assert.equal(invalid.state.quotaCalls, 0);
});
