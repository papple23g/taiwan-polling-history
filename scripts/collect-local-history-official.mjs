import { writeDataFile as writeFile } from './write-data-file.mjs';
import { createHash } from 'node:crypto';

const checkedAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const regions = {
  臺北市: 'taipei', 新北市: 'new-taipei', 桃園市: 'taoyuan', 臺中市: 'taichung', 臺南市: 'tainan', 高雄市: 'kaohsiung',
  基隆市: 'keelung', 新竹縣: 'hsinchu', 新竹市: 'hsinchu-city', 苗栗縣: 'miaoli', 彰化縣: 'changhua', 南投縣: 'nantou',
  雲林縣: 'yunlin', 嘉義縣: 'chiayi', 嘉義市: 'chiayi-city', 屏東縣: 'pingtung', 宜蘭縣: 'yilan', 花蓮縣: 'hualien',
  臺東縣: 'taitung', 澎湖縣: 'penghu', 金門縣: 'kinmen', 連江縣: 'lienchiang',
};
const sources = [];
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const text = await response.text();
  sources.push({ url, accessedAt: checkedAt, accessMethod: 'official_public_json', sha256: createHash('sha256').update(text).digest('hex') });
  return JSON.parse(text);
}
const contests = [];
for (const subject of ['C1', 'C2']) {
  const listUrl = `https://db.cec.gov.tw/static/elections/list/ELC_${subject}.json`;
  const listing = await json(listUrl);
  const themes = listing.flatMap(row => row.theme_items).filter(row => [103, 107, 111].includes(row.session));
  for (const theme of themes) {
    const url = `https://db.cec.gov.tw/static/elections/data/tickets/ELC/${subject}/00/${theme.theme_id}/C/00_000_00_000_0000.json`;
    const data = await json(url);
    const rows = Object.values(data).flat();
    const grouped = Map.groupBy(rows.filter(row => row.is_vice !== '*'), row => row.area_name.replaceAll('台', '臺'));
    for (const [region, records] of grouped) {
      if (!regions[region]) throw new Error(`Unrecognized CEC region ${region}`);
      // The separately held Chiayi City election is the result for the 2022 term.
      if (theme.vote_date === '2022-11-26' && region === '嘉義市') continue;
      const year = Number(theme.vote_date.slice(0, 4));
      const validVotes = records.reduce((sum, row) => sum + row.ticket_num, 0);
      if (!records.every(row => Number.isInteger(row.ticket_num) && row.ticket_num >= 0) || validVotes <= 0) throw new Error(`Invalid official votes ${year} ${region}`);
      const ranked = [...records].sort((a, b) => b.ticket_num - a.ticket_num || a.cand_no - b.cand_no);
      const selected = ranked.filter((row, index) => index < 2 || row.ticket_num * 100 >= validVotes * 5);
      contests.push({
        id: `${year}-${regions[region]}`, title: `${year}年${region}長選舉`, election_date: theme.vote_date, geography: region,
        office: subject === 'C1' ? '直轄市長' : region.endsWith('市') ? '市長' : '縣長', phase: 'completed',
        official_status: 'CEC_final_results_database', valid_votes: validVotes,
        selected_candidates: selected.map(row => row.cand_name.replace(/@([a-fA-F0-9]+)@/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)).normalize('NFKC'))), selected_candidate_votes: selected.reduce((sum, row) => sum + row.ticket_num, 0),
        candidates: records.map(row => ({ name: row.cand_name.replace(/@([a-fA-F0-9]+)@/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)).normalize('NFKC')), source_name: row.cand_name, running_mate: null, ballot_number: row.cand_no, party: row.party_name,
          votes: row.ticket_num, official_reported_percent: row.ticket_percent, valid_vote_percent: row.ticket_num / validVotes * 100, elected: row.is_victor === '*' })),
        sources: [
          { title: '中選會選舉資料庫：候選人得票數', url, kind: 'official_election_data', access_method: 'official_public_json', checked_at: checkedAt, evidence_summary: '依縣市逐一核對完整候選人整數票數，候選人票數合計為有效票總數；推薦政黨依該次官方資料。' },
          { title: '中選會選舉資料庫：選舉清單及投票日', url: listUrl, kind: 'official_election_metadata', access_method: 'official_public_json', checked_at: checkedAt },
        ],
        official_browser_url: `https://db.cec.gov.tw/ElecTable/Election/ElecTickets?dataType=tickets&typeId=ELC&subjectId=${subject}&legisId=00&themeId=${theme.theme_id}&dataLevel=C&prvCode=00&cityCode=000&areaCode=00&deptCode=000&liCode=0000`,
        priority_poll_scope: false, verified_poll_count: 0, notes: [],
      });
    }
  }
}
if (contests.length !== 66 || new Set(contests.map(row => row.id)).size !== 66) throw new Error(`Expected 66 unique contests, got ${contests.length}`);
for (const year of [2014, 2018, 2022]) if (contests.filter(row => row.election_date.startsWith(String(year))).length !== 22) throw new Error(`Incomplete year ${year}`);
await writeFile('source-data/local-history-official.json', JSON.stringify({ checkedAt, sources, contests }, null, 2) + '\n');
console.log(JSON.stringify({ contests: contests.length, sources: sources.length, years: [2014, 2018, 2022].map(year => ({ year, count: contests.filter(row => row.election_date.startsWith(String(year))).length })) }));
