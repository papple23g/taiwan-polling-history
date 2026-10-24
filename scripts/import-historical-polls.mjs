import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { adaptVerifiedData } from './import-verified-data.mjs';
import { calculatePollError, commonElectionComparison } from '../src/domain.mjs';

const day = 86_400_000;
const aliases = { '吳萼洋': '吳蕚洋' };
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const unique = values => [...new Set(values)];
const votingProduct = record => ['rolling_three_day_sample', 'weekly_combined_sample'].includes(record.productType)
  ? 'voting_intention_poll' : record.productType ?? 'voting_intention_poll';
const number = value => typeof value === 'number' && Number.isFinite(value);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const daysBefore = (end, election) => date(end) ? (Date.parse(election) - Date.parse(end)) / day : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const publicUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};
const identities = [
  [/^TVBS$/, /TVBS/, 'TVBS民意調查中心', 'tvbs__tvbs-poll-center'],
  [/美麗島/, /畢肯/, '畢肯市場研究股份有限公司', 'formosa__beacon'],
  [/ETtoday/, /ETtoday/, 'ETtoday民調雲', 'ettoday__ettoday-poll-cloud'],
];
const evidenceDescription = tier => ({
  primary_fulltext: '已讀原發布者全文；尚未核實的欄位保持空值，是否可比較另依核心欄位判定。',
  news_fulltext: '已讀新聞全文；尚未全面核對原發布者報告，不自動取得正式評分資格。',
  secondary_index: '依二手表格保存的歷史線索；原始連結及各欄尚待獨立核對。',
  search_excerpt_only: '僅取得搜尋摘要，未讀到原始全文；數值及日期均仍待核實。',
}[tier] ?? '來源與欄位尚待核實。');

export function sourcesFor(record, checkedAt) {
  const sources = (record.supplementalSources ?? []).map(source => ({
    title: source.title, url: source.url, kind: source.kind,
    access_method: /image_read|full_public_image/.test(source.readStatus ?? '') ? 'full_public_image'
      : /fulltext|full_public|full_html|relevant_fields/.test(source.readStatus ?? '') ? 'full_public_text'
      : /excerpt/.test(source.readStatus ?? '') ? 'search_index_excerpt_only' : 'not_independently_checked',
    checked_at: /fulltext|full_public|full_html|relevant_fields|image_read|excerpt/.test(source.readStatus ?? '') ? checkedAt : null,
    evidence_summary: source.evidenceSummary ?? null,
    ...(source.independenceGroup ? { independence_group: source.independenceGroup } : {}),
  }));
  const originalWasRead = !record.verificationReview && ['primary_fulltext', 'news_fulltext'].includes(record.evidenceTier);
  sources.push({
    title: `${record.brand} ${record.electionLabel ?? record.electionId}：${record.dateText ?? '民調來源'}`,
    url: record.sourceUrl,
    kind: originalWasRead && record.evidenceTier === 'primary_fulltext' ? 'primary_publisher_report'
      : originalWasRead && record.evidenceTier === 'news_fulltext' ? 'secondary_news_report' : 'original_link_from_secondary_index',
    access_method: originalWasRead ? 'full_public_text'
      : record.evidenceTier === 'search_excerpt_only' ? 'search_index_excerpt_only' : 'not_independently_checked',
    checked_at: originalWasRead || record.evidenceTier === 'search_excerpt_only' ? checkedAt : null,
    evidence_summary: originalWasRead ? evidenceDescription(record.evidenceTier) : '索引原始連結；實際已讀原文、存檔或替代網址另列，不能由替代來源可讀推定本址可讀。',
  });
  if (record.indexUrl) sources.push({ title: '維基百科歷史民調表（發現索引）', url: record.indexUrl,
    kind: 'secondary_table_index', access_method: 'complete_public_table_index', checked_at: checkedAt,
    evidence_summary: '保存原表參考連結與數值；二手索引不代表一手核實。' });
  for (const url of unique([record.originalIndexSourceUrl, record.indexedSourceUrl, record.originalIndexSourceUrl].filter(Boolean))) {
    sources.push({ title: '索引原始參考連結（可讀性另待核對）', url, kind: 'original_link_from_secondary_index',
      access_method: 'not_independently_checked', checked_at: null });
  }
  const seen = new Set();
  const result = sources.filter(source => publicUrl(source.url) && !seen.has(source.url) && seen.add(source.url));
  if (!result.length) throw new Error(`No public source for ${record.auditId}`);
  return result;
}

function canonicalShares(record) {
  return Object.fromEntries(Object.entries(record.shares ?? {}).map(([name, value]) => [aliases[name] ?? name, value]));
}

export function calculate(shares, selected, contest, metadata = {}) {
  const votes = Object.fromEntries(contest.candidates.map(candidate => [candidate.name, candidate.votes]));
  const arithmetic = calculatePollError({ electionId: contest.id, shares,
    candidateSet: (metadata.candidateSet ?? selected).map(name => aliases[name] ?? name),
    questionCandidateSet: metadata.questionCandidateSet?.map(name => aliases[name] ?? name),
    productType: votingProduct(metadata),
    calculationBlocker: metadata.verificationReview?.calculationBlocker ?? metadata.calculationBlocker }, {
    id: contest.id, candidates: contest.candidates.map(candidate => ({ id: candidate.name })), comparisonCandidateIds: selected,
    result: { votes, validVotes: contest.valid_votes },
  });
  const sum = selected.every(name => number(shares[name])) ? selected.reduce((sum, name) => sum + shares[name], 0) : null;
  const officialSum = selected.reduce((sum, name) => sum + votes[name], 0);
  const officialRaw = Object.fromEntries(selected.map(name => [name, votes[name] / contest.valid_votes * 100]));
  const officialNormalized = Object.fromEntries(selected.map(name => [name, votes[name] / officialSum * 100]));
  const normalized = arithmetic.pollNormalized;
  return {
    candidate_set: selected, poll_selected_support_total: sum, election_selected_votes_total: officialSum,
    raw_official_percent_same_candidates: officialRaw, normalized_poll_percent: normalized,
    normalized_official_percent: officialNormalized,
    raw_mae_pp: normalized ? selected.reduce((sum, name) => sum + Math.abs(shares[name] - officialRaw[name]), 0) / selected.length : null,
    normalized_mae_pp: arithmetic.mae,
    precision: 'full_precision_before_display_rounding', is_provisional: true,
  };
}

function identity(record, existing) {
  let executor = record.executor ?? null;
  if (/待核|未載|不明|未知/.test(executor ?? '')) executor = null;
  let unit = null;
  for (const [brandPattern, executorPattern, canonicalExecutor, id] of identities) {
    if (brandPattern.test(record.brand) && executor && executorPattern.test(executor)) { executor = canonicalExecutor; unit = id; break; }
  }
  unit ??= existing.find(poll => poll.verification_status === 'verified_primary' && !poll.verification_review
    && poll.brand === record.brand && poll.executor === executor)?.comparison_unit_id
    ?? `history__${hash(JSON.stringify([record.brand, executor]))}`;
  return { executor, unit };
}

const coreFields = ['shares', 'fieldworkEnd', 'publishedAt', 'executor', 'sampleSize', 'method'];
export function verificationProblems(record, contest, sources) {
  const problems = [];
  if (record.proposedVerification !== 'verified_primary') problems.push('未提議一手核實');
  if (record.evidenceTier !== 'primary_fulltext') problems.push('尚未核對一手全文');
  for (const key of coreFields) if (!record.fieldEvidence?.[key]?.url) problems.push(`缺少${key}逐欄依據`);
  if (!date(record.fieldworkEnd) || !date(record.publishedAt) || record.fieldworkEnd >= contest.election_date
    || record.publishedAt >= contest.election_date || record.publishedAt < record.fieldworkEnd) problems.push('調查／選前發布日未對齊');
  if (!record.executor || /待核|未載|未知/.test(record.executor)) problems.push('執行者未核實');
  if (!Number.isInteger(record.sampleSize) || record.sampleSize <= 0 || !record.method) problems.push('樣本／方法未核實');
  if (contest.selected_candidates.some(name => !number(canonicalShares(record)[name]))) problems.push('主要支持度不完整');
  const total = Object.values(canonicalShares(record)).filter(number).reduce((sum, value) => sum + value, 0) + (record.undecided ?? 0) + (record.other ?? 0);
  if (total > 100.5) problems.push(`來源報告合計${Number(total.toFixed(4))}%超過100.5%容差，保留原值待核`);
  if (record.sourceConflicts?.length && !record.conflictsResolved) problems.push('來源衝突仍未裁定');
  if (calculate(canonicalShares(record), contest.selected_candidates, contest, record).normalized_mae_pp === null) problems.push('比較候選組合或支持度輸入無法裁定');
  if (!sources.some(source => /^(?:primary_|archived_primary_)/.test(source.kind ?? '') && ['full_public_text', 'full_public_image'].includes(source.access_method))) problems.push('缺少一手全文來源');
  if (record.verificationReview?.status === 'primary_verified' && record.verificationReview.independentReview?.status !== 'approved') problems.push('本輪一手核實尚未完成獨立覆核');
  return problems;
}

const mapFields = {
  fieldworkStart: 'fieldwork_start', fieldworkEnd: 'fieldwork_end', publishedAt: 'publication_date',
  sampleSize: 'sample_size_total', sampleSizeSupportQuestion: 'sample_size_support_question', surveyTotalSampleSize: 'survey_total_sample_size',
  method: 'mode', population: 'population', samplingFrame: 'sampling_frame', weighting: 'weighting',
  reportedMarginOfError: 'reported_margin_of_error_pp', reportedConfidenceLevel: 'reported_confidence_level',
  supportDenominator: 'support_denominator', commissioner: 'commissioner', funder: 'funder', designAndAnalysis: 'design_and_analysis',
  undecided: 'undecided_percent', other: 'other_percent',
  otherResponses: 'other_responses', question: 'question', questionCandidateSet: 'question_candidate_set',
};
function fieldEvidence(record) {
  // Keep public locators and concise field notes; private working documents stay out.
  return Object.fromEntries(Object.entries(record.fieldEvidence ?? {}).filter(([, value]) => publicUrl(value?.url))
    .map(([field, value]) => [field, { url: value.url, ...(value.locator ? { locator: value.locator } : {}),
      ...(value.checkedAt ? { checkedAt: value.checkedAt } : {}), ...(value.note ? { note: value.note } : {}) }]));
}
function historyEvidence(record, sources, reason, disposition) {
  return {
    id: record.publicRecordId ?? record.auditId, auditId: record.auditId, electionId: record.electionId, brand: record.brand, executor: record.executor ?? null,
    candidateSet: record.candidateSet, shares: record.shares, undecided: record.undecided ?? null, other: record.other ?? null,
    productType: record.productType ?? 'voting_intention_poll',
    fieldworkStart: record.fieldworkStart, fieldworkEnd: record.fieldworkEnd, publishedAt: record.publishedAt,
    indexDate: record.indexDate ?? null, dateText: record.dateText, sampleSize: record.sampleSize,
    method: record.method, question: record.question ?? null, questionCandidateSet: record.questionCandidateSet ?? null,
    sampleSizeSupportQuestion: record.sampleSizeSupportQuestion ?? null,
    surveyTotalSampleSize: record.surveyTotalSampleSize ?? null, supportDenominator: record.supportDenominator ?? null,
    population: record.population ?? null, samplingFrame: record.samplingFrame ?? null,
    weighting: record.weighting ?? null, commissioner: record.commissioner ?? null,
    funder: record.funder ?? null, designAndAnalysis: record.designAndAnalysis ?? null,
    otherResponses: record.otherResponses ?? null,
    context: record.context ?? record.section ?? null,
    evidenceTier: record.evidenceTier, disposition, reason, sources,
    status: 'pending', officialScoreEligible: false, fieldEvidence: fieldEvidence(record),
    verificationReview: record.verificationReview ?? null,
    originalObservations: record.indexedObservations ?? null,
  };
}

export function buildHistoricalImport(baseParts, input) {
  const parts = structuredClone(baseParts);
  const metadata = parts[0].data;
  const contests = parts.filter(part => part.part_type === 'contests').flatMap(part => part.data);
  const existing = parts.filter(part => part.part_type === 'polls').flatMap(part => part.data);
  const existingById = new Map(existing.map(poll => [poll.id, poll]));
  const imported = [], contexts = [], held = [], accounting = [], promotionsRejected = [];
  const checkedAt = input.checked_at;
  for (const record of input.records) {
    if (record.disposition === 'excluded' && record.decision !== 'context_only' && !record.verificationReview) { accounting.push({ auditId: record.auditId, result: 'excluded', reason: record.reason ?? '原盤點已排除' }); continue; }
    const contest = contests.find(contest => contest.id === record.electionId);
    if (!contest) throw new Error(`Unknown election ${record.electionId}`);
    const sources = sourcesFor(record, checkedAt);
    const contextOnly = record.decision === 'context_only' || votingProduct(record) !== 'voting_intention_poll';
    if (record.disposition === 'existing_record' && contextOnly) {
      const ids = record.matchedExistingIds ?? [];
      for (const part of parts.filter(part => part.part_type === 'polls')) part.data = part.data.filter(poll => !ids.includes(poll.id));
      for (const id of ids) existingById.delete(id);
      contexts.push(historyEvidence(record, sources, record.reason ?? '完整題目與正式候選集合不同，保留原始情境。', 'historical_candidate_context'));
      accounting.push({ auditId: record.auditId, result: 'context', ids });
      continue;
    }
    if (record.disposition === 'existing_record') {
      for (const id of record.matchedExistingIds) {
        const poll = existingById.get(id);
        if (!poll) throw new Error(`Unknown existing poll ${id}`);
        if (record.verificationReview) poll.verification_review = record.verificationReview;
        if (!record.hasEnrichment) continue;
        const previousStatus = poll.source_enrichment?.previous_verification_status ?? poll.verification_status;
        if (poll.verification_status !== 'verified_primary' && record.enrichedFields?.brand) poll.brand = record.brand;
        if (poll.verification_status !== 'verified_primary' && record.enrichedFields?.executor) {
          const identified = identity(record, existing);
          poll.executor = identified.executor;
          poll.comparison_unit_id = identified.unit;
        }
        for (const [field, target] of Object.entries(mapFields)) {
          if (!(field in (record.enrichedFields ?? {}))) continue;
          const value = record[field];
          if (value === null || value === undefined) {
            if (value === null && poll.verification_status !== 'verified_primary') poll[target] = null;
            continue;
          }
          if (poll.verification_status === 'verified_primary' && poll[target] !== null && poll[target] !== undefined && !same(poll[target], value)) continue;
          poll[target] = field === 'questionCandidateSet' ? value.map(name => aliases[name] ?? name) : value;
        }
        if (poll.verification_status !== 'verified_primary' && record.enrichedFields?.shares) poll.raw_support_percent = canonicalShares(record);
        const promotionIssues = verificationProblems(record, contest, sources);
        if (poll.verification_status !== 'verified_primary' && !promotionIssues.length) {
          poll.verification_status = 'verified_primary'; poll.aggregate_source_eligible = true;
        }
        if (poll.verification_status !== 'verified_primary' && record.proposedVerification === 'verified_primary' && promotionIssues.length) promotionsRejected.push({ auditId: record.auditId, id, problems: promotionIssues });
        poll.sources = [...sources, ...poll.sources].filter((source, index, all) => all.findIndex(other => other.url === source.url) === index);
        poll.source_enrichment = { checked_at: checkedAt, previous_verification_status: previousStatus,
          record_id: record.auditId, evidence_tier: record.evidenceTier, field_evidence: fieldEvidence(record),
          verification_problems: poll.verification_status === 'verified_primary' ? [] : promotionIssues };
        if (previousStatus === 'indexed_secondary') {
          poll.verification_note = poll.verification_status === 'verified_primary'
            ? '本次已逐欄對照原發布者，核實主要支持度、調查結束日、選前發布日、執行者、樣本與方法。'
            : record.proposedVerification === 'verified_primary' ? promotionIssues.join('；') : evidenceDescription(record.evidenceTier);
          if (poll.verification_status === 'verified_primary') {
            poll.selection_label = '一手核心欄位已核實';
            poll.raw_means = '最初由歷史索引發現；本次主要支持度與核心調查欄位已對照原發布者。';
            poll.notes = (poll.notes ?? []).map(note => /僅依維基百科索引轉錄/.test(note)
              ? '最初由維基百科索引收錄；本次核心欄位已完成一手核實，原始索引與補查來源均保留。' : note);
          }
        }
        poll.notes = unique([...(poll.notes ?? []), ...(record.notes ?? []), '補查原文並保留逐欄來源；未核實或來源衝突欄位不補值。']);
        poll.calculation = calculate(poll.raw_support_percent, poll.candidate_set, contest, {
          candidateSet: poll.candidate_set, questionCandidateSet: poll.question_candidate_set,
          productType: poll.product_type, verificationReview: record.verificationReview,
        });
        poll.calculation.is_provisional = poll.verification_status !== 'verified_primary';
        poll.primary_mae_pp = poll.verification_status === 'verified_primary' ? poll.calculation.normalized_mae_pp : null;
      }
      accounting.push({ auditId: record.auditId, result: 'existing', ids: record.matchedExistingIds }); continue;
    }
    const shares = canonicalShares(record);
    const declaredTotal = Object.values(shares).filter(number).reduce((sum, value) => sum + value, 0)
      + (record.undecided ?? 0) + (record.other ?? 0);
    const nonfinalNames = unique([...Object.keys(shares), ...(record.candidateSet ?? []), ...(record.questionCandidateSet ?? []).map(name => aliases[name] ?? name)])
      .map(name => aliases[name] ?? name)
      .filter(name => !contest.candidates.some(candidate => candidate.name === name));
    const holdReason = !record.brand?.trim() ? '索引缺少機構名稱，原始參考連結疑似與文字拼接；保留線索待核，暫不建立比較機構。'
      : record.decision === 'hold_conflict' || record.disposition === 'unresolved' && !record.conflictsResolved ? record.reason ?? '來源／波次衝突未解' : null;
    if (holdReason) {
      held.push(historyEvidence(record, sources, holdReason, 'source_conflict'));
      accounting.push({ auditId: record.auditId, result: 'held', reason: holdReason }); continue;
    }
    const explicitImport = ['import_pending', 'import_verified'].includes(record.decision);
    if (nonfinalNames.length || contextOnly || record.disposition === 'candidate_set_review' && !explicitImport) {
      const reason = record.reason ?? (nonfinalNames.length ? `問卷包含最終名單以外人選：${nonfinalNames.join('、')}` : '原始候選情境仍須與最終選舉集合區分。');
      contexts.push(historyEvidence(record, sources, reason, 'historical_candidate_context'));
      accounting.push({ auditId: record.auditId, result: 'context', reason }); continue;
    }
    const { executor, unit } = identity(record, existing);
    const problems = verificationProblems(record, contest, sources);
    const verified = problems.length === 0;
    if (record.proposedVerification === 'verified_primary' && !verified) promotionsRejected.push({ auditId: record.auditId, problems });
    const candidateContext = !verified && (record.auditDisposition ?? record.disposition) === 'candidate_set_review' ? record.reason ?? '歷史候選情境；支持度未作正式比較。' : null;
    const calculated = calculate(shares, contest.selected_candidates, contest, record);
    calculated.is_provisional = !verified;
    const days = daysBefore(record.fieldworkEnd, contest.election_date);
    const poll = {
      id: record.publicRecordId ?? `${record.electionId}-history-${hash(record.auditId)}`, contest_id: record.electionId,
      brand: record.brand, executor, comparison_unit_id: unit,
      product_type: votingProduct(record), candidate_set: [...contest.selected_candidates],
      sampling_product_type: ['rolling_three_day_sample', 'weekly_combined_sample'].includes(record.productType) ? record.productType : null,
      raw_support_percent: shares,
      ...Object.fromEntries(Object.entries(mapFields).map(([field, target]) => [target,
        field === 'questionCandidateSet' ? record[field]?.map(name => aliases[name] ?? name) ?? null : record[field] ?? null])),
      date_timezone: 'Asia/Taipei', raw_means: evidenceDescription(record.evidenceTier),
      explicit_final_poll_label: false, selection_label: verified ? '一手核心欄位已核實' : candidateContext ? '歷史候選情境・待核實' : '歷史資料・待核實',
      latest_available_guaranteed: false, verification_status: verified ? 'verified_primary' : 'indexed_secondary',
      aggregate_source_eligible: verified, sources,
      notes: unique([evidenceDescription(record.evidenceTier), ...(record.notes ?? []), ...(candidateContext ? [candidateContext] : []),
        ...(Object.keys(record.shares).some(name => aliases[name]) ? ['來源姓名「吳萼洋」對齊官方名冊「吳蕚洋」，原始拼法保存在索引觀察。'] : []),
        ...(record.sampleSizeSupportQuestion ? ['支持度題有效樣本與全調查總樣本分欄保存。'] : []),
        ...(record.surveyTotalSampleSize ? ['跨市調查總樣本另存；不得直接當作本市有效樣本。'] : []),
        ...(record.sampleOverlapGroup || /美麗島/.test(record.brand) && /波|周|週/.test(record.dateText ?? '') ? ['滾動波次與週合併結果可能重疊樣本，不能視為獨立樣本加總。'] : []),
        ...(record.question ? [`原始題目／分類：${record.question}`] : [])]),
      verification_note: verified ? '主要支持度、調查結束日、選前發布日、執行者、樣本及方法已逐欄對照原發布者全文。' : evidenceDescription(record.evidenceTier),
      verification_review: record.verificationReview ?? null,
      days_before_election: days, published_before_election: date(record.publishedAt) ? record.publishedAt < contest.election_date : null,
      within_default_30_day_window: days === null ? null : days >= 1 && days <= 30,
      calculation: calculated, is_last_verified_eligible_in_dataset: false,
      default_aggregate_eligible: verified && days >= 1 && days <= 30,
      team_continuity_verified: false, primary_mae_pp: verified ? calculated.normalized_mae_pp : null,
      historical_import: { catalogue: input.id, record_id: record.auditId, original_classification: record.auditDisposition ?? record.disposition,
        evidence_tier: record.evidenceTier, candidate_context: candidateContext, index_date: record.indexDate ?? null,
        date_text: record.dateText, question: record.question ?? null, field_evidence: fieldEvidence(record),
        missing_fields: record.missingFields ?? [], original_candidate_names: record.candidateSet,
        indexed_observations: record.indexedObservations ?? null, source_conflicts: record.sourceConflicts ?? [] },
    };
    poll.executor = executor;
    imported.push(poll); accounting.push({ auditId: record.auditId, result: 'imported', id: poll.id, status: poll.verification_status });
  }
  const allPolls = [...existing.filter(poll => existingById.has(poll.id)), ...imported];
  if (new Set(allPolls.map(poll => poll.id)).size !== allPolls.length) throw new Error('Duplicate imported poll IDs');
  if (accounting.length !== input.records.length || new Set(accounting.map(row => row.auditId)).size !== accounting.length) throw new Error('Incomplete catalogue accounting');
  metadata.schema_version = '1.3.0'; metadata.verified_at = checkedAt;
  const verified = allPolls.filter(poll => poll.verification_status === 'verified_primary');
  const scope = metadata.scope;
  Object.assign(scope, {
    verified_poll_records: verified.length, indexed_poll_records: allPolls.length - verified.length,
    total_poll_records: allPolls.length, poll_contests_verified: new Set(verified.map(poll => poll.contest_id)).size,
    poll_contests_with_records: new Set(allPolls.map(poll => poll.contest_id)).size,
    historical_candidate_context_records: contexts.length, held_source_conflict_records: held.length,
    historical_catalogue_records_assessed: input.records.length,
    historical_imported_records: imported.length,
    verification_review_records: input.records.filter(record => record.verificationReview).length,
    verification_review_counts: Object.fromEntries(['primary_verified', 'secondary_cross_checked', 'partial', 'blocked', 'conflict'].map(status => [status, input.records.filter(record => record.verificationReview?.status === status).length])),
    coverage_statement: `中選會官方結果14場；民調收錄${allPolls.length}筆（一手核實${verified.length}、待核實${allPolls.length - verified.length}），涵蓋${new Set(allPolls.map(poll => poll.contest_id)).size}場選舉。另存${contexts.length}筆候選情境、${held.length}筆來源衝突及逐筆來源；未知欄位不補造。`,
  });
  metadata.methodology.index_source_rule = '維基、新聞全文與搜尋摘要分層保存，逐筆附原始與索引URL。候選支持度可對齊時提供試算MAE；僅核心欄位完成一手核實且符合條件者取得正式分數與跨場資格。索引日期不代填調查日，未知保持null；來源不可讀的限制逐筆保留。';
  metadata.data_changes = [{ date: checkedAt, title: input.verification_round ? '全量來源核對與 MAE 試算顯示' : '補收歷史民調與逐筆來源',
    description: input.verification_round
      ? `逐筆核對${input.verification_round.target_count}筆既有待核紀錄，保留原始ID、來源定位、更正與限制。可計算者提供試算MAE，正式分數仍須一手核心欄位核實。候選情境${contexts.length}筆、來源衝突${held.length}筆分開保存。`
      : `新增${imported.length}筆歷史民調；原發布、新聞、索引與摘要分級。另存${contexts.length}筆候選情境及${held.length}筆來源衝突，不混入正式比較。`,
    source: { title: 'TVBS官方歷史民調索引', url: 'https://www.tvbs.com.tw/poll-center', checked_at: checkedAt } }];
  for (const contest of contests) contest.verified_poll_count = verified.filter(poll => poll.contest_id === contest.id).length;
  const raw = { ...metadata, contests, polls: allPolls, historical_contexts: contexts, held_records: held, common_contest_comparisons: [] };
  const adapted = adaptVerifiedData(raw);
  raw.common_contest_comparisons = (metadata.common_contest_comparisons ?? []).map(group => {
    const comparison = commonElectionComparison(adapted, group.eligible_units.map(unit => unit.comparison_unit_id));
    const ids = comparison.commonElectionIds;
    return { ...group, label: `${ids.length}場共同選舉的已核實資料比較`, common_contest_ids: ids,
      coverage_warning: '限於所選機構都有合格資料的相同選舉交集；缺漏不補零，不作整體機構排名。',
      eligible_units: group.eligible_units.map(unit => {
        const row = comparison.rows.find(row => row.institutionId === unit.comparison_unit_id);
        const chosen = row.perElection.map(item => allPolls.find(poll => poll.id === item.pollId));
        return { ...unit, common_contest_ids: ids, common_contest_count: ids.length,
          normalized_mean_mae_pp: row.average, primary_mean_mae_pp: row.average,
          raw_mean_mae_pp: ids.length >= 3 ? chosen.reduce((sum, poll) => sum + poll.calculation.raw_mae_pp, 0) / ids.length : null,
          record_ids: chosen.map(poll => poll.id) };
      }) };
  });
  metadata.common_contest_comparisons = raw.common_contest_comparisons;
  adaptVerifiedData(raw);
  return { parts, imported, contexts, held, accounting, promotionsRejected, raw };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = resolve(root, 'source-data/parts');
  const filenames = (await readdir(directory)).filter(name => /^\d{2}\.json$/.test(name) && Number(name.slice(0, 2)) <= 16).sort();
  const parts = await Promise.all(filenames.map(async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'))));
  const input = JSON.parse(await readFile(resolve(root, 'source-data/historical-poll-index.json'), 'utf8'));
  const result = buildHistoricalImport(parts, input);
  if (!process.argv.includes('--dry-run')) {
    for (let index = 0; index < parts.length; index++) await writeFile(resolve(directory, filenames[index]), JSON.stringify(result.parts[index], null, 2) + '\n');
    for (const [name, type, data] of [['17.json', 'polls', result.imported], ['18.json', 'historical_contexts', result.contexts], ['19.json', 'held_records', result.held]]) {
      await writeFile(resolve(directory, name), JSON.stringify({ part_type: type, data }, null, 2) + '\n');
    }
  }
  const report = { total: result.raw.polls.length, scope: result.raw.scope,
    accounting: result.accounting, promotionsRejected: result.promotionsRejected };
  const reportIndex = process.argv.indexOf('--report');
  if (reportIndex >= 0) await writeFile(resolve(process.argv[reportIndex + 1]), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ dryRun: process.argv.includes('--dry-run'), polls: result.raw.polls.length,
    imported: result.imported.length, verified: result.raw.scope.verified_poll_records, contexts: result.contexts.length,
    held: result.held.length, promotionsRejected: result.promotionsRejected.length }));
}
