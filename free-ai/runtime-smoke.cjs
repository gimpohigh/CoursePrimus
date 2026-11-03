'use strict';
// Runs the local workerd runtime with real SQLite Durable Objects. Never invokes Workers AI.
(async () => {
  const {Miniflare, convertV4MiniflareOptions} = await import('miniflare');
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules:true,
    scriptPath:'.build/worker.js',
    compatibilityDate:'2026-11-03',
    durableObjects:{QUOTA:{className:'FreeChatQuota', useSQLite:true}},
    bindings:{ALLOWED_ORIGIN:'https://gimpohigh.github.io', FIREBASE_PROJECT_ID:'gimpo-monitoring'}
  }));
  try {
    const health = await runtime.dispatchFetch('http://localhost/health');
    const namespace = await runtime.getDurableObjectNamespace('QUOTA');
    const quota = namespace.get(namespace.idFromName('runtime-test'));
    const body = JSON.stringify({stage:'chat', ip:'a'.repeat(64), uid:'b'.repeat(64), anonymous:true});
    const responses = await Promise.all(Array.from({length:20}, () => quota.fetch('http://quota.test/', {method:'POST', body})));
    const allowed = responses.filter(response => response.status === 200).length;
    const rejected = responses.filter(response => response.status === 429).length;
    if (allowed !== 2 || rejected !== 18 || health.status !== 200) throw new Error('Runtime result mismatch');
    console.log(JSON.stringify({health:await health.json(), sqliteConcurrentAllowed:allowed, rejected}));
  } finally {await runtime.dispose();}
})().catch(error => {console.error(error); process.exitCode = 1;});
