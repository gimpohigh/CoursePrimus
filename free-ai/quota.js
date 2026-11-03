export const LIMITS = Object.freeze({globalDaily:50, memberDaily:10, anonymousDaily:3, userMinute:2, ipDaily:80, ipMinute:10, ingressGlobal:1200, ingressIpDaily:120, ingressIpMinute:20});

function countActor(previous, minute) {
  return {day:previous?.day || 0, minute, count:previous?.minute === minute ? previous.count : 0};
}

export function consume(previous, input, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60000);
  const state = previous?.day === day ? structuredClone(previous) : {day, ingress:0, total:0, ips:{}, users:{}};
  const ip = countActor(state.ips[input.ip], minute);
  if (input.stage === 'ingress') {
    if (state.ingress >= LIMITS.ingressGlobal || ip.day >= LIMITS.ingressIpDaily || ip.count >= LIMITS.ingressIpMinute) return null;
    state.ingress++;
    state.ips[input.ip] = {...ip, day:ip.day + 1, count:ip.count + 1};
    return state;
  }
  const user = countActor(state.users[input.uid], minute);
  const chatIp = countActor(state.ips['chat-' + input.ip], minute);
  if (state.total >= LIMITS.globalDaily || user.day >= (input.anonymous ? LIMITS.anonymousDaily : LIMITS.memberDaily) ||
      user.count >= LIMITS.userMinute || chatIp.day >= LIMITS.ipDaily || chatIp.count >= LIMITS.ipMinute) return null;
  state.total++;
  state.users[input.uid] = {...user, day:user.day + 1, count:user.count + 1};
  state.ips['chat-' + input.ip] = {...chatIp, day:chatIp.day + 1, count:chatIp.count + 1};
  return state;
}

// new_sqlite_classes in wrangler.jsonc keeps these transactional KV calls on the Free SQLite backend.
export class FreeChatQuota {
  constructor(ctx) {this.ctx = ctx;}
  async fetch(request) {
    const input = await request.json();
    if (!input || !['ingress', 'chat'].includes(input.stage) || !/^[a-f0-9]{64}$/.test(input.ip) ||
        (input.stage === 'chat' && (!/^[a-f0-9]{64}$/.test(input.uid) || typeof input.anonymous !== 'boolean'))) {
      return Response.json({allowed:false}, {status:400});
    }
    const allowed = await this.ctx.storage.transaction(async tx => {
      const next = consume(await tx.get('today'), input, Date.now());
      if (!next) return false;
      await tx.put('today', next);
      return true;
    });
    return Response.json({allowed}, {status:allowed ? 200 : 429});
  }
}
