// Synthetic data for development QA only. Never publish this module.
const source = { title: '測試用來源（非歷史證據）', url: 'https://example.org/qa-only', accessedAt: '2026-10-15' };
const candidates = [{ id: 'a', name: '測試候選人甲', party: '測試 A', color: '#487c74' }, { id: 'b', name: '測試候選人乙', party: '測試 B', color: '#5d7d9e' }, { id: 'c', name: '測試候選人丙', party: '測試 C', color: '#b38a55' }];
const elections = ['2020', '2021', '2022', '2023'].map((year, i) => ({ id: `qa-${year}`, label: `測試選舉 ${String.fromCharCode(65 + i)}`, year: Number(year), date: `${year}-11-26`, region: '測試地區', office: '測試職位', status: 'verified', candidates, result: { status: 'verified', votes: { a: 460, b: 370, c: 170 }, validVotes: 1000, source } }));
const institutions = [{ id: 'alpha', brand: '測試機構甲', teamNote: '2022 年測試團隊變更' }, { id: 'beta', brand: '測試機構乙' }, { id: 'gamma', brand: '測試機構丙' }];
const polls = elections.flatMap((e, index) => institutions.flatMap((institution, i) => {
  if (index === 3 && i === 1) return [];
  return [0, 1].map((n) => ({ id: `${e.id}-${institution.id}-${n}`, electionId: e.id, institutionId: institution.id, fieldworkStart: `${e.year}-11-${n ? '14' : '06'}`, fieldworkEnd: `${e.year}-11-${n ? '16' : '08'}`, publishedAt: `${e.year}-11-${n ? '17' : '09'}`, status: 'verified', source, shares: { a: 40 + i + n, b: 34 - i, c: 14 + index }, undecided: 9 - index - n, other: 3, isExplicitFinal: n === 1, closingEvidence: n === 1 ? source : undefined, commissioner: '測試委託者', executor: `測試執行團隊 ${i + 1}`, teamId: `${institution.id}-${index >= 2 ? 'new' : 'old'}`, teamNote: index >= 2 ? '測試團隊變更紀錄' : '', sampleSize: 1000 + i * 100, method: '測試用訪問方式', notes: '僅供操作驗證，不代表真實民調。' }));
}));
polls.push({ ...polls[0], id: 'qa-pending', status: 'pending', shares: { a: 40, b: null, c: 16 }, undecided: null, notes: '缺少候選人比例，待查核。' });
export default { version: 'QA-ONLY', updatedAt: '2026-10-15', elections, institutions, polls, corrections: [{ date: '2026-10-15', title: '測試更正紀錄', description: '此處僅測試版本與更正對話框。' }] };
