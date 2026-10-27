import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { writeDataFile as writeFile } from './write-data-file.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const indexSource = source => pick(source, ['title', 'url', 'publishedAt', 'accessedAt']);

export function runtimeArtifacts(data) {
  const revision = createHash('sha256').update(JSON.stringify(data) + '\n').digest('hex');
  const { historicalContexts = [], heldRecords = [], ...base } = data;
  const elections = data.elections.map(election => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(election.id)) throw new Error('Invalid runtime election ID: ' + election.id);
    return { revision, version: data.version, electionId: election.id,
      polls: data.polls.filter(poll => poll.electionId === election.id),
      historicalContexts: historicalContexts.filter(row => row.electionId === election.id),
      heldRecords: heldRecords.filter(row => row.electionId === election.id) };
  });
  const polls = data.polls.map(({ provenance, verificationReview, sourceCalculation, ...poll }) => ({
    ...poll,
    source: indexSource(poll.source),
    sources: poll.sources.map(indexSource),
    provenance: pick(provenance, ['product_type', 'candidate_set', 'question_candidate_set']),
    verificationReview: pick(verificationReview, ['calculationBlocker', 'calculation_blocker']),
  }));
  return { index: { ...base, revision, polls,
    catalogueCounts: Object.fromEntries(elections.map(election => [election.electionId,
      { historicalContexts: election.historicalContexts.length, heldRecords: election.heldRecords.length }])) },
    elections };
}

export async function writeRuntimeData(data, directory) {
  const artifacts = runtimeArtifacts(data);
  await mkdir(resolve(directory, 'elections'), { recursive: true });
  const writes = await Promise.allSettled(artifacts.elections.map(election => writeFile(resolve(directory, 'elections', election.electionId + '.json'), JSON.stringify(election) + '\n', 'utf8')));
  const failure = writes.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  await writeFile(resolve(directory, 'app-index.json'), JSON.stringify(artifacts.index) + '\n', 'utf8');
  return artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve('public/data');
  const data = JSON.parse(await readFile(resolve(directory, 'verified.json'), 'utf8'));
  const { index, elections } = await writeRuntimeData(data, directory);
  console.log(JSON.stringify({ revision: index.revision, indexBytes: Buffer.byteLength(JSON.stringify(index)), elections: elections.length }));
}
