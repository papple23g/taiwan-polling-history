import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { electionConfig2026 } from './2026-election-config.mjs';
import { auditSnapshot } from './2026-poll-audit.mjs';

const auditOnly = process.argv.includes('--audit');
if (process.argv.slice(2).some(arg => arg !== '--audit')) throw new Error('Usage: node scripts/collect-2026-index.mjs [--audit]');
const checkedAt = new Date().toISOString();
const previous = JSON.parse(await readFile('source-data/2026-poll-index.json', 'utf8'));
const publishedSource = JSON.parse(await readFile('public/data/verified-source.json', 'utf8'));
const parse = (mode, payload) => {
  const parsed = spawnSync('python', ['-B', 'scripts/extract-2026-index.py', mode], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 20_000_000 });
  if (parsed.status !== 0) throw new Error(parsed.stderr || String(parsed.error));
  return JSON.parse(parsed.stdout);
};
const fetchPage = async url => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return { url, finalUrl: response.url, status: 'fetch_error', httpStatus: response.status };
    const html = await response.text();
    return { url, finalUrl: response.url, status: 'fetched', httpStatus: response.status,
      sha256: createHash('sha256').update(html).digest('hex'), html };
  } catch (error) {
    return { url, status: 'fetch_error', error: String(error) };
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
const parsed = parse('--inventory', Object.fromEntries(fetched.filter(row => row.status === 'fetched').map(row => [row.slug, row.html])));
const { html: homepageHtml, ...homepageReceipt } = homepage;
if (discoveryError) Object.assign(homepageReceipt, { status: 'parse_error', error: discoveryError });
const regions = fetched.map(({ html, ...receipt }) => ({ ...receipt,
  ...(parsed.regions.find(row => row.slug === receipt.slug) ?? { waveCount: null, questionCount: null, hiddenWaveCount: null }) }));
const audit = auditSnapshot({ checkedAt, homepage: homepageReceipt, regions, previousRecords: previous.records,
  records: parsed.records, publishedSource, configuredCities: Object.keys(electionConfig2026) });
await writeFile('source-data/2026-poll-audit.json', JSON.stringify(audit, null, 2) + '\n');
if (!auditOnly) {
  if (!audit.complete || audit.changes.removed.length || audit.changes.duplicateWaveIds.length || audit.changes.duplicateQuestionIds.length || audit.unconfiguredCities.length) {
    throw new Error('Index unchanged: incomplete collection, removed waves, duplicate IDs or unconfigured public regions. Read source-data/2026-poll-audit.json.');
  }
  const records = parsed.records.map(record => ({ ...record,
    collectedAt: previous.records.find(old => old.id === record.id)?.collectedAt ?? checkedAt }));
  await writeFile('source-data/2026-poll-index.json', JSON.stringify({ collectedAt: checkedAt, source: 'https://poll-tw.com/',
    verification: 'Secondary index only; original links have not been independently checked by this collector.', records }, null, 2) + '\n');
}
console.log(JSON.stringify({ auditOnly, ...audit.summary, added: audit.changes.added.length,
  changed: audit.changes.changed.length, removed: audit.changes.removed.length, needsReview: audit.needsReview }));
if (auditOnly && audit.needsReview) process.exitCode = 1;
