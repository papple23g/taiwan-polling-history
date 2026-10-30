import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';

export const votingQuestion = question => question.type === 'voting_intention' || question.label.startsWith('投票意向');
const legacyQuestionId = (wave, question, index) => `${wave.id}${votingQuestion(question) && index === wave.questions.findIndex(votingQuestion) ? '' : `-question-${index + 1}`}`;
const questionKey = question => JSON.stringify([question.label.trim().replace(/\s+/g, ' '), question.scenario ?? null, question.denominator ?? null]);

// Seed once from the approved snapshots so every already-published ID survives migration.
export function createQuestionRegistry(records) {
  return extendQuestionRegistry({ schemaVersion: 1, records: [] }, records);
}

export function extendQuestionRegistry(registry, records) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.records)) throw new Error('Invalid question ID registry.');
  const entries = structuredClone(registry.records);
  const existingWaves = new Set(entries.map(row => row.waveId));
  const keys = new Map(entries.map(row => [JSON.stringify([row.waveId, row.questionKey]), row.recordId]));
  if (keys.size !== entries.length || new Set(entries.map(row => row.recordId)).size !== entries.length) throw new Error('Duplicate question registry key or record ID.');
  const usedIds = new Set(entries.map(row => row.recordId));
  for (const wave of records) for (const [index, question] of wave.questions.entries()) {
    const key = questionKey(question);
    const lookup = JSON.stringify([wave.id, key]);
    if (keys.has(lookup)) continue;
    const id = existingWaves.has(wave.id)
      ? `${wave.id}-question-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
      : legacyQuestionId(wave, question, index);
    if (usedIds.has(id)) throw new Error(`Question ID collision requires review: ${id}`);
    entries.push({ waveId: wave.id, questionKey: key, recordId: id });
    keys.set(lookup, id);
    usedIds.add(id);
  }
  return { schemaVersion: 1, records: entries };
}

export function importedQuestionId(wave, question, index, registry) {
  if (!registry) return legacyQuestionId(wave, question, index);
  const entry = registry.records.find(row => row.waveId === wave.id && row.questionKey === questionKey(question));
  if (!entry) throw new Error(`Question is absent from ID registry: ${wave.id} / ${question.label}`);
  return entry.recordId;
}

export const auditExitCode = status => ({ no_change: 0, changes_detected: 0, source_error: 1, review_required: 2 })[status] ?? 1;

const duplicates = ids => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();

export function fieldDifferences(before, after, path = '') {
  if (isDeepStrictEqual(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
      fieldDifferences(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ field: path, before: before ?? null, after: after ?? null }];
}

const comparableWave = ({ collectedAt, indexAsOf, ...record }) => record;

export function compareIndexRecords(previous, current, readableCities, registry) {
  const before = new Map(previous.map(row => [row.id, row]));
  const after = new Map(current.map(row => [row.id, row]));
  return {
    added: current.filter(row => !before.has(row.id)).map(row => row.id),
    removed: previous.filter(row => readableCities.includes(row.city) && !after.has(row.id)).map(row => row.id),
    changed: current.filter(row => before.has(row.id)).flatMap(row => {
      const fields = fieldDifferences(comparableWave(before.get(row.id)), comparableWave(row));
      return fields.length ? [{ id: row.id, fields }] : [];
    }),
    duplicateWaveIds: duplicates(current.map(row => row.id)),
    duplicateQuestionIds: duplicates(current.flatMap(wave => wave.questions.map((question, index) => importedQuestionId(wave, question, index, registry)))),
  };
}

export function questionCoverage(records, publishedSource, registry) {
  const main = publishedSource.polls ?? [];
  const catalogue = publishedSource.historical_contexts ?? [];
  return records.flatMap(wave => wave.questions.map((question, index) => {
    const id = importedQuestionId(wave, question, index, registry);
    const matches = [...main.filter(row => row.id === id).map(row => ({ row, disposition: 'main_table' })),
      ...catalogue.filter(row => row.id === id).map(row => ({ row, disposition: 'source_catalogue' }))];
    const expected = { contest_id: `2026-${wave.city}`, question: question.label, responses: question.responses };
    const differences = matches.length === 1 ? fieldDifferences(expected, Object.fromEntries(Object.keys(expected).map(key => [key, matches[0].row[key]]))) : [];
    const corrections = matches.length === 1 ? [matches[0].row.verification_review, matches[0].row.verificationReview].flatMap(review => review?.corrections ?? []) : [];
    const reviewedDifferences = differences.flatMap(difference => {
      const correction = corrections.find(change => change.field === difference.field
        && isDeepStrictEqual(change.original, difference.before) && isDeepStrictEqual(change.corrected, difference.after)
        && /^https?:\/\//.test(change.evidence?.url ?? '') && change.evidence.locator?.trim() && change.evidence.checkedAt);
      return correction ? [{ ...difference, evidence: correction.evidence }] : [];
    });
    const fields = differences.filter(difference => !reviewedDifferences.some(reviewed => reviewed.field === difference.field));
    return { waveId: wave.id, questionNumber: index + 1, question: question.label, recordId: id,
      disposition: matches.length === 1 ? matches[0].disposition : matches.length ? 'duplicate' : 'missing',
      matches: matches.length, fields, reviewedDifferences };
  }));
}

export function auditSnapshot({ checkedAt, homepage, regions, previousRecords, records, publishedSource, configuredCities, questionRegistry }) {
  const readableCities = regions.filter(row => row.status === 'parsed').map(row => row.slug);
  const registry = extendQuestionRegistry(questionRegistry ?? createQuestionRegistry(previousRecords), records);
  const changes = compareIndexRecords(previousRecords, records, readableCities, registry);
  const questions = questionCoverage(records, publishedSource, registry);
  const missingRegions = [...new Set(previousRecords.map(row => row.city))].filter(city => !regions.some(region => region.slug === city));
  const complete = homepage.status === 'fetched' && regions.length > 0 && regions.every(row => row.status === 'parsed') && !missingRegions.length;
  const incomplete = questions.filter(row => row.matches !== 1 || row.fields.length);
  const unconfiguredCities = [...new Set(records.filter(row => !configuredCities.includes(row.city)).map(row => row.city))];
  const newWaves = new Set(changes.added);
  const unexpectedCoverage = incomplete.filter(row => !(newWaves.has(row.waveId) && row.matches === 0));
  const status = !complete ? 'source_error'
    : changes.removed.length || changes.changed.length || changes.duplicateWaveIds.length || changes.duplicateQuestionIds.length || unexpectedCoverage.length || unconfiguredCities.length ? 'review_required'
    : changes.added.length ? 'changes_detected' : 'no_change';
  return {
    schemaVersion: 1, checkedAt, status, source: 'https://poll-tw.com/',
    scope: 'Homepage county cards including empty and hidden cards; all public drawer questions, not only voting intention.',
    limitations: ['Count-only hidden records have no public identity or values; their identity cannot be matched to an independently discovered report.',
      'Matching the secondary index does not verify original reports or promote source status.',
      'Timestamp changes are recorded per page and excluded from wave field differences. Unreadable pages are unknown, not empty.'],
    complete, homepage, regions, missingRegions, observedRecords: records,
    summary: { discoveredRegions: regions.length, readableRegions: readableCities.length,
      publicWavesObserved: records.length, publicQuestionsObserved: questions.length,
      hiddenWaves: complete ? regions.reduce((sum, row) => sum + row.hiddenWaveCount, 0) : null,
      mainTableQuestions: questions.filter(row => row.disposition === 'main_table').length,
      sourceCatalogueQuestions: questions.filter(row => row.disposition === 'source_catalogue').length,
      reviewedDifferentQuestions: questions.filter(row => row.reviewedDifferences.length).length,
      missingOrDifferentQuestions: incomplete.length },
    changes, unconfiguredCities, questions,
    needsReview: status === 'source_error' || status === 'review_required',
  };
}
