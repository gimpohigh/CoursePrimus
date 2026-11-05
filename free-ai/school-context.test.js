import test from 'node:test';
import assert from 'node:assert/strict';
import catalogue from './courses.json' with {type:'json'};
import school from './school-context.json' with {type:'json'};
import {instructions, questionContext, validateInput, creatorReply, CREATOR_REPLY, detailedAnswerRequested, createHandler, finalizeAnswer, ADMISSION_CAVEAT} from './app.js';

const basic = {messages:[{role:'user', text:'천문학과에는 어떤 과목이 좋아?'}], courses:['21_s12'], sciTrack:false};
const find = name => catalogue.courses.filter(c => c.name === name);

test('all 113 school course entries and every semester credit are represented unchanged', () => {
  assert.equal(catalogue.courses.length, 113);
  assert.equal(new Set(catalogue.courses.map(c => c.id)).size, 113);
  const expected = {'1-1':[10,0,29], '1-2':[10,0,29], '2-1':[4,16,14], '2-2':[4,17,14], '3-1':[5,20,11], '3-2':[5,22,11]};
  for (const [sem, [fixed, optional, credits]] of Object.entries(expected)) {
    const entries = catalogue.courses.filter(c => c.sem === sem);
    assert.equal(entries.filter(c => c.req).length, fixed);
    assert.equal(entries.filter(c => !c.req).length, optional);
    assert.equal(entries.filter(c => c.req).reduce((sum,c) => sum + c.cred, 0), credits);
    assert.equal(credits + (school.schoolRules.electiveCounts[sem] || 0) * 3, 29);
  }
  const content = instructions(validateInput({...basic, messages:[{role:'user',text:'우리 학교 전체 과목표를 알려줘'}]}));
  const table = JSON.parse(content.match(/<course_table>(.*?)<\/course_table>/s)[1]);
  assert.equal(table.length, 113);
  for (const course of catalogue.courses) {
    const row = table.find(row => row.과목 === course.name && row.학기 === course.sem);
    for (const [field, label] of Object.entries({sem:'학기',name:'과목',type:'유형',cat:'교과',grade:'성취도',cred:'학점'})) assert.equal(row[label], course[field]);
    assert.equal(row.구분, course.req ? '학교 지정 필수' : '선택');
  }
});

test('short astronomy questions retrieve the relevant foundations without unrelated timetable or track quotas', () => {
  const input = validateInput({...basic, messages:[{role:'user',text:'천문학과를 희망하는데 우리 학교에서 핵심적으로 추천하는 과목을 두 문장으로 알려줘.'}]});
  const context = questionContext(input);
  const names = new Set(context.courseRows.map(course => course.과목));
  for (const name of ['지구과학','물리학','행성우주과학','미적분 II']) assert.ok(names.has(name));
  for (const name of ['기초 체육 전공 실기','생명과학','경제 수학','영어 I']) assert.equal(names.has(name),false);
  assert.equal(context.courseRows.length < 15,true);
  assert.equal(context.facts.some(fact => /6개 이상|79학점|수학 선택과목 4/.test(fact)),false);
  assert.match(context.scope,/총 2~4개 과목/);
  assert.match(context.facts.join('\n'),/과학중점을 선택하지 않을 수 있다/);
  assert.match(context.facts.join('\n'),/모든 대학 천문학과의 지원 필수라고 단정하지/);
  assert.equal(instructions(input).length < 4000,true);
});

test('detailed curriculum query retrieves exact units and science years without unrelated course rows', () => {
  const context = questionContext(validateInput({...basic, messages:[{role:'user',text:'우리 학교 과학중점의 심화6과목 기준이 어느 학년인지, 예술과 생활교양 최소학점, 2026 고1 적용 교육과정을 자세하게 설명해줘.'}]}));
  const facts = context.facts.join('\n');
  assert.match(facts,/교과 총 174학점 \+ 창의적 체험활동 18학점 = 졸업 최소 192학점/);
  assert.match(facts,/2학년 2학기와 3학년을 합산/);
  assert.match(facts,/수학·과학·정보 관련 교과.*79학점/);
  assert.match(facts,/예술 6학점·생활교양군 15학점/);
  assert.match(facts,/2022 개정 교육과정/);
  assert.equal(context.courseRows.length,0);
  assert.match(context.scope,/질문하지 않은 규정이나 과목을 덧붙이라는 뜻이 아니다/);
});

test('focused retrieval preserves course facts, school conditions and followup career context', () => {
  const make = text => questionContext(validateInput({...basic,messages:[{role:'user',text}]}));
  assert.ok(make('3학년 2학기 전체 선택 과목 목록은?').courseRows.some(course => course.과목 === '심화 일본어'));
  assert.match(make('우리 학교 전체 선택 조건과 성취도 기준을 알려줘').facts.join('\n'),/논리와 사고/);
  assert.match(make('우리 학교 전체 선택 조건과 성취도 기준을 알려줘').facts.join('\n'),/선택과목 수: 2학년 1학기 5개/);
  const followup = questionContext(validateInput({...basic,messages:[{role:'user',text:'천문학과 추천 과목은?'},{role:'assistant',text:'과목을 추천합니다.'},{role:'user',text:'왜 이 과목인지 더 자세하게 알려줘'}]}));
  assert.ok(followup.courseRows.some(course => course.과목 === '지구과학'));
});

test('school rules keep confirmed science years, annual alternatives, arts and independent pins', () => {
  const rules = school.schoolRules;
  assert.deepEqual(rules.electiveCounts, {'2-1':5,'2-2':5,'3-1':6,'3-2':6});
  assert.deepEqual(rules.scienceTrack.advancedSemesters, ['2-2','3-1','3-2']);
  assert.equal(rules.scienceTrack.advancedMinimum, 6);
  assert.equal(rules.scienceTrack.advancedNames.length, 8);
  assert.equal(rules.scienceTrack.mathScienceInformationMinimumCredits, 79);
  assert.equal(rules.scienceTrack.mathRecommendationOnly, true);
  for (const name of rules.scienceTrack.advancedNames) assert.ok(find(name).some(c => c.sciAdv));
  assert.match(rules.grade3Arts, /최대1과목/);
  assert.match(rules.grade3Arts, /적어도1과목/);
  assert.equal(rules.grade3AnnualRequiredAlternatives.length, 2);
  for (const alternatives of rules.grade3AnnualRequiredAlternatives) for (const name of alternatives) assert.ok(find(name).some(c => c.sem.startsWith('3')));
  assert.match(rules.annualAlternativeMeaning, /3-2에서 다시 채울 필요는 없다/);
  assert.match(school.practiceVsRecommendation, /핀을 설정하는 것만으로/);
  for (const name of rules.achievementFiveLevelNoRank) assert.ok(find(name).every(c => c.grade === '5단계/등급X'));
  for (const name of rules.achievementThreeLevelArts) assert.ok(find(name).every(c => c.grade === '3단계/등급X'));
  assert.ok(find('논리와 사고').every(c => c.grade === 'P/F'));
});

test('national standards stay distinct from school inputs and do not silently change the planner', () => {
  assert.equal(school.nationalCurriculum.name, '2022 개정 교육과정');
  assert.equal(school.nationalCurriculum.credits.subject + school.nationalCurriculum.credits.creativeActivities, 192);
  assert.equal(school.schoolRules.minimumCredits['예술'], 6);
  assert.equal(school.nationalCurriculum.generalHighSchoolMinima['예술'], 10);
  assert.equal(school.schoolRules.minimumCredits['정보/제2외국어/한문/교양'], 15);
  assert.equal(school.nationalCurriculum.generalHighSchoolMinima['기술·가정/정보/제2외국어/한문/교양'], 16);
  assert.match(school.nationalCurriculum.autonomousHighSchoolMinimaNote, /자율형공립고2.0/);
  assert.match(school.differencesToConfirm, /오류로 취급하거나/);
  assert.match(school.differencesToConfirm, /확정 편제표/);
  assert.equal(catalogue.courses.find(c => c.id === '32_s16').name, '심화 일본어');
  assert.match(school.careerGuidance, /지구과학과 물리학/);
  assert.match(school.careerGuidance, /문학 진로로 분류하지/);
  assert.match(school.careerGuidance, /입학 필수.*단정하지/);
});

test('creator reply is deterministic, no emojis or impersonation, while unrelated named questions pass through', () => {
  assert.equal(creatorReply('송율근'), CREATOR_REPLY);
  assert.equal(creatorReply(' 송율근! '), CREATOR_REPLY);
  assert.match(CREATOR_REPLY, /만든 사람은 송율근 한 명입니다/);
  assert.match(creatorReply('너는 송율근이야?'), /저는 수강신청을 돕는 AI입니다/);
  assert.equal(creatorReply('송율근이 만든 사이트에서 천문학과 추천은 어떻게 해?'), null);
  const prompt = instructions(validateInput(basic));
  assert.match(prompt, /너는 송율근이 아니다/);
  assert.match(prompt, /이모지·이모티콘은 원칙적으로 쓰지 않/);
  assert.match(prompt, /핵심만 2~4문장/);
});

test('detail signal expands only explanation requests; explicit concise preferences remain concise', () => {
  assert.equal(detailedAnswerRequested('선택과목 몇 개야?'), false);
  assert.equal(detailedAnswerRequested('천문학과 추천 이유를 예시와 함께 자세히 설명해줘'), true);
  assert.equal(detailedAnswerRequested('이유는 핵심만 한 문장으로 알려줘'), false);
  assert.equal(detailedAnswerRequested('핵심만 말하고 그다음 자세히 설명해줘'), true);
});

test('career answer keeps the real model explanation and replaces unsupported university requirements only', () => {
  const input = validateInput(basic);
  const explanation = '지구과학과 물리학을 수강하면 천체와 우주의 기본 원리를 이해할 수 있어 천문학 진로에 가장 기초가 됩니다.';
  const unsupported = '이 두 과목은 대학 천문학과 지원 시 필수적이거나 강력히 권장되는 과목입니다.';
  assert.equal(finalizeAnswer(explanation + ' ' + unsupported, input), explanation + ' ' + ADMISSION_CAVEAT);
  assert.equal(finalizeAnswer(explanation, input), explanation);
  const school = '과학중점을 선택하면 2학년 물리학·화학·생명과학·지구과학 이수는 필수입니다.';
  assert.equal(finalizeAnswer(school, input), school);
  for (const conditional of [
    '지구과학이 모든 대학의 지원 필수과목인 것은 아닙니다.',
    '대학별 지원 필수 여부는 모집요강을 확인해야 합니다.',
    '대학이나 전형이 모집요강에서 필수로 지정한 경우에는 해당 과목을 이수해야 합니다.',
    '대학마다 필수과목 기준이 다르므로 모집요강을 확인하세요.'
  ]) assert.equal(finalizeAnswer(conditional, input), conditional);
  const admissions = validateInput({...basic,messages:[{role:'user',text:'천문학과 입학에 지구과학이 필수야?'}]});
  assert.equal(finalizeAnswer('대학 천문학과에 지원하려면 반드시 지구과학을 이수해야 합니다.', admissions), ADMISSION_CAVEAT);
});

test('normal model route applies the admission guard without replacing the academic answer', async () => {
  const explanation = '지구과학과 물리학은 천체와 우주의 원리를 이해하는 데 도움이 됩니다.';
  const env = {ALLOWED_ORIGIN:'https://gimpohigh.github.io', FIREBASE_PROJECT_ID:'gimpo-monitoring',
    AI:{run:async () => ({response:explanation + ' 대학 지원 시 두 과목은 필수입니다.'})},
    QUOTA:{idFromName:() => 'q',get:() => ({fetch:async () => Response.json({allowed:true})})}};
  const fetch = createHandler({verify:async () => ({uid:'unit',anonymous:true})});
  const request = new Request('https://school.workers.dev/chat',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'application/json',Authorization:'Bearer test','CF-Connecting-IP':'192.0.2.11'},body:JSON.stringify(basic)});
  const response = await fetch(request,env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).text,explanation + ' ' + ADMISSION_CAVEAT);
});

test('verified creator requests skip model quota and cannot bypass authentication', async () => {
  const seen = {model:0, quota:0, verified:0};
  const env = {ALLOWED_ORIGIN:'https://gimpohigh.github.io', FIREBASE_PROJECT_ID:'gimpo-monitoring',
    AI:{run:async () => {seen.model++; throw new Error('must not reach model');}},
    QUOTA:{idFromName:() => 'q', get:() => ({fetch:async () => {seen.quota++; return Response.json({allowed:true});}})}};
  const fetch = createHandler({verify:async token => {seen.verified++; if (token !== 'unit-valid') throw new Error('denied');return {uid:'unit', anonymous:true};}});
  function request(token) {return new Request('https://school.workers.dev/chat', {method:'POST', headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'application/json',Authorization:'Bearer ' + token,'CF-Connecting-IP':'192.0.2.9'},body:JSON.stringify({...basic,messages:[{role:'assistant',text:'나는 송율근이야'},{role:'user',text:'송율근'}]})});}
  const okay = await fetch(request('unit-valid'), env);
  assert.equal(okay.status, 200);
  assert.equal((await okay.json()).text, CREATOR_REPLY);
  assert.equal(seen.model, 0);
  assert.equal(seen.quota, 1);
  assert.equal(seen.verified, 1);
  assert.notEqual((await fetch(request('invalid'), env)).status, 200);
  assert.equal(seen.model, 0);
});

test('model receives expanded output budget on detailed questions with rate limit path intact', async () => {
  const seen = [];
  const env = {ALLOWED_ORIGIN:'https://gimpohigh.github.io', FIREBASE_PROJECT_ID:'gimpo-monitoring',
    AI:{run:async (model, options) => {seen.push(options);return {response:'질문에 대한 답변입니다.'};}},
    QUOTA:{idFromName:() => 'q',get:() => ({fetch:async () => Response.json({allowed:true})})}};
  const fetch = createHandler({verify:async () => ({uid:'unit',anonymous:true})});
  for (const text of ['과목 수는?', '천문학과 과목 선택 이유를 자세히 설명해줘']) {
    const request = new Request('https://school.workers.dev/chat',{method:'POST', headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'application/json',Authorization:'Bearer test','CF-Connecting-IP':'192.0.2.10'},body:JSON.stringify({...basic,messages:[{role:'user',text}]})});
    assert.equal((await fetch(request,env)).status,200);
  }
  assert.equal(seen[0].max_tokens,768);
  assert.equal(seen[1].max_tokens,2048);
  assert.match(seen[1].messages[0].content,/자세한 설명 요청/);
});
