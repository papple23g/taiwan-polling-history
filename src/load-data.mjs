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
    const phase = e.phase ?? 'completed';
    const parsed = Date.parse(`${e.date}T00:00:00Z`);
    if (!['completed', 'pre_result'].includes(phase) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== e.date) throw new Error('選舉階段或日期格式不正確。');
    if (phase === 'completed' && e.date > new Date().toISOString().slice(0, 10)) throw new Error('尚未舉行的選舉須標記為選前階段。');
    if (phase === 'pre_result' && (e.result?.status === 'verified' || e.result?.validVotes != null || Object.values(e.result?.votes || {}).some(value => value != null))) throw new Error('選前選舉不得填入官方票數。');
  }
  if (data.polls.some(p => !electionIds.has(p.electionId) || !institutionIds.has(p.institutionId))) throw new Error('民調的選舉或機構對應不存在。');
  return data;
}
export function createDataLoader(fetcher = (...args) => fetch(...args), timeoutMs = 30_000) {
  const requests = new Map();
  function request(key, url, validate) {
    if (!requests.has(key)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const pending = Promise.resolve().then(async () => {
        const response = await fetcher(url, { cache: 'no-cache', signal: controller.signal });
        if (!response.ok) throw new Error('資料暫時無法讀取，請重試。');
        return validate(await response.json());
      }).catch(error => {
        requests.delete(key);
        if (controller.signal.aborted) throw new Error('資料載入超過 30 秒，請重試。');
        throw error;
      }).finally(() => clearTimeout(timer));
      requests.set(key, pending);
    }
    return requests.get(key);
  }
  function loadDataset() {
    return request('index', '/data/app-index.json', value => {
      const data = validateDataset(value);
      if (!/^[a-f0-9]{64}$/.test(data.revision || '') || !data.catalogueCounts) throw new Error('資料修訂資訊不完整，請重新載入。');
      return { data };
    });
  }
  function loadElectionDetails(data, electionId) {
    if (!data.elections.some(election => election.id === electionId)) return Promise.reject(new Error('選舉不存在。'));
    return request(data.revision + ':' + electionId, '/data/elections/' + encodeURIComponent(electionId) + '.json?revision=' + data.revision, value => {
      if (value.revision !== data.revision || value.version !== data.version || value.electionId !== electionId) throw new Error('資料修訂不一致，請重新載入頁面。');
      for (const key of ['polls', 'historicalContexts', 'heldRecords']) {
        if (!Array.isArray(value[key]) || value[key].some(row => row.electionId !== electionId || typeof row.id !== 'string') || new Set(value[key].map(row => row.id)).size !== value[key].length) throw new Error('選舉詳情格式不完整，請重試。');
      }
      const expected = data.polls.filter(poll => poll.electionId === electionId).map(poll => poll.id);
      if (value.polls.length !== expected.length || value.polls.some(poll => !expected.includes(poll.id))) throw new Error('民調詳情與索引不一致，請重新載入頁面。');
      const counts = data.catalogueCounts[electionId];
      if (!counts || counts.historicalContexts !== value.historicalContexts.length || counts.heldRecords !== value.heldRecords.length) throw new Error('來源目錄與索引不一致，請重新載入頁面。');
      return value;
    });
  }
  return { loadDataset, loadElectionDetails };
}
export const { loadDataset, loadElectionDetails } = createDataLoader();
export { publicUrl };
