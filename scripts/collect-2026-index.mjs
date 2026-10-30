import { spawnSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { electionConfig2026 } from './2026-election-config.mjs';
import { auditSnapshot, auditExitCode, createQuestionRegistry, extendQuestionRegistry } from './2026-poll-audit.mjs';
import { writeDataFile as writeFile } from './write-data-file.mjs';

let auditOnly = false, reportDirectory = null;
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === '--audit') auditOnly = true;
  else if (process.argv[index] === '--report-dir' && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) reportDirectory = resolve(process.argv[++index]);
  else throw new Error('Usage: node scripts/collect-2026-index.mjs [--audit] [--report-dir directory]');
}
const checkedAt = new Date().toISOString();
const previous = JSON.parse(await readFile('source-data/2026-poll-index.json', 'utf8'));
const publishedSource = JSON.parse(await readFile('public/data/verified-source.json', 'utf8'));
const registryPath = 'source-data/2026-question-ids.json';
let questionRegistry;
try { questionRegistry = JSON.parse(await readFile(registryPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const otherSnapshots = await Promise.all(['2026-zhubei-primary.json', '2026-poll-supplement.json'].map(name => readFile(`source-data/${name}`, 'utf8').then(JSON.parse)));
  questionRegistry = createQuestionRegistry([...previous.records, ...otherSnapshots.flatMap(snapshot => snapshot.records)]);
}
const parse = (mode, payload) => {
  const parsed = spawnSync(process.env.PYTHON || 'python', ['-B', 'scripts/extract-2026-index.py', mode], { input: JSON.stringify(payload) + '\n', encoding: 'utf8', maxBuffer: 20_000_000, timeout: 60_000 });
  if (parsed.status !== 0) throw new Error(parsed.stderr || String(parsed.error));
  return JSON.parse(parsed.stdout);
};
const fetchPage = async url => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        await response.body?.cancel();
        if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
          await delay(Math.min(10_000, Math.max(1000 * 2 ** attempt, (Number(response.headers.get('retry-after')) || 0) * 1000)));
          continue;
        }
        return { url, finalUrl: response.url, status: 'fetch_error', httpStatus: response.status, attempts: attempt + 1 };
      }
      const html = await response.text();
      return { url, finalUrl: response.url, status: 'fetched', httpStatus: response.status, attempts: attempt + 1,
        sha256: createHash('sha256').update(html).digest('hex'), html };
    } catch (error) {
      if (attempt < 2 && (['TimeoutError', 'AbortError'].includes(error.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code))) {
        await delay(1000 * 2 ** attempt);
        continue;
      }
      return { url, status: 'fetch_error', error: String(error), attempts: attempt + 1 };
    }
  }
};
const homepage = await fetchPage('https://poll-tw.com/');
let discovered = [], discoveryError;
if (homepage.status === 'fetched') {
  try { discovered = parse('--regions', homepage.html); } catch (error) { discoveryError = String(error); }
}
const fetched = [];
// Bound concurrent requests without restricting discovery to configured elections.
for (let index = 0; index < discovered.length; index += 4) {
  fetched.push(...await Promise.all(discovered.slice(index, index + 4).map(async region => ({ ...region, ...await fetchPage(region.url) }))));
}
let parsed;
try { parsed = parse('--inventory', Object.fromEntries(fetched.filter(row => row.status === 'fetched').map(row => [row.slug, row.html]))); }
catch (error) {
  parsed = { records: [], regions: fetched.filter(row => row.status === 'fetched').map(row => ({ slug: row.slug, status: 'parse_error', error: String(error), waveCount: null, questionCount: null, hiddenWaveCount: null })) };
}
const { html: homepageHtml, ...homepageReceipt } = homepage;
if (discoveryError) Object.assign(homepageReceipt, { status: 'parse_error', error: discoveryError });
const regions = fetched.map(({ html, ...receipt }) => ({ ...receipt,
  ...(parsed.regions.find(row => row.slug === receipt.slug) ?? { waveCount: null, questionCount: null, hiddenWaveCount: null }) }));
const audit = auditSnapshot({ checkedAt, homepage: homepageReceipt, regions, previousRecords: previous.records,
  records: parsed.records, publishedSource, configuredCities: Object.keys(electionConfig2026), questionRegistry });
const records = parsed.records.map(record => ({ ...record,
  collectedAt: previous.records.find(old => old.id === record.id)?.collectedAt ?? checkedAt }));
const candidate = { collectedAt: checkedAt, source: 'https://poll-tw.com/',
  verification: 'Secondary index only; original links have not been independently checked by this collector.', records };
const candidateRegistry = extendQuestionRegistry(questionRegistry, parsed.records);
if (reportDirectory) {
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(resolve(reportDirectory, '2026-poll-index.json'), JSON.stringify(candidate, null, 2) + '\n');
  await writeFile(resolve(reportDirectory, '2026-question-ids.json'), JSON.stringify(candidateRegistry, null, 2) + '\n');
}
await writeFile(reportDirectory ? resolve(reportDirectory, '2026-poll-audit.json') : 'source-data/2026-poll-audit.json', JSON.stringify(audit, null, 2) + '\n');
if (!auditOnly && audit.status === 'changes_detected') {
  await writeFile('source-data/2026-poll-index.json', JSON.stringify(candidate, null, 2) + '\n');
  await writeFile(registryPath, JSON.stringify(candidateRegistry, null, 2) + '\n');
}
console.log(JSON.stringify({ auditOnly, status: audit.status, checkedAt, ...audit.summary, added: audit.changes.added.length,
  changed: audit.changes.changed.length, removed: audit.changes.removed.length, needsReview: audit.needsReview }));
process.exitCode = auditExitCode(audit.status);
