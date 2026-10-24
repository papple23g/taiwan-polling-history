import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { evaluatePoll, commonElectionComparison } from '../src/domain.mjs';

const source = item => item ? { ...item, title: item.title, url: item.url?.replaceAll('&amp;', '&'), accessedAt: item.checked_at || null } : null;
const sameSet = (a, b) => a.length === b.length && a.every(id => b.includes(id));
export function adaptVerifiedData(raw) {
  if (!Array.isArray(raw?.contests) || !Array.isArray(raw?.polls)) throw new Error('Expected complete public source JSON with contests and polls arrays.');
  const elections = raw.contests.map(c => ({
    id: c.id, label: c.title, year: Number(c.election_date.slice(0,4)), date: c.election_date, region: c.geography,
    office: c.id.endsWith('president') ? '總統副總統' : '縣市長', status: 'verified',
    candidates: c.candidates.map(item => ({ ...item, id: item.name, name: item.name })),
    comparisonCandidateIds: [...c.selected_candidates],
    result: { status: 'verified', validVotes: c.valid_votes, votes: Object.fromEntries(c.candidates.map(item => [item.name, item.votes])), source: source(c.sources?.[0]), sources: c.sources.map(source), officialBrowserUrl: c.official_browser_url?.replaceAll('&amp;', '&'), officialStatus: c.official_status },
    notes: c.notes || [], priorityPollScope: c.priority_poll_scope, verifiedPollCount: c.verified_poll_count,
  }));
  const institutionMap = new Map();
  const polls = raw.polls.map(p => {
    const election = elections.find(e => e.id === p.contest_id);
    if (!election || !sameSet(election.comparisonCandidateIds, p.candidate_set)) throw new Error(`Candidate set mismatch: ${p.id}`);
    if (!p.comparison_unit_id || !p.brand || p.verification_status === 'verified_primary' && !p.executor) throw new Error(`Unresolved comparison identity: ${p.id}`);
    if (!Array.isArray(p.sources) || !p.sources.some(s => /^https?:\/\//.test(s.url ?? ''))) throw new Error(`Missing per-poll public source: ${p.id}`);
    institutionMap.set(p.comparison_unit_id, { id: p.comparison_unit_id, brand: p.brand, executor: p.executor, teamNote: raw.methodology?.team_continuity_rule || null });
    return {
      id: p.id, electionId: p.contest_id, institutionId: p.comparison_unit_id,
      fieldworkStart: p.fieldwork_start, fieldworkEnd: p.fieldwork_end, publishedAt: p.publication_date,
      indexDate: p.historical_import?.index_date ?? null, sourceDateText: p.historical_import?.date_text ?? null,
      historicalContext: p.historical_import?.candidate_context ?? null, verificationNote: p.verification_note ?? null,
      question: p.question ?? p.historical_import?.question ?? null, questionCandidateSet: p.question_candidate_set ?? null,
      productType: p.product_type, candidateSet: p.candidate_set,
      calculationBlocker: p.verification_review?.calculationBlocker ?? null,
      verificationReview: p.verification_review ?? null,
      status: p.verification_status === 'verified_primary' ? 'verified' : 'pending', source: source(p.sources?.[0]), sources: p.sources.map(source),
      shares: { ...p.raw_support_percent }, undecided: p.undecided_percent, other: p.other_percent ?? null,
      otherResponses: p.other_responses ?? null,
      isExplicitFinal: p.explicit_final_poll_label === true, closingEvidence: p.explicit_final_poll_label === true ? source(p.sources?.[0]) : undefined,
      commissioner: p.commissioner, executor: p.executor, funder: p.funder, designAndAnalysis: p.design_and_analysis,
      teamId: null, teamNote: p.team_continuity_verified === true ? null : raw.methodology?.team_continuity_rule || '完整團隊連續性未核實。',
      sampleSize: p.sample_size_total, sampleSizeSupportQuestion: p.sample_size_support_question,
      surveyTotalSampleSize: p.survey_total_sample_size ?? null,
      method: p.mode, population: p.population,
      samplingFrame: p.id === '2022-taipei-zmedia' ? '住宅電話名冊輔助隨機跳號' : p.sampling_frame,
      weighting: p.weighting, reportedMarginOfError: p.reported_margin_of_error_pp, reportedConfidenceLevel: p.reported_confidence_level,
      supportDenominator: p.support_denominator, rawMeans: p.raw_means, notes: (p.notes || []).join('\n'),
      selectionLabel: p.selection_label, latestAvailableGuaranteed: p.latest_available_guaranteed,
      aggregateSourceEligible: p.aggregate_source_eligible, sourceCalculation: p.calculation,
      provenance: { ...p, ...(p.id === '2022-taipei-zmedia' ? { sampling_frame: '住宅電話名冊輔助隨機跳號' } : {}) },
    };
  });
  const corrections = elections.filter(e => e.notes.length).map(e => ({ date: raw.verified_at, title: `${e.label}結果核對`, description: e.notes.join(' '), source: e.result.sources.at(-1) || e.result.source }));
  if (polls.some(p => p.id === '2022-taipei-zmedia')) corrections.push({ date: raw.verified_at, title: '震傳媒 2022 臺北調查方法註記修正', description: '抽樣框僅記錄來源可證實的「住宅電話名冊輔助隨機跳號」；移除未經來源證實的末兩碼替換細節。支持度與 MAE 數值不變。', source: polls.find(p => p.id === '2022-taipei-zmedia').source });
  for (const change of raw.data_changes ?? []) corrections.push({ date: change.date, title: change.title, description: change.description, source: source(change.source) });
  const history = rows => (rows ?? []).map(row => ({ ...row, verificationReview: row.verificationReview ?? row.verification_review ?? null, sources: row.sources.map(source) }));
  const data = { version: `${raw.schema_version}+${raw.verified_at.replaceAll('-', '')}`, updatedAt: raw.verified_at, frozenAt: raw.frozen_at, score: 'normalized_mae_pp', scope: raw.scope, methodology: raw.methodology, commonComparisonNotes: raw.common_contest_comparisons, elections, institutions: [...institutionMap.values()], polls, historicalContexts: history(raw.historical_contexts), heldRecords: history(raw.held_records), corrections };
  for (const poll of polls) {
    const ev = evaluatePoll(poll, elections.find(e => e.id === poll.electionId), { within30Days: false });
    if (poll.status === 'verified' && !ev.eligible) throw new Error(`Audited poll rejected: ${poll.id}: ${ev.reason}`);
    const expected = poll.sourceCalculation?.normalized_mae_pp;
    if (poll.status === 'verified' && (typeof expected !== 'number' || Math.abs(ev.mae - expected) > 1e-9)) throw new Error(`Normalized MAE mismatch: ${poll.id}: ${ev.mae} vs ${expected}`);
  }
  if (raw.scope?.verified_poll_records !== undefined && raw.scope.verified_poll_records !== polls.filter(p => p.status === 'verified').length) throw new Error('Verified poll count does not match source scope.');
  if (raw.scope?.total_poll_records !== undefined && raw.scope.total_poll_records !== polls.length) throw new Error('Total poll count does not match source scope.');
  if (raw.scope?.official_contests_verified !== undefined && raw.scope.official_contests_verified !== elections.length) throw new Error('Official election count does not match source scope.');
  for (const group of raw.common_contest_comparisons || []) {
    const computed = commonElectionComparison(data, group.eligible_units.map(unit => unit.comparison_unit_id));
    if (!sameSet(computed.commonElectionIds, group.common_contest_ids)) throw new Error('Common-election intersection mismatch.');
    for (const unit of group.eligible_units) {
      const actual = computed.rows.find(row => row.institutionId === unit.comparison_unit_id)?.average;
      if (Math.abs(actual - unit.normalized_mean_mae_pp) > 1e-9) throw new Error(`Common-election average mismatch: ${unit.comparison_unit_id}`);
    }
  }
  return data;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2];
  if (!input) throw new Error('Provide the absolute path to the complete audited public JSON.');
  const raw = JSON.parse(await readFile(input, 'utf8'));
  const data = adaptVerifiedData(raw);
  const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(resolve(publicDirectory, 'verified.json'), JSON.stringify(data) + '\n');
  const publicSource = structuredClone(raw);
  const revised = publicSource.polls.find(p => p.id === '2022-taipei-zmedia');
  if (revised) revised.sampling_frame = '住宅電話名冊輔助隨機跳號';
  await writeFile(resolve(publicDirectory, 'verified-source.json'), JSON.stringify(publicSource) + '\n');
  process.stdout.write(JSON.stringify({ elections: data.elections.length, polls: data.polls.length, institutions: data.institutions.length, score: data.score, version: data.version }) + '\n');
}
