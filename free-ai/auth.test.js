import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, SignJWT} from 'jose';
import {createCertificateResolver, createFirebaseVerifier} from './auth.js';

const project = 'gimpo-monitoring';
const now = 1793653200000;
const seconds = now / 1000;
const keys = await generateKeyPair('RS256');
const env = {FIREBASE_PROJECT_ID:project};
const verify = createFirebaseVerifier({clock:() => now, resolveKey:async () => keys.publicKey});
async function token(overrides = {}) {
  return new SignJWT({sub:'synthetic-guest', aud:project, iss:'https://securetoken.google.com/' + project,
    iat:seconds - 10, exp:seconds + 3590, auth_time:seconds - 10,
    firebase:{sign_in_provider:'anonymous'}, ...overrides})
    .setProtectedHeader({alg:'RS256', kid:'synthetic-key'}).sign(keys.privateKey);
}

test('verified Google-signature contract accepts guest and member without Web API keys', async () => {
  assert.deepEqual(await verify(await token(), env), {uid:'synthetic-guest', anonymous:true});
  assert.equal((await verify(await token({firebase:{sign_in_provider:'google.com'}}), env)).anonymous, false);
});

test('signature, issuer, audience, expiry, future time, subject and token lifetime fail closed', async () => {
  for (const changed of [{aud:'other-project'}, {iss:'https://evil.invalid'}, {exp:seconds}, {iat:seconds + 1},
    {auth_time:seconds + 1}, {auth_time:seconds}, {sub:''}, {sub:'x'.repeat(129)},
    {exp:seconds + 7200}, {firebase:{}}, {iat:'invalid'}]) {
    await assert.rejects(verify(await token(changed), env), {status:401});
  }
  const signed = await token();
  const parts = signed.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(verify(parts.join('.'), env), {status:401});
  const wrongAlgorithm = await new SignJWT({sub:'bad'}).setProtectedHeader({alg:'HS256', kid:'synthetic-key'})
    .sign(new TextEncoder().encode('synthetic-secret-only-for-unit-test'));
  await assert.rejects(verify(wrongAlgorithm, env), {status:401});
});

test('certificate cache honors expiration, rotation cooldown and Google fetch failure', async () => {
  let time = 0;
  let calls = 0;
  let failed = false;
  const resolver = createCertificateResolver({clock:() => time,
    importer:async value => value,
    fetcher:async url => {
      assert.equal(url, 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
      calls++;
      if (failed) throw new Error('synthetic-network');
      return Response.json(calls === 1 ? {'old-key':'certificate-old'} : {'new-key':'certificate-new'}, {headers:{'Cache-Control':'public, max-age=60'}});
    }});
  assert.equal(await resolver('old-key'), 'certificate-old');
  assert.equal(await resolver('old-key'), 'certificate-old');
  await assert.rejects(resolver('new-key'), {status:401});
  assert.equal(calls, 1);
  time = 31000;
  assert.equal(await resolver('new-key'), 'certificate-new');
  assert.equal(calls, 2);
  time = 100000;
  failed = true;
  await assert.rejects(resolver('new-key'), {status:503});
});

test('certificate fetch uses workerd-compatible manual redirects and rejects every redirect', async () => {
  let imported = 0;
  const makeResolver = status => createCertificateResolver({
    importer:async () => {imported++; return 'synthetic-key';},
    fetcher:async (url, options) => {
      // workerd rejects redirect:error before sending the request. Keep the supported mode explicit.
      assert.equal(options.redirect, 'manual');
      if (status >= 300 && status < 400) return new Response(null, {status, headers:{Location:'https://untrusted.invalid/keys'}});
      return Response.json({'test-key':'synthetic-certificate'});
    }
  });
  for (const status of [301, 302, 303, 307, 308]) {
    await assert.rejects(makeResolver(status)('test-key'), {status:503});
  }
  assert.equal(imported, 0);
  assert.equal(await makeResolver(200)('test-key'), 'synthetic-key');
});
