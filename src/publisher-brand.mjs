// Publishing identity is independent of the poll's executor, funder and original institution ID.
export const publisherBrandRules = [
  { brand: '國民黨', aliases: ['中國國民黨', '國民黨內參', '國民黨內部民調', '國民黨臺北市黨部', '中國國民黨新北市議會黨團', '國民黨台中市議會黨團', '中國國民黨基隆市黨部'],
    reason: '中央、地方黨部及議會黨團按政黨發布品牌歸戶；個人團隊與外圍協會另列。',
    sources: ['https://news.tvbs.com.tw/politics/1778338', 'https://news.tvbs.com.tw/politics/1653100'] },
  { brand: '蘋果日報', aliases: ['蘋果新聞網', '蘋果日報／壹電視'],
    reason: '蘋果報紙、新聞網及出售前聯名歸戶；2013 年出售後的壹電視獨立。',
    sources: ['https://www.hkexnews.hk/listedco/listconews/sehk/2015/0626/LTN20150626590.pdf'] },
  { brand: '震傳媒', aliases: ['震撼世代傳媒'], reason: '震傳媒股份有限公司的原名為震撼世代有限公司。', sources: ['https://cons.judicial.gov.tw/download/download.aspx?id=471753'] },
  { brand: 'TVBS', aliases: ['TVBS民意調查中心', 'TVBS新聞網'], reason: '同一 TVBS 發布品牌；個別民調出資者仍保留。', sources: ['https://www.tvbs.com.tw/poll-center', 'https://news.tvbs.com.tw/politics/3162996'] },
  { brand: 'ETtoday', aliases: ['ETtoday新聞雲'], reason: 'ETtoday 新聞雲品牌的中英文名稱。', sources: ['https://www.etgroup.com.tw/?page_id=377'] },
  { brand: '匯流新聞網', aliases: ['CNEWS匯流新聞網', '匯流'], reason: 'CNEWS 匯流新聞網的名稱及簡稱。', sources: ['https://cnews.com.tw/aboutus/', 'https://cmediagroup.com.tw/'] },
  { brand: '關鍵調查', aliases: ['關鍵調查有限公司'], reason: '公司全名及品牌簡稱。', sources: ['https://www.kpoint.com.tw/'] },
  { brand: '台灣獨立建國聯盟', aliases: ['台灣獨立建國聯盟（山水）'], reason: '聯盟發布，山水為執行者，不作為發布品牌的一部分。', sources: ['https://wufi.org.tw/post/2023「台美建交」民調記者會'] },
];

export const publisherPollRules = [
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taipei-history-ee61e1299b30', '2022-new-taipei-history-84be7ce7cbf9', '2022-taoyuan-history-c307576380df', '2022-hsinchu-city-history-175fea4d6aed'],
    sources: ['https://web.archive.org/web/20220926083811id_/https://udn.com/news/story/122682/6640889'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taipei-history-e7af1f4c1451'], sources: ['https://web.archive.org/web/20230118091258id_/https://www.chinatimes.com/realtimenews/20221024001997-260407?chdtv'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taoyuan-history-bb65e0e6d0d0'], sources: ['https://www.setn.com/News.aspx?NewsID=1199341'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-hsinchu-city-history-81e23cefdd6e'], sources: ['https://web.archive.org/web/20221031100346id_/https://www.chinatimes.com/realtimenews/20221031001480-260407?chdtv'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taipei-history-ec574abad412'], sources: ['https://www.setn.com/News.aspx?NewsID=1203637'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taoyuan-history-2a61287309eb'], sources: ['https://www.setn.com/News.aspx?NewsID=1206418'] },
  { brand: '中廣', originalBrand: '蓋洛普', pollIds: ['2022-taipei-history-d12be6269851'], sources: ['https://www.setn.com/News.aspx?NewsID=1207662'] },
  { brand: '中廣', originalBrand: '中廣蓋洛普', pollIds: ['2024-president-history-2f8428753a87'], sources: ['https://newtalk.tw/news/view/2023-03-24/863289'] },
  { brand: '中廣', originalBrand: '中廣蓋洛普', pollIds: ['2024-president-history-06625d0ebb8e'], sources: ['https://news.ltn.com.tw/news/politics/breakingnews/4340492'] },
  { brand: '里昂證券', originalBrand: '台灣蓋洛普', pollIds: ['2012-president-history-192cd5b1dfa6'], reason: '2011 年調查由里昂證券發布，蓋洛普為執行者。', sources: ['https://n.yam.com/Article/20111110013312'] },
  { brand: '負數票協會', originalBrand: '台灣蓋洛普', pollIds: ['2016-president-history-358ab1f4f36e'], reason: '2015 年調查由負數票協會發布，蓋洛普為執行者。', sources: ['https://web.archive.org/web/20151208123659/http://www.appledaily.com.tw/realtimenews/article/new/20151208/748597/'] },
  { brand: '放言', originalBrand: '201911-全國時事民調', pollIds: ['2020-president-history-a7226b84d4f4'], reason: '同波報導可對應放言發布；只修正歸戶，不提升原紀錄的來源核實資格。', sources: ['https://newtalk.tw/news/view/2019-12-03/335055'] },
].map(rule => ({ reason: '逐筆發布報導記載中廣委託／發布、蓋洛普執行；不將蓋洛普名稱整批視為中廣別名。', ...rule }));

const aliases = new Map([
  ['三立電視', '三立'], ['東森新聞', '東森'], ['美麗島', '美麗島電子報'],
  ['聯合報系', '聯合報'], ['中時', '中國時報'], ['鋒燦', '鋒燦傳媒'],
  ['鋒燦民調中心', '鋒燦傳媒'], ['年代', '年代民調中心'],
  ['旺旺中時媒體集團', '旺旺中時'], ['臺灣世代智庫', '台灣世代智庫'], ['民主進步黨', '民進黨'],
  ...publisherBrandRules.flatMap(rule => rule.aliases.map(alias => [alias, rule.brand])),
]);
const pollRules = new Map(publisherPollRules.flatMap(rule => rule.pollIds.map(id => [id, rule])));

export function institutionBrand(brand) {
  const name = typeof brand === 'string' ? brand.trim().replace(/\s+/g, ' ') : '';
  return aliases.get(name) || name;
}

export function publisherBrand(poll, institution) {
  return pollRules.get(poll.id)?.brand || institutionBrand(institution?.brand) || poll.institutionId || '';
}

export function publisherBrandId(brand) { return `brand:${brand.toLocaleLowerCase('en-US')}`; }

export function institutionGroups(institutions = []) {
  const groups = new Map();
  for (const institution of institutions) addMember(groups, institutionBrand(institution.brand) || institution.id, institution);
  return [...groups.values()];
}

function addMember(groups, brand, institution) {
  const id = publisherBrandId(brand);
  if (!groups.has(id)) groups.set(id, { id, brand, memberIds: [], aliases: [...aliases].filter(([, canonical]) => canonical === brand).map(([alias]) => alias) });
  const group = groups.get(id);
  if (institution?.id && !group.memberIds.includes(institution.id)) group.memberIds.push(institution.id);
  if (institution?.brand && !group.aliases.includes(institution.brand)) group.aliases.push(institution.brand);
}

export function publisherGroups(polls, institutions) {
  const byId = new Map(institutions.map(institution => [institution.id, institution]));
  const groups = new Map();
  for (const poll of polls) addMember(groups, publisherBrand(poll, byId.get(poll.institutionId)), byId.get(poll.institutionId));
  return [...groups.values()];
}

export function electionBrandOptions(data, electionId) {
  return publisherGroups(data.polls.filter(poll => poll.electionId === electionId), data.institutions)
    .sort((a, b) => a.brand.localeCompare(b.brand, 'zh-Hant'));
}

export function searchBrandOptions(options, search) {
  const term = search.trim().toLocaleLowerCase();
  return options.filter(option => [option.brand, ...option.aliases].some(name => name.toLocaleLowerCase().includes(term)));
}

export function filterPublisherRows(rows, brandIds, institutions) {
  if (brandIds === null) return rows;
  const selected = new Set(brandIds);
  return rows.filter(row => selected.has(publisherBrandId(publisherBrand(row.poll, institutions.get(row.poll.institutionId)))));
}
