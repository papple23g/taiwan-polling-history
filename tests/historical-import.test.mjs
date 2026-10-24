import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildHistoricalImport, sourcesFor } from '../scripts/import-historical-polls.mjs';
import { adaptVerifiedData } from '../scripts/import-verified-data.mjs';
import { evaluatePoll } from '../src/domain.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const input = await json('../source-data/historical-poll-index.json');
const parts = await Promise.all(Array.from({ length: 16 }, (_, index) => json(`../source-data/parts/${String(index + 1).padStart(2, '0')}.json`)));
const result = buildHistoricalImport(parts, input);
const raw = await json('../source-data/audited-source.json');
const data = adaptVerifiedData(raw);
const publicSource = source => { const url = new URL(source.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; };
const digest = value => createHash('sha256').update(JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
function importFixture(record, existing = []) {
  return buildHistoricalImport([
    { part_type: 'metadata', data: { schema_version: '1.3.0', verified_at: '2026-10-18', scope: {}, methodology: {}, common_contest_comparisons: [] } },
    { part_type: 'contests', data: raw.contests }, { part_type: 'polls', data: existing },
  ], { id: 'isolated-import-regression', checked_at: '2026-10-18', records: [record] });
}
const pendingFixture = auditId => ({ ...structuredClone(input.records.find(record => record.auditId === auditId)),
  disposition: 'missing_record', auditDisposition: 'missing_record', decision: 'import_pending', proposedVerification: 'pending',
  verificationReview: null, productType: 'voting_intention_poll', matchedExistingIds: [] });

test('source recovery never marks an unread original URL as read when only its alternate was retrieved', () => {
  const sources = sourcesFor({ brand: '來源追溯', sourceUrl: 'https://publisher.example/old', evidenceTier: 'primary_fulltext',
    verificationReview: { status: 'partial' }, supplementalSources: [{ title: '搬遷原文', url: 'https://publisher.example/new',
      kind: 'primary_publisher_report', readStatus: 'full_public_text' }] }, '2026-10-18');
  assert.equal(sources.find(source => source.url.endsWith('/old')).access_method, 'not_independently_checked');
  assert.equal(sources.find(source => source.url.endsWith('/new')).access_method, 'full_public_text');
});

test('import canonicalizes official spelling in complete candidate questions without changing original observations', () => {
  const record = pendingFixture('local-2018-0035');
  record.questionCandidateSet = raw.contests.find(contest => contest.id === record.electionId).candidates.map(candidate => candidate.name === '吳蕚洋' ? '吳萼洋' : candidate.name);
  const imported = importFixture(record);
  assert.equal(imported.contexts.length, 0);
  const poll = adaptVerifiedData(imported.raw).polls[0];
  assert.ok(poll.questionCandidateSet.includes('吳蕚洋'));
  assert.ok(!poll.questionCandidateSet.includes('吳萼洋'));
  assert.ok(Number.isFinite(evaluatePoll(poll, data.elections.find(election => election.id === poll.electionId), { within30Days: false }).provisionalMae));
  assert.ok('吳萼洋' in poll.provenance.historical_import.indexed_observations.shares);
});

test('non-voting questions remain separate contexts even without an explicit context-only decision', () => {
  const record = pendingFixture('president-early-0001');
  record.productType = 'election_outcome_expectation';
  const imported = importFixture(record);
  assert.equal(imported.raw.polls.length, 0);
  assert.equal(imported.contexts.length, 1);
  assert.equal(imported.contexts[0].productType, 'election_outcome_expectation');
  assert.equal(imported.contexts[0].officialScoreEligible, false);
});

test('rolling and weekly sampling classifications retain voting-intention records and scores', () => {
  for (const productType of ['rolling_three_day_sample', 'weekly_combined_sample']) {
    const record = pendingFixture('president-early-0001');
    record.productType = productType;
    const imported = importFixture(record);
    assert.equal(imported.contexts.length, 0, productType);
    assert.equal(imported.raw.polls.length, 1, productType);
    const poll = adaptVerifiedData(imported.raw).polls[0];
    assert.equal(poll.productType, 'voting_intention_poll', productType);
    assert.equal(poll.provenance.sampling_product_type, productType);
    assert.ok(Number.isFinite(evaluatePoll(poll, data.elections.find(election => election.id === poll.electionId), { within30Days: false }).provisionalMae), productType);
  }
});

test('a source-verified candidate context stays pending and receives no MAE', () => {
  const record = structuredClone(input.records.find(row => row.auditId === 'local-2022-0046'));
  const imported = importFixture(record);
  const poll = imported.raw.polls.find(row => row.id === record.publicRecordId);
  const adapted = adaptVerifiedData(imported.raw).polls.find(row => row.id === record.publicRecordId);
  const evaluation = evaluatePoll(adapted, data.elections.find(row => row.id === adapted.electionId), { within30Days: false });
  assert.equal(poll.verification_status, 'indexed_secondary');
  assert.equal(poll.primary_mae_pp, null);
  assert.equal(poll.calculation.normalized_mae_pp, null);
  assert.ok(imported.promotionsRejected.some(item => item.auditId === record.auditId));
  assert.equal(evaluation.mae, null);
  assert.equal(evaluation.provisionalMae, null);
});

test('explicit reviewed nulls clear stale pending values while original source observations remain traceable', () => {
  const original = structuredClone(raw.polls.find(poll => poll.verification_status !== 'verified_primary'));
  const record = { ...pendingFixture('president-early-0001'), electionId: original.contest_id, disposition: 'existing_record',
    matchedExistingIds: [original.id], hasEnrichment: true, enrichedFields: { fieldworkEnd: true, undecided: true },
    fieldworkEnd: null, undecided: null, verificationReview: { auditId: 'null-regression', status: 'partial' } };
  const imported = importFixture(record, [original]);
  assert.equal(imported.raw.polls[0].fieldwork_end, null);
  assert.equal(imported.raw.polls[0].undecided_percent, null);
  assert.equal(imported.raw.polls[0].verification_status, 'indexed_secondary');
});

test('all 1215 audited leads are accounted for exactly once and imports are reproducible', () => {
  assert.equal(input.records.length, 1215);
  assert.equal(result.accounting.length, input.records.length);
  assert.equal(new Set(result.accounting.map(row => row.auditId)).size, input.records.length);
  for (const disposition of ['missing_record', 'candidate_set_review', 'unresolved']) {
    const records = input.records.filter(row => row.auditDisposition === disposition);
    assert.equal(records.length, { missing_record: 661, candidate_set_review: 410, unresolved: 5 }[disposition]);
    assert.ok(records.every(row => ['imported', 'context', 'held', 'excluded'].includes(result.accounting.find(item => item.auditId === row.auditId)?.result)));
  }
  assert.equal(digest(result.raw), digest(raw), 'Reimport must reproduce the complete public source without data drift.');
  assert.equal(data.polls.length, raw.scope.total_poll_records);
  assert.equal(new Set(data.polls.map(row => row.electionId)).size, 14);
});

test('every public poll, candidate scenario and held record has a public per-record source', () => {
  const records = [...data.polls, ...data.historicalContexts, ...data.heldRecords];
  for (const row of records) {
    assert.ok(row.sources.length > 0, row.id);
    assert.ok(row.sources.every(publicSource), row.id);
  }
  for (const row of [...data.historicalContexts, ...data.heldRecords]) {
    assert.equal(row.officialScoreEligible, false, row.id);
    assert.equal(row.status, 'pending', row.id);
  }
});

test('all 1119 fixed audit IDs remain individually traceable across public record types', () => {
  const records = [...data.polls, ...data.historicalContexts, ...data.heldRecords];
  const audited = records.filter(record => record.verificationReview);
  assert.equal(audited.length, 1119);
  assert.equal(new Set(audited.map(record => record.verificationReview.auditId)).size, 1119);
  assert.deepEqual(Object.fromEntries(['poll', 'context', 'held'].map(type => [type,
    audited.filter(record => record.verificationReview.originalRecordType === type).length])), { poll: 737, context: 356, held: 26 });
  for (const record of audited) {
    const review = record.verificationReview;
    assert.equal(record.id, review.originalPublicRecordId, review.auditId);
    assert.ok(review.originalObservations, review.auditId);
    assert.ok(review.attempts.length > 0, review.auditId);
    for (const evidence of Object.values(review.fieldEvidence)) {
      assert.ok(evidence.locator, review.auditId);
      assert.ok(publicSource(evidence), review.auditId);
    }
    if (['primary_verified', 'secondary_cross_checked'].includes(review.status) || review.conflictsResolved || review.conflicts.length || review.originalRecordType === 'held') {
      assert.equal(review.independentReview.status, 'approved', review.auditId);
    }
  }
});

test('unresolved comparison-input conflicts block trials and 101 percent response totals retain arithmetic with warnings', () => {
  for (const auditId of ['president-early-0045', 'president-early-0149', 'president-early-0169', 'president-early-0209', 'president-early-0221']) {
    const poll = data.polls.find(record => record.verificationReview?.auditId === auditId);
    assert.ok(poll, auditId);
    const evaluation = evaluatePoll(poll, data.elections.find(election => election.id === poll.electionId), { within30Days: false });
    assert.equal(evaluation.mae, null, auditId);
    assert.equal(evaluation.provisionalMae, null, auditId);
    assert.match(evaluation.calculationReason, /unresolved comparison-input conflict/i, auditId);
  }
  const rounding = data.polls.find(poll => poll.id === '2024-president-wiki-tvbs-tvbs-poll-center-2023-12-28-1f0dh33');
  const evaluation = evaluatePoll(rounding, data.elections.find(election => election.id === rounding.electionId), { within30Days: false });
  assert.equal(evaluation.mae, null);
  assert.ok(Number.isFinite(evaluation.provisionalMae));
  assert.ok(evaluation.calculationWarnings.length > 0);
});

test('pending records never receive an official score and verified promotions have six core field URLs', () => {
  assert.equal(data.polls.filter(row => row.status === 'verified' && !row.verificationReview).length, 57);
  assert.ok(data.polls.some(row => row.status === 'verified' && row.verificationReview));
  for (const poll of data.polls) {
    const evaluation = evaluatePoll(poll, data.elections.find(election => election.id === poll.electionId), { within30Days: false });
    if (poll.status === 'pending') { assert.equal(evaluation.mae, null, poll.id); assert.equal(evaluation.eligible, false, poll.id); }
    else {
      assert.equal(evaluation.eligible, true, poll.id);
      const provenance = poll.provenance.historical_import || (poll.provenance.source_enrichment?.previous_verification_status === 'indexed_secondary' ? poll.provenance.source_enrichment : null);
      if (provenance) {
        for (const field of ['shares', 'fieldworkEnd', 'publishedAt', 'executor', 'sampleSize', 'method']) assert.ok(provenance.field_evidence[field]?.url, `${poll.id}: ${field}`);
      }
    }
  }
});

test('unknown dates, source rounding conflicts, question scenarios and sample denominators stay explicit', () => {
  const unknown = data.polls.find(row => row.verificationReview?.auditId === 'president-early-0133');
  assert.equal(unknown.fieldworkEnd, null); assert.equal(unknown.indexDate, '2011-12-10');
  const four = data.historicalContexts.find(row => row.id === 'local-2022-0002');
  assert.equal(four.shares['黃國昌'], 5.5);
  assert.ok(!data.polls.some(row => row.provenance.historical_import?.record_id === four.id));
  const rounding = data.polls.find(row => row.id === '2024-president-wiki-tvbs-tvbs-poll-center-2023-12-28-1f0dh33');
  assert.equal(rounding.status, 'pending'); assert.equal(rounding.undecided, 9);
  assert.match(rounding.verificationNote, /101%/);
  assert.equal(rounding.sampleSize, 1074); assert.equal(rounding.sampleSizeSupportQuestion, 951);
  const conflict = data.heldRecords.find(row => row.id === 'local-2018-0071');
  assert.equal(Object.values(conflict.shares).reduce((sum, value) => sum + value, 0) + conflict.undecided, 101);
  const alias = data.polls.find(row => row.provenance.historical_import?.record_id === 'local-2018-0035');
  assert.ok('吳蕚洋' in alias.shares); assert.ok(!('吳萼洋' in alias.shares));
  assert.ok('吳萼洋' in alias.provenance.historical_import.indexed_observations.shares);
  const fullQuestion = data.polls.find(row => row.provenance.historical_import?.record_id === 'local-2022-0047');
  assert.equal(fullQuestion.questionCandidateSet.length, 12); assert.equal(fullQuestion.shares['童文薰'], 0.3);
  assert.equal(fullQuestion.shares['王文娟'], undefined);
  for (const poll of data.polls.filter(row => row.status === 'verified' && row.provenance.source_enrichment?.previous_verification_status === 'indexed_secondary')) {
    assert.match(poll.verificationNote, /核實/);
    assert.doesNotMatch(poll.notes, /不能列入正式 MAE/);
  }
});
