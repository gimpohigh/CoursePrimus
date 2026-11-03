'use strict';
const {createHash} = require('node:crypto');
function validateChat(input, courseIds) {
  if (!input || !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 20) throw new Error('대화는 최근 20개 이내로 보내주세요.');
  const messages = input.messages.map(m => {
    if (!m || !['user','assistant'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 4000) throw new Error('질문은 1~4,000자로 입력해주세요.');
    return {role:m.role,content:m.text.trim()};
  });
  if (messages.at(-1).role !== 'user' || messages.reduce((n,m)=>n+m.content.length,0)>16000) throw new Error('대화가 너무 깁니다. 새 대화를 시작해주세요.');
  if (!Array.isArray(input.courses) || input.courses.length > 113 || input.courses.some(id=>!courseIds.has(id))) throw new Error('선택 과목 정보가 올바르지 않습니다.');
  return {messages,courses:[...new Set(input.courses)],sciTrack:input.sciTrack===true};
}
function consumeQuota(current, uid, anonymous, now, limits) {
  const state = current || {total:0,users:{}};
  const key = createHash('sha256').update(uid).digest('hex');
  const users = state.users || {};
  const u = users[key] || {day:0,minute:0,minuteCount:0};
  const minute = Math.floor(now/60000);
  const count = u.minute===minute ? u.minuteCount : 0;
  if ((state.total||0)>=limits.global || u.day>=(anonymous?limits.anonymous:limits.user) || count>=limits.minute) return undefined;
  return {...state,total:(state.total||0)+1,users:{...users,[key]:{day:u.day+1,minute,minuteCount:count+1}}};
}
function applyContribution(current,uid,selection,registered,courseIds) {
  const state=current||{public:{totalUsers:0,courses:{}},contributions:{}};
  const contributions=state.contributions||{};
  const previous=contributions[uid];
  const revision=Number(selection?.revision)||0;
  if(previous && previous.revision>=revision) return undefined;
  const next=registered && selection && Array.isArray(selection.courses) ? [...new Set(selection.courses)].filter(id=>courseIds.has(id)) : [];
  const counts={...(state.public?.courses||{})};
  for(const id of previous?.courses||[]) counts[id]=Math.max(0,(counts[id]||0)-1);
  for(const id of next) counts[id]=(counts[id]||0)+1;
  for(const id of Object.keys(counts)) if(counts[id]===0) delete counts[id];
  const counted=registered && !!selection;
  return {public:{totalUsers:Math.max(0,(state.public?.totalUsers||0)-(previous?.counted?1:0)+(counted?1:0)),courses:counts},
    contributions:{...contributions,[uid]:{revision,counted,courses:next}}};
}
function extractResponse(body) {
  const text=(body.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[])
    .filter(x=>x.type==='output_text').map(x=>x.text||'').join('\n').trim();
  if(!text || body.status==='incomplete') throw new Error('답변을 완성하지 못했습니다. 질문을 짧게 나누어 다시 시도해주세요.');
  return text.slice(0,12000);
}
function summarizeRoom(current,message,messageId,profile) {
  const timestamp=Number(message.timestamp)||0;
  if(current?.deletedAt && timestamp<=current.deletedAt)return undefined;
  if(current && (current.updatedAt>timestamp || (current.updatedAt===timestamp && current.messageId>=messageId)))return undefined;
  const profileName=profile?.name?`${profile.classNum}반 ${profile.studentNum}번 ${profile.name}`:'';
  const name=profileName || (message.role==='user'?String(message.senderName||''):current?.name) || '익명';
  return {name:name.slice(0,120),lastText:String(message.text||'(사진)').slice(0,160),updatedAt:timestamp,messageId,deleted:false};
}
module.exports={validateChat,consumeQuota,applyContribution,extractResponse,summarizeRoom};
