import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { electionConfig2026 } from './2026-election-config.mjs';
import { importedQuestionId } from './2026-poll-audit.mjs';

const snapshot = JSON.parse(await readFile('source-data/2026-poll-index.json', 'utf8'));
const primaryChecks = JSON.parse(await readFile('source-data/2026-primary-checks.json', 'utf8'));
const zhubei = JSON.parse(await readFile('source-data/2026-zhubei-primary.json', 'utf8'));
const supplement = JSON.parse(await readFile('source-data/2026-poll-supplement.json', 'utf8'));
const checkedAt = snapshot.collectedAt.slice(0, 10);
const date = text => {
  const match = text?.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
};
const known = value => value && !/未載|未揭|依過往|依委託|先標記|未明/.test(value) ? value : null;
const number = text => text ? Number(text.replaceAll(',', '')) : null;
const response = (label, supplement = false) => /未表態|未決定|不投票|不支持|拒答|其他|不知道|無意見|無法選出/.test(label) || supplement && /未明確|沒意見|無明確意見/.test(label);
const isVoting = question => question.type === 'voting_intention' || question.label.startsWith('投票意向');
const polls = [], contexts = [], contests = [];
for (const [city, config] of Object.entries(electionConfig2026)) {
  const { region, pair: [first, second] } = config;
  const leads = [...snapshot.records, ...zhubei.records, ...supplement.records].filter(row => row.city === city);
  const candidateNames = [...new Set([first, second, ...leads.flatMap(row => row.questions.filter(isVoting).flatMap(q => q.responses.filter(r => !response(r.label, row.supplement)).map(r => r.label)))])];
  contests.push({ id: `2026-${city}`, title: `2026年${region}長選舉`, phase: 'pre_result', election_date: '2026-11-28', geography: region,
    office: config.office, official_status: 'results_pending', valid_votes: null, selected_candidates: [first, second], selected_candidate_votes: null,
    candidates: candidateNames.map(name => ({ name, party: config.parties[name] ?? null, votes: null, elected: null, ballot_number: null,
      ...(config.baseline ? {} : { party_source: config.parties[name] == null ? null : { url: config.sourceUrl ?? `https://poll-tw.com/${city}`, locator: config.partyLocator ?? (city === 'zhubei' ? 'Q2候選人姓名與政黨提示；未明黨籍保留null' : '參選人及其他登記參選人區塊'), evidence_level: config.partyEvidenceLevel ?? (city === 'zhubei' ? 'primary_questionnaire' : 'secondary_index'), checked_at: checkedAt } }) })),
    sources: [{ title: '中選會：115年地方公職人員選舉工作進行程序表', url: 'https://web.cec.gov.tw/api/file/2ecc9288-48df-44b1-8dbd-d0a263763fd0.pdf', kind: 'official_election_schedule', checked_at: checkedAt, evidence_summary: '投票日為2026年11月28日；此連結不是選舉結果或完整候選人名冊。' }],
    official_browser_url: null, priority_poll_scope: true, verified_poll_count: 0, notes: [],
    candidate_list_note: '候選名單為本批支持度題目所出現的人名，不宣稱完整官方登記名冊；主要比較集合固定列明。',
  });
  for (const lead of leads) {
    const leadCheckedAt = (lead.collectedAt ?? snapshot.collectedAt).slice(0, 10);
    const fromPrimary = lead.sourceType === 'primary_report';
    const m = lead.metadata;
    const dates = m['調查期間']?.split(/[–—～~至]/).map(value => value.trim()) || [];
    const start = date(dates[0]);
    const endText = dates[1] ? (/^\d{4}\//.test(dates[1]) ? dates[1] : `${dates[0].slice(0,4)}/${dates[1]}`) : null;
    const end = date(endText);
    const brand = known(m['發布單位']) || known(m['委託單位']) || lead.executorLabel;
    const indexSource = fromPrimary
      ? { title: lead.sources[0].title, url: lead.indexUrl, kind: 'primary_report', checked_at: leadCheckedAt, access_method: 'public_html_and_questionnaire_image_read', locator: 'Q2與調查說明', evidence_summary: '由原發布者同波問卷方法頁及結果頁轉錄；同波兩頁不重複計筆。' }
      : { title: `2026民調觀測站：${region}逐筆調查索引`, url: lead.indexUrl, kind: 'secondary_table_index', checked_at: leadCheckedAt, access_method: 'public_html_structured_questions', evidence_summary: '從二手索引逐題轉錄；原始問卷措辭、候選名單完整性與各欄尚未逐筆核實，不代表一手報告已核對。' };
    if (lead.supplement) Object.assign(indexSource, { title: lead.sources[0].title, kind: lead.sourceType,
      access_method: lead.accessMethod, locator: lead.locator, evidence_summary: lead.sourceSummary });
    const sources = [indexSource, ...lead.sources.filter(source => source.url !== lead.indexUrl).map(source => ({ ...source, kind: fromPrimary ? 'primary_questionnaire' : 'original_link_from_secondary_index', access_method: fromPrimary ? 'public_html_methodology_read' : 'not_independently_checked', checked_at: fromPrimary ? leadCheckedAt : null, evidence_summary: fromPrimary ? '原發布者同波問卷與方法；不是第二波。' : '索引所列外部連結；本次匯入未據此判定原文可讀或欄位已核實。' }))];
    const sampleText = m['樣本數'] || '';
    const sample = number(sampleText.match(/有效樣本\s*([\d,]+)\s*人/)?.[1]);
    for (const [questionIndex, question] of lead.questions.entries()) {
      const voting = isVoting(question);
      const support = Object.fromEntries(question.responses.filter(r => !response(r.label, lead.supplement)).map(r => [r.label, r.percent]));
      const undecided = question.responses.filter(r => /^(未表態|未決定|不知道|無意見|無法選出任一候選人)$/.test(r.label) || lead.supplement && /^(未明確回答|沒意見|無明確意見|無法選出任何一位候選人)$/.test(r.label));
      const otherResponses = Object.fromEntries(question.responses.filter(r => response(r.label, lead.supplement) && !undecided.includes(r)).map(r => [r.label, r.percent]));
      const id = importedQuestionId(lead, question, questionIndex);
      const notes = [fromPrimary ? '數值由原發布者同波方法頁與結果頁轉錄；分項來源與核對限制另列。' : '數值與方法均由二手索引轉錄，尚未完成一手核心欄位核實。', fromPrimary ? (question.note ?? '原發布者題意分類；原題全文尚待核實。') : '原題全文未核實；題目欄保留索引的題意分類。', m['調查期間'] && `${fromPrimary ? '原報告' : '索引'}調查期間：${m['調查期間']}`, `${fromPrimary ? '原報告' : '索引'}樣本說明：${sampleText}`, m['經費來源'] && !known(m['經費來源']) && `索引經費註記含推論，不作已知出資者：${m['經費來源']}`].filter(Boolean);
      const common = { id, contest_id: `2026-${city}`, brand, executor: known(m['負責調查單位']), commissioner: known(m['委託單位']), funder: known(m['經費來源']), design_and_analysis: known(m['主持人']),
        comparison_unit_id: `pre2026__${createHash('sha256').update(`${brand}|${lead.executorLabel}`).digest('hex').slice(0,12)}`,
        fieldwork_start: start, fieldwork_end: end, publication_date: date(m['發布日期']), date_timezone: 'Asia/Taipei',
        question: question.label, question_candidate_set: voting ? Object.keys(support) : null,
        ...(fromPrimary ? { original_question: question.originalQuestion ?? (voting ? question.label : null), original_option_labels: question.originalOptionLabels ?? question.responses.map(item => item.label), question_source_url: question.excerptSourceUrl, question_scenario: voting ? '四人互比；隨機順序提示候選人姓名及黨籍' : null } : {}),
        sample_size_total: sample, sample_size_support_question: question.sampleSizeSupportQuestion ?? number(question.label.match(/（([\d,]+)\s*人）/)?.[1]),
        population: known(m['母體']), mode: known(m['訪問方式']), sampling_frame: known(m['抽樣說明']), weighting: known(m['加權方式']),
        reported_margin_of_error_pp: number(m['抽樣誤差']?.match(/±\s*([\d.]+)/)?.[1]), reported_confidence_level: m['抽樣誤差']?.includes('95%') ? 0.95 : null,
        support_denominator: question.denominator ?? (question.label.includes('作答對象') ? question.label : null),
        raw_means: fromPrimary ? '原發布者刊載加權後百分比；不補足缺失選項或調整四捨五入合計。' : '索引刊載原始百分比；不補足缺失選項或調整四捨五入合計。',
        product_type: voting ? 'voting_intention_poll' : 'non_voting_question', candidate_set: [first, second],
        raw_support_percent: voting ? support : {}, responses: question.responses,
        undecided_percent: undecided.length ? undecided.reduce((sum, r) => sum + r.percent, 0) : null,
        other_percent: Object.keys(otherResponses).length ? Object.values(otherResponses).reduce((sum, value) => sum + value, 0) : null, other_responses: otherResponses,
        verification_status: 'indexed_secondary', aggregate_source_eligible: false, explicit_final_poll_label: false, latest_available_guaranteed: false,
        sources, notes, calculation: null, primary_mae_pp: null, default_aggregate_eligible: false,
        historical_import: { index_date: null, date_text: m['調查期間'], question: question.label, candidate_context: null },
        verification_review: { status: 'partial', checkedAt: leadCheckedAt, verifiedFields: [], missingFields: ['primaryPublisherFulltext', 'originalQuestion', 'completeCandidateScenario'], reason: fromPrimary ? '原發布者結果與方法已讀；所有題目原圖及情境尚未逐項核全，維持待核實。' : '二手索引轉錄，逐欄一手核實未完成。', fieldEvidence: Object.fromEntries(['shares', 'candidateSet', 'fieldworkStart', 'fieldworkEnd', 'publishedAt', 'sampleSize', 'executor', 'method'].map(field => [field, { url: lead.indexUrl, locator: `${lead.id}／${question.label}`, evidenceLevel: fromPrimary ? 'primary_partial' : 'secondary_index' }])) },
      };
      if (lead.supplement) {
        common.notes = [lead.sourceSummary, question.note, m['樣本數'] && `樣本說明：${m['樣本數']}`, lead.publicationNote].filter(Boolean);
        common.raw_means = '來源刊載的加權後原始百分比；保留原選項及分母，四捨五入合計不調整。';
        Object.assign(common, { original_question: question.originalQuestion ?? null,
          original_option_labels: question.originalOptionLabels ?? question.responses.map(item => item.label),
          question_source_url: question.excerptSourceUrl, question_scenario: question.scenario ?? null });
        common.verification_review = { status: 'partial', checkedAt: leadCheckedAt,
          verifiedFields: lead.checkedFields, missingFields: ['completeOriginalQuestionnaire', 'independentFieldReview'],
          reason: '已核對所列公開來源及題目；未完成全部核心欄位與完整原始問卷的獨立核實，維持待核實。',
          fieldEvidence: Object.fromEntries(lead.checkedFields.map(field => [field, { url: lead.indexUrl,
            locator: question.locator ?? lead.locator, evidenceLevel: fromPrimary ? 'primary_partial' : 'secondary_report' }])) };
      }
      const check = voting && primaryChecks.records.find(record => record.pollId === id);
      if (check) {
        common.notes.push(check.note);
        common.verification_review.verifiedFields = check.fields;
        common.verification_review.missingFields = common.verification_review.missingFields.filter(field => !check.fields.includes(field));
        for (const field of check.fields) common.verification_review.fieldEvidence[field] = check.fieldEvidence?.[field] ?? { url: check.url, locator: check.locator, evidenceLevel: check.evidenceLevel ?? 'primary_partial' };
        const source = common.sources.find(source => source.url === check.url);
        if (source) Object.assign(source, { kind: check.kind ?? 'primary_report', access_method: check.accessMethod ?? 'public_pdf_selected_fields_read', checked_at: check.checkedAt ?? primaryChecks.checkedAt, evidence_summary: check.note, locator: check.locator });
      }
      if (voting) for (const attempt of primaryChecks.accessAttempts ?? []) {
        if (attempt.pollId !== id) continue;
        const source = common.sources.find(source => source.url === attempt.url);
        if (source && !common.verification_review.verifiedFields.length) Object.assign(source, { access_method: attempt.accessMethod, checked_at: attempt.checkedAt, locator: attempt.locator, evidence_summary: attempt.note });
        common.notes.push(attempt.note);
      }
      const observation = voting && primaryChecks.publicationDateObservations.find(record => record.pollId === id);
      if (observation) {
        const note = `發布日期待釐清：二手索引列${observation.indexDate}，原發布者索引列${observation.observedDate}；保留兩項觀察，未裁定原始發布時間。`;
        common.notes.push(note);
        common.verification_review.publicationDateConflict = observation;
        common.sources.push({ title: 'TVBS民調中心原發布索引', url: observation.url, kind: 'primary_publication_index', checked_at: primaryChecks.checkedAt, access_method: 'public_index_read', locator: observation.locator, evidence_summary: note });
      }
      if (voting && !question.catalogueOnly && [first, second].every(name => Number.isFinite(support[name]))) polls.push(common);
      else contexts.push({ ...common, electionId: common.contest_id, fieldworkStart: start, fieldworkEnd: end, publishedAt: common.publication_date,
        shares: Object.fromEntries(question.responses.map(item => [item.label, item.percent])), questionCandidateSet: common.question_candidate_set,
        status: 'pending', officialScoreEligible: false, reason: question.catalogueReason ?? (voting ? '候選情境與主要集合不同' : '非投票意向題；不納入候選人支持度主表。'),
        candidateContext: question.catalogueReason ?? (voting ? '候選情境與主要集合不同' : '非投票意向題'), disposition: 'historical_context', rawSupportPercent: support });
    }
  }
}
const recordIds = new Set();
for (const row of [...polls, ...contexts]) {
  if (recordIds.has(row.id)) throw new Error(`Duplicate imported question: ${row.id}`);
  recordIds.add(row.id);
}
const files = (await readdir('source-data/parts')).filter(name => /^\d{2}\.json$/.test(name)).sort();
// Parts 20–22 are owned by this importer; refuse to overwrite an unrelated part.
for (const [offset, type, rows] of [[20, 'contests', contests], [21, 'polls', polls], [22, 'historical_contexts', contexts]]) {
  const name = `${String(offset).padStart(2, '0')}.json`;
  if (files.includes(name)) {
    const previous = JSON.parse(await readFile(`source-data/parts/${name}`, 'utf8'));
    if (previous.importer !== '2026-six-cities') throw new Error(`Unrelated source part: ${name}`);
  }
  await writeFile(`source-data/parts/${name}`, JSON.stringify({ part_type: type, importer: '2026-six-cities', data: rows }, null, 2) + '\n');
}
const metadata = JSON.parse(await readFile('source-data/parts/01.json', 'utf8'));
const base = { contests: [], polls: [], historical_contexts: [] };
for (const name of files.filter(name => !['01.json', '20.json', '21.json', '22.json'].includes(name))) {
  const part = JSON.parse(await readFile(`source-data/parts/${name}`, 'utf8'));
  if (base[part.part_type]) base[part.part_type].push(...part.data);
}
metadata.data.title = '台灣選情劉伯溫：選前支持度與歷史民調資料';
metadata.data.schema_version = '1.5.0'; metadata.data.verified_at = checkedAt;
Object.assign(metadata.data.scope, { total_contests: base.contests.length + contests.length, pre_result_contests: contests.length,
  total_poll_records: base.polls.length + polls.length, indexed_poll_records: base.polls.filter(p => p.verification_status === 'indexed_secondary').length + polls.length,
  poll_contests_with_records: new Set([...base.polls, ...polls].map(p => p.contest_id)).size,
  historical_candidate_context_records: base.historical_contexts.length + contexts.length,
  pre_result_collection: { checked_at: checkedAt, index_leads: snapshot.records.length, direct_primary_waves: zhubei.records.length + supplement.records.filter(row => row.sourceType === 'primary_report').length, voting_intention_records: polls.length, other_question_records: contexts.length, primary_verified: 0, primary_partially_checked: primaryChecks.records.filter(record => record.evidenceLevel !== 'secondary_report').length + supplement.records.filter(row => row.sourceType === 'primary_report').length, secondary_report_partially_checked: primaryChecks.records.filter(record => record.evidenceLevel === 'secondary_report').length + supplement.records.filter(row => row.sourceType === 'secondary_report').length, original_source_access_limited: primaryChecks.accessAttempts?.length ?? 0, publication_date_discrepancies: primaryChecks.publicationDateObservations.length + supplement.records.filter(row => row.publicationNote).length, coverage: `從poll-tw首頁發現22縣市，公開${snapshot.records.length}波逐題比對；另保留美麗島竹北1波及獨立回源補充${supplement.records.length}波。僅標示份數的隱藏紀錄不能與獨立來源確認為同一波；這不是完整2026民調清冊，所有新增紀錄維持待核實。` },
  coverage_statement: `中選會已核實結果${base.contests.length}場；另收錄2026年${contests.length}場選前民調${polls.length}筆及其他題目${contexts.length}筆，均維持待核實狀態並分列一手核對範圍。歷史民調與官方計算資格不變。`,
});
await writeFile('source-data/parts/01.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ contests: contests.length, polls: polls.length, otherQuestions: contexts.length, missingDates: polls.filter(p => !p.fieldwork_end).map(p => p.id) }));
