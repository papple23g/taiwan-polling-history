// These aliases identify the recorded executor, independently of who publishes or pays for a poll.
export const executorAliasRules = [
  { name: '世新大學民意調查研究中心',
    aliases: ['世新大學民意調查中心', '世新大學知識經濟發展研究院民意調查研究中心'],
    reason: '世新官方以民意調查中心為頁名，說明研究中心成立、升等研究院及院內設置研究中心的關係；完整隸屬名稱與簡稱合併，不推定人員或方法持續相同。',
    sources: ['https://iked.wp.shu.edu.tw/單位簡介/'] },
  { name: 'TVBS民意調查中心', aliases: ['TVBS'],
    reason: '僅將執行者欄已明列的 TVBS 與其民意調查中心名稱合併，不從 TVBS 發布品牌補值。',
    sources: ['https://www.tvbs.com.tw/poll-center'] },
  { name: '畢肯市場研究股份有限公司', aliases: ['畢肯市場研究公司'],
    reason: '畢肯官方公司全名與省略股份有限公司的名稱合併。',
    sources: ['https://www.beacon-marketing.com.tw/'] },
  { name: '山水民意研究股份有限公司',
    aliases: ['山水民意研究公司', '山水民調公司', '山水民調', '山水民意研究', '山水公司'],
    reason: '山水官方同頁使用公司全名、山水民調與山水公司；只對執行者欄明列的名稱歸戶。',
    sources: ['https://www.fsr.com.tw/'] },
  { name: '趨勢民意調查股份有限公司',
    aliases: ['趨勢民意調查公司', '趨勢民意調查', '趨勢民調', '趨勢民調公司', '趨勢民調股份有限公司'],
    reason: '趨勢官方公司介紹以趨勢民調為標題並明列完整公司名，相關省略名稱合併。',
    sources: ['https://polls.com.tw/core/'] },
  { name: '求真民意調查股份有限公司', aliases: ['求真民調公司', '求真民調', '求真（來源標示）'],
    reason: '求真官方同頁列公司全名與求真民調研究團隊；來源標示只是既有欄位註記，不代表另外一個機構。',
    sources: ['https://tnsr.com.tw/'] },
  { name: '循證民調有限公司', aliases: ['循證民調公司', '循證民調'],
    reason: '循證官方民意調查頁同列公司全名與簡稱。',
    sources: ['https://www.ebsr.com.tw/custom_87821.html'] },
  { name: '全國公信力民意調查股份有限公司', aliases: ['全國公信力民意調查公司', '全國公信力民調公司'],
    reason: '全國公信力官方網站列公司全名並以全國公信力民調公司介紹受託調查。',
    sources: ['https://www.trs.com.tw/', 'https://www.trs.com.tw/content?uid=2'] },
  { name: 'ETtoday民調雲', aliases: ['ETtoday新聞雲民調中心', 'ETtoday新聞雲'],
    reason: 'ETtoday 原發布報導以 ETtoday 新聞雲及民調雲說明本身執行的調查；僅合併執行者欄已載名稱，未將東森集團其他單位併入。',
    sources: ['https://www.ettoday.net/news/20181112/1303949.htm'] },
  { name: '大地民意研究股份有限公司', aliases: ['大地民意研究公司'],
    reason: '大地官方公司全名與省略股份有限公司的名稱合併。',
    sources: ['https://dadi-opinion.com.tw/'] },
  { name: '台灣指標調查研究股份有限公司', aliases: ['TISR台灣指標民調公司', '台灣指標民調公司', '台灣指標民調'],
    reason: '原台灣指標發布頁使用 TISR 與台灣指標民調名稱；美麗島原發布調查說明列完整受託公司名。',
    sources: ['https://web.archive.org/web/20151222130407id_/http://www.tisr.com.tw/?p=5983', 'https://m.my-formosa.com.tw/DOC_138345.htm'] },
  { name: '精確市場研究公司', aliases: ['精確市場研究調查公司'],
    reason: '匯流原發布者調查說明以兩種名稱記載同一受託執行者；不與名稱相近的其他市場研究公司合併。',
    sources: ['https://cnews.com.tw/235231225a01/', 'https://cnews.com.tw/212220520a01'] },
  { name: '全國意向顧問股份有限公司', aliases: ['全國意向顧問公司'],
    reason: '同期卓越雜誌調查的完整報導列完整受託公司名；省略股份有限公司的名稱合併。',
    sources: ['https://web.archive.org/web/20160305062407id_/http://news.101media.com.tw/news/18515'] },
];

const aliasNames = new Map(executorAliasRules.flatMap(rule => [rule.name, ...rule.aliases].map(alias => [alias, rule.name])));
const unknownName = '執行機構未載明';
const unknownMarker = /待核實|待查|未載明|未註明|未公布|未揭露|未提供|不詳|不明|未知|unspecified|unknown/iu;
const methodWords = /(?:非機率|機率|非概率|概率|非隨機|分層|分級|配額|電腦輔助|電腦|人員|訪員|市話|手機|住宅|雙底冊|自動|語音|電話|電訪|網路|網絡|線上|問卷|調查|民調|民意|面對面|街頭|訪問|訪談|面訪|街訪|簡訊|混合|自填|隨機|抽樣|撥號|以及|CATI|CAWI|CAPI|IVR|SMS|EDM|RDD|telephone|online|survey)/giu;

function recordedName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || unknownMarker.test(name) || /^(?:N\/?A|無|不適用|[-—–]+)$/iu.test(name)) return null;
  const nonMethodText = name.replace(methodWords, '').replace(/[\s（）()／/、,，:：+＋&與及-]/gu, '');
  if (!nonMethodText) return null;
  return name;
}

export function executorName(poll, institution) {
  const value = poll && Object.hasOwn(poll, 'executor') ? poll.executor : institution?.executor;
  const name = recordedName(value);
  return name === null ? null : aliasNames.get(name) ?? name;
}

export function executorGroupId(name) {
  return name === null || name === undefined ? 'executor:unknown' : `executor:${name.toLocaleLowerCase('en-US')}`;
}

export function executorSearchName(poll, institution) {
  return executorName(poll, institution) ?? unknownName;
}

export function executorGroups(polls = [], institutions = [], { includeUnknown = false } = {}) {
  const byId = institutions instanceof Map ? institutions : new Map(institutions.map(institution => [institution.id, institution]));
  const groups = new Map();
  for (const poll of polls) {
    const institution = byId.get(poll.institutionId);
    const name = executorName(poll, institution);
    if (name === null && !includeUnknown) continue;
    const id = executorGroupId(name);
    if (!groups.has(id)) groups.set(id, { id, brand: name ?? unknownName, memberIds: [],
      aliases: [...(executorAliasRules.find(rule => rule.name === name)?.aliases ?? [])] });
    const group = groups.get(id);
    if (poll.institutionId && !group.memberIds.includes(poll.institutionId)) group.memberIds.push(poll.institutionId);
    const original = poll && Object.hasOwn(poll, 'executor') ? poll.executor : institution?.executor;
    if (name !== null && typeof original === 'string' && !group.aliases.includes(original)) group.aliases.push(original);
    // A publisher is a search association only; it never enters the executor identity alias map.
    const publisher = institution?.brand ?? poll.brand;
    if (publisher && !group.aliases.includes(publisher)) group.aliases.push(publisher);
  }
  return [...groups.values()];
}

export function electionExecutorOptions(data, electionId) {
  return executorGroups(data.polls.filter(poll => poll.electionId === electionId), data.institutions, { includeUnknown: true })
    .sort((a, b) => (a.id === 'executor:unknown') - (b.id === 'executor:unknown') || a.brand.localeCompare(b.brand, 'zh-Hant'));
}

export function filterExecutorRows(rows, ids, institutionsMap) {
  if (ids === null) return rows;
  const selected = new Set(ids);
  return rows.filter(row => selected.has(executorGroupId(executorName(row.poll, institutionsMap.get(row.poll.institutionId)))));
}

export function searchExecutorOptions(options, search) {
  const term = search.trim().toLocaleLowerCase();
  return options.filter(option => [option.brand, ...option.aliases].some(name => name.toLocaleLowerCase().includes(term)));
}
