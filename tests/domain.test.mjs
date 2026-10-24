import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDistribution, calculatePollError, evaluatePoll, selectFinalPoll, selectElectionPolls, selectSingleElectionPolls,
  commonElectionComparison, filterAndSortRows, exportCsv,
} from '../src/domain.mjs';
import { pageNumbers } from '../src/pagination.mjs';
import { institutionBrand, institutionGroups, compareInstitutionBrands } from '../src/institution-model.mjs';

// Synthetic fixtures stay in tests; none represents a real institution or poll.
const source = (name = 'Original evidence') => ({ title: name, url: 'https://example.org/original', publishedAt: '2024-01-20', accessedAt: '2024-03-02' });
const election = (changes = {}) => ({
  id: 'e1', label: 'Synthetic election', year: 2024, date: '2024-03-01', region: 'Test region', office: 'Test office', status: 'verified',
  candidates: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
  result: { status: 'verified', votes: { a: 600, b: 400 }, validVotes: 1000, source: source('Official result') },
  ...changes,
});
const poll = (changes = {}) => ({
  id: 'p1', electionId: 'e1', institutionId: 'i1', fieldworkStart: '2024-02-17', fieldworkEnd: '2024-02-20', publishedAt: '2024-02-21',
  status: 'verified', source: source(), shares: { a: 45, b: 35 }, undecided: 15, other: 5, isExplicitFinal: false,
  ...changes,
});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const row = (p, e = election(), brand) => ({ poll: p, evaluation: evaluatePoll(p, e), brand });

test('normalization retains raw total and computes a known MAE in percentage points', () => {
  const normalized = normalizeDistribution({ a: 45, b: 35 }, ['a', 'b']);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.total, 80);
  assert.deepEqual(normalized.values, { a: 56.25, b: 43.75 });
  const result = evaluatePoll(poll(), election());
  assert.equal(result.eligible, true);
  assert.equal(result.reason, null);
  assert.deepEqual(result.pollRaw, { a: 45, b: 35 });
  assert.deepEqual(result.resultRaw, { a: 60, b: 40 });
  assert.equal(result.mae, 3.75);
  assert.equal(result.calculation.mae, result.mae);
  assert.equal(result.provisionalMae, null);
});

test('pure error calculation ignores verification, sources, dates, samples and precomputed scores without mutating inputs', () => {
  const p = poll({
    status: 'pending', fieldworkStart: null, fieldworkEnd: null, publishedAt: 'not-a-date', source: null,
    sampleSize: null, sampleSizeSupportQuestion: -1, sourceCalculation: { normalized_mae_pp: 999, raw_mae_pp: -1 },
  });
  const e = election({ date: null, status: 'pending', result: { status: 'pending', votes: { a: 600, b: 400 }, validVotes: 1000, source: null } });
  const before = structuredClone({ p, e });
  const calculated = calculatePollError(p, e);
  assert.deepEqual(calculated, {
    calculable: true, mae: 3.75, pollNormalized: { a: 56.25, b: 43.75 }, resultNormalized: { a: 60, b: 40 }, reason: null, warnings: [],
  });
  assert.deepEqual({ p, e }, before);
  const evaluated = evaluatePoll(p, e);
  assert.equal(evaluated.eligible, false);
  assert.equal(evaluated.mae, null);
  assert.equal(evaluated.provisionalMae, 3.75);
  assert.equal(evaluated.calculationReason, null);
  assert.deepEqual(evaluated.pollNormalized, calculated.pollNormalized);
  assert.deepEqual(evaluated.calculation, calculated);
});

test('date and original-source failures preserve provisional arithmetic but never produce an official score', () => {
  const cases = [
    poll({ fieldworkStart: null, fieldworkEnd: null, publishedAt: null }),
    poll({ fieldworkEnd: '2024-02-30' }),
    poll({ fieldworkStart: '2024-02-22' }),
    poll({ publishedAt: '2024-02-19' }),
    poll({ fieldworkStart: '2024-03-02', fieldworkEnd: '2024-03-02', publishedAt: '2024-03-03' }),
    poll({ fieldworkStart: '2024-01-29', fieldworkEnd: '2024-01-30', publishedAt: '2024-01-31' }),
    poll({ source: { url: 'http://127.0.0.1/private' } }),
  ];
  for (const p of cases) {
    const evaluation = evaluatePoll(p, election());
    assert.equal(evaluation.eligible, false, JSON.stringify(p));
    assert.equal(evaluation.mae, null);
    assert.equal(evaluation.provisionalMae, 3.75);
    assert.equal(evaluation.calculation.calculable, true);
  }
  const widened = evaluatePoll(cases[5], election(), { within30Days: false });
  assert.equal(widened.eligible, true);
  assert.equal(widened.mae, 3.75);
  assert.equal(widened.provisionalMae, null);
});

test('pure arithmetic rejects missing, unknown and invalid support instead of borrowing a source calculation', () => {
  const invalid = [
    { a: 45 }, { a: 45, b: null }, { a: 45, b: undefined }, { a: 45, b: '35' },
    { a: 45, b: NaN }, { a: 45, b: Infinity }, { a: 45, b: -1 }, { a: 45, b: 100.1 },
    { a: 45, b: 35, unknown: 1 }, { a: 0, b: 0 }, { a: 60, b: 40.51 },
  ];
  for (const shares of invalid) {
    const p = poll({ status: 'pending', shares, sourceCalculation: { normalized_mae_pp: 0 } });
    const calculation = calculatePollError(p, election());
    assert.equal(calculation.calculable, false, JSON.stringify(shares));
    assert.equal(calculation.mae, null);
    assert.equal(calculation.pollNormalized, null);
    assert.ok(calculation.reason);
    const evaluated = evaluatePoll(p, election());
    assert.equal(evaluated.provisionalMae, null);
    assert.equal(evaluated.calculationReason, calculation.reason);
  }
  const zero = calculatePollError(poll({ shares: { a: 0, b: 50 }, undecided: null, other: null }), election());
  assert.equal(zero.calculable, true);
  assert.deepEqual(zero.pollNormalized, { a: 0, b: 100 });
  assert.equal(zero.mae, 60);
  assert.equal(calculatePollError(null, election()).calculable, false);
  assert.equal(calculatePollError(poll(), null).calculable, false);
  assert.equal(calculatePollError(poll({ electionId: 'other' }), election()).calculable, false);
});

test('response-total conflicts warn in the calculation while the official 100.5 percent gate remains strict', () => {
  const p = poll({ shares: { a: 45, b: 35 }, undecided: 21, other: null });
  const calculated = calculatePollError(p, election());
  assert.equal(calculated.calculable, true);
  assert.equal(calculated.mae, 3.75);
  assert.match(calculated.warnings[0], /undecided and other exceed 100\.5/);
  const evaluated = evaluatePoll(p, election());
  assert.equal(evaluated.eligible, false);
  assert.equal(evaluated.mae, null);
  assert.equal(evaluated.provisionalMae, 3.75);
  assert.deepEqual(evaluated.calculationWarnings, calculated.warnings);
  assert.match(evaluated.reason, /undecided and other exceed 100\.5/);
  const subset = election({ comparisonCandidateIds: ['a'] });
  const excessiveCandidates = calculatePollError(poll({ shares: { a: 60, b: 41 }, undecided: null, other: null }), subset);
  assert.equal(excessiveCandidates.calculable, false, 'excluded reported candidates still count toward the candidate total');
  for (const key of ['undecided', 'other']) {
    for (const value of [-1, Infinity, '20', 101]) assert.equal(calculatePollError(poll({ [key]: value }), election()).calculable, false);
  }
});

test('unsupported products, alternate candidate scenarios and unresolved support cannot receive a trial score', () => {
  const cases = [
    { provenance: { product_type: 'approval_poll' } },
    { productType: 'voting_intention_poll', provenance: { product_type: 'approval_poll' } },
    { candidateSet: ['a'] }, { candidateSet: ['a', 'unknown'] }, { candidateSet: ['a', 'a'] },
    { questionCandidateSet: ['a', 'b', 'unknown'] }, { provenance: { candidate_set: ['a'] } },
    { verification_review: { calculation_blocker: 'The support question has not been identified.' } },
    { calculationBlocker: 'historical_candidate_context' },
    { calculationBlocker: '同波蔡英文支持度在同片圓餅圖與趨勢圖不同，輸入尚未裁定。' },
    { calculationBlocker: '同一文件當期圖與趨勢圖不一致。' },
    { calculationBlocker: '黨名題誤轉為候選人題；不可直接納候選人MAE。' },
    { calculationBlocker: '經濟建設能力題不可當投票支持度計MAE。' },
    { calculationBlocker: '完整報告的逐字題目與圖表候選姓名不一致。' },
  ];
  for (const change of cases) {
    const p = poll({ ...change, status: 'pending' });
    const calculated = calculatePollError(p, election());
    assert.equal(calculated.calculable, false, JSON.stringify(change));
    assert.equal(calculated.mae, null);
    assert.equal(evaluatePoll(p, election()).provisionalMae, null);
  }
  const unresolvedSourceConflict = poll({
    calculationBlocker: 'Two conflicting support distributions identify the same wave.', status: 'pending',
  });
  const conflictCalculation = calculatePollError(unresolvedSourceConflict, election());
  assert.equal(conflictCalculation.calculable, true);
  assert.equal(conflictCalculation.mae, 3.75);
  assert.match(conflictCalculation.warnings.join(' '), /conflicting support distributions/);
  const conflictEvaluation = evaluatePoll(unresolvedSourceConflict, election());
  assert.equal(conflictEvaluation.eligible, false);
  assert.equal(conflictEvaluation.mae, null);
  assert.equal(conflictEvaluation.provisionalMae, 3.75);

  const verifiedConflict = evaluatePoll({ ...unresolvedSourceConflict, status: 'verified' }, election());
  assert.equal(verifiedConflict.eligible, false, 'an unresolved calculation review still blocks official eligibility');
  assert.equal(verifiedConflict.mae, null);
  assert.equal(verifiedConflict.provisionalMae, 3.75);
  assert.match(verifiedConflict.reason, /unresolved calculation review/);

  const street = poll({ productType: 'nonprobability_street_interview', status: 'pending' });
  const streetCalculation = calculatePollError(street, election());
  assert.equal(streetCalculation.calculable, true);
  assert.equal(streetCalculation.mae, 3.75);
  const streetEvaluation = evaluatePoll(street, election());
  assert.equal(streetEvaluation.eligible, false);
  assert.equal(streetEvaluation.mae, null);
  assert.equal(streetEvaluation.provisionalMae, 3.75);
  const formalStreet = evaluatePoll({ ...street, status: 'verified' }, election(), { within30Days: false });
  assert.equal(formalStreet.eligible, false);
  assert.equal(formalStreet.mae, null);
  assert.equal(formalStreet.provisionalMae, 3.75);
  assert.match(formalStreet.reason, /formal comparison/);
  const fullQuestion = calculatePollError(poll({ productType: 'voting_intention_poll', candidateSet: ['b', 'a'], questionCandidateSet: ['a', 'b'] }), election({ comparisonCandidateIds: ['a'] }));
  assert.equal(fullQuestion.calculable, true, 'an explicit comparison subset may come from the full official candidate question');
  assert.equal(fullQuestion.mae, 0);
  const totalWarningOnly = calculatePollError(poll({ disposition: 'source_conflict', shares: { a: 45, b: 35 }, undecided: 21, other: null }), election());
  assert.equal(totalWarningOnly.calculable, true, 'a generic source-conflict label cannot silently block valid candidate arithmetic');
});

test('pure calculation requires complete official votes and a matching declared valid-vote total', () => {
  const e = election();
  for (const result of [
    { ...e.result, votes: { a: 600 } }, { ...e.result, votes: { a: 600, b: null } },
    { ...e.result, votes: { a: 600, b: '400' } }, { ...e.result, votes: { a: 600, b: Infinity } },
    { ...e.result, votes: { a: 600, b: -1 } }, { ...e.result, votes: { a: 600, b: 400, unknown: 1 } },
    { ...e.result, votes: { a: 0, b: 0 } }, { ...e.result, validVotes: 999 },
    { ...e.result, validVotes: '1000' }, { ...e.result, validVotes: 0 },
  ]) {
    const calculated = calculatePollError(poll(), { ...e, result });
    assert.equal(calculated.calculable, false, JSON.stringify(result));
    assert.equal(calculated.mae, null);
  }
  assert.equal(calculatePollError(poll(), { ...e, result: { ...e.result, validVotes: null } }).mae, 3.75);
  const subset = { ...e, comparisonCandidateIds: ['a'], result: { ...e.result, votes: { a: 600, b: null } } };
  assert.equal(calculatePollError(poll(), subset).calculable, false, 'excluded official votes are still required for result integrity');
});

test('missing and null candidate values never become zero', () => {
  for (const values of [{ a: 10 }, { a: 10, b: null }, { a: 10, b: undefined }]) {
    const result = normalizeDistribution(values, ['a', 'b']);
    assert.equal(result.ok, false);
    assert.equal(result.values, null);
    assert.match(result.reason, /Missing value/);
  }
  const result = evaluatePoll(poll({ shares: { a: 40, b: null } }), election());
  assert.equal(result.eligible, false);
  assert.equal(result.mae, null);
  assert.equal(result.pollRaw.b, null);
});

test('normalization rejects invalid individual numbers and accepts a real zero', () => {
  for (const value of ['10', NaN, Infinity, -1, 100.1]) assert.equal(normalizeDistribution({ a: value, b: 30 }, ['a', 'b']).ok, false);
  assert.deepEqual(normalizeDistribution({ a: 0, b: 50 }, ['a', 'b']).values, { a: 0, b: 100 });
  const zero = normalizeDistribution({ a: 0, b: 0 }, ['a', 'b']);
  assert.equal(zero.ok, false);
  assert.equal(zero.total, 0);
});

test('candidate declarations reject empty, duplicate, and unknown IDs', () => {
  for (const ids of [[], ['a', 'a'], [''], null]) assert.equal(normalizeDistribution({ a: 40 }, ids).ok, false);
  assert.equal(evaluatePoll(poll(), election({ comparisonCandidateIds: ['a', 'unknown'] })).eligible, false);
  assert.equal(evaluatePoll(poll(), election({ candidates: [{ id: 'a' }, { id: 'a' }] })).eligible, false);
  assert.equal(evaluatePoll(poll({ shares: { a: 45, b: 35, unknown: 2 } }), election()).eligible, false);
});

test('reported totals accept rounding through 100.5 but reject impossible distributions', () => {
  assert.equal(normalizeDistribution({ a: 60, b: 40.5 }, ['a', 'b']).ok, true);
  assert.equal(normalizeDistribution({ a: 60, b: 40.51 }, ['a', 'b']).ok, false);
  assert.equal(normalizeDistribution({ a: 90, b: 90 }, ['a', 'b']).ok, false);
  assert.equal(evaluatePoll(poll({ shares: { a: 45.5, b: 35 } }), election()).eligible, true);
  const excessive = evaluatePoll(poll({ shares: { a: 45.51, b: 35 } }), election());
  assert.equal(excessive.eligible, false);
  assert.equal(excessive.mae, null);
  assert.match(excessive.reason, /undecided and other exceed/);
});

test('excluded reported candidates still require valid percentages and count toward totals', () => {
  const e = election({ comparisonCandidateIds: ['a'] });
  for (const value of ['30', undefined, NaN, Infinity, -1, 101]) {
    assert.equal(evaluatePoll(poll({ shares: { a: 45, b: value } }), e).eligible, false);
  }
  assert.equal(evaluatePoll(poll({ shares: { a: 45, b: null } }), e).eligible, true);
  assert.equal(evaluatePoll(poll({ shares: { a: 45, b: 40 } }), e).eligible, false);
});

test('an explicit matched subset normalizes both sides and exposes excluded candidates', () => {
  const e = election({
    candidates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], comparisonCandidateIds: ['a', 'b'],
    result: { status: 'verified', votes: { a: 500, b: 300, c: 200 }, validVotes: 1000, source: source() },
  });
  const p = poll({ shares: { a: 40, b: 20, c: 10 }, undecided: 30, other: 0 });
  const result = evaluatePoll(p, e);
  assert.equal(result.eligible, true);
  assert.deepEqual(result.candidateIds, ['a', 'b']);
  assert.deepEqual(result.excludedCandidates, ['c']);
  assert.equal(result.pollRaw.c, 10);
  assert.equal(result.resultRaw.c, 20);
  near(result.pollNormalized.a, 200 / 3);
  assert.equal(result.resultNormalized.a, 62.5);
  near(result.mae, 25 / 6);
  assert.deepEqual(normalizeDistribution(p.shares, ['a', 'b']).excludedIds, ['c']);
});

test('result totals must match the published valid votes; absent total uses complete votes', () => {
  const e = election();
  assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, validVotes: 999 } }).eligible, false);
  for (const value of ['1000', NaN, Infinity, -1, 0]) assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, validVotes: value } }).eligible, false);
  const withoutTotal = evaluatePoll(poll(), { ...e, result: { ...e.result, validVotes: null } });
  assert.equal(withoutTotal.eligible, true);
  assert.deepEqual(withoutTotal.resultRaw, { a: 60, b: 40 });
  assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, votes: { a: 600, b: null } } }).eligible, false);
  assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, votes: { a: 0, b: 0 }, validVotes: 0 } }).eligible, false);
});

test('the default pre-election window includes 1 and 30 days, excludes 31 and election day', () => {
  for (const [date, days, eligible] of [['2024-02-29', 1, true], ['2024-01-31', 30, true], ['2024-01-30', 31, false], ['2024-03-01', 0, false]]) {
    const p = poll({ fieldworkStart: date, fieldworkEnd: date, publishedAt: date });
    const result = evaluatePoll(p, election());
    assert.equal(result.daysBefore, days);
    assert.equal(result.eligible, eligible);
    if (!eligible) assert.equal(result.mae, null);
  }
  assert.equal(evaluatePoll(poll({ fieldworkStart: '2024-01-30', fieldworkEnd: '2024-01-30', publishedAt: '2024-01-31' }), election(), { within30Days: false }).eligible, true);
  assert.equal(evaluatePoll(poll({ fieldworkStart: '2024-03-01', fieldworkEnd: '2024-03-01', publishedAt: '2024-03-01' }), election(), { within30Days: false }).eligible, false);
});

test('dates must exist and follow fieldwork start <= end <= publication < election', () => {
  const changes = [
    { fieldworkStart: '2024-02-30' }, { fieldworkEnd: '2024-02-30' }, { publishedAt: 'not-a-date' },
    { fieldworkStart: '2024-02-22' }, { publishedAt: '2024-02-19' }, { publishedAt: '2024-03-01' },
    { publishedAt: '2024-02-21T25:00:00Z' }, { source: { ...source(), accessedAt: '2024-02-30' } },
  ];
  for (const change of changes) assert.equal(evaluatePoll(poll(change), election()).eligible, false, JSON.stringify(change));
  assert.equal(evaluatePoll(poll(), election({ date: '2023-02-29' })).eligible, false);
  assert.equal(evaluatePoll(poll({ publishedAt: '2024-02-21T12:30:00Z' }), election()).eligible, true);
});

test('an unknown fieldwork start stays missing while end and publication still govern eligibility', () => {
  for (const fieldworkStart of [null, undefined]) {
    const p = poll({ fieldworkStart });
    const result = evaluatePoll(p, election());
    assert.equal(result.eligible, true);
    assert.equal(result.daysBefore, 10);
    assert.equal(p.fieldworkStart, fieldworkStart);
    const [headers, cells] = parseCsv(exportCsv([row(p)], { elections: [election()] }));
    assert.equal(cells[headers.indexOf('fieldwork_start')], '');
    const old = { ...p, fieldworkEnd: '2024-01-30', publishedAt: '2024-01-31' };
    assert.equal(evaluatePoll(old, election()).eligible, false);
    assert.equal(evaluatePoll(old, election(), { within30Days: false }).eligible, true);
    assert.equal(evaluatePoll({ ...p, fieldworkEnd: null }, election()).eligible, false);
    assert.equal(evaluatePoll({ ...p, publishedAt: null }, election()).eligible, false);
  }
  for (const fieldworkStart of ['', 'unknown', '2024-02-30', 0, '2024-02-22']) {
    assert.equal(evaluatePoll(poll({ fieldworkStart }), election()).eligible, false);
  }
});

test('each verification status and both public original sources are required', () => {
  const e = election();
  assert.equal(evaluatePoll(poll({ status: 'pending' }), e).eligible, false);
  assert.equal(evaluatePoll(poll(), { ...e, status: 'pending' }).eligible, false);
  assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, status: 'pending' } }).eligible, false);
  for (const url of ['file:///private.pdf', 'https://localhost/data', 'http://127.0.0.1/a', 'http://192.168.1.1/a', 'javascript:alert(1)', 'https://user:secret@example.org/a']) {
    assert.equal(evaluatePoll(poll({ source: { url } }), e).eligible, false);
    assert.equal(evaluatePoll(poll(), { ...e, result: { ...e.result, source: { url } } }).eligible, false);
  }
  assert.equal(evaluatePoll(poll({ electionId: 'another' }), e).eligible, false);
});

test('Taiwan calendar days govern timestamp publication and exact times order same-day evidence', () => {
  const end = { fieldworkStart: '2024-02-29', fieldworkEnd: '2024-02-29' };
  for (const publishedAt of ['2024-03-01T00:01:00+08:00', '2024-02-29T16:01:00Z', '2024-03-01']) {
    assert.equal(evaluatePoll(poll({ ...end, publishedAt }), election()).eligible, false, publishedAt);
  }
  for (const publishedAt of ['2024-02-29T23:59:00+08:00', '2024-02-29T15:59:00Z', '2024-02-29']) {
    const result = evaluatePoll(poll({ ...end, publishedAt }), election());
    assert.equal(result.eligible, true, publishedAt);
    assert.equal(result.daysBefore, 1);
  }
  // Taiwan's midnight is still the preceding UTC day and must not precede its own date-only fieldwork day.
  assert.equal(evaluatePoll(poll({ ...end, publishedAt: '2024-02-29T00:01:00+08:00' }), election()).eligible, true);
  const timestampEnd = poll({ fieldworkStart: '2024-02-29T08:00:00+08:00', fieldworkEnd: '2024-02-29T15:00:00+08:00', publishedAt: '2024-02-29T07:01:00Z' });
  assert.equal(evaluatePoll(timestampEnd, election()).eligible, true);
  assert.equal(evaluatePoll({ ...timestampEnd, publishedAt: '2024-02-29T06:59:00Z' }, election()).eligible, false);
  assert.equal(evaluatePoll({ ...timestampEnd, fieldworkStart: '2024-02-29T15:01:00+08:00' }, election()).eligible, false);
  assert.equal(evaluatePoll(poll({ fieldworkStart: '2024-02-28', fieldworkEnd: '2024-02-29', publishedAt: '2024-02-28T15:59:00Z' }), election()).eligible, false);
});

test('a publicly evidenced closing poll outranks newer nonfinal polls', () => {
  const closing = poll({ id: 'closing', fieldworkStart: '2024-02-14', fieldworkEnd: '2024-02-15', isExplicitFinal: true, closingEvidence: source('Final-poll wording') });
  const latest = poll({ id: 'latest', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-25' });
  const selected = selectFinalPoll([latest, closing], election(), 'i1');
  assert.equal(selected.poll.id, 'closing');
  assert.equal(selected.selectionReason, 'explicit-final');
});

test('missing or nonpublic closing evidence uses latest end and publication, deduplicating exact reprints', () => {
  const unsupported = poll({ id: 'claimed', isExplicitFinal: true });
  const a = poll({ id: 'a', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-25' });
  const b = poll({ id: 'b', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-26' });
  const z = poll({ id: 'z', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-26', shares: { b: 35, a: 45 } });
  for (const list of [[unsupported, a, b, z], [z, b, a, unsupported]]) {
    const selected = selectFinalPoll(list, election(), 'i1');
    assert.equal(selected.poll.id, 'z');
    assert.equal(selected.selectionReason, 'latest-eligible');
  }
  assert.equal(selectFinalPoll([poll({ isExplicitFinal: true, closingEvidence: { url: 'file:///private.pdf' } }), a], election(), 'i1').poll.id, 'a');
  assert.equal(selectFinalPoll([], election(), 'i1'), null);
});

test('unresolved leading ties require manual resolution instead of ID, accuracy, or older fallback', () => {
  const a = poll({ id: 'a', source: { ...source(), url: 'https://example.org/one' } });
  const z = poll({ id: 'z', source: { ...source(), url: 'https://example.org/two' }, shares: { a: 60, b: 40 }, undecided: 0, other: 0 });
  const older = poll({ id: 'older', fieldworkEnd: '2024-02-18' });
  for (const list of [[a, z, older], [older, z, a]]) {
    assert.equal(selectFinalPoll(list, election(), 'i1'), null);
    assert.deepEqual(selectElectionPolls(list, election()), []);
    assert.equal(selectElectionPolls(list, election(), { allPolls: true }).length, 3);
  }
  assert.equal(selectFinalPoll([a, { ...z, source: a.source }], election(), 'i1'), null, 'same source with different shares is not an exact reprint');
  assert.equal(selectFinalPoll([a, { ...z, shares: a.shares, undecided: 15, other: 5 }], election(), 'i1'), null, 'identical shares with different sources remain unresolved');
  const closing = { ...a, isExplicitFinal: true, closingEvidence: source() };
  assert.equal(selectFinalPoll([closing, z], election(), 'i1').poll.id, 'a', 'a unique evidenced-final rank resolves priority');
  assert.equal(selectFinalPoll([closing, { ...z, isExplicitFinal: true, closingEvidence: source() }, older], election(), 'i1'), null);
});

test('matching support, source and dates cannot hide conflicting substantive poll metadata', () => {
  const original = poll({
    id: 'a', method: 'Telephone', sampleSize: 1000, executor: 'Execution team', commissioner: 'Commissioner', funder: 'Funder',
    teamId: 'team-one', population: 'Eligible voters', weighting: 'Age and region',
    provenance: { verification_status: 'verified_primary', audit: { note: 'Original wording' } },
  });
  const conflicts = [
    { undecided: 10 }, { other: 0 }, { fieldworkStart: null }, { fieldworkStart: '2024-02-16' },
    { method: 'Online panel' }, { sampleSize: 900 }, { sampleSizeSupportQuestion: 600 },
    { executor: 'Another execution team' }, { commissioner: 'Another commissioner' }, { funder: 'Another funder' },
    { teamId: 'team-two' }, { population: 'All adults' }, { weighting: 'Not reported' },
    { source: { ...original.source, title: 'Conflicting source title' } },
    { provenance: { verification_status: 'verified_primary', audit: { note: 'Different wording' } } },
  ];
  for (const conflict of conflicts) {
    const competing = { ...original, id: 'z', ...conflict };
    assert.equal(evaluatePoll(competing, election()).eligible, true, JSON.stringify(conflict));
    for (const order of [[original, competing], [competing, original]]) {
      assert.equal(selectFinalPoll(order, election(), 'i1'), null, JSON.stringify(conflict));
    }
  }
});

test('complete identical reprints may differ only in record ID and object-key ordering', () => {
  const original = poll({ id: 'a', method: 'Telephone', sampleSize: 1000, sources: [{ ...source(), access_method: 'full_public_text' }], provenance: { verification_status: 'verified_primary', audit: { page: 2, note: 'Same wording' } } });
  const reprint = structuredClone(original);
  reprint.id = 'z';
  reprint.shares = { b: 35, a: 45 };
  reprint.provenance = { audit: { note: 'Same wording', page: 2 }, verification_status: 'verified_primary' };
  for (const order of [[original, reprint], [reprint, original]]) assert.equal(selectFinalPoll(order, election(), 'i1').poll.id, 'z');
  const conflictingSource = structuredClone(reprint);
  conflictingSource.sources[0].access_method = 'search_index_excerpt_only';
  assert.equal(selectFinalPoll([original, conflictingSource], election(), 'i1'), null);
});

test('closing-poll priority respects the active date and verification filters', () => {
  const old = poll({ id: 'old-final', fieldworkStart: '2024-01-29', fieldworkEnd: '2024-01-30', publishedAt: '2024-01-31', isExplicitFinal: true, closingEvidence: source() });
  const latest = poll({ id: 'latest' });
  assert.equal(selectFinalPoll([old, latest], election(), 'i1').poll.id, 'latest');
  assert.equal(selectFinalPoll([old, latest], election(), 'i1', { within30Days: false }).poll.id, 'old-final');
  assert.equal(selectFinalPoll([{ ...old, status: 'pending' }, latest], election(), 'i1', { within30Days: false }).poll.id, 'latest');
});

test('all-polls mode exposes pending records without making them comparable', () => {
  const pending = poll({ id: 'pending', status: 'pending', fieldworkEnd: '2024-02-22', publishedAt: '2024-02-23' });
  const polls = [poll(), pending, poll({ id: 'other', institutionId: 'i2' }), poll({ id: 'elsewhere', electionId: 'e2' })];
  assert.equal(selectElectionPolls(polls, election()).length, 2);
  const all = selectElectionPolls(polls, election(), { allPolls: true });
  assert.equal(all.length, 3);
  const exposed = all.find((item) => item.poll.id === 'pending');
  assert.equal(exposed.evaluation.eligible, false);
  assert.equal(exposed.evaluation.mae, null);
  assert.equal(exposed.selectionReason, 'ineligible');
  assert.match(exposed.evaluation.reason, /pending/);
});

test('single-election closing mode selects one latest record per institution, including pending records', () => {
  const explicitOlder = poll({ id: 'explicit-older', fieldworkEnd: '2024-02-20', publishedAt: '2024-02-21', isExplicitFinal: true, closingEvidence: source() });
  const pendingLatest = poll({ id: 'pending-latest', fieldworkEnd: '2024-02-27', publishedAt: '2024-02-28', status: 'pending' });
  const otherUnit = poll({ id: 'other-unit', institutionId: 'i2', fieldworkEnd: '2024-02-26', publishedAt: '2024-02-27' });
  const closing = selectSingleElectionPolls([explicitOlder, pendingLatest, otherUnit], election());
  assert.deepEqual(closing.rows.map((item) => item.poll.id), ['pending-latest', 'other-unit']);
  assert.equal(new Set(closing.rows.map((item) => item.poll.institutionId)).size, closing.rows.length);
  assert.equal(closing.rows.find((item) => item.poll.id === 'pending-latest').evaluation.eligible, false);
  assert.equal(selectFinalPoll([explicitOlder, pendingLatest], election(), 'i1').poll.id, 'explicit-older', 'formal cross-election selection stays unchanged');

  const history = selectSingleElectionPolls([explicitOlder, pendingLatest, otherUnit], election(), { view: 'history' });
  assert.equal(history.rows.length, 3);
});

test('closing mode ranks survey end before publication date and then uses publication date', () => {
  const earlierSurveyLaterPublication = poll({ id: 'earlier-survey', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-29' });
  const latestSurveyEarlierPublication = poll({ id: 'latest-survey', fieldworkEnd: '2024-02-26', publishedAt: '2024-02-27' });
  const sameSurveyLaterPublication = poll({ id: 'same-survey-later-pub', fieldworkEnd: '2024-02-26', publishedAt: '2024-02-28' });
  const result = selectSingleElectionPolls([earlierSurveyLaterPublication, latestSurveyEarlierPublication, sameSurveyLaterPublication], election());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].poll.id, 'same-survey-later-pub');
  assert.equal(result.rows[0].selectionReason, 'latest-record');
});

test('single-election tables collapse exact reprints while history retains distinct waves', () => {
  const original = poll({ id: 'wave-a', fieldworkEnd: '2024-02-25', publishedAt: '2024-02-26' });
  const exactCopy = { ...structuredClone(original), id: 'wave-a-copy' };
  const older = poll({ id: 'wave-b', fieldworkEnd: '2024-02-20', publishedAt: '2024-02-21' });
  const history = selectSingleElectionPolls([original, exactCopy, older], election(), { view: 'history' });
  assert.deepEqual(history.rows.map((item) => item.poll.id), ['wave-a-copy', 'wave-b']);
  assert.equal(selectSingleElectionPolls([original, exactCopy, older], election()).rows.length, 1);
});

test('undated records use a later publication date as a closing proxy, preserving the unknown survey date', () => {
  const known = poll({ id: 'known-latest', fieldworkEnd: '2024-02-24', publishedAt: '2024-02-25' });
  const undatedEarlier = poll({ id: 'undated-earlier', fieldworkEnd: null, publishedAt: '2024-02-23' });
  const undatedLater = poll({ id: 'undated-later', fieldworkEnd: null, publishedAt: '2024-02-28' });
  const result = selectSingleElectionPolls([known, undatedEarlier, undatedLater], election());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].poll.id, 'undated-later');
  assert.equal(result.rows[0].poll.fieldworkEnd, null);
  assert.equal(result.rows[0].selectionReason, 'publication-date-proxy');
  assert.equal(result.dateUnknownCount, 1);
});

test('single-election selection reports fully undated institutions and latest-wave support conflicts', () => {
  const fullyUndated = poll({ id: 'fully-undated', institutionId: 'i-unknown', fieldworkStart: null, fieldworkEnd: null, publishedAt: '2024-02-28' });
  const conflictA = poll({ id: 'conflict-a', institutionId: 'i-conflict', fieldworkEnd: '2024-02-27', publishedAt: '2024-02-28' });
  const conflictB = { ...conflictA, id: 'conflict-b', shares: { a: 40, b: 40 } };
  const resolved = poll({ id: 'resolved', institutionId: 'i-resolved', fieldworkEnd: '2024-02-27', publishedAt: '2024-02-28' });
  const result = selectSingleElectionPolls([fullyUndated, conflictA, conflictB, resolved], election());
  assert.deepEqual(result.rows.map((item) => item.poll.id), ['resolved']);
  assert.deepEqual(result.unresolvedCounts, { undatedInstitutionCount: 1, supportConflictInstitutionCount: 1 });
});

test('the 30-day filter follows closing selection and history keeps all in-window waves', () => {
  const datedInsideWindow = poll({ id: 'dated-inside', fieldworkEnd: '2024-02-20', publishedAt: '2024-02-21' });
  const undatedLaterProxy = poll({ id: 'undated-proxy', fieldworkEnd: null, publishedAt: '2024-02-28' });
  const closingAll = selectSingleElectionPolls([datedInsideWindow, undatedLaterProxy], election());
  assert.equal(closingAll.rows[0].poll.id, 'undated-proxy');
  const closingInWindow = selectSingleElectionPolls([datedInsideWindow, undatedLaterProxy], election(), { within30Days: true });
  assert.deepEqual(closingInWindow.rows, [], 'do not fall back to an older dated wave after the latest selected row has unknown dates');
  const historyInWindow = selectSingleElectionPolls([datedInsideWindow, undatedLaterProxy], election(), { view: 'history', within30Days: true });
  assert.deepEqual(historyInWindow.rows.map((item) => item.poll.id), ['dated-inside']);
  assert.equal(historyInWindow.dateUnknownCount, 1);
});

test('single-election main table keeps street interviews but omits candidate contexts and non-voting products', () => {
  const street = poll({ id: 'street', institutionId: 'i-street', productType: 'nonprobability_street_interview' });
  const candidateContext = poll({ id: 'candidate-context', institutionId: 'i-context', calculationBlocker: 'historical_candidate_context' });
  const nonVoting = poll({ id: 'non-voting', institutionId: 'i-issue', productType: 'issue_favorability' });
  const result = selectSingleElectionPolls([street, candidateContext, nonVoting], election());
  assert.deepEqual(result.rows.map((item) => item.poll.id), ['street']);
});

test('cross-election averages use the shared intersection and require three elections', () => {
  const elections = ['e1', 'e2', 'e3', 'e4'].map((id) => election({ id }));
  const polls = elections.flatMap((e) => [
    poll({ id: `i1-${e.id}`, electionId: e.id }),
    ...(e.id === 'e4' ? [] : [poll({ id: `i2-${e.id}`, electionId: e.id, institutionId: 'i2', shares: { a: 50, b: 50 }, undecided: 0, other: 0 })]),
  ]);
  const data = { elections, institutions: [{ id: 'i1', brand: 'One' }, { id: 'i2', brand: 'Two' }], polls };
  const result = commonElectionComparison(data, ['i1', 'i2']);
  assert.equal(result.minimum, 3);
  assert.deepEqual(result.commonElectionIds, ['e1', 'e2', 'e3']);
  assert.equal(result.rows[0].average, 3.75);
  assert.equal(result.rows[1].average, 10);
  assert.deepEqual(result.rows[0].availableElectionIds, ['e1', 'e2', 'e3', 'e4']);
  assert.deepEqual(result.rows[1].missingElectionIds, ['e4']);
  assert.equal(result.rows[0].perElection.length, 3);
  assert.equal(result.rows[0].perElection[0].pollId, 'i1-e1');
  const tooFew = commonElectionComparison({ ...data, elections: elections.slice(0, 2) }, ['i1', 'i2']);
  assert.deepEqual(tooFew.rows.map((item) => item.average), [null, null]);
});

test('brand groups merge exact names and explicit aliases without merging executors or related publishers', () => {
  const institutions = [{ id: 'a', brand: '三立電視', executor: 'Team A' }, { id: 'b', brand: '三立', executor: 'Team B' },
    { id: 'c', brand: '東森新聞' }, { id: 'd', brand: '東森' }, { id: 'e', brand: 'ETtoday', executor: 'Team A' },
    { id: 'f', brand: '蘋果日報／壹電視' }, { id: 'g', brand: '蘋果日報' }];
  const groups = institutionGroups(institutions);
  assert.equal(groups.length, 5);
  assert.deepEqual(groups.find(group => group.brand === '三立').memberIds, ['a', 'b']);
  assert.deepEqual(groups.find(group => group.brand === '東森').memberIds, ['c', 'd']);
  assert.deepEqual(groups.find(group => group.brand === 'ETtoday').memberIds, ['e']);
  assert.equal(institutionBrand(' 美麗島 '), '美麗島電子報');
  assert.equal(institutionBrand('中國國民黨'), '國民黨');
  assert.equal(institutionBrand('民主進步黨'), '民進黨');
  assert.equal(institutionBrand('不明新聞機構'), '不明新聞機構');
  assert.equal(institutions[0].brand, '三立電視');
});

test('all-brand comparison chooses one formal wave across aliases and exports original institution IDs', () => {
  const elections = ['e1', 'e2', 'e3'].map(id => election({ id }));
  const institutions = [{ id: 'i1', brand: '三立電視' }, { id: 'i2', brand: '三立' }, { id: 'i3', brand: '東森新聞' }];
  const polls = elections.flatMap(e => [poll({ id: `old-${e.id}`, electionId: e.id, fieldworkEnd: '2024-02-19', publishedAt: '2024-02-20' }),
    poll({ id: `new-${e.id}`, electionId: e.id, institutionId: 'i2', fieldworkEnd: '2024-02-21', publishedAt: '2024-02-22' }),
    poll({ id: `ebc-${e.id}`, electionId: e.id, institutionId: 'i3' })]);
  const comparison = compareInstitutionBrands({ elections, institutions, polls });
  assert.equal(comparison.rows.length, 2);
  assert.equal(comparison.commonElectionIds.length, 3);
  assert.ok(comparison.rows.every(row => Number.isFinite(row.average)));
  assert.ok(comparison.rows[0].availablePerElection.every(point => point.pollId.startsWith('new-')));
  assert.equal(comparison.exportRows.length, 6);
  for (const row of comparison.exportRows) {
    assert.equal(row.poll, polls.find(p => p.id === row.poll.id));
    assert.ok(['i2', 'i3'].includes(row.poll.institutionId));
  }
  const finalPolls = polls.map(p => p.id.startsWith('old-') ? { ...p, isExplicitFinal: true, closingEvidence: source() } : p);
  assert.ok(compareInstitutionBrands({ elections, institutions, polls: finalPolls }).rows[0].availablePerElection.every(point => point.pollId.startsWith('old-')));
});

test('all-brand comparison retains per-election numbers when all institutions have no shared set', () => {
  const elections = ['e1', 'e2', 'e3'].map(id => election({ id }));
  const institutions = [{ id: 'i1', brand: '三立' }, { id: 'i2', brand: '東森' }];
  const polls = elections.flatMap(e => [poll({ id: `formal-${e.id}`, electionId: e.id }),
    poll({ id: `pending-${e.id}`, electionId: e.id, institutionId: 'i2', status: 'pending' })]);
  const comparison = compareInstitutionBrands({ elections, institutions, polls });
  assert.deepEqual(comparison.commonElectionIds, []);
  assert.equal(comparison.rows.length, 2);
  assert.ok(comparison.rows.every(row => row.average === null));
  assert.equal(comparison.rows[0].availablePerElection.length, 3);
  assert.equal(comparison.rows[1].availablePerElection.length, 0);
  assert.equal(comparison.displayElectionIds.length, 3);
  assert.equal(comparison.exportRows.length, 3);
});

test('alias grouping preserves unresolved wave conflicts and the date filter', () => {
  const institutions = [{ id: 'i1', brand: '三立' }, { id: 'i2', brand: '三立電視' }];
  const a = poll({ id: 'a' });
  const b = poll({ id: 'b', institutionId: 'i2', shares: { a: 50, b: 40 }, undecided: 10, other: 0 });
  const data = { institutions, elections: [election()], polls: [a, b] };
  assert.equal(compareInstitutionBrands(data).rows[0].availablePerElection.length, 0);
  const old = poll({ id: 'old', fieldworkStart: '2024-01-15', fieldworkEnd: '2024-01-16', publishedAt: '2024-01-17' });
  assert.equal(compareInstitutionBrands({ ...data, polls: [old] }, { within30Days: false }).exportRows.length, 1);
  assert.equal(compareInstitutionBrands({ ...data, polls: [old] }, { within30Days: true }).exportRows.length, 0);
});

test('cross-election selection takes one final each and preserves zero averages and missing coverage', () => {
  const elections = ['e1', 'e2', 'e3'].map((id) => election({ id }));
  const polls = elections.flatMap((e) => [
    poll({ id: `latest-${e.id}`, electionId: e.id }),
    poll({ id: `final-${e.id}`, electionId: e.id, fieldworkEnd: '2024-02-18', shares: { a: 60, b: 40 }, undecided: 0, other: 0, isExplicitFinal: true, closingEvidence: source() }),
  ]);
  const result = commonElectionComparison({ elections, polls }, ['i1', 'i1']);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].average, 0);
  assert.ok(result.rows[0].perElection.every((item) => item.pollId.startsWith('final-')));
  const missing = commonElectionComparison({ elections, polls }, ['i1', 'unlisted']);
  assert.deepEqual(missing.commonElectionIds, []);
  assert.equal(missing.rows[0].average, null);
  assert.equal(missing.rows[1].average, null);
  assert.deepEqual(missing.rows[1].missingElectionIds, ['e1', 'e2', 'e3']);
  assert.deepEqual(commonElectionComparison({ elections, polls }, []).rows, []);
});

test('unresolved ties and result-only elections never enter common-election comparisons', () => {
  const elections = ['e1', 'e2', 'result-only'].map((id) => election({ id }));
  const polls = [
    poll({ id: 'tie-a', source: { ...source(), url: 'https://example.org/a' } }),
    poll({ id: 'tie-b', source: { ...source(), url: 'https://example.org/b' } }),
    poll({ id: 'eligible', electionId: 'e2' }),
  ];
  const comparison = commonElectionComparison({ elections, polls }, ['i1']);
  assert.deepEqual(comparison.commonElectionIds, ['e2']);
  assert.deepEqual(comparison.rows[0].availableElectionIds, ['e2']);
  assert.deepEqual(comparison.rows[0].missingElectionIds, ['e1', 'result-only']);
  assert.equal(comparison.rows[0].average, null);
});

test('provisional scores never select a final poll or enter a common-election intersection', () => {
  const elections = ['e1', 'e2', 'e3'].map((id) => election({ id }));
  const polls = elections.flatMap((e) => [
    poll({ id: `official-${e.id}`, electionId: e.id }),
    poll({ id: `trial-${e.id}`, electionId: e.id, institutionId: 'i2', status: 'pending', shares: { a: 60, b: 40 }, undecided: null, other: null }),
  ]);
  assert.equal(evaluatePoll(polls[1], elections[0]).provisionalMae, 0);
  assert.equal(selectFinalPoll(polls, elections[0], 'i2'), null);
  assert.equal(selectFinalPoll(polls, elections[0], 'i1').poll.id, 'official-e1');
  const comparison = commonElectionComparison({ elections, polls }, ['i1', 'i2']);
  assert.deepEqual(comparison.commonElectionIds, []);
  assert.deepEqual(comparison.rows.map((item) => item.average), [null, null]);
  assert.deepEqual(comparison.rows[1].availableElectionIds, []);
});

test('filtering and sorting are deterministic, nested-row aware, and keep missing MAE last', () => {
  const a = row(poll({ id: 'a', fieldworkEnd: '2024-02-19', executor: 'Independent team' }), election(), 'Zulu');
  const b = row(poll({ id: 'b', shares: { a: 60, b: 40 }, undecided: 0, other: 0 }), election(), 'Alpha');
  const pending = row(poll({ id: 'c', status: 'pending' }), election(), 'Beta');
  const input = [a, pending, b];
  assert.deepEqual(filterAndSortRows(input).map((item) => item.poll.id), ['b', 'c', 'a']);
  assert.deepEqual(filterAndSortRows(input, { sortKey: 'mae', direction: 'asc' }).map((item) => item.poll.id), ['b', 'c', 'a']);
  assert.deepEqual(filterAndSortRows(input, { sortKey: 'mae', direction: 'desc' }).map((item) => item.poll.id), ['c', 'a', 'b']);
  assert.deepEqual(filterAndSortRows(input, { sortKey: 'brand', direction: 'asc' }).map((item) => item.poll.id), ['b', 'c', 'a']);
  assert.deepEqual(filterAndSortRows(input, { query: '  INDEPENDENT ' }).map((item) => item.poll.id), ['a']);
  assert.deepEqual(filterAndSortRows(input, { query: 'alpha' }).map((item) => item.poll.id), ['b']);
  assert.deepEqual(input.map((item) => item.poll.id), ['a', 'c', 'b']);
  const tied = [row(poll({ id: 'z' }), election(), 'Same'), row(poll({ id: 'a' }), election(), 'Same')];
  assert.deepEqual(filterAndSortRows(tied).map((item) => item.poll.id), ['a', 'z']);
});

test('pagination exposes every page index without collapsing the range', () => {
  assert.deepEqual(pageNumbers(1), [0]);
  assert.deepEqual(pageNumbers(4), [0, 1, 2, 3]);
  assert.deepEqual(pageNumbers(0), [0]);
  assert.deepEqual(pageNumbers(-2), [0]);
});

test('MAE sorting ranks every available score numerically and keeps missing values last', () => {
  const official = row(poll({ id: 'official-3.75' }));
  const officialZero = row(poll({ id: 'official-zero', shares: { a: 60, b: 40 }, undecided: null, other: null }));
  const trialZero = row(poll({ id: 'trial-zero', status: 'pending', shares: { a: 60, b: 40 }, undecided: null, other: null }));
  const trialLarge = row(poll({ id: 'trial-40', status: 'pending', shares: { a: 100, b: 0 }, undecided: null, other: null }));
  const missing = row(poll({ id: 'unavailable', status: 'pending', shares: { a: 45, b: null } }));
  const input = [trialLarge, missing, trialZero, official, officialZero];
  assert.deepEqual(filterAndSortRows(input, { sortKey: 'mae', direction: 'asc' }).map((item) => item.poll.id), [
    'official-zero', 'trial-zero', 'official-3.75', 'trial-40', 'unavailable',
  ]);
  assert.deepEqual(filterAndSortRows(input, { sortKey: 'mae', direction: 'desc' }).map((item) => item.poll.id), [
    'trial-40', 'official-3.75', 'official-zero', 'trial-zero', 'unavailable',
  ]);
  const unqualifiedMae = { poll: { id: 'unqualified-mae' }, evaluation: { eligible: false, mae: 0, provisionalMae: null } };
  assert.deepEqual(filterAndSortRows([unqualifiedMae, trialLarge], { sortKey: 'mae' }).map((item) => item.poll.id), ['trial-40', 'unqualified-mae']);
  assert.deepEqual(input.map((item) => item.poll.id), ['trial-40', 'unavailable', 'trial-zero', 'official-3.75', 'official-zero']);
});

// A small RFC 4180 parser verifies decoded cell values, including embedded newlines.
function parseCsv(text) {
  const records = [];
  let cells = [], value = '', quoted = false;
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { cells.push(value); value = ''; }
    else if (ch === '\r' && text[i + 1] === '\n' && !quoted) {
      cells.push(value); records.push(cells); cells = []; value = ''; i++;
    } else value += ch;
  }
  return records;
}

test('CSV exports auditable evidence, dates, raw/normalized values and explicit metadata', () => {
  const p = poll({ commissioner: 'Commissioning organization', executor: 'Actual executor', teamId: 'team-2024', teamNote: 'This wave only', sampleSize: 1200, method: 'Telephone' });
  const dataset = { version: 'test-1', updatedAt: '2024-03-02', elections: [election()], institutions: [{ id: 'i1', brand: 'Synthetic brand' }] };
  const csv = exportCsv([row(p)], dataset);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const [headers, values] = parseCsv(csv);
  const data = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  assert.equal(headers.length, values.length);
  assert.equal(data.poll_source_url, 'https://example.org/original');
  assert.equal(data.result_source_title, 'Official result');
  assert.equal(data.poll_source_published_at, '2024-01-20');
  assert.equal(data.fieldwork_end, '2024-02-20');
  assert.equal(data.institution_brand, 'Synthetic brand');
  assert.equal(data.executor, 'Actual executor');
  assert.equal(data.team_id, 'team-2024');
  assert.equal(data['poll_raw_pct[a]'], '45');
  assert.equal(data['result_raw_pct[a]'], '60');
  assert.equal(data['poll_normalized_pct[a]'], '56.25');
  assert.equal(data['result_normalized_pct[a]'], '60');
  assert.equal(data['result_votes[a]'], '600');
  assert.equal(data.undecided_percent, '15');
  assert.equal(data.other_percent, '5');
  assert.equal(data.mae_percentage_points, '3.75');
  assert.equal(data.provisional_mae_percentage_points, '');
  assert.equal(data.score_status, 'official');
  assert.equal(data.calculation_reason, '');
  assert.deepEqual(JSON.parse(data.calculation_warnings), []);
  assert.match(data.calculation, /sum\(abs/);
});

test('CSV keeps trial arithmetic separate from the official MAE and records unavailable reasons and total warnings', () => {
  const verificationReview = { auditId: 'original-001', status: 'secondary_cross_checked', checkedAt: '2026-10-18',
    fieldEvidence: { shares: { url: 'https://example.org/report', locator: 'Table 2', checkedAt: '2026-10-18' } },
    originalObservations: { shares: { a: 44, b: 35 } } };
  const pending = row(poll({ id: 'pending', status: 'pending', fieldworkStart: null, fieldworkEnd: null, publishedAt: null, verificationReview }));
  const missing = row(poll({ id: 'missing', status: 'pending', shares: { a: null, b: 35 } }));
  const warning = row(poll({ id: 'total-warning', undecided: 21, other: null }));
  const [headers, ...records] = parseCsv(exportCsv([pending, missing, warning], { elections: [election()] }));
  const decoded = records.map((values) => {
    assert.equal(headers.length, values.length);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
  assert.equal(decoded[0].mae_percentage_points, '');
  assert.equal(decoded[0].provisional_mae_percentage_points, '3.75');
  assert.equal(decoded[0].score_status, 'provisional');
  assert.equal(decoded[0].calculation_reason, '');
  assert.equal(decoded[0]['poll_normalized_pct[a]'], '56.25');
  assert.equal(decoded[0].eligible, 'false');
  assert.match(decoded[0].ineligibility_reason, /pending/);
  assert.equal(decoded[0].record_audit_id, 'original-001');
  assert.equal(decoded[0].review_status, 'secondary_cross_checked');
  assert.equal(decoded[0].review_checked_at, '2026-10-18');
  assert.deepEqual(JSON.parse(decoded[0].review_field_evidence_json), verificationReview.fieldEvidence);
  assert.deepEqual(JSON.parse(decoded[0].verification_review_json), verificationReview);
  assert.equal(decoded[1].mae_percentage_points, '');
  assert.equal(decoded[1].provisional_mae_percentage_points, '');
  assert.equal(decoded[1].score_status, 'unavailable');
  assert.match(decoded[1].calculation_reason, /Missing value for candidate a/);
  assert.equal(decoded[1]['poll_raw_pct[a]'], '');
  assert.equal(decoded[1]['poll_normalized_pct[a]'], '');
  assert.equal(decoded[2].mae_percentage_points, '');
  assert.equal(decoded[2].provisional_mae_percentage_points, '3.75');
  assert.equal(decoded[2].score_status, 'provisional');
  assert.match(JSON.parse(decoded[2].calculation_warnings)[0], /undecided and other exceed/);
});

test('CSV preserves excluded candidates and exports null cells empty without inventing institution metadata', () => {
  const e = election({ comparisonCandidateIds: ['a'] });
  const p = poll({ shares: { a: 45, b: null }, undecided: null, other: null, notes: null, commissioner: null, executor: null, teamId: null });
  const [headers, values] = parseCsv(exportCsv([row(p, e)], { elections: [e], institutions: [{ id: 'i1', brand: 'Brand only' }] }));
  const data = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  assert.equal(data.excluded_candidate_ids, 'b');
  assert.equal(data.excluded_candidate_names, 'Beta');
  for (const name of ['undecided_percent', 'other_percent', 'notes', 'commissioner', 'executor', 'team_id', 'institution_team_note', 'poll_raw_pct[b]', 'poll_normalized_pct[b]']) assert.equal(data[name], '', name);
  assert.equal(data.mae_percentage_points, '0');
  const pending = row(poll({ status: 'pending', shares: { a: null, b: 30 } }));
  const [h2, v2] = parseCsv(exportCsv([pending], { elections: [election()] }));
  const d2 = Object.fromEntries(h2.map((header, index) => [header, v2[index]]));
  assert.equal(d2.institution_brand, '');
  assert.equal(d2.mae_percentage_points, '');
  assert.equal(d2['poll_raw_pct[a]'], '');
});

test('CSV preserves audit methods, supplementary PDF excerpt evidence and the fixed normalized primary score', () => {
  const sources = [
    { ...source(), access_method: 'full_public_text', evidence_summary: 'Original public report.' },
    { url: 'https://example.org/report.pdf', title: 'Publisher PDF, "index excerpt"', access_method: 'search_index_excerpt_only', evidence_summary: 'Search excerpt only;\nfull PDF not read.', kind: 'primary_pdf', page: null, additional_status: 'not_fully_accessed' },
  ];
  const p = poll({
    funder: 'Published funder', designAndAnalysis: 'Named analysis team', sampleSizeSupportQuestion: 800, surveyTotalSampleSize: 6376,
    population: 'Eligible voters', samplingFrame: 'Published phone frame', weighting: 'Age and region',
    reportedMarginOfError: 3.5, reportedConfidenceLevel: 0.95, supportDenominator: 'Respondents intending to vote',
    rawMeans: 'Published weighted shares before candidate normalization.', latestAvailableGuaranteed: false, aggregateSourceEligible: true,
    sources, provenance: { verification_status: 'candidate_excerpt_only' }, sourceCalculation: { raw_mae_pp: 999 },
  });
  const [headers, cells] = parseCsv(exportCsv([row(p)], { elections: [election()], institutions: [{ id: 'i1', brand: 'Brand', executor: 'Recorded institution executor' }] }));
  const data = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  assert.equal(headers.length, cells.length);
  assert.equal(data.funder, p.funder);
  assert.equal(data.design_and_analysis, p.designAndAnalysis);
  assert.equal(data.sample_size_support_question, '800');
  assert.equal(data.survey_total_sample_size, '6376');
  assert.equal(data.population, p.population);
  assert.equal(data.sampling_frame, p.samplingFrame);
  assert.equal(data.weighting, p.weighting);
  assert.equal(data.reported_margin_of_error_pp, '3.5');
  assert.equal(data.reported_confidence_level, '0.95');
  assert.equal(data.support_denominator, p.supportDenominator);
  assert.equal(data.raw_means, p.rawMeans);
  assert.equal(data.latest_available_guaranteed, 'false');
  assert.equal(data.aggregate_source_eligible, 'true');
  assert.equal(data.candidate_source_status, 'candidate_excerpt_only');
  assert.equal(data.institution_executor, 'Recorded institution executor');
  assert.equal(data.primary_score, 'normalized_mae_pp');
  assert.equal(data.mae_percentage_points, '3.75');
  const evidence = JSON.parse(data.poll_sources_json);
  assert.deepEqual(evidence, [sources[0], { ...sources[1], page: '' }]);
  assert.equal(evidence[1].access_method, 'search_index_excerpt_only');
  assert.equal(evidence[1].additional_status, 'not_fully_accessed');
});

test('CSV keeps unknown audit fields empty, false values explicit, and metadata formulas inert', () => {
  const unknown = ['funder', 'designAndAnalysis', 'sampleSizeSupportQuestion', 'surveyTotalSampleSize', 'population', 'samplingFrame', 'weighting', 'reportedMarginOfError', 'reportedConfidenceLevel', 'supportDenominator', 'rawMeans'];
  const p = poll({ ...Object.fromEntries(unknown.map((key) => [key, null])), executor: null, latestAvailableGuaranteed: false, aggregateSourceEligible: false, sources: null, provenance: { verification_status: null } });
  const [headers, cells] = parseCsv(exportCsv([row(p)], { elections: [election()], institutions: [{ id: 'i1', executor: 'Institution-only executor' }] }));
  const data = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  for (const header of ['funder', 'design_and_analysis', 'sample_size_support_question', 'survey_total_sample_size', 'population', 'sampling_frame', 'weighting', 'reported_margin_of_error_pp', 'reported_confidence_level', 'support_denominator', 'raw_means', 'candidate_source_status', 'executor']) assert.equal(data[header], '', header);
  assert.equal(data.institution_executor, 'Institution-only executor');
  assert.equal(data.latest_available_guaranteed, 'false');
  assert.equal(data.aggregate_source_eligible, 'false');
  assert.equal(data.primary_score, 'normalized_mae_pp');
  assert.equal(JSON.parse(data.poll_sources_json)[0].url, p.source.url);
  const malicious = { ...p, funder: '\n=HYPERLINK("https://example.org","open")', sources: [{ url: 'https://example.org/report.pdf', access_method: null, evidence_summary: null }] };
  const [safeHeaders, safeCells] = parseCsv(exportCsv([row(malicious)], { elections: [election()] }));
  assert.equal(safeCells[safeHeaders.indexOf('funder')], `'${malicious.funder}`);
  assert.deepEqual(JSON.parse(safeCells[safeHeaders.indexOf('poll_sources_json')]), [{ url: 'https://example.org/report.pdf', access_method: '', evidence_summary: '' }]);
});

test('CSV escapes commas, quotes, multiline text and spreadsheet formulas after decoding', () => {
  const payloads = ['=HYPERLINK("https://example.org","open")', '+SUM(1,2)', '-1+2', '@SUM(A1)', '  =1+1', '\r\n=1+1', '\t@SUM(A1)'];
  for (const payload of payloads) {
    const p = poll({ notes: payload });
    const [headers, values] = parseCsv(exportCsv([row(p)], { elections: [election()] }));
    assert.equal(values[headers.indexOf('notes')], `'${payload}`);
    assert.equal(headers.length, values.length);
  }
  const p = poll({ notes: 'A comma, a "quote"\nand a second line' });
  const [headers, values] = parseCsv(exportCsv([row(p)], { elections: [election()] }));
  assert.equal(values[headers.indexOf('notes')], p.notes);
  assert.equal(parseCsv(exportCsv([], {})).length, 1);
});
