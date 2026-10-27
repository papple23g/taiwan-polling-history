import { isDeepStrictEqual } from 'node:util';

export const votingQuestion = question => question.type === 'voting_intention' || question.label.startsWith('投票意向');
export const importedQuestionId = (wave, question, index) => `${wave.id}${votingQuestion(question) && index === wave.questions.findIndex(votingQuestion) ? '' : `-question-${index + 1}`}`;

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

export function compareIndexRecords(previous, current, readableCities) {
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
    duplicateQuestionIds: duplicates(current.flatMap(wave => wave.questions.map((question, index) => importedQuestionId(wave, question, index)))),
  };
}

export function questionCoverage(records, publishedSource) {
  const main = publishedSource.polls ?? [];
  const catalogue = publishedSource.historical_contexts ?? [];
  return records.flatMap(wave => wave.questions.map((question, index) => {
    const id = importedQuestionId(wave, question, index);
    const matches = [...main.filter(row => row.id === id).map(row => ({ row, disposition: 'main_table' })),
      ...catalogue.filter(row => row.id === id).map(row => ({ row, disposition: 'source_catalogue' }))];
    const expected = { contest_id: `2026-${wave.city}`, question: question.label, responses: question.responses };
    const fields = matches.length === 1 ? fieldDifferences(expected, Object.fromEntries(Object.keys(expected).map(key => [key, matches[0].row[key]]))) : [];
    return { waveId: wave.id, questionNumber: index + 1, question: question.label, recordId: id,
      disposition: matches.length === 1 ? matches[0].disposition : matches.length ? 'duplicate' : 'missing',
      matches: matches.length, fields };
  }));
}

export function auditSnapshot({ checkedAt, homepage, regions, previousRecords, records, publishedSource, configuredCities }) {
  const readableCities = regions.filter(row => row.status === 'parsed').map(row => row.slug);
  const changes = compareIndexRecords(previousRecords, records, readableCities);
  const questions = questionCoverage(records, publishedSource);
  const complete = homepage.status === 'fetched' && regions.length > 0 && regions.every(row => row.status === 'parsed');
  const incomplete = questions.filter(row => row.matches !== 1 || row.fields.length);
  const unconfiguredCities = [...new Set(records.filter(row => !configuredCities.includes(row.city)).map(row => row.city))];
  return {
    schemaVersion: 1, checkedAt, source: 'https://poll-tw.com/',
    scope: 'Homepage county cards including empty and hidden cards; all public drawer questions, not only voting intention.',
    limitations: ['Count-only hidden records have no public identity or values; their identity cannot be matched to an independently discovered report.',
      'Matching the secondary index does not verify original reports or promote source status.',
      'Timestamp changes are recorded per page and excluded from wave field differences. Unreadable pages are unknown, not empty.'],
    complete, homepage, regions, observedRecords: records,
    summary: { discoveredRegions: regions.length, readableRegions: readableCities.length,
      publicWavesObserved: records.length, publicQuestionsObserved: questions.length,
      hiddenWaves: complete ? regions.reduce((sum, row) => sum + row.hiddenWaveCount, 0) : null,
      mainTableQuestions: questions.filter(row => row.disposition === 'main_table').length,
      sourceCatalogueQuestions: questions.filter(row => row.disposition === 'source_catalogue').length,
      missingOrDifferentQuestions: incomplete.length },
    changes, unconfiguredCities, questions,
    needsReview: !complete || Boolean(changes.added.length || changes.removed.length || changes.changed.length ||
      changes.duplicateWaveIds.length || changes.duplicateQuestionIds.length || incomplete.length || unconfiguredCities.length),
  };
}
