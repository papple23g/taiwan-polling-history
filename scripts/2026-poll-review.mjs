import { createHash } from 'node:crypto';

const inputFields = ['id', 'contest_id', 'brand', 'executor', 'commissioner', 'funder', 'fieldwork_start', 'fieldwork_end',
  'publication_date', 'question', 'original_question', 'question_scenario', 'question_candidate_set', 'candidate_set',
  'product_type', 'raw_support_percent', 'responses', 'undecided_percent', 'other_percent', 'other_responses',
  'sample_size_total', 'sample_size_support_question', 'population', 'mode', 'sampling_frame', 'weighting',
  'reported_margin_of_error_pp', 'reported_confidence_level', 'support_denominator'];
const evidenceFields = {
  raw_support_percent: 'shares', fieldwork_start: 'fieldworkStart', fieldwork_end: 'fieldworkEnd', publication_date: 'publishedAt',
  executor: 'executor', sample_size_total: 'sampleSize', mode: 'method', original_question: 'originalQuestion',
  question_candidate_set: 'candidateSet', support_denominator: 'supportDenominator', undecided_percent: 'undecided', other_percent: 'other',
};
const coreFields = ['shares', 'fieldworkEnd', 'publishedAt', 'executor', 'sampleSize', 'method', 'originalQuestion', 'candidateSet'];
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const unresolvedConflicts = record => ({ publicationDateConflict: record.verification_review?.publicationDateConflict ?? null,
  calculationBlocker: record.verification_review?.calculationBlocker ?? record.verification_review?.calculation_blocker ?? null,
  conflicts: (record.verification_review?.conflicts ?? []).filter(conflict => conflict.resolved !== true),
  conflicted: record.verification_review?.status === 'conflict' });

export function reviewInputHash(record) {
  const inputs = Object.fromEntries(inputFields.map(field => [field, record[field] ?? null]));
  inputs.sourceUrls = [...new Set((record.sources ?? []).map(source => source.url))].sort();
  inputs.unresolvedConflicts = unresolvedConflicts(record);
  return createHash('sha256').update(JSON.stringify(canonical(inputs))).digest('hex');
}

// Approved rereads live in 2026-primary-checks.json, bound to the exact source observation.
// An entry may include approvedReview { inputHash, approved, independentReread, status,
// checkedAt, reason, verifiedFields, fieldEvidence, values? }. No approval is inferred.
export function reviewPollRecord(record, previous, check, electionDate) {
  const inputHash = reviewInputHash(record);
  const review = check?.approvedReview;
  if (!review) {
    if (previous?.verification_status !== 'verified_primary') return record;
    const previousHash = previous.verification_review?.sourceInputHash ?? reviewInputHash(previous);
    if (previous.id !== record.id || previousHash !== inputHash) throw new Error(`Verified source inputs changed; independent reread required: ${record.id}`);
    return structuredClone(previous);
  }
  const reject = reason => { throw new Error(`Invalid approved primary review for ${record.id}: ${reason}`); };
  if (review.approved !== true || review.independentReread !== true || review.status !== 'primary_verified') reject('explicit independent approval is missing');
  if (review.inputHash !== inputHash) reject('source input hash changed');
  const conflicts = unresolvedConflicts(record);
  if (conflicts.publicationDateConflict || conflicts.calculationBlocker || conflicts.conflicted || conflicts.conflicts.length) reject('unresolved source conflict');
  if (!review.reason?.trim() || !Number.isFinite(Date.parse(review.checkedAt))) reject('review reason or timestamp is missing');
  const values = review.values ?? {};
  const required = new Set(coreFields);
  for (const field of Object.keys(values)) {
    if (!Object.hasOwn(evidenceFields, field)) reject(`unsupported correction: ${field}`);
    required.add(evidenceFields[field]);
  }
  const sourceUrls = new Set((record.sources ?? []).map(source => source.url));
  for (const field of required) {
    const evidence = review.fieldEvidence?.[field];
    if (!review.verifiedFields?.includes(field) || !/^https?:\/\//.test(evidence?.url ?? '') || !sourceUrls.has(evidence.url) || !evidence.locator?.trim()
      || !['primary_report', 'primary_questionnaire', 'primary_fulltext', 'primary_verified'].includes(evidence.evidenceLevel)) reject(`primary field evidence missing: ${field}`);
  }
  const reviewed = { ...record, ...structuredClone(values) };
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (![reviewed.fieldwork_end, reviewed.publication_date, electionDate].every(validDate)
    || reviewed.fieldwork_end > reviewed.publication_date || reviewed.publication_date >= electionDate) reject('survey and pre-election publication dates are invalid');
  if (reviewed.fieldwork_start != null && (!validDate(reviewed.fieldwork_start) || reviewed.fieldwork_start > reviewed.fieldwork_end)) reject('survey start date is invalid');
  if (!reviewed.executor?.trim() || !reviewed.mode?.trim() || !Number.isInteger(reviewed.sample_size_total) || reviewed.sample_size_total <= 0
    || !reviewed.original_question?.trim() || reviewed.product_type !== 'voting_intention_poll') reject('core survey fields are incomplete');
  if (!Array.isArray(reviewed.candidate_set) || !reviewed.candidate_set.length || !reviewed.candidate_set.every(name => reviewed.question_candidate_set?.includes(name)
    && Number.isFinite(reviewed.raw_support_percent?.[name]) && reviewed.raw_support_percent[name] >= 0 && reviewed.raw_support_percent[name] <= 100)) reject('candidate scenario is incomplete');
  const percentages = [...Object.values(reviewed.raw_support_percent), reviewed.undecided_percent, reviewed.other_percent].filter(value => value != null);
  if (percentages.some(value => !Number.isFinite(value) || value < 0 || value > 100) || percentages.reduce((sum, value) => sum + value, 0) > 100.5) reject('reported percentages are inconsistent');
  reviewed.verification_status = 'verified_primary';
  reviewed.verification_review = { ...record.verification_review, ...structuredClone(review), sourceInputHash: inputHash,
    missingFields: review.missingFields ?? (record.verification_review?.missingFields ?? []).filter(field => !review.verifiedFields.includes(field) && field !== 'independentFieldReview'),
    corrections: [...(record.verification_review?.corrections ?? []), ...Object.entries(values).map(([field, value]) => ({ field,
      original: record[field] ?? null, corrected: value, evidence: review.fieldEvidence[evidenceFields[field]] }))] };
  delete reviewed.verification_review.values;
  reviewed.sources = record.sources.map(source => Object.values(review.fieldEvidence).some(evidence => evidence.url === source.url)
    ? { ...source, checked_at: review.checkedAt, access_method: 'independent_primary_content_reread', evidence_summary: review.reason } : source);
  // A source can be verified before election day without granting result-based scores.
  reviewed.aggregate_source_eligible = false;
  reviewed.default_aggregate_eligible = false;
  reviewed.calculation = null;
  reviewed.primary_mae_pp = null;
  return reviewed;
}
