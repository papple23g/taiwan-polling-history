import { commonElectionComparison, evaluatePoll } from './domain.mjs';

const brandAliases = new Map([
  ['三立電視', '三立'], ['東森新聞', '東森'], ['美麗島', '美麗島電子報'],
  ['匯流', '匯流新聞網'], ['聯合報系', '聯合報'], ['中時', '中國時報'],
  ['鋒燦', '鋒燦傳媒'], ['鋒燦民調中心', '鋒燦傳媒'], ['年代', '年代民調中心'],
  ['旺旺中時媒體集團', '旺旺中時'], ['臺灣世代智庫', '台灣世代智庫'],
  ['中國國民黨', '國民黨'], ['民主進步黨', '民進黨'],
]);

export function institutionBrand(brand) {
  const name = typeof brand === 'string' ? brand.trim().replace(/\s+/g, ' ') : '';
  return brandAliases.get(name) || name;
}

export function institutionGroups(institutions = []) {
  const groups = new Map();
  for (const institution of institutions) {
    const brand = institutionBrand(institution.brand) || institution.id;
    const key = brand.toLocaleLowerCase('en-US');
    if (!groups.has(key)) groups.set(key, { id: `brand:${key}`, brand, memberIds: [] });
    groups.get(key).memberIds.push(institution.id);
  }
  return [...groups.values()];
}

export function compareInstitutionBrands(data, options = {}) {
  const groups = institutionGroups(data.institutions);
  const byInstitution = new Map(groups.flatMap(group => group.memberIds.map(id => [id, group.id])));
  // Group only the comparison view; original poll IDs, institutions and source records stay intact.
  const grouped = { ...data, polls: data.polls.map(poll => ({ ...poll, institutionId: byInstitution.get(poll.institutionId) || poll.institutionId })) };
  const comparison = commonElectionComparison(grouped, groups.map(group => group.id), options);
  const originalPolls = new Map(data.polls.map(poll => [poll.id, poll]));
  const elections = new Map(data.elections.map(election => [election.id, election]));
  const availableIds = new Set(comparison.rows.flatMap(row => row.availableElectionIds));
  const displayElectionIds = [...data.elections].sort((a, b) => b.date.localeCompare(a.date)).map(election => election.id).filter(id => availableIds.has(id));
  const rows = comparison.rows.map((row, index) => ({ ...row, brand: groups[index].brand, memberIds: groups[index].memberIds }));
  const exportRows = rows.flatMap(row => row.availablePerElection.map(point => {
    const poll = originalPolls.get(point.pollId);
    const election = elections.get(point.electionId);
    return { poll, election, evaluation: evaluatePoll(poll, election, options), brand: row.brand, selectionReason: point.selectionReason };
  }));
  return { ...comparison, rows, displayElectionIds, exportRows };
}
