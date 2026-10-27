const localRegionOrder = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
  '基隆市', '新竹縣', '竹北市', '新竹市', '宜蘭縣',
  '苗栗縣', '彰化縣', '南投縣', '雲林縣',
  '嘉義縣', '嘉義市', '屏東縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
];
const regionRanks = new Map(localRegionOrder.map((region, rank) => [region, rank]));
const presidential = election => election.id.endsWith('president');
const yearOf = election => Number(election.year) || Number(election.date?.slice(0, 4)) || 0;
const regionRank = election => regionRanks.get(election.region?.replaceAll('台', '臺')) ?? localRegionOrder.length;

export function sortElectionsForDisplay(elections = []) {
  return [...elections].sort((left, right) => yearOf(right) - yearOf(left)
    || Number(presidential(right)) - Number(presidential(left))
    || regionRank(left) - regionRank(right));
}

export function electionNavigationItems(elections = []) {
  const years = new Map();
  for (const election of sortElectionsForDisplay(elections)) {
    if (!years.has(election.year)) years.set(election.year, { presidents: [], local: [] });
    years.get(election.year)[presidential(election) ? 'presidents' : 'local'].push(election);
  }
  return [...years].flatMap(([year, group]) => [
    ...group.presidents.map(election => ({ kind: 'president', year, election })),
    ...(group.local.length ? [{ kind: 'local', year, elections: group.local, preResult: group.local.every(election => election.phase === 'pre_result') }] : []),
  ]);
}
