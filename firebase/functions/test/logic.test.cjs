const test=require('node:test');const assert=require('node:assert/strict');
const {validateChat,consumeQuota,applyContribution,extractResponse,summarizeRoom}=require('../logic');
test('user cannot inject developer role or unknown course',()=>{
 assert.throws(()=>validateChat({messages:[{role:'system',text:'x'}],courses:[]},new Set()));
 assert.throws(()=>validateChat({messages:[{role:'user',text:'x'}],courses:['bad']},new Set()));
 assert.deepEqual(validateChat({messages:[{role:'user',text:'hi'}],courses:['a','a']},new Set(['a'])).courses,['a']);
});
test('quota blocks excess global, user, and minute attempts',()=>{
 const limits={global:10,user:4,anonymous:2,minute:2};
 let x=consumeQuota(null,'u',false,100000,limits);x=consumeQuota(x,'u',false,100000,limits);
 assert.equal(consumeQuota(x,'u',false,100000,limits),undefined);
 x=consumeQuota(x,'u',false,180000,limits);x=consumeQuota(x,'u',false,180000,limits);
 assert.equal(consumeQuota(x,'u',false,240000,limits),undefined);
 assert.equal(consumeQuota({total:10},'v',false,300000,limits),undefined);
});
test('statistic events are deduplicated and out-of-order safe',()=>{
 const ids=new Set(['a','b']);
 let x=applyContribution(null,'u',{revision:1,courses:['a','a']},true,ids);
 assert.deepEqual(x.public,{totalUsers:1,courses:{a:1}});
 assert.equal(applyContribution(x,'u',{revision:1,courses:['a']},true,ids),undefined);
 x=applyContribution(x,'u',{revision:3,courses:['b']},true,ids);
 assert.equal(applyContribution(x,'u',{revision:2,courses:['a']},true,ids),undefined);
 assert.deepEqual(x.public,{totalUsers:1,courses:{b:1}});
 x=applyContribution(x,'guest',{revision:1,courses:['b']},false,ids);
 assert.deepEqual(x.public,{totalUsers:1,courses:{b:1}});
});
test('REST response parser accepts output_text only and rejects incomplete',()=>{
 assert.equal(extractResponse({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'hello'}]}]}),'hello');
 assert.throws(()=>extractResponse({status:'incomplete',output:[]}));
});
test('admin reply retains anonymous name; deletion tombstones reject old events',()=>{
 const room={name:'anonymous name',updatedAt:10,messageId:'a'};
 assert.equal(summarizeRoom(room,{role:'admin',senderName:'developer',timestamp:11,text:'reply'},'b',null).name,'anonymous name');
 assert.equal(summarizeRoom({deleted:true,deletedAt:20,updatedAt:20},{role:'user',timestamp:15},'c',null),undefined);
 assert.equal(summarizeRoom(room,{role:'user',timestamp:9},'z',null),undefined);
});
