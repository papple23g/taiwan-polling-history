import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { candidatePortraits } from '../src/candidate-portraits.mjs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { runtimeArtifacts } from './build-runtime-data.mjs';
const root=resolve('dist/client');
async function files(directory) { const entries=await readdir(directory,{withFileTypes:true}); return (await Promise.all(entries.map(e=>e.isDirectory()?files(resolve(directory,e.name)):[resolve(directory,e.name)]))).flat(); }
const paths=await files(root);
const forbidden=['QA-ONLY','測試候選人','libfile_','completion_token','download_url','library_file_transfer','C:\\Users\\','餘弦'];
const portraitPaths = new Map(candidatePortraits.map(portrait => [resolve(root, '.' + portrait.src), portrait]));
for(const path of paths) {
  const portrait = portraitPaths.get(path);
  if (portrait && /^\/candidate-portraits\/(?:q\d+|candidate-[a-z0-9]+(?:-[a-z0-9]+)*)\.(jpg|png)$/.test(portrait.src)) {
    const bytes = await readFile(path);
    const valid = extname(path) === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!valid || createHash('sha256').update(bytes).digest('hex') !== portrait.sha256) throw new Error(`Invalid portrait image: ${relative(root, path)}`);
    continue;
  }
  if(!['.html','.css','.js','.json'].includes(extname(path))) throw new Error(`Unexpected bundle asset: ${relative(root,path)}`);
  const content=await readFile(path,'utf8');
  for(const marker of forbidden) if(content.includes(marker)) throw new Error(`Non-public marker ${marker} in ${relative(root,path)}`);
}
for (const path of portraitPaths.keys()) if (!paths.includes(path)) throw new Error(`Missing portrait: ${relative(root, path)}`);
const data=JSON.parse(await readFile(resolve(root,'data/verified.json'),'utf8'));
const source=JSON.parse(await readFile(resolve(root,'data/verified-source.json'),'utf8'));
const runtime = runtimeArtifacts(data);
assert.deepEqual(JSON.parse(await readFile(resolve(root, 'data/app-index.json'), 'utf8')), runtime.index, 'Runtime index differs from full public data');
const electionFiles = await readdir(resolve(root, 'data/elections'));
assert.deepEqual(electionFiles.sort(), runtime.elections.map(election => election.electionId + '.json').sort(), 'Unexpected or missing election chunks');
for (const election of runtime.elections) assert.deepEqual(JSON.parse(await readFile(resolve(root, 'data/elections', election.electionId + '.json'), 'utf8')), election, 'Election evidence or revision differs: ' + election.electionId);
if(data.elections.length!==(source.scope.total_contests??source.scope.official_contests_verified) || source.contests.length!==data.elections.length || data.elections.filter(e=>e.result.status==='verified').length!==source.scope.official_contests_verified || data.polls.length!==(source.scope.total_poll_records??source.scope.verified_poll_records) || source.polls.length!==data.polls.length) throw new Error('Bundle has incorrect authentic-data coverage.');
if(data.polls.filter(p=>p.status==='verified').length!==source.scope.verified_poll_records || data.polls.filter(p=>p.status==='pending').length!==source.scope.indexed_poll_records) throw new Error('Bundle verification tiers are inconsistent.');
if(data.score!=='normalized_mae_pp') throw new Error('Incorrect primary score.');
console.log(JSON.stringify({files:paths.map(p=>relative(root,p)),elections:data.elections.length,polls:data.polls.length,privateMarkersFound:0}));
