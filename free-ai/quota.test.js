import test from 'node:test';
import assert from 'node:assert/strict';
import {consume, FreeChatQuota, LIMITS} from './quota.js';

const now = 1793653200000;
const ip = 'a'.repeat(64);
const uid = 'b'.repeat(64);

test('guest, member, IP and shared global limits survive new states and UTC midnight', () => {
  let state = null;
  const chat = {stage:'chat', ip, uid, anonymous:true};
  for (let index = 0; index < LIMITS.anonymousDaily; index++) state = consume(state, chat, now + index * 60000);
  assert.equal(consume(state, chat, now + 3600000), null);
  assert.equal(consume(state, {...chat, anonymous:false}, now + 3600000).total, 4);
  assert.equal(consume(state, chat, now + 86400000).total, 1);
  state.total = LIMITS.globalDaily;
  assert.equal(consume(state, {...chat, uid:'c'.repeat(64)}, now), null);
  state.total = 0;
  state.ips['chat-' + ip] = {day:LIMITS.ipDaily, minute:0, count:0};
  assert.equal(consume(state, chat, now), null);
});

test('ingress and model quotas reject before mutation when storage limit has been reached', () => {
  let state;
  for (let index = 0; index < LIMITS.ingressIpMinute; index++) state = consume(state, {stage:'ingress', ip}, now);
  const prior = structuredClone(state);
  assert.equal(consume(state, {stage:'ingress', ip}, now), null);
  assert.deepEqual(state, prior);
  assert.ok(consume(state, {stage:'ingress', ip}, now + 60000));
});

test('Durable Object transaction has one shared counter under concurrent requests', async () => {
  let state;
  let queue = Promise.resolve();
  const ctx = {storage:{transaction(fn) {
    const result = queue.then(() => fn({get:async () => structuredClone(state), put:async (key, next) => {state = structuredClone(next);}}));
    queue = result.catch(() => {});
    return result;
  }}};
  const quota = new FreeChatQuota(ctx);
  const requests = Array.from({length:20}, () => quota.fetch(new Request('https://quota.internal', {
    method:'POST', body:JSON.stringify({stage:'chat', ip, uid, anonymous:false})
  })));
  const statuses = (await Promise.all(requests)).map(response => response.status);
  assert.equal(statuses.filter(status => status === 200).length, LIMITS.userMinute);
  assert.equal(state.total, LIMITS.userMinute);
});
