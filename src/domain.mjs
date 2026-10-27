/** Pure comparison rules. Percentages are percentage points, never fractions. */
const DAY = 86_400_000;
const MAX_REPORTED_TOTAL = 100.5;
const taiwanDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const compareText = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const validId = (id) => typeof id === 'string' && id.trim().length > 0;
const finiteNonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const TRIAL_CALCULATION_PRODUCTS = new Set(['voting_intention_poll', 'nonprobability_street_interview']);
const FORMAL_COMPARISON_PRODUCTS = new Set(['voting_intention_poll']);

function declaredProductTypes(poll) {
  return [poll?.productType, poll?.product_type, poll?.provenance?.product_type]
    .filter((value) => value !== undefined && value !== null);
}

function unsupportedProductReason(poll, allowedProducts, purpose) {
  const unsupported = declaredProductTypes(poll).find((product) => !allowedProducts.has(product));
  return unsupported ? `The product is not supported for ${purpose}: ${unsupported}.` : null;
}

const UNINTERPRETABLE_QUESTION_BLOCKER = /support question.{0,40}(?:not.{0,10}identified|unidentified|unclear)|題目.*候選(?:人)?(?:姓)?名不一致|黨名題|(?:經濟建設能力|福利政策).*題|(?:不可|不能).{0,12}(?:直接)?(?:納|當|用|作).{0,12}(?:投票支持度|候選人MAE|MAE)/i;
const UNRESOLVED_INPUT_CONFLICT_BLOCKER = /(?:尚未裁定|未裁定|互異|不一致|未任選|不任選|未證明為同一波|衝突未解)/;

function calculationBlocker(poll) {
  const blocker = poll?.calculationBlocker ?? poll?.verification_review?.calculation_blocker;
  if (blocker === undefined || blocker === null || blocker === false || typeof blocker === 'string' && !blocker.trim()) return null;
  return typeof blocker === 'string' ? blocker.trim() : 'A non-text calculation blocker is present.';
}

function candidateSetReason(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !validId(id))) return 'A nonempty candidate set is required.';
  if (new Set(ids).size !== ids.length) return 'The candidate set contains duplicate IDs.';
  return null;
}

/** Validate calendar dates without Date.parse's rollover of impossible dates. */
function dateValue(value, timestamps = false) {
  if (typeof value !== 'string') return null;
  const pattern = timestamps
    ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/
    : /^(\d{4}-\d{2}-\d{2})$/;
  const match = value.match(pattern);
  if (!match) return null;
  const midnight = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== match[1]) return null;
  if (match[2] !== undefined && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59)) return null;
  const result = timestamps && match[2] !== undefined ? Date.parse(value) : midnight;
  return Number.isFinite(result) ? result : null;
}

// Date-only evidence states a calendar day; timestamps state an instant in Taiwan.
export function calendarDay(value) {
  const instant = dateValue(value, true);
  if (instant === null) return null;
  if (!value.includes('T')) return instant;
  const parts = Object.fromEntries(taiwanDate.formatToParts(instant).map(({ type, value: part }) => [type, part]));
  return dateValue(`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`);
}

function compareEvidenceDates(left, right) {
  const a = calendarDay(left);
  const b = calendarDay(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  if (a !== b) return a - b;
  return left.includes('T') && right.includes('T') ? dateValue(left, true) - dateValue(right, true) : 0;
}

function publicUrl(value) {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || !host.includes('.') && !host.includes(':')) return false;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (host.includes(':')) return !/^\[?(?:::|::1|fc|fd|fe8|fe9|fea|feb)/i.test(host);
    const parts = host.split('.');
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
      const [a, b] = parts.map(Number);
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function publicSource(source) {
  return record(source) && publicUrl(source.url);
}

function sourceDatesValid(source) {
  return ['publishedAt', 'accessedAt'].every((key) => source?.[key] === undefined || source[key] === null || dateValue(source[key], true) !== null);
}

export function normalizeDistribution(values, candidateIds) {
  const object = record(values) ? values : {};
  const declared = Array.isArray(candidateIds) ? candidateIds : [];
  const excludedIds = Object.keys(object).filter((id) => !declared.includes(id)).sort(compareText);
  const fail = (reason, total = null) => ({ ok: false, reason, values: null, total, excludedIds });
  const setReason = candidateSetReason(candidateIds);
  if (setReason) return fail(setReason);
  if (!record(values)) return fail('A candidate-value map is required.');
  for (const id of candidateIds) {
    if (!owns(values, id) || values[id] === null || values[id] === undefined) return fail(`Missing value for candidate ${id}.`);
    if (!finiteNonnegative(values[id]) || values[id] > 100) return fail(`Invalid percentage for candidate ${id}.`);
  }
  const total = candidateIds.reduce((sum, id) => sum + values[id], 0);
  if (!Number.isFinite(total) || total <= 0) return fail('The compared candidate total must be positive.', total);
  if (total > MAX_REPORTED_TOTAL) return fail('The compared candidate percentages exceed 100.5%.', total);
  return {
    ok: true,
    reason: null,
    values: Object.fromEntries(candidateIds.map((id) => [id, values[id] / total * 100])),
    total,
    excludedIds,
  };
}

export function normalizePollSupport(poll, election) {
  const ids = election?.comparisonCandidateIds || election?.candidates?.map(candidate => candidate.id);
  return normalizeDistribution(poll?.shares, ids);
}

function rawPollShares(poll, allIds) {
  const entries = record(poll?.shares) ? Object.entries(poll.shares) : [];
  const raw = Object.fromEntries(entries);
  for (const id of allIds) if (!owns(raw, id)) raw[id] = null;
  return raw;
}

function rawResultShares(result, allIds) {
  const votes = record(result?.votes) ? result.votes : {};
  const ids = [...new Set([...allIds, ...Object.keys(votes)])];
  const counts = Object.values(votes);
  const sum = counts.length && counts.every(finiteNonnegative) ? counts.reduce((a, b) => a + b, 0) : null;
  const total = finiteNonnegative(result?.validVotes) && result.validVotes > 0 ? result.validVotes : sum;
  return Object.fromEntries(ids.map((id) => [id, finiteNonnegative(votes[id]) && total > 0 ? votes[id] / total * 100 : null]));
}

/** Calculation uses the recorded support values, never a precomputed source score. */
export function calculatePollError(poll, election) {
  const warnings = [];
  const fail = (reason) => ({ calculable: false, mae: null, pollNormalized: null, resultNormalized: null, reason, warnings });
  if (!record(poll) || !record(election) || poll.electionId !== election.id) return fail('The poll must match an existing election.');
  const allIds = Array.isArray(election.candidates) ? election.candidates.map((candidate) => candidate?.id) : [];
  const candidateIds = election.comparisonCandidateIds === undefined ? [...allIds] : election.comparisonCandidateIds;
  const setReason = candidateSetReason(allIds) || candidateSetReason(candidateIds);
  if (setReason) return fail(setReason);
  if (candidateIds.some((id) => !allIds.includes(id))) return fail('The comparison set contains an unknown candidate.');
  const blocker = calculationBlocker(poll);
  if (blocker === 'historical_candidate_context') return fail(`Historical candidate contexts are not scored against official results: ${blocker}`);
  if (blocker && UNINTERPRETABLE_QUESTION_BLOCKER.test(blocker)) return fail(`The poll support question cannot be interpreted for MAE: ${blocker}`);
  if (blocker && UNRESOLVED_INPUT_CONFLICT_BLOCKER.test(blocker)) return fail(`Unresolved comparison-input conflict: ${blocker}`);
  if (blocker) warnings.push(`Trial arithmetic uses the recorded support values despite this unresolved review note: ${blocker}`);
  const productReason = unsupportedProductReason(poll, TRIAL_CALCULATION_PRODUCTS, 'trial arithmetic');
  if (productReason) return fail(productReason);
  for (const ids of [poll.candidateSet, poll.candidate_set, poll.provenance?.candidate_set,
    poll.questionCandidateSet, poll.question_candidate_set, poll.provenance?.question_candidate_set]) {
    if (ids === undefined || ids === null) continue;
    if (candidateSetReason(ids) || ids.some((id) => !allIds.includes(id)) || candidateIds.some((id) => !ids.includes(id))) {
      return fail('The poll candidate scenario does not match the comparison set.');
    }
  }
  if (!record(poll.shares)) return fail('Poll candidate percentages are missing.');
  if (Object.keys(poll.shares).some((id) => !allIds.includes(id))) return fail('The poll contains an unknown candidate.');
  for (const [id, value] of Object.entries(poll.shares)) {
    if (value !== null && (!finiteNonnegative(value) || value > 100)) return fail(`Invalid percentage for candidate ${id}.`);
  }
  const candidateTotal = Object.values(poll.shares).filter(finiteNonnegative).reduce((sum, value) => sum + value, 0);
  if (candidateTotal > MAX_REPORTED_TOTAL) return fail('The reported candidate percentages exceed 100.5%.');
  const pollDistribution = normalizePollSupport(poll, election);
  if (!pollDistribution.ok) return fail(pollDistribution.reason);
  for (const key of ['undecided', 'other']) {
    const value = poll[key];
    if (value !== undefined && value !== null && (!finiteNonnegative(value) || value > 100)) return fail(`The ${key} percentage is invalid.`);
  }
  const reportedTotal = candidateTotal + (poll.undecided ?? 0) + (poll.other ?? 0);
  if (reportedTotal > MAX_REPORTED_TOTAL) warnings.push('Reported candidates, undecided and other exceed 100.5%.');
  if (election.phase === 'pre_result') return { ...fail('Official results are not available for this election.'), pollNormalized: pollDistribution.values };
  if (!record(election.result?.votes)) return fail('Result candidate votes are missing.');
  if (Object.keys(election.result.votes).some((id) => !allIds.includes(id))) return fail('The result contains an unknown candidate.');
  for (const id of allIds) {
    if (!owns(election.result.votes, id) || election.result.votes[id] === null || election.result.votes[id] === undefined) return fail(`Missing result votes for candidate ${id}.`);
    if (!finiteNonnegative(election.result.votes[id])) return fail(`Invalid result votes for candidate ${id}.`);
  }
  const voteTotal = allIds.reduce((sum, id) => sum + election.result.votes[id], 0);
  if (!Number.isFinite(voteTotal) || voteTotal <= 0) return fail('The result vote total must be positive.');
  const declaredTotal = election.result.validVotes;
  if (declaredTotal !== undefined && declaredTotal !== null) {
    if (!finiteNonnegative(declaredTotal) || declaredTotal <= 0) return fail('The declared valid-vote total is invalid.');
    if (Math.abs(voteTotal - declaredTotal) > Math.max(1, voteTotal, declaredTotal) * Number.EPSILON * 8) return fail('Candidate votes do not match the declared valid-vote total.');
  }
  const resultDistribution = normalizeDistribution(rawResultShares(election.result, allIds), candidateIds);
  if (!resultDistribution.ok) return fail(resultDistribution.reason);
  return {
    calculable: true,
    mae: candidateIds.reduce((sum, id) => sum + Math.abs(pollDistribution.values[id] - resultDistribution.values[id]), 0) / candidateIds.length,
    pollNormalized: pollDistribution.values,
    resultNormalized: resultDistribution.values,
    reason: null,
    warnings,
  };
}

export function evaluatePoll(poll, election, { within30Days = true } = {}) {
  const allIds = Array.isArray(election?.candidates) ? election.candidates.map((candidate) => candidate?.id) : [];
  const candidateIds = election?.comparisonCandidateIds === undefined ? [...allIds] : election.comparisonCandidateIds;
  const comparedIds = Array.isArray(candidateIds) ? [...candidateIds] : [];
  const calculation = calculatePollError(poll, election);
  const evaluation = {
    eligible: false,
    reason: null,
    candidateIds: comparedIds,
    pollNormalized: calculation.pollNormalized,
    resultNormalized: calculation.resultNormalized,
    pollRaw: rawPollShares(poll, allIds.filter(validId)),
    resultRaw: rawResultShares(election?.result, allIds.filter(validId)),
    mae: null,
    provisionalMae: null,
    calculationReason: calculation.reason,
    calculationWarnings: calculation.warnings,
    calculation,
    daysBefore: null,
    excludedCandidates: allIds.filter((id) => validId(id) && !comparedIds.includes(id)),
  };
  const fail = (reason) => ({ ...evaluation, reason, provisionalMae: calculation.calculable ? calculation.mae : null });
  if (!record(poll) || !record(election) || poll.electionId !== election.id) return fail('The poll must match an existing election.');
  const electionDay = dateValue(election.date);
  const hasStart = poll.fieldworkStart !== null && poll.fieldworkStart !== undefined;
  const start = calendarDay(poll.fieldworkStart);
  const end = calendarDay(poll.fieldworkEnd);
  const publication = calendarDay(poll.publishedAt);
  if (electionDay !== null && end !== null) evaluation.daysBefore = (electionDay - end) / DAY;
  if (election.phase === 'pre_result') return fail('Official results are not available for this election.');
  if (poll.status !== 'verified') return fail('The poll is pending verification.');
  if (election.status !== 'verified') return fail('The election is pending verification.');
  if (election.result?.status !== 'verified') return fail('The election result is pending verification.');
  if (!publicSource(poll.source)) return fail('The poll needs a public original source.');
  if (!publicSource(election.result.source)) return fail('The result needs a public original source.');
  if ([electionDay, end, publication].some((value) => value === null) || hasStart && start === null || !sourceDatesValid(poll.source) || !sourceDatesValid(election.result.source)) return fail('A required date is invalid.');
  if (hasStart && compareEvidenceDates(poll.fieldworkStart, poll.fieldworkEnd) > 0) return fail('Fieldwork must start on or before it ends.');
  if (compareEvidenceDates(poll.fieldworkEnd, poll.publishedAt) > 0) return fail('Publication must be on or after fieldwork ends.');
  if (end >= electionDay || publication >= electionDay) return fail('Fieldwork and publication must precede election day.');
  if (within30Days && (evaluation.daysBefore < 1 || evaluation.daysBefore > 30)) return fail('Fieldwork must end 1–30 calendar days before election day.');
  if (!calculation.calculable) return fail(calculation.reason);
  const blocker = calculationBlocker(poll);
  if (blocker) return fail(`The poll has an unresolved calculation review: ${blocker}`);
  const formalProductReason = unsupportedProductReason(poll, FORMAL_COMPARISON_PRODUCTS, 'formal comparison');
  if (formalProductReason) return fail(formalProductReason);
  const reportedTotal = Object.values(poll.shares).reduce((sum, value) => sum + (value ?? 0), 0)
    + (poll.undecided ?? 0) + (poll.other ?? 0);
  if (reportedTotal > MAX_REPORTED_TOTAL) return fail('Reported candidates, undecided and other exceed 100.5%.');
  evaluation.mae = calculation.mae;
  evaluation.eligible = true;
  return evaluation;
}

function evidencedFinal(poll) {
  return poll?.isExplicitFinal === true && publicSource(poll.closingEvidence) && sourceDatesValid(poll.closingEvidence);
}

function compareRecency(a, b) {
  for (const key of ['fieldworkEnd', 'publishedAt']) {
    const difference = compareEvidenceDates(a.poll?.[key], b.poll?.[key]);
    if (difference) return -difference;
  }
  return 0;
}

function newestFirst(a, b) {
  return compareRecency(a, b)
    || compareText(b.poll?.id ?? '', a.poll?.id ?? '') || compareText(a.poll?.institutionId ?? '', b.poll?.institutionId ?? '');
}

function compareSelectionPriority(a, b) {
  return Number(evidencedFinal(b.poll)) - Number(evidencedFinal(a.poll)) || compareRecency(a, b);
}

function sameEvidenceValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameEvidenceValue(value, right[index]));
  }
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left).sort(compareText);
  const rightKeys = Object.keys(right).sort(compareText);
  return keys.length === rightKeys.length
    && keys.every((key, index) => key === rightKeys[index] && sameEvidenceValue(left[key], right[key]));
}

function exactReprint(left, right) {
  // Every recorded payload field is evidence, including unknown and nested metadata.
  // Only the top-level record ID may differ; even source presentation conflicts need review.
  const withoutId = (poll) => Object.fromEntries(Object.entries(poll).filter(([key]) => key !== 'id'));
  return sameEvidenceValue(withoutId(left), withoutId(right));
}

function evidenceSignature(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array:[${value.map(evidenceSignature).join(',')}]`;
  if (record(value)) return `object:{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${evidenceSignature(value[key])}`).join(',')}}`;
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'number') return `number:${Object.is(value, -0) ? '-0' : String(value)}`;
  return `${typeof value}:${String(value)}`;
}

function isMainTablePoll(poll) {
  if (calculationBlocker(poll) === 'historical_candidate_context') return false;
  return declaredProductTypes(poll).every((product) => TRIAL_CALCULATION_PRODUCTS.has(product));
}

function deduplicateExactRows(rows) {
  const unique = [];
  const signatures = new Set();
  for (const row of [...rows].sort(newestFirst)) {
    const signature = evidenceSignature(Object.fromEntries(Object.entries(row.poll).filter(([key]) => key !== 'id')));
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    unique.push(row);
  }
  return unique;
}

function sameCandidateSupport(left, right) {
  return sameEvidenceValue(left?.poll?.shares ?? null, right?.poll?.shares ?? null);
}

function rowHasSurveyDate(row) {
  return calendarDay(row?.poll?.fieldworkEnd) !== null;
}

/**
 * Build the single-election main-table scope without changing formal final-poll
 * selection used by cross-election comparisons. The 30-day window is applied
 * only after the closing record for each institution has been selected.
 */
export function selectSingleElectionPolls(polls, election, { view = 'closing', within30Days = false } = {}) {
  const matching = (Array.isArray(polls) ? polls : [])
    .filter((poll) => poll?.electionId === election?.id && isMainTablePoll(poll))
    .map((poll) => ({ poll, evaluation: evaluatePoll(poll, election, { within30Days: false }), selectionReason: 'history' }));
  const uniqueRows = deduplicateExactRows(matching);
  const unresolvedCounts = { undatedInstitutionCount: 0, supportConflictInstitutionCount: 0 };
  let scopedRows = uniqueRows;

  if (view !== 'history') {
    const groups = new Map();
    for (const row of uniqueRows) {
      const institutionId = row.poll.institutionId;
      if (!validId(institutionId)) continue;
      const group = groups.get(institutionId) ?? [];
      group.push(row);
      groups.set(institutionId, group);
    }

    scopedRows = [];
    for (const group of groups.values()) {
      const dated = group.filter(rowHasSurveyDate);
      if (!dated.length) {
        unresolvedCounts.undatedInstitutionCount += 1;
        continue;
      }

      const latestKnown = dated.reduce((latest, row) => compareEvidenceDates(row.poll.fieldworkEnd, latest.poll.fieldworkEnd) > 0 ? row : latest);
      const latestKnownEnd = latestKnown.poll.fieldworkEnd;
      const publicationDateProxies = group.filter((row) => !rowHasSurveyDate(row)
        && compareEvidenceDates(row.poll.publishedAt, latestKnownEnd) > 0);

      let latestWave;
      let selectionReason;
      if (publicationDateProxies.length) {
        const latestPublication = publicationDateProxies.reduce((latest, row) => compareEvidenceDates(row.poll.publishedAt, latest.poll.publishedAt) > 0 ? row : latest);
        latestWave = publicationDateProxies.filter((row) => compareEvidenceDates(row.poll.publishedAt, latestPublication.poll.publishedAt) === 0);
        selectionReason = 'publication-date-proxy';
      } else {
        const latestDated = dated.reduce((latest, row) => compareRecency(row, latest) < 0 ? row : latest);
        latestWave = dated.filter((row) => compareEvidenceDates(row.poll.fieldworkEnd, latestDated.poll.fieldworkEnd) === 0
          && compareEvidenceDates(row.poll.publishedAt, latestDated.poll.publishedAt) === 0);
        selectionReason = 'latest-record';
      }

      if (latestWave.some((row) => !sameCandidateSupport(latestWave[0], row))) {
        unresolvedCounts.supportConflictInstitutionCount += 1;
        continue;
      }

      const selected = [...latestWave].sort(newestFirst)[0];
      scopedRows.push({ ...selected, selectionReason });
    }
  }

  const dateUnknownCount = scopedRows.filter((row) => !rowHasSurveyDate(row)).length;
  const rows = within30Days
    ? scopedRows.filter((row) => Number.isFinite(row.evaluation.daysBefore) && row.evaluation.daysBefore >= 1 && row.evaluation.daysBefore <= 30)
    : scopedRows;
  return { rows: rows.sort(newestFirst), unresolvedCounts, dateUnknownCount, unfilteredCount: scopedRows.length };
}

function recordedComparisonEligible({ poll, evaluation }, election, { within30Days = true } = {}) {
  if (election.phase === 'pre_result' || election.result?.status !== 'verified' || !evaluation.calculation.calculable) return false;
  if (![poll.source, ...(poll.sources || [])].some(publicSource)) return false;
  const electionDay = calendarDay(election.date);
  if (electionDay === null) return false;
  if (['fieldworkEnd', 'publishedAt'].some(key => {
    const day = calendarDay(poll[key]);
    return day !== null && day >= electionDay;
  })) return false;
  return !within30Days || evaluation.daysBefore >= 1 && evaluation.daysBefore <= 30;
}

export function selectFinalPoll(polls, election, institutionId, options = {}) {
  const eligible = (Array.isArray(polls) ? polls : [])
    .filter((poll) => poll?.electionId === election?.id && poll?.institutionId === institutionId)
    .map((poll) => ({ poll, evaluation: evaluatePoll(poll, election, options) }))
    .filter((row) => options.includeRecorded ? recordedComparisonEligible(row, election, options) : row.evaluation.eligible)
    .sort((a, b) => compareSelectionPriority(a, b) || newestFirst(a, b));
  if (!eligible.length) return null;
  const selected = eligible[0];
  // Recorded comparisons ignore metadata-only differences; conflicting support is never chosen by ID.
  const tied = eligible.filter((row) => compareSelectionPriority(selected, row) === 0);
  if (tied.some(row => options.includeRecorded
    ? selected.evaluation.candidateIds.some(id => selected.poll.shares[id] !== row.poll.shares[id])
    : !exactReprint(selected.poll, row.poll))) return null;
  return { ...selected, selectionReason: evidencedFinal(selected.poll) ? 'explicit-final' : 'latest-eligible' };
}

export function selectElectionPolls(polls, election, { within30Days = true, allPolls = false } = {}) {
  const matching = (Array.isArray(polls) ? polls : []).filter((poll) => poll?.electionId === election?.id);
  if (allPolls) {
    return matching.map((poll) => {
      const evaluation = evaluatePoll(poll, election, { within30Days });
      return { poll, evaluation, selectionReason: !evaluation.eligible ? 'ineligible' : evidencedFinal(poll) ? 'explicit-final' : 'all-polls' };
    }).sort(newestFirst);
  }
  const ids = [...new Set(matching.map((poll) => poll.institutionId).filter(validId))].sort(compareText);
  return ids.map((id) => selectFinalPoll(matching, election, id, { within30Days })).filter(Boolean).sort(newestFirst);
}

export function commonElectionComparison(dataset, institutionIds, options = {}) {
  const score = row => options.includeRecorded ? row.evaluation.calculation.mae : row.evaluation.mae;
  const institutions = [...new Set((Array.isArray(institutionIds) ? institutionIds : []).filter(validId))];
  const elections = [...(Array.isArray(dataset?.elections) ? dataset.elections : [])]
    .filter(election => election.phase !== 'pre_result')
    .sort((a, b) => compareText(b.date ?? '', a.date ?? '') || compareText(a.id ?? '', b.id ?? ''));
  const polls = Array.isArray(dataset?.polls) ? dataset.polls : [];
  const available = institutions.map((institutionId) => new Map(elections.map((election) => [election.id, selectFinalPoll(polls, election, institutionId, options)]).filter(([, row]) => row)));
  const commonElectionIds = institutions.length ? elections.map((election) => election.id).filter((id) => available.every((map) => map.has(id))) : [];
  const minimum = 3;
  const rows = institutions.map((institutionId, index) => {
    const perElection = commonElectionIds.map((electionId) => {
      const row = available[index].get(electionId);
      return { electionId, mae: score(row), pollId: row.poll.id };
    });
    return {
      institutionId,
      average: perElection.length >= minimum ? perElection.reduce((sum, row) => sum + row.mae, 0) / perElection.length : null,
      perElection,
      availablePerElection: [...available[index]].map(([electionId, row]) => ({ electionId, mae: score(row), pollId: row.poll.id, selectionReason: row.selectionReason })),
      availableElectionIds: elections.map((election) => election.id).filter((id) => available[index].has(id)),
      missingElectionIds: elections.map((election) => election.id).filter((id) => !available[index].has(id)),
    };
  });
  return { commonElectionIds, rows, minimum };
}

function rowBrand(row) {
  return typeof row?.brand === 'string' ? row.brand : typeof row?.institution?.brand === 'string' ? row.institution.brand : '';
}

function rowScore(row) {
  const evaluation = row?.evaluation;
  if (evaluation?.eligible === true && finiteNonnegative(evaluation.mae)) return { group: 0, value: evaluation.mae, status: 'official' };
  if (finiteNonnegative(evaluation?.provisionalMae)) return { group: 1, value: evaluation.provisionalMae, status: 'provisional' };
  return { group: 2, value: null, status: 'unavailable' };
}

export function filterAndSortRows(rows, { query = '', sortKey = 'date', direction = 'desc' } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  const sign = direction === 'asc' ? 1 : -1;
  const value = (row) => {
    if (sortKey === 'brand') return rowBrand(row).toLowerCase() || null;
    if (sortKey === 'mae') return rowScore(row).value;
    return calendarDay(row?.poll?.fieldworkEnd);
  };
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const poll = row.poll ?? {};
    const searchable = [rowBrand(row), poll.id, poll.institutionId, poll.electionId, poll.commissioner, poll.executor, poll.teamId, poll.teamNote, poll.notes, poll.method, row.election?.label, row.election?.region, row.election?.office];
    return !needle || searchable.filter((item) => typeof item === 'string').join(' ').toLowerCase().includes(needle);
  }).map((row, index) => ({ row, index })).sort((a, b) => {
    const left = value(a.row);
    const right = value(b.row);
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    if (left !== right) return sign * (typeof left === 'number' ? left - right : compareText(left, right));
    return compareText(rowBrand(a.row).toLowerCase(), rowBrand(b.row).toLowerCase())
      || compareText(a.row.poll?.institutionId ?? '', b.row.poll?.institutionId ?? '')
      || compareText(a.row.poll?.electionId ?? '', b.row.poll?.electionId ?? '')
      || compareText(a.row.poll?.id ?? '', b.row.poll?.id ?? '')
      || a.index - b.index;
  }).map(({ row }) => row);
}
