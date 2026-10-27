import { readFile, readdir, mkdir } from 'node:fs/promises';
import { writeDataFile as writeFile } from './write-data-file.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildHistoricalImport } from './import-historical-polls.mjs';

export const importer = 'local-election-history';
const years = [2014, 2018, 2022];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
// Match documented source spellings to the same person's official ballot name; preserve the observations.
const canonicalName = value => String(value).normalize('NFKC').replace('吳萼洋', '吳蕚洋').replace('黄師鵬', '黃師鵬').replace('洪志恆', '洪志恒')
  .replace(/^(?:Kolas(?:[·．.]?尤達卡)?|谷辣斯[·．.]尤達卡)(?:\s+Kolas Yotaka)?$/i, '谷辣斯.尤達卡 Kolas Yotaka');
const canonicalShares = shares => Object.fromEntries(Object.entries(shares ?? {}).map(([name, value]) => [canonicalName(name), value]));
const brandKey = value => String(value ?? '').normalize('NFKC').replace(/(?:新聞網|新聞台|新聞|民意調查中心|民調中心|民調)|\s/g, '').toLowerCase();
const observedDate = row => row.indexDate ?? row.fieldworkEnd ?? row.dateText?.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
const supportKey = shares => JSON.stringify(Object.entries(canonicalShares(shares)).filter(([, value]) => typeof value === 'number').sort(([a], [b]) => a.localeCompare(b)));
function reviewCorrections(corrections = []) {
  return corrections.flatMap(change => Object.entries(change.changes ?? { [change.field]: {
    indexed: 'original' in change ? change.original : change.indexedValue,
    revised: 'corrected' in change ? change.corrected : change.value,
  } }).map(([field, value]) => {
    if (!field || field === 'undefined') throw new Error('Source correction requires a field name.');
    return { field, original: value.indexed ?? null, corrected: value.revised ?? null,
      reason: change.reason ?? null, evidence: { ...change.evidence, url: change.url ?? change.evidence?.url,
        locator: change.locator ?? change.evidence?.locator ?? change.reason ?? null } };
  }));
}
function key(row, observations = row) {
  const date = observedDate({ ...row, ...observations });
  const scenario = row.conditionalQuestion || row.contextOnly || row.productType === 'non_voting_question' ? `|context:${row.question ?? row.productType}` : '';
  return `${row.electionId}|${brandKey(row.brand)}|${date ?? row.sourceUrl}|${supportKey(observations.shares ?? row.shares)}${scenario}`;
}

export function summarizeParts(metadata, parts) {
  const all = { contests: [], polls: [], historical_contexts: [], held_records: [] };
  for (const part of parts) if (all[part.part_type]) all[part.part_type].push(...part.data);
  const verified = all.polls.filter(row => row.verification_status === 'verified_primary');
  Object.assign(metadata.scope, {
    total_contests: all.contests.length, official_contests_verified: all.contests.filter(row => row.phase !== 'pre_result').length,
    pre_result_contests: all.contests.filter(row => row.phase === 'pre_result').length,
    total_poll_records: all.polls.length, verified_poll_records: verified.length, indexed_poll_records: all.polls.length - verified.length,
    poll_contests_verified: new Set(verified.map(row => row.contest_id)).size, poll_contests_with_records: new Set(all.polls.map(row => row.contest_id)).size,
    historical_candidate_context_records: all.historical_contexts.length, held_source_conflict_records: all.held_records.length,
  });
  for (const contest of all.contests) contest.verified_poll_count = verified.filter(row => row.contest_id === contest.id).length;
  return all;
}

export function buildLocalHistorySupplement(parts, official, inputs, legacyIndex) {
  const metadata = structuredClone(parts.find(part => part.part_type === 'metadata').data);
  const base = summarizeParts(metadata, parts.filter(part => part.importer !== importer));
  const oldContests = new Set(base.contests.map(row => row.id));
  const addedContests = structuredClone(official.contests.filter(row => !oldContests.has(row.id)));
  const contests = [...base.contests, ...addedContests];
  const contestMap = new Map(contests.map(row => [row.id, row]));
  if (new Set(official.contests.map(row => row.id)).size !== 66 || years.some(year => official.contests.filter(row => row.election_date.startsWith(String(year))).length !== 22)) throw new Error('Expected 22 official local contests per year.');
  const priorRecords = legacyIndex.records;
  const existingKeys = new Map();
  for (const record of priorRecords) {
    for (const original of [record, record.indexedObservations].filter(Boolean)) existingKeys.set(key(record, original), record.auditId);
  }
  for (const poll of base.polls) {
    const row = { electionId: poll.contest_id, brand: poll.brand, shares: poll.raw_support_percent, fieldworkEnd: poll.fieldwork_end,
      indexDate: poll.historical_import?.index_date, dateText: poll.historical_import?.date_text, sourceUrl: poll.sources[0]?.url };
    existingKeys.set(key(row), poll.id);
  }
  const existingElections = new Map([...priorRecords.map(row => [row.auditId, row.electionId]), ...base.polls.map(row => [row.id, row.contest_id]), ...base.historical_contexts.map(row => [row.id, row.electionId]), ...base.held_records.map(row => [row.id, row.electionId])]);
  const records = [], accounting = [], seen = new Map();
  for (const input of inputs) {
    if (!years.includes(input.year) || input.coverage.length !== 22 || new Set(input.coverage.map(row => row.region)).size !== 22) throw new Error(`Incomplete source coverage ${input.year}`);
    for (const original of input.records) {
      const contest = contestMap.get(original.electionId);
      if (!contest) throw new Error(`Unknown contest ${original.electionId}`);
      const explicitMatches = [...(original.matchedExistingIds ?? []), ...(original.matchedCatalogueIds ?? []), ...(original.matchedCatalogueAuditIds ?? [])].filter(id => existingElections.get(id) === original.electionId);
      const matched = explicitMatches.length ? explicitMatches : existingKeys.has(key(original)) ? [existingKeys.get(key(original))] : [];
      if (matched.length) { accounting.push({ auditId: original.auditId, electionId: original.electionId, result: 'existing', ids: matched }); continue; }
      const duplicate = key(original);
      if (seen.has(duplicate)) { accounting.push({ auditId: original.auditId, electionId: original.electionId, result: 'duplicate', ids: [seen.get(duplicate)] }); continue; }
      seen.set(duplicate, original.auditId);
      const officialNames = new Map(contest.candidates.map(candidate => [canonicalName(candidate.name), candidate.name]));
      const name = value => officialNames.get(canonicalName(value)) ?? canonicalName(value);
      const row = { ...structuredClone(original),
        publicRecordId: `${original.electionId}-supplement-${digest(original.auditId)}`,
        fieldworkStart: original.fieldworkStart ?? null, fieldworkEnd: original.fieldworkEnd ?? null, publishedAt: original.publishedAt ?? null,
        candidateSet: original.candidateSet.filter(candidate => typeof original.shares[candidate] === 'number' || original.questionCandidateSet?.includes(candidate)).map(name),
        questionCandidateSet: original.questionCandidateSet?.length ? original.questionCandidateSet.map(name) : null,
        shares: Object.fromEntries(Object.entries(original.shares).map(([candidate, value]) => [name(candidate), value])),
        proposedVerification: 'pending', disposition: 'new_record',
        decision: original.conditionalQuestion || original.contextOnly ? 'context_only' : original.decision ?? (original.productType === 'non_voting_question' ? 'context_only' : 'import_pending'),
        matchedExistingIds: [], auditDisposition: 'local_history_supplement',
        indexedObservations: original.indexedObservations ?? original.indexObservations ?? { shares: original.shares, candidateSet: original.candidateSet, dateText: original.dateText },
        verificationReview: { ...original.verificationReview, status: original.decision === 'hold_conflict' ? 'conflict' : 'partial', checkedAt: input.checkedAt,
          corrections: reviewCorrections(original.corrections),
          sourceAccess: original.sourceAccess ? Object.fromEntries(Object.entries(original.sourceAccess).filter(([field]) => !['file', 'localEvidence'].includes(field))) : null,
          reason: original.verificationReview?.reason ?? '保留公開索引與逐欄觀察，六核心一手核實及獨立回讀尚未全部完成。',
          fieldEvidence: original.fieldEvidence ?? {}, verifiedFields: original.verificationReview?.verifiedFields ?? [], missingFields: original.verificationReview?.missingFields ?? ['independentFieldReview'] },
      };
      // A header can list a hypothetical candidate without reporting a value for this question.
      for (const candidate of Object.keys(row.shares)) if (row.shares[candidate] === null && !officialNames.has(canonicalName(candidate)) && !row.candidateSet.includes(candidate) && !row.questionCandidateSet?.includes(candidate)) delete row.shares[candidate];
      records.push(row);
    }
  }
  const syntheticMetadata = structuredClone(metadata);
  syntheticMetadata.common_contest_comparisons = [];
  syntheticMetadata.scope.official_contests_verified = contests.filter(row => row.phase !== 'pre_result').length;
  const result = buildHistoricalImport([{ part_type: 'metadata', data: syntheticMetadata }, { part_type: 'contests', data: contests }, { part_type: 'polls', data: base.polls }],
    { id: 'local-election-history-20261027', checked_at: official.checkedAt, records });
  accounting.push(...result.accounting.map(row => ({ ...row, electionId: records.find(record => record.auditId === row.auditId).electionId })));
  if (accounting.length !== inputs.reduce((sum, input) => sum + input.records.length, 0) || new Set(accounting.map(row => row.auditId)).size !== accounting.length) throw new Error('Incomplete local source accounting');
  const additions = [
    { part_type: 'contests', importer, data: addedContests }, { part_type: 'polls', importer, data: result.imported },
    { part_type: 'historical_contexts', importer, data: result.contexts }, { part_type: 'held_records', importer, data: result.held },
  ];
  const all = summarizeParts(metadata, [...parts.filter(part => part.importer !== importer), ...additions]);
  metadata.schema_version = '1.6.0'; metadata.verified_at = official.checkedAt;
  metadata.scope.local_history_collection = { checked_at: official.checkedAt, years, contests: 66,
    records_assessed: accounting.length, dispositions: Object.fromEntries(['existing', 'duplicate', 'imported', 'context', 'held'].map(status => [status, accounting.filter(row => row.result === status).length])),
    coverage: inputs.flatMap(input => input.coverage.map(row => ({ year: input.year, region: row.region, status: row.status,
      recordsFound: input.records.filter(record => contestMap.get(record.electionId)?.geography === row.region).length,
      queries: row.queries ?? [], indexUrls: row.indexUrls ?? [], limitations: row.limitations ?? [] }))) };
  metadata.scope.coverage_statement = `中選會已核實結果${metadata.scope.official_contests_verified}場；2022、2018、2014各22縣市長均已建立資料與來源盤點。全站民調${all.polls.length}筆，另存候選情境及來源衝突；來源盤點不代表完整歷史民調普查，未知欄位不補造。`;
  metadata.methodology.local_history_candidate_rule = '新增歷史縣市長場次固定比較官方得票前二名，加上其他官方得票率達5%者，以未四捨五入整數票數判定；既有場次維持原集合。原始問卷人選與支持度完整保留，缺比較人選時不補零。';
  metadata.data_changes = [...(metadata.data_changes ?? []).filter(row => row.title !== '補收三屆地方選舉民調'),
    { date: official.checkedAt, title: '補收三屆地方選舉民調', description: `2022、2018、2014各22縣市長，補收${result.imported.length}筆民調，另存${result.contexts.length}筆候選情境與${result.held.length}筆衝突；保留既有ID與核實狀態，原文未讀及其他缺漏逐筆記錄。`,
      source: { title: '中選會選舉資料庫：縣市長選舉清單', url: 'https://db.cec.gov.tw/static/elections/list/ELC_C2.json', checked_at: official.checkedAt } }];
  return { additions, metadata, accounting, records, all };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = 'source-data/parts';
  const files = (await readdir(directory)).filter(name => /^\d{2}\.json$/.test(name)).sort();
  const parts = await Promise.all(files.map(async name => JSON.parse(await readFile(`${directory}/${name}`, 'utf8'))));
  for (const number of [23, 24, 25, 26]) {
    const name = `${number}.json`;
    if (files.includes(name) && parts[files.indexOf(name)].importer !== importer) throw new Error(`Refusing to overwrite unrelated part ${name}`);
  }
  const official = JSON.parse(await readFile('source-data/local-history-official.json', 'utf8'));
  const inputs = await Promise.all(years.map(async year => JSON.parse(await readFile(`source-data/local-history-${year}.json`, 'utf8'))));
  const legacy = JSON.parse(await readFile('source-data/historical-poll-index.json', 'utf8'));
  const result = buildLocalHistorySupplement(parts, official, inputs, legacy);
  if (!process.argv.includes('--dry-run')) {
    for (const [index, part] of result.additions.entries()) await writeFile(`${directory}/${23 + index}.json`, JSON.stringify(part, null, 2) + '\n');
    await writeFile(`${directory}/01.json`, JSON.stringify({ part_type: 'metadata', data: result.metadata }, null, 2) + '\n');
  }
  await mkdir('report/local-history-20261027', { recursive: true });
  await writeFile('report/local-history-20261027/accounting.json', JSON.stringify({ scope: result.metadata.scope.local_history_collection, records: result.accounting }, null, 2) + '\n');
  console.log(JSON.stringify({ dryRun: process.argv.includes('--dry-run'), contests: result.all.contests.length, polls: result.all.polls.length, ...result.metadata.scope.local_history_collection.dispositions }));
}
