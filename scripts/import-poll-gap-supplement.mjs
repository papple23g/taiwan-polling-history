import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeDataFile } from './write-data-file.mjs';
import { buildHistoricalImport, calculate, sourcesFor } from './import-historical-polls.mjs';
import { summarizeParts } from './import-local-election-history.mjs';
import { adaptVerifiedData } from './import-verified-data.mjs';
import { institutionBrand } from '../src/publisher-brand.mjs';

const checkedAt = '2026-10-27';
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
const publicUrl = value => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } };
const brandKey = value => institutionBrand(value ?? '').normalize('NFKC').replace(/\s/g, '').toLowerCase();
const values = row => row.raw_support_percent ?? row.shares ?? {};
const electionId = row => row.contest_id ?? row.electionId;
const fieldEnd = row => row.fieldwork_end ?? row.fieldworkEnd ?? null;
const publication = row => row.publication_date ?? row.publishedAt ?? null;
const sourceUrls = row => new Set([row.sourceUrl, ...(row.sources ?? []).map(source => source.url), ...(row.supplementalSources ?? []).map(source => source.url)].filter(publicUrl));
const fieldMap = { fieldworkStart: 'fieldwork_start', fieldworkEnd: 'fieldwork_end', publishedAt: 'publication_date',
  shares: 'raw_support_percent', questionCandidateSet: 'question_candidate_set', sampleSize: 'sample_size_total',
  sampleSizeSupportQuestion: 'sample_size_support_question', surveyTotalSampleSize: 'survey_total_sample_size',
  method: 'mode', supportDenominator: 'support_denominator', samplingFrame: 'sampling_frame',
  reportedMarginOfError: 'reported_margin_of_error_pp', reportedConfidenceLevel: 'reported_confidence_level',
  undecided: 'undecided_percent', other: 'other_percent', otherResponses: 'other_responses',
  brand: 'brand', executor: 'executor', commissioner: 'commissioner', funder: 'funder', designAndAnalysis: 'design_and_analysis',
  population: 'population', weighting: 'weighting', question: 'question', notes: 'notes' };
const stable = value => JSON.stringify(value ?? null, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const equivalent = (a, b) => stable(a) === stable(b);
const sourceRank = source => /full_public_text|full_public_image/.test(source.access_method ?? '') ? 4
  : /selected_fields_read/.test(source.access_method ?? '') ? 3
    : /complete_public_table|public_html_structured|public_index_read/.test(source.access_method ?? '') ? 2
    : /excerpt/.test(source.access_method ?? '') ? 1 : 0;
function mergeSources(...groups) {
  const byUrl = new Map();
  for (const source of groups.flat()) {
    const previous = byUrl.get(source.url);
    if (!previous || sourceRank(source) > sourceRank(previous)) byUrl.set(source.url, structuredClone(source));
    else if (sourceRank(source) === sourceRank(previous)) for (const [key, value] of Object.entries(source)) {
      if (previous[key] == null && value != null) previous[key] = structuredClone(value);
    }
  }
  return [...byUrl.values()];
}
const asSupplemental = source => ({ title: source.title, url: source.url, kind: source.kind,
  readStatus: source.access_method, checkedAt: source.checked_at, evidenceSummary: source.evidence_summary,
  ...(source.locator ? { locator: source.locator } : {}),
  ...(source.independence_group ? { independenceGroup: source.independence_group } : {}) });
const preservingSourcesFor = record => mergeSources(sourcesFor(record, checkedAt), (record.supplementalSources ?? [])
  .filter(source => sourceRank({ access_method: source.readStatus }) > 0)
  .map(source => ({ title: source.title, url: source.url, kind: source.kind, access_method: source.readStatus,
    checked_at: source.checkedAt ?? null, evidence_summary: source.evidenceSummary ?? null,
    ...(source.locator ? { locator: source.locator } : {}),
    ...(source.independenceGroup ? { independence_group: source.independenceGroup } : {}) })));

function researchRecord(row) {
  const result = { ...row, publicRecordId: row.id, auditId: `gap-correction-${row.id}`,
    electionId: electionId(row), candidateSet: row.question_candidate_set ?? row.candidateSet ?? Object.keys(values(row)),
    shares: values(row), sourceUrl: row.sources[0].url, evidenceTier: row.historical_import?.evidence_tier ?? row.evidenceTier ?? 'primary_fulltext',
    fieldEvidence: row.verification_review?.fieldEvidence ?? row.fieldEvidence ?? {},
    verificationReview: row.verification_review ?? row.verificationReview,
    supplementalSources: row.sources.map(asSupplemental),
    notes: Array.isArray(row.notes) ? row.notes : [] };
  for (const [field, name] of Object.entries(fieldMap)) if (name in row) result[field] = row[name];
  return result;
}

function applyCorrections(base, inputs, researchRecords = false) {
  const corrections = [], moves = [], recoveries = [];
  for (const correction of inputs.flatMap(input => input.correctionCandidates ?? [])) {
    const checkedAt = correction.checkedAt ?? '2026-10-27';
    const row = [...base.polls, ...base.historical_contexts, ...base.held_records]
      .find(item => item.id === correction.pollId || researchRecords && item.auditId === correction.pollId);
    if (!row || !publicUrl(correction.sourceUrl)) throw new Error(`Invalid source correction: ${correction.pollId}`);
    const isPoll = base.polls.includes(row);
    const wasVerified = isPoll && row.verification_status === 'verified_primary';
    const reviewName = isPoll ? 'verification_review' : 'verificationReview';
    const previousReview = row[reviewName] ?? {};
    const changes = [];
    for (const [field, change] of Object.entries(correction.changes)) {
      if (field === 'candidateSet' && isPoll) continue;
      if (field === 'sourceUrl') {
        const original = row.sourceUrl ?? row.sources[0]?.url;
        if (equivalent(original, change.corrected)) continue;
        if (!equivalent(original, change.original)) throw new Error(`Correction baseline differs: ${row.id}/${field}`);
        if (!publicUrl(change.corrected)) throw new Error(`Invalid corrected source URL: ${row.id}`);
        changes.push({ field, original, corrected: change.corrected, reason: correction.reason,
          evidence: { url: correction.sourceUrl, locator: correction.locator, checkedAt } });
        row.sourceUrl = change.corrected;
        continue;
      }
      if (['calculationBlocker', 'conflictsResolved', 'missingFields'].includes(field)) {
        if (equivalent(previousReview[field], change.corrected)) continue;
        if (!equivalent(previousReview[field], change.original)) throw new Error(`Correction baseline differs: ${row.id}/${field}`);
        changes.push({ field, ...change, reason: correction.reason,
          evidence: { url: correction.sourceUrl, locator: correction.locator, checkedAt } });
        previousReview[field] = change.corrected;
        continue;
      }
      const target = isPoll ? fieldMap[field] : field;
      if (!target) throw new Error(`Unsupported correction field: ${field}`);
      if (equivalent(row[target], change.corrected)) continue;
      if (!equivalent(row[target], change.original)) throw new Error(`Correction baseline differs: ${row.id}/${field}`);
      changes.push({ field, original: row[target] ?? null, corrected: change.corrected,
        reason: correction.reason, evidence: { url: correction.sourceUrl, locator: correction.locator, checkedAt } });
      row[target] = structuredClone(change.corrected);
    }
    const incomingEvidence = Object.fromEntries(Object.entries(correction.fieldEvidence ?? {})
      .filter(([, evidence]) => publicUrl(evidence?.url)));
    const checkedFields = (correction.verificationReview?.verifiedFields ?? [])
      .filter(field => field in fieldMap || ['candidateSet', 'dateText'].includes(field))
      .filter(field => incomingEvidence[field] || changes.some(change => change.field === field));
    const fieldEvidence = { ...(previousReview.fieldEvidence ?? row.fieldEvidence), ...incomingEvidence,
      ...(correction.recommendedDisposition ? { classification: { url: correction.sourceUrl, locator: correction.locator, checkedAt } } : {}),
      ...Object.fromEntries(changes.map(change => [change.field, change.evidence])) };
    const changesCore = changes.some(change => ['shares', 'fieldworkEnd', 'publishedAt', 'executor', 'sampleSize', 'method', 'brand'].includes(change.field));
    const unresolvedSupport = previousReview.calculationBlocker === 'unresolved_support_conflict';
    row[reviewName] = { ...previousReview, status: unresolvedSupport ? 'conflict' : wasVerified && !changesCore ? previousReview.status ?? 'primary_verified' : 'partial', checkedAt, fieldEvidence,
      corrections: [...(previousReview.corrections ?? []), ...changes], reason: correction.reason };
    if (correction.verificationReview) {
      row[reviewName].verifiedFields = [...new Set([...(previousReview.verifiedFields ?? []), ...checkedFields])];
      row[reviewName].missingFields = [...new Set([
        ...(previousReview.missingFields ?? []).filter(field => !checkedFields.includes(field)),
        ...(correction.verificationReview.missingFields ?? []),
      ])];
    }
    if (correction.sourceObservations?.length) row[reviewName].sourceObservations = [
      ...(previousReview.sourceObservations ?? []), ...structuredClone(correction.sourceObservations)];
    if (!isPoll) row.fieldEvidence = fieldEvidence;
    const checkedSources = sourcesFor({ brand: row.brand, sourceUrl: correction.sourceUrl,
      supplementalSources: correction.supplementalSources ?? [], verificationReview: { status: 'partial' } }, checkedAt);
    row.sources = mergeSources(checkedSources, row.sources ?? preservingSourcesFor(row));
    if (isPoll && wasVerified && (changesCore || unresolvedSupport)) {
      row.verification_status = 'indexed_secondary'; row.aggregate_source_eligible = false;
      row.primary_mae_pp = null; row.default_aggregate_eligible = false; row.is_last_verified_eligible_in_dataset = false;
    }
    if (isPoll && changes.some(change => change.field === 'brand')) {
      row.comparison_unit_id = base.polls.find(other => other.id !== row.id && other.brand === row.brand && other.executor === row.executor)?.comparison_unit_id
        ?? `history__${hash(JSON.stringify([row.brand, row.executor])).slice(0, 12)}`;
    }
    corrections.push({ pollId: row.id, fields: changes.map(change => change.field), sourceUrl: correction.sourceUrl,
      disposition: correction.recommendedDisposition ?? 'updated' });
    if (researchRecords) {
      if (correction.duplicateOf) throw new Error(`Same-batch duplicate corrections require a canonical record: ${row.id}`);
      row.supplementalSources = row.sources.map(asSupplemental);
      if (correction.recommendedDisposition) row.reason = correction.reason;
      if (correction.recommendedDisposition === 'context_only') { row.contextOnly = true; row.decision = 'context_only'; }
      if (correction.recommendedDisposition === 'restore_pending') { row.contextOnly = false; row.decision = 'import_pending'; }
      if (correction.recommendedDisposition === 'hold_conflict') row.decision = 'hold_conflict';
      continue;
    }
    if (correction.duplicateOf) {
      row.disposition = 'duplicate_source_observation';
      row.resolved = true; row.relatedPollId = correction.duplicateOf; row.relatedRecordId = correction.duplicateOf;
      row.reason = `與${correction.duplicateOf}為同一波；保留原始來源觀察及逐欄更正。`;
      row[reviewName].relatedRecordIds = [...new Set([...(row[reviewName].relatedRecordIds ?? []), correction.duplicateOf])];
      const canonical = [...base.polls, ...base.historical_contexts, ...base.held_records].find(item => item.id === correction.duplicateOf);
      if (!canonical) throw new Error(`Unknown duplicate source target: ${correction.duplicateOf}`);
      canonical.sources = mergeSources(canonical.sources, row.sources);
      const canonicalReviewName = base.polls.includes(canonical) ? 'verification_review' : 'verificationReview';
      canonical[canonicalReviewName] = { ...canonical[canonicalReviewName],
        relatedRecordIds: [...new Set([...(canonical[canonicalReviewName]?.relatedRecordIds ?? []), row.id])] };
    }
    if (correction.recommendedDisposition === 'context_only' && isPoll) {
      const record = researchRecord(row);
      moves.push({ ...record, contextOnly: true, reason: row.reason ?? correction.reason,
        shares: Object.fromEntries(Object.entries(record.shares).filter(([name, value]) => value !== null || record.candidateSet.includes(name))),
        indexedObservations: { ...record.indexedObservations, previousComparisonSupport: row.raw_support_percent,
          previousComparisonCandidateSet: row.candidate_set, duplicateResolution: correction.duplicateResolution ?? null } });
      base.polls = base.polls.filter(poll => poll.id !== row.id);
    }
    if (correction.recommendedDisposition === 'restore_pending' && (base.held_records.includes(row) || base.historical_contexts.includes(row))) {
      recoveries.push({ contextId: row.id, record: { ...researchRecord(row), contextOnly: false, decision: 'import_pending',
        verificationReview: { ...row.verificationReview, calculationBlocker: null } } });
    }
  }
  return { corrections, moves, recoveries };
}
const sameSupport = (left, right) => {
  const a = values(left), b = values(right);
  const names = Object.keys(a).filter(name => typeof a[name] === 'number');
  const otherNames = Object.keys(b).filter(name => typeof b[name] === 'number');
  return names.length >= 2 && names.length === otherNames.length
    && names.every(name => typeof b[name] === 'number' && Math.abs(a[name] - b[name]) < 1e-8);
};

const populationKey = row => {
  const population = row.population ?? row.populationScope ?? row.indexedObservations?.region;
  if (population && typeof population === 'object') return { key: stable(population), specific: true };
  const text = String(population ?? '').normalize('NFKC').replaceAll('台', '臺');
  if (!text) return null;
  const regions = [...text.matchAll(/全國|臺北市|新北市|桃園市|臺中市|臺南市|高雄市|基隆市|新竹縣|新竹市|宜蘭縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|嘉義市|屏東縣|花蓮縣|臺東縣|澎湖縣|金門縣|連江縣/g)].map(match => match[0]);
  const districts = [...text.matchAll(/第[一二三四五六七八九十百零〇\d]+(?:選舉區|選區)|[\p{Script=Han}]{1,8}(?:區|鄉|鎮)/gu)]
    .map(match => match[0]).filter(name => !/地區|行政區/.test(name));
  const subset = text.match(/首投族|年輕人|年輕族群|手機族|市話族|純手機|一定會投票|20[至～–-]29歲|20[至～–-]39歲/);
  return { key: regions.length || districts.length || subset
    ? [...new Set([...regions, ...districts, subset?.[0]].filter(Boolean))].sort().join('|') : text,
  specific: !!(districts.length || subset) };
};
const held = row => row.decision === 'hold_conflict' || row.disposition === 'source_conflict';

export function sameWave(left, right) {
  if (electionId(left) !== electionId(right) || brandKey(left.brand) !== brandKey(right.brand) || !sameSupport(left, right)) return false;
  const leftQuestion = left.question_candidate_set ?? left.questionCandidateSet ?? left.candidateSet ?? left.candidate_set;
  const rightQuestion = right.question_candidate_set ?? right.questionCandidateSet ?? right.candidateSet ?? right.candidate_set;
  if (Array.isArray(leftQuestion) && Array.isArray(rightQuestion)
    && (leftQuestion.length !== rightQuestion.length || leftQuestion.some(name => !rightQuestion.includes(name)))) return false;
  const leftPopulation = populationKey(left), rightPopulation = populationKey(right);
  if (leftPopulation && rightPopulation && leftPopulation.key !== rightPopulation.key) return false;
  if (leftPopulation?.specific && !rightPopulation || rightPopulation?.specific && !leftPopulation) return false;
  if (held(left) !== held(right)) return false;
  if (!!left.conditionalQuestion !== !!right.conditionalQuestion && (left.conditionalQuestion || right.conditionalQuestion)) return false;
  if (left.conditionalQuestion && right.conditionalQuestion && left.question !== right.question) return false;
  const leftEnd = fieldEnd(left), rightEnd = fieldEnd(right);
  if (leftEnd && rightEnd) return leftEnd === rightEnd;
  const a = sourceUrls(left), sharedSource = [...sourceUrls(right)].some(url => a.has(url) && !/wikipedia\.org|poll-tw\.com\/[a-z-]+$/.test(url));
  if (sharedSource) return true;
  const leftDate = left.indexDate ?? left.historical_import?.index_date ?? publication(left);
  const rightDate = right.indexDate ?? right.historical_import?.index_date ?? publication(right);
  return !!leftDate && leftDate === rightDate;
}

function normalizeRecord(record, contest) {
  if (!record.auditId || !record.brand?.trim() || !record.shares
    || !Object.keys(record.shares).length && !(record.productType === 'non_voting_question' && Object.keys(record.otherResponses ?? {}).length)) throw new Error(`Incomplete source record: ${record.auditId}`);
  if (record.evidenceTier === 'search_excerpt_only') throw new Error(`Search-only lead cannot become a data record: ${record.auditId}`);
  if (!publicUrl(record.sourceUrl) || !Object.values(record.fieldEvidence ?? {}).some(field => publicUrl(field.url))) throw new Error(`Missing public field evidence: ${record.auditId}`);
  const row = structuredClone(record);
  const missingComparison = contest.selected_candidates.some(name => !Number.isFinite(row.shares[name]));
  const contextual = row.contextOnly || row.conditionalQuestion || row.decision === 'context_only' || missingComparison;
  return { ...row, publicRecordId: row.publicRecordId ?? `${row.electionId}-gap-${hash(row.auditId)}`,
    notes: Array.isArray(row.notes) ? row.notes : row.notes ? [row.notes] : [],
    proposedVerification: 'pending', decision: row.decision === 'hold_conflict' ? 'hold_conflict' : contextual ? 'context_only' : 'import_pending',
    disposition: 'missing_record', auditDisposition: 'source_supplement',
    fieldworkStart: row.fieldworkStart ?? null, fieldworkEnd: row.fieldworkEnd ?? null, publishedAt: row.publishedAt ?? null,
    candidateSet: row.candidateSet ?? Object.keys(row.shares),
    verificationReview: { ...row.verificationReview,
      ...(row.calculationBlocker && !row.verificationReview?.calculationBlocker ? { calculationBlocker: row.calculationBlocker } : {}),
      status: row.verificationReview?.status === 'conflict' ? 'conflict' : 'partial', checkedAt,
      reason: row.verificationReview?.reason ?? '公開來源逐筆補錄；完整原始問卷及六核心獨立核實尚未全部完成。' },
  };
}

export function buildGapSupplement(parts, inputs, recoveries = []) {
  const metadata = structuredClone(parts.find(part => part.part_type === 'metadata').data);
  const base = summarizeParts(metadata, structuredClone(parts.filter(part => part.part_type !== 'metadata')));
  const originalIds = new Set([...base.polls, ...base.historical_contexts, ...base.held_records].map(row => row.id));
  const selectCorrections = original => inputs.map(input => ({ ...input,
    correctionCandidates: (input.correctionCandidates ?? []).filter(row => originalIds.has(row.pollId) === original) }));
  const correctionResult = applyCorrections(base, selectCorrections(true));
  if (new Set(recoveries.map(row => row.contextId)).size !== recoveries.length) throw new Error('Duplicate context recovery ID');
  recoveries = [...new Map([...correctionResult.recoveries, ...recoveries].map(row => [row.contextId, row])).values()];
  const contestMap = new Map(base.contests.map(contest => [contest.id, contest]));
  const allInputRecords = inputs.flatMap(input => input.records ?? []);
  for (const proposal of inputs.flatMap(input => input.newContestProposals ?? [])) {
    if (contestMap.has(proposal.id)) continue;
    if (!proposal.id.startsWith('2026-') || proposal.pair?.length !== 2 || !allInputRecords.some(row => row.electionId === proposal.id)) throw new Error(`Invalid pre-result proposal ${proposal.id}`);
    const contest = { id: proposal.id, title: `2026年${proposal.region.replaceAll('台', '臺')}長選舉`, phase: 'pre_result', election_date: '2026-11-28',
      geography: proposal.region.replaceAll('台', '臺'), office: proposal.office, official_status: 'results_pending', valid_votes: null,
      selected_candidates: proposal.pair, selected_candidate_votes: null, candidates: [], official_browser_url: null, priority_poll_scope: true,
      sources: proposal.sources.map(source => typeof source === 'string' ? { title: '公開候選情境來源', url: source, kind: 'secondary_table_index', checked_at: checkedAt } : source),
      notes: [], candidate_list_note: '候選名單來自所收錄題目；不宣稱完整官方登記名冊。', verified_poll_count: 0 };
    base.contests.push(contest); contestMap.set(contest.id, contest);
  }
  for (const contest of base.contests.filter(contest => contest.phase === 'pre_result')) {
    const names = new Set(contest.candidates.map(candidate => candidate.name));
    for (const name of [...contest.selected_candidates, ...allInputRecords.filter(row => row.electionId === contest.id).flatMap(row => Object.keys(row.shares ?? {}))]) {
      if (names.has(name)) continue;
      names.add(name);
      contest.candidates.push({ name, party: null, votes: null, elected: null, ballot_number: null, party_source: null });
    }
  }
  const normalizedRecords = allInputRecords.map(source => {
    const contest = contestMap.get(source.electionId);
    if (!contest) throw new Error(`Unknown supplement election: ${source.electionId}`);
    const row = normalizeRecord(source, contest);
    return { ...row, id: row.publicRecordId };
  });
  const additionalCorrections = applyCorrections({ polls: [], historical_contexts: normalizedRecords, held_records: [] }, selectCorrections(false), true);
  correctionResult.corrections.push(...additionalCorrections.corrections);
  const recoveryIds = new Set(recoveries.map(row => row.contextId));
  if (recoveryIds.size !== recoveries.length) throw new Error('Duplicate context recovery ID');
  const recovered = recoveries.map(recovery => {
    const source = [...base.historical_contexts, ...base.held_records].find(row => row.id === recovery.contextId);
    if (!source || recovery.record.publicRecordId !== source.id) throw new Error(`Recovery must preserve the existing context ID: ${recovery.contextId}`);
    const updated = { ...recovery.record, ...source, publicRecordId: source.id, decision: 'import_pending', contextOnly: false,
      verificationReview: { ...source.verificationReview, classificationCorrection: recovery.record.verificationReview?.classificationCorrection },
      fieldEvidence: source.fieldEvidence ?? recovery.record.fieldEvidence,
      indexedObservations: { ...(source.originalObservations ?? recovery.record.indexedObservations),
        previousClassification: { disposition: source.disposition, reason: source.reason } } };
    return normalizeRecord(updated, contestMap.get(source.electionId));
  });
  const known = [...base.polls, ...base.historical_contexts.filter(row => !recoveryIds.has(row.id)), ...base.held_records.filter(row => !recoveryIds.has(row.id))];
  const records = [...recovered, ...correctionResult.moves.map(row => normalizeRecord(row, contestMap.get(row.electionId)))], accounting = [];
  for (const input of inputs) for (const original of input.records ?? []) {
    const source = normalizedRecords.find(row => row.auditId === original.auditId);
    const contest = contestMap.get(source.electionId);
    const row = normalizeRecord(source, contest);
    if (original.disposition === 'existing_record' && source.hasEnrichment) {
      if (!source.matchedExistingIds?.length || source.matchedExistingIds.some(id => !base.polls.some(poll => poll.id === id))) throw new Error(`Unknown enrichment target: ${row.auditId}`);
      records.push({ ...row, disposition: 'existing_record' });
      continue;
    }
    const duplicate = [...known, ...records].find(existing => sameWave(existing, row)
      && (existing.product_type ?? existing.productType ?? 'voting_intention_poll') === (row.productType ?? 'voting_intention_poll'));
    if (duplicate) {
      if (duplicate.publicRecordId) duplicate.supplementalSources = mergeSources(preservingSourcesFor(duplicate), preservingSourcesFor(row)).map(asSupplemental);
      else duplicate.sources = mergeSources(duplicate.sources ?? [], preservingSourcesFor(row));
      const observation = { auditId: row.auditId, sourceCollection: input.sourceCollection ?? null,
        candidateSet: row.candidateSet, questionCandidateSet: row.questionCandidateSet ?? null, shares: row.shares,
        fieldworkStart: row.fieldworkStart, fieldworkEnd: row.fieldworkEnd, publishedAt: row.publishedAt,
        indexDate: row.indexDate ?? null, population: row.population ?? null, sourceUrl: row.sourceUrl,
        indexedObservations: row.indexedObservations ?? null, fieldEvidence: row.fieldEvidence };
      const owner = duplicate.contest_id ? (duplicate.historical_import ??= {}) : duplicate;
      const key = duplicate.contest_id ? 'indexed_observations' : duplicate.publicRecordId ? 'indexedObservations' : 'originalObservations';
      owner[key] = { ...owner[key], sourceObservations: [...(owner[key]?.sourceObservations ?? []), observation] };
      accounting.push({ auditId: row.auditId, electionId: row.electionId, result: 'existing', ids: [duplicate.id ?? duplicate.publicRecordId], evidenceMerged: true });
      continue;
    }
    records.push(row);
  }
  const result = buildHistoricalImport([
    { part_type: 'metadata', data: metadata }, { part_type: 'contests', data: base.contests }, { part_type: 'polls', data: base.polls },
  ], { id: 'public-poll-gap-supplement-20261027', checked_at: checkedAt, records });
  for (const row of [...result.imported, ...result.contexts, ...result.held]) {
    const record = records.find(record => record.auditId === (row.historical_import?.record_id ?? row.auditId));
    row.sources = mergeSources(row.sources, preservingSourcesFor(record));
  }
  for (const poll of result.imported.filter(row => contestMap.get(row.contest_id).phase === 'pre_result')) {
    poll.calculation = null; poll.primary_mae_pp = null; poll.default_aggregate_eligible = false;
  }
  const raw = { ...result.raw, schema_version: metadata.schema_version, historical_contexts: [...base.historical_contexts.filter(row => !recoveryIds.has(row.id)), ...result.contexts],
    held_records: [...base.held_records.filter(row => !recoveryIds.has(row.id)), ...result.held] };
  for (const context of result.contexts) {
    const source = records.find(row => row.auditId === context.auditId);
    if (source?.resolved && source.relatedRecordId) Object.assign(context, {
      resolved: true, relatedRecordId: source.relatedRecordId, disposition: 'duplicate_source_observation' });
  }
  for (const poll of raw.polls) {
    if (contestMap.get(poll.contest_id).phase === 'pre_result') {
      poll.calculation = null; poll.primary_mae_pp = null; poll.default_aggregate_eligible = false;
    }
    const source = records.find(row => row.auditId === poll.historical_import?.record_id);
    if (source?.returnedQuestionnaireCount != null) poll.returned_questionnaire_count = source.returnedQuestionnaireCount;
  }
  const correctedIds = new Set(correctionResult.corrections.map(row => row.pollId));
  for (const poll of raw.polls.filter(row => correctedIds.has(row.id))) {
    const contest = contestMap.get(poll.contest_id);
    const days = poll.fieldwork_end ? (Date.parse(contest.election_date) - Date.parse(poll.fieldwork_end)) / 86_400_000 : null;
    poll.days_before_election = Number.isFinite(days) ? days : null;
    poll.within_default_30_day_window = days === null ? null : days >= 1 && days <= 30;
    poll.published_before_election = poll.publication_date ? poll.publication_date < contest.election_date : null;
  }
  for (const poll of raw.polls.filter(row => correctedIds.has(row.id) && row.verification_status !== 'verified_primary' && contestMap.get(row.contest_id).phase !== 'pre_result')) {
    poll.calculation = calculate(poll.raw_support_percent, poll.candidate_set, contestMap.get(poll.contest_id), {
      candidateSet: poll.candidate_set, questionCandidateSet: poll.question_candidate_set, productType: poll.product_type,
      verificationReview: poll.verification_review });
  }
  summarizeParts(raw, [{ part_type: 'contests', data: raw.contests }, { part_type: 'polls', data: raw.polls },
    { part_type: 'historical_contexts', data: raw.historical_contexts }, { part_type: 'held_records', data: raw.held_records }]);
  const dispositions = [...accounting, ...result.accounting.map(row => ({ ...row, electionId: records.find(record => record.auditId === row.auditId).electionId,
    ...(recovered.some(record => record.auditId === row.auditId) ? { recovery: true } : {}) }))];
  if (dispositions.length !== allInputRecords.length + recoveries.length + correctionResult.moves.length || new Set(dispositions.map(row => row.auditId)).size !== dispositions.length) throw new Error('Incomplete supplement accounting');
  raw.methodology = structuredClone(base.methodology ?? metadata.methodology);
  raw.scope.gap_supplement = { checked_at: checkedAt, source_records: allInputRecords.length, recovered_contexts: recoveries.length,
    imported_polls: result.imported.length, added_contexts: result.contexts.length, held_records: result.held.length,
    existing_matches: accounting.length,
    corrections: correctionResult.corrections, moved_to_context: correctionResult.moves.map(row => row.publicRecordId),
    coverage_statement: '逐筆盤點所列公開索引與回源資料；未知欄位與未讀原文保留限制，不能據此宣稱完整涵蓋所有歷史民調。' };
  raw.scope.coverage_statement = `已核實官方結果${raw.scope.official_contests_verified}場；另有${raw.scope.pre_result_contests}場選前選舉。收錄公開民調${raw.polls.length}筆，來源與欄位完整程度逐筆保留；不宣稱完整普查。`;
  raw.data_changes = [...(base.data_changes ?? metadata.data_changes ?? []), { date: checkedAt, title: '補收公開民調及校正支持度題分類',
    description: '依逐筆公開來源補收各年份民調與候選情境，恢復可對齊的支持度題；原始ID、缺值及來源核實層級均保留。' }];
  adaptVerifiedData(raw);
  const allIds = [...raw.polls, ...raw.historical_contexts, ...raw.held_records].map(row => row.id);
  if (new Set(allIds).size !== allIds.length) throw new Error('Duplicate IDs across public record types');
  return { raw, accounting: dispositions, imported: result.imported, contexts: result.contexts, recoveredIds: [...recoveryIds], corrections: correctionResult.corrections };
}

const recordGroups = ['polls', 'historical_contexts', 'held_records'];
const reviewFields = new Set([...Object.keys(fieldMap), 'sourceUrl', 'missingFields']);
const nonemptyText = value => typeof value === 'string' && value.trim().length > 0;
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const correctionValue = (row, field, isPoll) => field === 'missingFields'
  ? row[isPoll ? 'verification_review' : 'verificationReview']?.missingFields
  : field === 'sourceUrl' ? row.sourceUrl ?? row.sources?.[0]?.url : row[isPoll ? fieldMap[field] : field];
const protectedReviewState = (row, isPoll) => Object.fromEntries([
  'id', 'contest_id', 'electionId', 'candidate_set', 'candidateSet', 'comparison_unit_id',
  'product_type', 'productType', 'disposition', 'status', 'officialScoreEligible', 'verification_status',
  'aggregate_source_eligible', 'default_aggregate_eligible', 'is_last_verified_eligible_in_dataset', 'primary_mae_pp', 'calculation',
].map(field => [field, row[field]]).concat([['calculationBlocker', row[isPoll ? 'verification_review' : 'verificationReview']?.calculationBlocker]]));

// Review corrections use the final public snapshot as their baseline, after all legacy imports.
// New records are materialized by buildGapSupplement; their publication review belongs to the update runner.
export function applyReviewedUpdates(raw, updates) {
  if (!object(updates) || !Array.isArray(updates.collections)) throw new Error('Invalid reviewed-update collections');
  for (const collection of updates.collections) {
    if (!object(collection) || collection.records != null && !Array.isArray(collection.records)
      || collection.correctionCandidates != null && !Array.isArray(collection.correctionCandidates)) throw new Error('Invalid reviewed-update collection');
  }
  const candidates = updates.collections.flatMap(collection => collection.correctionCandidates ?? []);
  const newRecords = updates.collections.reduce((sum, collection) => sum + (collection.records?.length ?? 0), 0);
  const next = structuredClone(raw);
  if (!candidates.length && !newRecords) return { raw: next, corrections: [] };
  if (updates.version !== 1 || !dateOnly(updates.checkedAt)) throw new Error('Invalid reviewed-update version or date');
  const byId = new Map();
  for (const group of recordGroups) for (const row of next[group] ?? []) {
    if (byId.has(row.id)) throw new Error(`Duplicate reviewed-update target: ${row.id}`);
    byId.set(row.id, { row, isPoll: group === 'polls' });
  }
  const finalChanges = new Map();
  for (const correction of candidates) {
    if (!object(correction) || !byId.has(correction.pollId) || !publicUrl(correction.sourceUrl)
      || !nonemptyText(correction.locator) || !nonemptyText(correction.reason)
      || !dateOnly(correction.checkedAt) || correction.checkedAt > updates.checkedAt
      || correction.independentReread !== true || !object(correction.changes) || !object(correction.fieldEvidence)) throw new Error(`Invalid reviewed correction: ${correction?.pollId}`);
    if (correction.recommendedDisposition != null || correction.duplicateOf != null
      || correction.verificationReview?.status != null && correction.verificationReview.status !== 'partial') {
      throw new Error(`Reviewed updates cannot change classification or verification status: ${correction.pollId}`);
    }
    for (const [field, evidence] of Object.entries(correction.fieldEvidence)) {
      if (!object(evidence) || !publicUrl(evidence.url) || !nonemptyText(evidence.locator)
        || !dateOnly(evidence.checkedAt) || evidence.checkedAt > correction.checkedAt) throw new Error(`Invalid reviewed field evidence: ${correction.pollId}/${field}`);
    }
    for (const field of correction.verificationReview?.verifiedFields ?? []) {
      if (!Object.hasOwn(fieldMap, field) || !correction.fieldEvidence[field]) throw new Error(`Missing reviewed field evidence: ${correction.pollId}/${field}`);
    }
    for (const [field, change] of Object.entries(correction.changes)) {
      if (!reviewFields.has(field)) throw new Error(`Unsupported reviewed correction field: ${field}`);
      if (!object(change) || !Object.hasOwn(change, 'original') || !Object.hasOwn(change, 'corrected')
        || !correction.fieldEvidence[field]) throw new Error(`Missing reviewed field evidence or baseline: ${correction.pollId}/${field}`);
      if (!finalChanges.has(correction.pollId)) finalChanges.set(correction.pollId, new Map());
      finalChanges.get(correction.pollId).set(field, change.corrected);
    }
  }
  const digest = createHash('sha256').update(stable(updates)).digest('hex');
  const batches = next.scope?.poll_update_reviews?.batches ?? [];
  const existing = batches.find(batch => batch.digest === digest);
  if (existing) {
    for (const [id, fields] of finalChanges) for (const [field, corrected] of fields) {
      const { row, isPoll } = byId.get(id);
      if (!equivalent(correctionValue(row, field, isPoll), corrected)) throw new Error(`Applied reviewed correction drifted: ${id}/${field}`);
    }
    return { raw: next, corrections: structuredClone(existing.corrections) };
  }
  const corrections = [];
  for (const correction of candidates) {
    const { row, isPoll } = byId.get(correction.pollId);
    const contest = next.contests.find(contest => contest.id === electionId(row));
    for (const [field, change] of Object.entries(correction.changes)) {
      if (!equivalent(correctionValue(row, field, isPoll), change.original)) throw new Error(`Correction baseline differs: ${row.id}/${field}`);
      if (isPoll && contest?.phase !== 'pre_result' && ['shares', 'questionCandidateSet', 'undecided', 'other'].includes(field)
        && !equivalent(change.original, change.corrected)) throw new Error(`Reviewed updates cannot change historical scoring inputs: ${row.id}/${field}`);
    }
    const before = structuredClone(protectedReviewState(row, isPoll));
    const reviewName = isPoll ? 'verification_review' : 'verificationReview';
    const historyLength = row[reviewName]?.corrections?.length ?? 0;
    const applied = applyCorrections(next, [{ correctionCandidates: [correction] }]);
    if (!equivalent(before, protectedReviewState(row, isPoll))) throw new Error(`Reviewed update changed classification or scoring: ${row.id}`);
    // Keep the specific locator for each field, including the correction history.
    Object.assign(row[reviewName].fieldEvidence, structuredClone(correction.fieldEvidence));
    for (const entry of row[reviewName].corrections.slice(historyLength)) entry.evidence = structuredClone(correction.fieldEvidence[entry.field]);
    if (!isPoll) row.fieldEvidence = row[reviewName].fieldEvidence;
    if (isPoll && ('fieldworkEnd' in correction.changes || 'publishedAt' in correction.changes)) {
      const days = row.fieldwork_end ? (Date.parse(contest.election_date) - Date.parse(row.fieldwork_end)) / 86_400_000 : null;
      row.days_before_election = Number.isFinite(days) ? days : null;
      row.within_default_30_day_window = row.days_before_election === null ? null : days >= 1 && days <= 30;
      row.published_before_election = row.publication_date ? row.publication_date < contest.election_date : null;
    }
    corrections.push(...applied.corrections.map(entry => ({ ...entry, checkedAt: correction.checkedAt, locator: correction.locator })));
  }
  next.scope ??= {};
  next.scope.poll_update_reviews = { checked_at: [next.scope.poll_update_reviews?.checked_at, updates.checkedAt].filter(Boolean).sort().at(-1),
    batches: [...batches, { digest, checkedAt: updates.checkedAt, newRecords, corrections }] };
  next.verified_at = [next.verified_at, updates.checkedAt].filter(Boolean).sort().at(-1);
  next.data_changes = [...(next.data_changes ?? []), { date: updates.checkedAt, title: '補核民調原始來源',
    description: '依原始報告補齊逐題分母與查核證據，保留原紀錄ID、原始觀察及既有分類。' }];
  return { raw: next, corrections };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = (await readdir('source-data/parts')).filter(name => /^\d{2}\.json$/.test(name)).sort();
  const parts = await Promise.all(files.map(async name => JSON.parse(await readFile(`source-data/parts/${name}`, 'utf8'))));
  const input = JSON.parse(await readFile('source-data/poll-gap-supplement-20261027.json', 'utf8'));
  let updates = { version: 1, collections: [] };
  try { updates = JSON.parse(await readFile('source-data/poll-update-reviews.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const newInputs = updates.collections.filter(collection => collection.records?.length)
    .map(collection => ({ ...collection, correctionCandidates: [] }));
  const result = buildGapSupplement(parts, [...input.collections, ...newInputs], input.recoveries);
  const reviewed = applyReviewedUpdates(result.raw, updates);
  result.raw = reviewed.raw;
  await mkdir('report/poll-gap-audit-20261027', { recursive: true });
  await writeDataFile('source-data/audited-source.json', JSON.stringify(result.raw, null, 2) + '\n');
  await writeDataFile('report/poll-gap-audit-20261027/accounting.json', JSON.stringify({ recoveredIds: result.recoveredIds, records: result.accounting,
    scope: result.raw.scope.gap_supplement, reviewedUpdates: result.raw.scope.poll_update_reviews ?? null }, null, 2) + '\n');
  console.log(JSON.stringify({ elections: result.raw.contests.length, polls: result.raw.polls.length, imported: result.imported.length,
    contexts: result.contexts.length, recovered: result.recoveredIds.length, reviewedCorrections: reviewed.corrections.length }));
}
