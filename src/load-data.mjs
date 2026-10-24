const publicUrl = (value) => { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } };
export function validateDataset(data) {
  if (!data || typeof data.version !== 'string' || !['elections', 'institutions', 'polls', 'corrections'].every(k => Array.isArray(data[k]))) throw new Error('資料檔格式不完整，請檢查版本與資料集合。');
  for (const key of ['elections', 'institutions', 'polls']) {
    const ids = data[key].map(item => item.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error(`${key} 有缺漏或重複的識別碼。`);
  }
  const electionIds = new Set(data.elections.map(e => e.id));
  const institutionIds = new Set(data.institutions.map(i => i.id));
  for (const e of data.elections) {
    if (!Array.isArray(e.candidates) || e.candidates.length < 2 || e.candidates.some(c => !c.id || !c.name) || new Set(e.candidates.map(c => c.id)).size !== e.candidates.length) throw new Error('選舉候選人清單缺漏或重複。');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date > new Date().toISOString().slice(0, 10)) throw new Error('僅支援日期明確的歷史選舉。');
  }
  if (data.polls.some(p => !electionIds.has(p.electionId) || !institutionIds.has(p.institutionId))) throw new Error('民調的選舉或機構對應不存在。');
  return data;
}
export async function loadDataset() {
  const response = await fetch('./data/verified.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('資料暫時無法讀取，請稍後重試。');
  return { data: validateDataset(await response.json()) };
}
export { publicUrl };
