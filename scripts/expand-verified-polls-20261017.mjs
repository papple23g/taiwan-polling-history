import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = resolve(root, 'source-data/parts');
const readPart = async number => JSON.parse(await readFile(resolve(partsDir, String(number).padStart(2, '0') + '.json'), 'utf8'));
const writePart = async (number, data) => writeFile(resolve(partsDir, String(number).padStart(2, '0') + '.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
const parts = await Promise.all(Array.from({length: 14}, (_, i) => readPart(i + 1)));
const contests = parts.filter(part => part.part_type === 'contests').flatMap(part => part.data);
const oldPolls = parts.filter(part => part.part_type === 'polls').flatMap(part => part.data);
const byElection = new Map(contests.map(contest => [contest.id, contest]));
const specs = [
  {
    id: '2018-kaohsiung-tvbs', contest: '2018-kaohsiung',
    start: '2018-11-04', end: '2018-11-06', published: '2018-11-07',
    shares: { '陳其邁': 38, '韓國瑜': 48 }, undecided: 14,
    sample: 1077, margin: 3.0, population: '高雄市年滿20歲、有投票意願之民眾',
    title: 'TVBS民調／若明投票預估得票率：韓52%、陳47%',
    url: 'https://news.tvbs.com.tw/politics/1024545',
    notes: ['原始支持度：韓國瑜48%、陳其邁38%，並未使用同篇以區辨分析推估的52%／47%得票率。',
      '來源另報無黨籍蘇盈貴0.3%、璩美鳳1%、未決定14%；各分項相加101.3%，超過一般四捨五入容忍值，未將未核對的集合外數值硬併入其他欄位。']
  },
  {
    id: '2018-new-taipei-tvbs', contest: '2018-new-taipei',
    start: '2018-11-10', end: '2018-11-11', published: '2018-11-12',
    shares: { '蘇貞昌': 34, '侯友宜': 48 }, undecided: 18,
    sample: 1078, margin: 3.0, population: '新北市年滿20歲、有投票意願之民眾',
    title: 'TVBS民調／侯友宜支持度48% 領先蘇14個百分點',
    url: 'https://news.tvbs.com.tw/politics/1027615',
    notes: ['原始支持度：侯友宜48%、蘇貞昌34%；未使用同篇區辨分析估票55%／45%。']
  },
  {
    id: '2018-taichung-tvbs', contest: '2018-taichung',
    start: '2018-11-06', end: '2018-11-09', published: '2018-11-12',
    shares: { '林佳龍': 39, '盧秀燕': 41 }, undecided: 19, other: 1,
    sample: 1309, margin: 2.7, population: '臺中市年滿20歲、有投票意願之民眾',
    title: 'TVBS民調／盧秀燕支持度41% 林佳龍39%',
    url: 'https://news.tvbs.com.tw/politics/1027579',
    notes: ['集合外候選人宋原通支持度1%，如實記於其他；本資料集比較集合固定為林佳龍、盧秀燕。']
  },
  {
    id: '2022-hsinchu-city-tvbs', contest: '2022-hsinchu-city',
    start: '2022-11-09', end: '2022-11-12', published: '2022-11-14',
    shares: { '高虹安': 33, '沈慧虹': 28, '林耕仁': 19 },
    sample: 852, margin: 3.4, population: '新竹市年滿20歲民眾',
    title: 'TVBS民調／新竹「雙虹」差距縮至5％！高虹安33％領先',
    url: 'https://news.tvbs.com.tw/politics/1961801',
    notes: ['報導未提供整體未表態及其他三位正式候選人的精確占比，因此保留null，不用100減去80推估。'],
    weighting: '性別、年齡、地區、教育程度加權',
    denominator: null
  },
  {
    id: '2022-new-taipei-ettoday', contest: '2022-new-taipei',
    start: '2022-11-11', end: '2022-11-14', published: '2022-11-15',
    shares: { '侯友宜': 51.2, '林佳龍': 31.7 },
    sample: 1846, margin: 2.28, population: '設籍新北市且年滿20歲民眾（會員抽樣框）',
    title: 'ETtoday 六都選前封關民調（新北市）',
    url: 'https://www.ettoday.net/news/20221115/2380360.htm',
    notes: ['2022/11/15六都封關同一份調查；新北市個別有效樣本1846份。',
      'ETtoday原始連結在本次檢索無法直接讀取全文；支持度與抽樣資訊由同集團東森新聞完整轉載，並經同日TVBS報導交叉核對。',
      '網站未把其餘17.1%自動當成未表態；原文未能確認該剩餘比例的完整分項。'],
    type: 'ettoday', final: true
  },
  {
    id: '2022-taoyuan-ettoday', contest: '2022-taoyuan',
    start: '2022-11-11', end: '2022-11-14', published: '2022-11-15',
    shares: { '張善政': 38.2, '鄭運鵬': 35.3 },
    sample: 1242, margin: 2.78, population: '設籍桃園市且年滿20歲民眾（會員抽樣框）',
    title: 'ETtoday 六都選前封關民調（桃園市）',
    url: 'https://www.ettoday.net/news/20221115/2380360.htm',
    notes: ['2022/11/15六都封關同一份調查；桃園市個別有效樣本1242份。',
      'ETtoday原始連結在本次檢索無法直接讀取全文；支持度與抽樣資訊由同集團東森新聞完整轉載，並經同日TVBS報導交叉核對。',
      '其餘26.5%含不明確及可能的其他正式候選人，不擅自歸入未表態或其他。'],
    type: 'ettoday', final: true
  }
];

const DAY = 86400000;
const sourceTemplate = (spec) => spec.type === 'ettoday' ? [
  {
    url: spec.url, title: spec.title, kind: 'primary_publisher_report',
    access_method: 'original_url_secondary_reprint_verified',
    checked_at: '2026-10-17',
    evidence_summary: '原始發布者連結已由多篇同期報導證實；本次以同集團完整轉載核對支持度、調查日期、樣本與方法，原始頁面未直接讀取。'
  },
  {
    url: 'https://news.ebc.net.tw/news/politics/344583',
    title: '東森新聞：ETtoday 六都封關民調及調查說明',
    kind: 'affiliated_publisher_reprint', access_method: 'full_public_text', checked_at: '2026-10-17',
    evidence_summary: '原文載明六都各區支持度、各都市有效樣本及11/11–14混合式抽樣、加權方法。'
  },
  {
    url: 'https://news.tvbs.com.tw/politics/1962665',
    title: 'TVBS：ETtoday 六都封關民調交叉核對',
    kind: 'independent_secondary_report', access_method: 'full_public_text', checked_at: '2026-10-17',
    evidence_summary: '交叉核實新北、桃園的報導支持度及發布日期。'
  }
] : [{
  url: spec.url, title: spec.title, kind: 'primary_publisher_report',
  access_method: 'full_public_text', checked_at: '2026-10-17',
  evidence_summary: '直接核對TVBS原始報導的候選人支持度、實訪日期、發布時間、總樣本、電話抽樣方式及刊登誤差。'
}];

const newPolls = specs.map(spec => {
  const election = byElection.get(spec.contest);
  if (!election) throw new Error('Unknown contest ' + spec.contest);
  const candidateSet = [...election.selected_candidates];
  if (!candidateSet.every(id => Number.isFinite(spec.shares[id]))) throw new Error('Incomplete candidate shares ' + spec.id);
  const sumPoll = candidateSet.reduce((sum, id) => sum + spec.shares[id], 0);
  const votes = Object.fromEntries(election.candidates.map(c => [c.name, c.votes]));
  const sumVotes = candidateSet.reduce((sum, id) => sum + votes[id], 0);
  const officialRaw = Object.fromEntries(candidateSet.map(id => [id, votes[id] / election.valid_votes * 100]));
  const normalizedPoll = Object.fromEntries(candidateSet.map(id => [id, spec.shares[id] / sumPoll * 100]));
  const normalizedOfficial = Object.fromEntries(candidateSet.map(id => [id, votes[id] / sumVotes * 100]));
  const mae = candidateSet.reduce((sum,id) => sum + Math.abs(normalizedPoll[id] - normalizedOfficial[id]),0) / candidateSet.length;
  const rawMae = candidateSet.reduce((sum,id) => sum + Math.abs(spec.shares[id] - officialRaw[id]),0) / candidateSet.length;
  const ettoday = spec.type === 'ettoday';
  const days = (Date.parse(election.election_date) - Date.parse(spec.end)) / DAY;
  if (!(days >= 1 && days <= 30) || !(spec.start <= spec.end && spec.end <= spec.published && spec.published < election.election_date)) throw new Error('Invalid timing: ' + spec.id);
  if (sumPoll + (spec.undecided || 0) + (spec.other || 0) > 100.5) throw new Error('Percentage total exceeded ' + spec.id);
  return {
    id: spec.id, contest_id: spec.contest,
    brand: ettoday ? 'ETtoday' : 'TVBS',
    executor: ettoday ? 'ETtoday民調雲' : 'TVBS民意調查中心',
    commissioner: ettoday ? 'ETtoday民調雲' : null,
    funder: ettoday ? null : 'TVBS',
    design_and_analysis: ettoday ? 'ETtoday民調雲' : null,
    comparison_unit_id: ettoday ? 'ettoday__ettoday-poll-cloud' : 'tvbs__tvbs-poll-center',
    product_type: 'voting_intention_poll', candidate_set: candidateSet,
    fieldwork_start: spec.start, fieldwork_end: spec.end, publication_date: spec.published,
    date_timezone: 'Asia/Taipei', sample_size_total: spec.sample,
    sample_size_support_question: null, population: spec.population,
    mode: ettoday ? '網路調查＋CATI電話調查' : '人員電話訪問',
    sampling_frame: ettoday
      ? 'ETtoday民調雲及東森購物會員資料庫；依戶籍地與年齡篩選，等比分層隨機抽樣'
      : '電話號碼後四碼隨機抽樣',
    weighting: ettoday ? '性別、戶籍地、年齡、教育程度反覆加權（raking）' : (spec.weighting || '性別、年齡、地區加權'),
    reported_margin_of_error_pp: spec.margin, reported_confidence_level: 0.95,
    support_denominator: spec.denominator === null ? null : (ettoday ? null : '有投票意願的受訪者'),
    raw_support_percent: spec.shares,
    raw_means: '來源刊載的候選人原始支持度，可能已有人口權數調整；未表態與未能核對的其他候選人不臆補。',
    undecided_percent: spec.undecided ?? null,
    other_percent: spec.other ?? null,
    explicit_final_poll_label: !!spec.final,
    selection_label: spec.final ? '來源明示封關民調' : '本資料集最後可核實民調（不保證最後一份）',
    latest_available_guaranteed: false, verification_status: 'verified_primary', aggregate_source_eligible: true,
    sources: sourceTemplate(spec),
    notes: spec.notes,
    days_before_election: days, published_before_election: true, within_default_30_day_window: true,
    calculation: {
      candidate_set: candidateSet, poll_selected_support_total: sumPoll, election_selected_votes_total: sumVotes,
      raw_official_percent_same_candidates: officialRaw,
      normalized_poll_percent: normalizedPoll, normalized_official_percent: normalizedOfficial,
      raw_mae_pp: rawMae, normalized_mae_pp: mae, precision: 'full_precision_before_display_rounding'
    },
    is_last_verified_eligible_in_dataset: true, default_aggregate_eligible: true,
    team_continuity_verified: false, primary_mae_pp: mae
  };
});
const all = [...oldPolls, ...newPolls];
if (new Set(all.map(p=>p.id)).size !== all.length) throw new Error('Duplicate poll ID');
await writePart(15, { part_type: 'polls', data: newPolls });
const metadata = parts[0];
metadata.data.verified_at = '2026-10-17';
metadata.data.frozen_at = '2026-10-17T01:00:00+08:00';
metadata.data.scope.verified_poll_records = all.length;
metadata.data.scope.poll_contests_verified = new Set(all.map(p => p.contest_id)).size;
metadata.data.scope.supplied_raw_records_assessed = 20 + newPolls.length;
metadata.data.scope.matrix_only_missing_records = null;
metadata.data.scope.expanded_contests = [...new Set(newPolls.map(p => p.contest_id))];
metadata.data.scope.coverage_statement = '目前官方結果14場，已核實民調' + all.length + '筆、涵蓋' + metadata.data.scope.poll_contests_verified + '場；新增六份可核對支持度、時間、樣本與方法的歷史調查，仍非完整歷史民調庫。';
metadata.data.common_contest_comparisons[0].coverage_warning = '此比較限定TVBS與美麗島在相同四場選舉的交集，其他品牌與場次仍不得直接按不同選舉均分排名。';
metadata.data.methodology.verified_core_fields = '民調納入須核對主要候選人支持度、調查結束日、選前發布日、實施單位、有效樣本與方式；ETtoday新增紀錄以同集團完整轉載與獨立同期報導交叉核對，並保留原始發布者連結的可讀性限制。';
await writePart(1, metadata);
for (let i = 1; i <= 7; i++) {
  const part = parts[i];
  if (part.part_type !== 'contests') continue;
  for (const contest of part.data) contest.verified_poll_count = all.filter(p => p.contest_id === contest.id).length;
  await writePart(i + 1, part);
}
process.stdout.write(JSON.stringify({ added: newPolls.map(p=>({id:p.id, mae:p.calculation.normalized_mae_pp})), pollCount: all.length, contestCoverage: metadata.data.scope.poll_contests_verified }) + '\n');
