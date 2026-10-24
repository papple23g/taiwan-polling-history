import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../source-data/parts/', import.meta.url));
const filenames = (await readdir(directory)).filter(name => /^\d{2}\.json$/.test(name)).sort();
if (filenames.length < 14 || filenames.some((name, i) => name !== String(i + 1).padStart(2, '0') + '.json')) {
  throw new Error('Expected consecutive numbered source parts starting at 01.json.');
}
const parts = await Promise.all(filenames.map(name => readFile(resolve(directory, name), 'utf8').then(JSON.parse)));
if (parts[0].part_type !== 'metadata') throw new Error('Part 1 must be metadata.');
const raw = { ...parts[0].data, contests: [], polls: [], historical_contexts: [], held_records: [] };
for (let i = 1; i < parts.length; i++) {
  const part = parts[i];
  if (!['contests', 'polls', 'historical_contexts', 'held_records'].includes(part.part_type) || !Array.isArray(part.data)) throw new Error('Invalid part ' + filenames[i]);
  raw[part.part_type].push(...part.data);
}
const contestIds = new Set(raw.contests.map(contest => contest.id));
const pollIds = new Set(raw.polls.map(poll => poll.id));
if (raw.contests.length !== 14 || contestIds.size !== raw.contests.length) throw new Error('Expected unique official results for 14 contests.');
if (raw.polls.length !== (raw.scope?.total_poll_records ?? raw.scope?.verified_poll_records) || pollIds.size !== raw.polls.length) throw new Error('Poll count/IDs differ from metadata.');
if (raw.polls.filter(p => p.verification_status === 'verified_primary').length !== raw.scope?.verified_poll_records) throw new Error('Verified primary poll count differs from metadata.');
if (raw.scope?.indexed_poll_records !== undefined && raw.polls.filter(p => p.verification_status === 'indexed_secondary').length !== raw.scope.indexed_poll_records) throw new Error('Secondary-index poll count differs from metadata.');
if (new Set(raw.polls.filter(poll => poll.verification_status === 'verified_primary').map(poll => poll.contest_id)).size !== raw.scope?.poll_contests_verified) throw new Error('Verified poll coverage differs from metadata.');
if (raw.scope?.poll_contests_with_records !== undefined && new Set(raw.polls.map(poll => poll.contest_id)).size !== raw.scope.poll_contests_with_records) throw new Error('Indexed poll coverage differs from metadata.');
for (const contest of raw.contests) {
  if (contest.verified_poll_count !== raw.polls.filter(poll => poll.contest_id === contest.id && poll.verification_status === 'verified_primary').length) {
    throw new Error('Verified poll count differs from election metadata: ' + contest.id);
  }
}
const destination = process.argv[3] ? resolve(process.argv[3]) : fileURLToPath(new URL('../source-data/audited-source.json', import.meta.url));
await writeFile(destination, JSON.stringify(raw, null, 2) + '\n');
process.stdout.write(JSON.stringify({ parts: parts.length, contests: raw.contests.length, polls: raw.polls.length, destination }) + '\n');
