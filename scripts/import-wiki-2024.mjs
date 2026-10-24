import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = resolve(root, 'source-data/parts');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const write = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
const index = await read(resolve(root, 'source-data/wikipedia-2024-index.json'));
const priorParts = await Promise.all(Array.from({ length: 15 }, (_, i) => read(resolve(partsDir, String(i + 1).padStart(2, '0') + '.json'))));
const prior = priorParts.filter(part => part.part_type === 'polls').flatMap(part => part.data);
const contest = priorParts.filter(part => part.part_type === 'contests').flatMap(part => part.data).find(c => c.id === '2024-president');
if (!contest || !Array.isArray(index.records) || index.records.length !== 83) throw new Error('Expected the complete 83-row indexed post-registration dataset.');
const votes = Object.fromEntries(contest.candidates.map(c => [c.name, c.votes]));
const candidateSet = [...contest.selected_candidates];
const officialVoteSum = candidateSet.reduce((s, c) => s + votes[c], 0);
const sourceGroupNames = { media: '一般機構', rolling: '美麗島追蹤', internal: '政黨內參', street: '非機率街訪' };

function identity(row) {
  const name = row.displayName;
  if (row.sourceGroup === 'rolling' || name.includes('美麗島')) return { brand: '美麗島電子報', executor: '畢肯市場研究股份有限公司', unit: 'formosa__beacon' };
  if (name === 'TVBS') return { brand: 'TVBS', executor: 'TVBS民意調查中心', unit: 'tvbs__tvbs-poll-center' };
  if (name === 'ETtoday') return { brand: 'ETtoday', executor: 'ETtoday民調雲', unit: 'ettoday__ettoday-poll-cloud' };
  if (name.includes('QuickseeK')) return { brand: 'QuickseeK', executor: '影響力數據顧問', unit: 'quickseek__influence' };
  if (name.includes('鏡新聞')) return { brand: '鏡新聞', executor: '大地民意研究公司', unit: 'mirrornews__dadi' };
  if (name.includes('震傳媒')) return { brand: '震傳媒', executor: '山水民意研究股份有限公司', unit: 'zmedia__sanshui' };
  if (name.includes('鋒燦')) return { brand: '鋒燦傳媒', executor: '鋒燦傳媒（調查團隊待核實）', unit: 'ftnn__self' };
  if (name.includes('菱傳媒')) return { brand: '菱傳媒', executor: '皮爾森（來源標示）', unit: 'rwnews__pearson' };
  if (name.includes('三立')) return { brand: '三立電視', executor: '山水（來源標示）', unit: 'setn__sanshui' };
  if (name.includes('聯合報')) return { brand: '聯合報', executor: '執行單位待核實', unit: 'udn__unspecified' };
  if (name.includes('中華亞太')) return { brand: '中華亞太菁英交流協會', executor: '執行單位待核實', unit: 'apec__unspecified' };
  if (name.includes('榮泰')) return { brand: '榮泰創數據', executor: '執行單位待核實', unit: 'rongtai__unspecified' };
  if (name.includes('匯流') && name.includes('精確')) return { brand: '匯流新聞網', executor: '精確市場研究', unit: 'cnews__jingque' };
  if (name.includes('匯流') && name.includes('趨勢')) return { brand: '匯流新聞網', executor: '趨勢（來源標示）', unit: 'cnews__trend' };
  if (name.includes('民意基金會')) return { brand: '台灣民意基金會', executor: '執行單位待核實', unit: 'tpof__unspecified' };
  if (name.includes('信傳媒')) return { brand: '信傳媒', executor: '佳興（來源標示）', unit: 'cmmedia__jiaxing' };
  if (name.includes('中時')) return { brand: '中時新聞網', executor: '執行單位待核實', unit: 'chinatimes__unspecified' };
  if (name.includes('關鍵調查')) return { brand: '關鍵調查', executor: '執行單位待核實', unit: 'keypoll__unspecified' };
  if (name.includes('新未來')) return { brand: '新未來文教基金會', executor: '蓋洛普（來源標示）', unit: 'newfuture__gallup' };
  if (name.includes('國民黨')) return { brand: '國民黨內參', executor: '十方民意（來源標示）', unit: 'kmt__shifang' };
  if (name.includes('民眾黨')) return { brand: '民眾黨內參', executor: name.includes('求真') ? '求真（來源標示）' : '執行單位待核實', unit: name.includes('求真') ? 'tpp__qiuzhen' : 'tpp__unspecified' };
  if (name.includes('街頭有派對')) return { brand: '街頭有派對', executor: '街頭訪問（非機率抽樣）', unit: 'streetparty__street' };
  throw new Error('Unmapped institution ' + name);
}
function hashString(text) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function matched(existing, row) {
  const p = { '賴清德': row.lai, '侯友宜': row.hou, '柯文哲': row.ko };
  return existing.contest_id === '2024-president' && existing.fieldwork_end === row.fieldworkEnd
    && candidateSet.every(c => Math.abs(existing.raw_support_percent[c] - p[c]) < 1e-7);
}

const primaryChecks = {
  '鏡新聞（大地）|2023-12-31': {
    published: '2024-01-01', isFinal: true, error: 2.96,
    population: '戶籍於台閩地區且年滿20歲以上的民眾',
    method: '市話與手機雙底冊電話調查',
    sampleFrame: '市話分層抽樣；手機後五碼隨機抽樣',
    weighting: '戶籍地、性別、教育程度、年齡反覆加權（raking）',
    undecided: 13, other: 1.8,
    notes: '原始鏡新聞報導載明未決定13%、不投票／廢票1.8%；維基表合併欄16.2%與原文分類不一致，採一手報導可核實數字，未補足剩餘差額。',
  },
  '震傳媒（山水）|2023-12-29': {
    published: '2024-01-01', isFinal: true, error: 2.83,
    population: '全國年滿20歲民眾', method: '市話＋手機CATI',
    sampleFrame: '住宅電話尾二碼隨機；手機依電信業者字首與後五碼隨機',
    weighting: '地區、性別、年齡加權',
    undecided: null, other: null,
    notes: '震傳媒原文可直接核實三組支持度、兩日訪問、1200份與調查方式；維基合併的其他／未定14.9%未由此一手內文逐項確認，保留缺值。',
  },
  '鋒燦傳媒|2023-12-29': {
    published: '2024-01-01', isFinal: true, error: 2.0,
    population: '全國年滿20歲民眾', method: '住宅電話CATI＋會員網路調查',
    sampleFrame: '住宅電話分層加尾四碼隨機；網路會員庫分層抽樣',
    weighting: '性別、年齡層、地區、教育程度加權',
    undecided: 14.8, other: null,
    notes: '一手鋒燦報導直接核實支持度、2405樣本、調查區間與2024-01-01封關發布；14.8%含不投票、未決定及其他未表態，非狹義未決定。',
  },
};
const names = { '鏡新聞（大地）': '鏡新聞 2024 總統大選封關民調', '震傳媒（山水）': '震傳媒封關民調 2024/01/01', '鋒燦傳媒': '鋒燦傳媒 2024/01/01 封關民調' };
const duplicateRows = [];
const generated = [];
for (const row of index.records) {
  if (prior.some(existing => matched(existing, row))) {
    duplicateRows.push({ label: row.displayName, fieldworkEnd: row.fieldworkEnd, samplesWiki: row.sampleSize });
    continue;
  }
  const { brand, executor, unit } = identity(row);
  const id = '2024-president-wiki-' + unit.replaceAll(/[^a-z0-9]+/g, '-') + '-' + row.fieldworkEnd + '-' + hashString(row.sourceUrl + row.fieldworkText + row.lai + row.hou + row.ko).slice(0, 7);
  const proof = primaryChecks[row.displayName + '|' + row.fieldworkEnd] ?? null;
  const rawShares = { '賴清德': row.lai, '侯友宜': row.hou, '柯文哲': row.ko };
  const pollTotal = Object.values(rawShares).reduce((a, b) => a + b, 0);
  if (pollTotal > 100.5) throw new Error('Candidate shares exceed 100.5: ' + id);
  let undecided = proof ? proof.undecided : row.undecided;
  let other = proof ? proof.other : null;
  const notes = [
    '維基索引分類：' + sourceGroupNames[row.sourceGroup] + '；原索引標示：' + row.displayName,
    '原表調查日期：' + row.fieldworkText,
    '維基彙整的「皆不支持／未決定／拒答」欄：' + (row.undecided === null ? '未載／不適用' : row.undecided + '%') + '；此欄可能混合不同類別。',
  ];
  if (pollTotal + (undecided ?? 0) + (other ?? 0) > 100.5) {
    notes.push('維基四欄加總超過100.5%，暫不將其末欄視為可確定的未表態比例，保留待核實。');
    undecided = null;
  }
  if (proof) notes.push(proof.notes);
  else notes.push('僅依維基百科索引轉錄候選人支持度、訪問區間、樣本與方法；原始來源及發布日尚未逐筆獨立核實，不能列入正式 MAE 評比。');
  if (row.sourceGroup === 'internal') notes.push('政黨內部參考資料，公開資訊的抽樣與委託背景可能不足，不與一般獨立發布調查混為同種機構。');
  if (row.sourceGroup === 'street') notes.push('非機率街訪資料，受訪者非全國機率樣本，禁止據以推論選民母體或當作正式民調準確度比較。');
  const normPoll = Object.fromEntries(candidateSet.map(c => [c, rawShares[c] / pollTotal * 100]));
  const normOfficial = Object.fromEntries(candidateSet.map(c => [c, votes[c] / officialVoteSum * 100]));
  const officialRaw = Object.fromEntries(candidateSet.map(c => [c, votes[c] / contest.valid_votes * 100]));
  const mae = candidateSet.reduce((a, c) => a + Math.abs(normPoll[c] - normOfficial[c]), 0) / 3;
  const rawMae = candidateSet.reduce((a, c) => a + Math.abs(rawShares[c] - officialRaw[c]), 0) / 3;
  const primarySource = {
    title: proof ? names[row.displayName] : row.displayName + ' 2024總統民調（維基原始參考連結，待逐筆核對）',
    url: row.sourceUrl,
    kind: proof ? 'primary_publisher_report' : 'original_link_from_secondary_index',
    access_method: proof ? 'full_public_text' : 'not_independently_checked',
    checked_at: proof ? '2026-10-17' : null,
    evidence_summary: proof ? '直接核對原發布者全文中的調查日期、樣本、支持度及公開日期。' : '這個原始報導網址來自維基百科參考連結；本筆數值尚未獨立對照原發布全文。',
  };
  const wikiSource = {
    title: '維基百科：2024年中華民國總統選舉民意調查',
    url: index.sourceUrl,
    kind: 'secondary_table_index',
    access_method: 'public_table_manual_section_parse',
    checked_at: index.indexVersion,
    evidence_summary: '原表逐筆記載品牌、調查日期、方式、樣本數、三位候選人支持度，供後續逐筆來源核實。',
  };
  const sources = [primarySource, wikiSource];
  if (row.archiveUrl) sources.push({
    title: '原始來源的網際網路檔案館備份（尚未核對全文）',
    url: row.archiveUrl, kind: 'archived_source_link', access_method: 'not_independently_checked', checked_at: null,
  });
  const endDays = (Date.parse(contest.election_date) - Date.parse(row.fieldworkEnd)) / 86400000;
  if (!(endDays >= 1 && endDays <= 50) || !(row.fieldworkStart <= row.fieldworkEnd)) throw new Error('Invalid indexed date ' + id);
  const mapped = {
    id, contest_id: '2024-president', brand, executor,
    commissioner: proof || row.sourceGroup === 'internal' ? brand : null,
    funder: proof || row.sourceGroup === 'internal' ? brand : null,
    design_and_analysis: null, comparison_unit_id: unit, product_type: row.sourceGroup === 'street' ? 'nonprobability_street_interview' : 'voting_intention_poll',
    candidate_set: candidateSet, fieldwork_start: row.fieldworkStart, fieldwork_end: row.fieldworkEnd,
    publication_date: proof?.published ?? null, date_timezone: 'Asia/Taipei',
    sample_size_total: row.sampleSize, sample_size_support_question: null,
    population: proof?.population ?? null, mode: proof?.method ?? row.mode,
    sampling_frame: proof?.sampleFrame ?? null, weighting: proof?.weighting ?? null,
    reported_margin_of_error_pp: proof?.error ?? null, reported_confidence_level: proof ? 0.95 : null,
    support_denominator: null, raw_support_percent: rawShares,
    raw_means: proof ? '已核對一手發布者原始支持度。' : '由維基百科二手整理表轉錄之原始支持度，尚未獨立核對一手全文。',
    undecided_percent: undecided, other_percent: other,
    explicit_final_poll_label: !!proof?.isFinal,
    selection_label: proof ? '一手原文明示封關民調' : '維基彙整待核實（不納入正式MAE）',
    latest_available_guaranteed: false,
    verification_status: proof ? 'verified_primary' : 'indexed_secondary',
    aggregate_source_eligible: !!proof,
    sources, notes,
    days_before_election: endDays,
    published_before_election: proof ? true : null,
    within_default_30_day_window: endDays <= 30,
    calculation: {
      candidate_set: candidateSet, poll_selected_support_total: pollTotal, election_selected_votes_total: officialVoteSum,
      raw_official_percent_same_candidates: officialRaw,
      normalized_poll_percent: normPoll, normalized_official_percent: normOfficial,
      raw_mae_pp: rawMae, normalized_mae_pp: mae,
      precision: 'full_precision_before_display_rounding',
      is_provisional: !proof,
    },
    is_last_verified_eligible_in_dataset: !!proof,
    default_aggregate_eligible: !!proof,
    team_continuity_verified: false, primary_mae_pp: proof ? mae : null,
    wikipedia_index: { source_group: row.sourceGroup, display_name: row.displayName, fieldwork_text: row.fieldworkText, original_reference: row.sourceUrl, sample: row.sampleSize, wiki_undecided_combined: row.undecided },
  };
  generated.push(mapped);
}
if (generated.length + duplicateRows.length !== index.records.length) throw new Error('Import accounting mismatch');
if (new Set(generated.map(p=>p.id)).size !== generated.length) throw new Error('Duplicate imported IDs');
const verifiedAdded = generated.filter(p => p.verification_status === 'verified_primary');
const indexedAdded = generated.filter(p => p.verification_status === 'indexed_secondary');
if (verifiedAdded.length !== 3) throw new Error('Expected three directly verified original sources');
await write(resolve(partsDir,'16.json'), { part_type: 'polls', data: generated });
const metadata = priorParts[0];
const all = [...prior, ...generated];
metadata.data.schema_version = '1.1.0';
metadata.data.scope.verified_poll_records = all.filter(p=>p.verification_status === 'verified_primary').length;
metadata.data.scope.indexed_poll_records = indexedAdded.length;
metadata.data.scope.total_poll_records = all.length;
metadata.data.scope.wikipedia_index_records = index.records.length;
metadata.data.scope.wikipedia_matched_existing = duplicateRows.length;
metadata.data.scope.poll_contests_verified = new Set(all.filter(p=>p.verification_status === 'verified_primary').map(p=>p.contest_id)).size;
metadata.data.scope.supplied_raw_records_assessed = 26 + index.records.length;
metadata.data.scope.coverage_statement = '中選會官方選舉結果14場；民調總收錄' + all.length + '筆（已完成一手或交叉核實' + metadata.data.scope.verified_poll_records + '筆；維基索引待核實' + indexedAdded.length + '筆），民調涵蓋10場選舉。待核實紀錄可查看原始數值但不納入正式MAE或跨場平均。';
metadata.data.methodology.index_source_rule = '維基百科為搜尋索引，不等於原始發布者核實；未確認發表日期的索引資料使用publication_date:null，verification_status:indexed_secondary，MAE僅保留供日後核查的試算值，不進入正式比較。';
metadata.data.methodology.verified_core_fields += '；2024新增鏡新聞、震傳媒、鋒燦傳媒之封關民調直接核對發布者原文。';
metadata.data.scope.expanded_2024_original_verified = verifiedAdded.map(p => p.id);
await write(resolve(partsDir,'01.json'), metadata);
const finalContestsPart = priorParts.find(part => part.part_type === 'contests' && part.data.some(c => c.id === '2024-president'));
if (!finalContestsPart) throw new Error('No 2024 official contest part found');
finalContestsPart.data.find(c => c.id === '2024-president').verified_poll_count = all.filter(p => p.contest_id === '2024-president' && p.verification_status === 'verified_primary').length;
const finalPartIndex = priorParts.indexOf(finalContestsPart) + 1;
await write(resolve(partsDir, String(finalPartIndex).padStart(2,'0') + '.json'), finalContestsPart);
process.stdout.write(JSON.stringify({ wikipediaRows: index.records.length, duplicateRows, imported: generated.length, newVerified: verifiedAdded.length, indexedPending: indexedAdded.length, totalPolls: all.length, verifiedTotal: metadata.data.scope.verified_poll_records, byBrand: new Set(all.filter(p=>p.contest_id==='2024-president').map(p=>p.brand)).size }) + '\n');
