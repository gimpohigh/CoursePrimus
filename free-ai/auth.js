import {decodeProtectedHeader, importX509, jwtVerify} from 'jose';
import {ApiError} from './errors.js';

const CERTIFICATES = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export function createCertificateResolver({fetcher = fetch, clock = Date.now, importer = importX509} = {}) {
  let cached = new Map();
  let expires = 0;
  let lastRefresh = -Infinity;
  let pending;
  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      lastRefresh = clock();
      let response;
      try {response = await fetcher(CERTIFICATES, {redirect:'error', signal:AbortSignal.timeout(5000)});} catch {
        throw new ApiError(503, 'auth-unavailable', '로그인 인증 서버에 연결하지 못했습니다.');
      }
      if (!response.ok) throw new ApiError(503, 'auth-unavailable', '로그인 인증 서버에 연결하지 못했습니다.');
      const raw = await response.text();
      if (raw.length > 65536) throw new ApiError(503, 'auth-unavailable', '로그인 인증 정보를 확인하지 못했습니다.');
      let certificates;
      try {certificates = JSON.parse(raw);} catch {throw new ApiError(503, 'auth-unavailable', '로그인 인증 정보를 확인하지 못했습니다.');}
      if (!certificates || typeof certificates !== 'object' || Array.isArray(certificates)) {
        throw new ApiError(503, 'auth-unavailable', '로그인 인증 정보를 확인하지 못했습니다.');
      }
      const next = new Map();
      for (const [kid, certificate] of Object.entries(certificates)) {
        if (typeof certificate !== 'string') continue;
        try {next.set(kid, await importer(certificate, 'RS256'));} catch {}
      }
      if (!next.size) throw new ApiError(503, 'auth-unavailable', '로그인 인증 정보를 확인하지 못했습니다.');
      const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('cache-control') || '')?.[1] || 300);
      cached = next;
      expires = clock() + Math.min(Math.max(maxAge, 0), 86400) * 1000;
    })().finally(() => {pending = null;});
    return pending;
  }
  return async kid => {
    if (clock() >= expires || (!cached.has(kid) && clock() - lastRefresh > 30000)) await refresh();
    const key = cached.get(kid);
    if (!key) throw new ApiError(401, 'invalid-token', '로그인 정보를 새로고침해주세요.');
    return key;
  };
}

export function createFirebaseVerifier({fetcher = fetch, clock = Date.now, resolveKey = createCertificateResolver({fetcher, clock})} = {}) {
  return async (token, env) => {
    if (typeof token !== 'string' || token.length > 8192 || token.split('.').length !== 3) {
      throw new ApiError(401, 'invalid-token', '로그인 정보를 확인해주세요.');
    }
    let payload;
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 128) throw new Error('header');
      ({payload} = await jwtVerify(token, await resolveKey(header.kid), {
        algorithms:['RS256'], audience:env.FIREBASE_PROJECT_ID,
        issuer:'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID,
        currentDate:new Date(clock()), requiredClaims:['exp', 'iat', 'auth_time', 'sub']
      }));
      const now = Math.floor(clock() / 1000);
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
          !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.auth_time) ||
          payload.iat > now || payload.auth_time > now || payload.auth_time > payload.iat || payload.exp <= now ||
          payload.exp - payload.iat > 3600 || typeof payload.firebase?.sign_in_provider !== 'string' || !payload.firebase.sign_in_provider) throw new Error('claims');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(401, 'invalid-token', '로그인 정보를 새로고침해주세요.');
    }
    // Signature verification intentionally has the standard ID-token revocation window.
    // A revoked or disabled session can reach inference until this token expires (at most one hour).
    return {uid:payload.sub, anonymous:payload.firebase?.sign_in_provider === 'anonymous'};
  };
}
