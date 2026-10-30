import { filterAndSortRows, selectSingleElectionPolls } from './domain.mjs';
import { executorGroupId, executorName, executorSearchName } from './executor-identity.mjs';
import { electionBrandOptions, filterPublisherRows, publisherBrand, publisherBrandId } from './publisher-brand.mjs';

function compatibleBrandIds(data, electionId, ids, institutions) {
  const allowed = new Set(electionBrandOptions(data, electionId).map(option => option.id));
  const legacy = new Map();
  if (ids.some(id => typeof id === 'string' && id.startsWith('executor:'))) {
    for (const poll of data.polls.filter(poll => poll.electionId === electionId)) {
      const institution = institutions.get(poll.institutionId);
      const id = executorGroupId(executorName(poll, institution));
      if (!legacy.has(id)) legacy.set(id, new Set());
      legacy.get(id).add(publisherBrandId(publisherBrand(poll, institution)));
    }
  }
  const valid = new Set();
  for (const id of ids) {
    if (allowed.has(id)) valid.add(id);
    else if (legacy.has(id)) {
      for (const brandId of legacy.get(id)) if (allowed.has(brandId)) valid.add(brandId);
    }
  }
  return valid.size || !ids.length ? [...valid] : null;
}

export function defaultView(data, electionId, mode = 'single') {
  const election = data.elections.find(item => item.id === electionId)
    || data.elections.find(item => item.id === '2022-taipei')
    || data.elections.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const preResult = election?.phase === 'pre_result';
  return { electionId: election?.id || '', mode, pollView: preResult ? 'history' : 'closing',
    showNormalized: !preResult, showTrajectory: true, within30Days: mode === 'comparison', minimumFiveElections: true, query: '', brandIds: null,
    sort: { key: preResult ? 'date' : 'mae', direction: preResult ? 'desc' : 'asc' }, selection: null };
}

export function validateView(data, value) {
  const defaults = defaultView(data, value.electionId, value.mode === 'comparison' ? 'comparison' : 'single');
  const state = { electionId: defaults.electionId,
    mode: ['single', 'comparison'].includes(value.mode) ? value.mode : defaults.mode,
    pollView: ['closing', 'history'].includes(value.pollView) ? value.pollView : defaults.pollView,
    showNormalized: typeof value.showNormalized === 'boolean' ? value.showNormalized : defaults.showNormalized,
    showTrajectory: typeof value.showTrajectory === 'boolean' ? value.showTrajectory : defaults.showTrajectory,
    within30Days: typeof value.within30Days === 'boolean' ? value.within30Days : defaults.within30Days,
    minimumFiveElections: defaults.mode === 'comparison' && typeof value.minimumFiveElections === 'boolean' ? value.minimumFiveElections : true,
    query: typeof value.query === 'string' ? value.query : '', brandIds: null,
    sort: { key: ['brand', 'date', 'mae'].includes(value.sort?.key) ? value.sort.key : defaults.sort.key,
      direction: ['asc', 'desc'].includes(value.sort?.direction) ? value.sort.direction : defaults.sort.direction },
    selection: null };
  const election = data.elections.find(item => item.id === state.electionId);
  const institutions = new Map(data.institutions.map(item => [item.id, item]));
  if (Array.isArray(value.brandIds)) {
    state.brandIds = compatibleBrandIds(data, state.electionId, value.brandIds, institutions);
  }
  if (value.selection?.kind === 'official' && election?.result?.status === 'verified') state.selection = { kind: 'official' };
  if (value.selection?.kind === 'poll' && election) {
    const rows = selectSingleElectionPolls(data.polls, election, { view: state.pollView, within30Days: state.within30Days,
      institutionKey: poll => publisherBrandId(publisherBrand(poll, institutions.get(poll.institutionId))) }).rows
      .map(row => ({ ...row, brand: publisherBrand(row.poll, institutions.get(row.poll.institutionId)),
        originalBrand: institutions.get(row.poll.institutionId)?.brand,
        executorSearchName: executorSearchName(row.poll, institutions.get(row.poll.institutionId)) }));
    if (filterAndSortRows(filterPublisherRows(rows, state.brandIds, institutions), { query: state.query, sortKey: state.sort.key, direction: state.sort.direction })
      .some(row => row.poll.id === value.selection.pollId)) state.selection = { kind: 'poll', pollId: value.selection.pollId };
  }
  return state;
}

export function parseView(search, data) {
  const params = new URLSearchParams(search);
  const selected = params.get('selected');
  return validateView(data, { electionId: params.get('election'), mode: params.get('page'),
    pollView: params.get('polls'), showNormalized: { raw: false, normalized: true }[params.get('ratio')],
    within30Days: { 0: false, 1: true }[params.get('within30')],
    minimumFiveElections: { 0: false, 1: true }[params.get('min5')], query: params.get('q') || '',
    brandIds: params.has('brands') ? params.getAll('brands').filter(Boolean) : null,
    sort: { key: params.get('sort'), direction: params.get('dir') },
    selection: selected === 'official' ? { kind: 'official' }
      : selected?.startsWith('poll:') ? { kind: 'poll', pollId: selected.slice(5) } : null });
}

export function viewPath(state) {
  return state.mode === 'comparison' ? '/comparison' : '/elections/' + encodeURIComponent(state.electionId);
}

export function readView(location, historyState, data) {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  const electionMatch = /^\/elections\/([^/]+)$/.exec(pathname);
  let electionId;
  try { electionId = electionMatch && decodeURIComponent(electionMatch[1]); } catch { /* 無效編碼視為未知路徑。 */ }
  const route = pathname === '/comparison' ? { mode: 'comparison' }
    : electionId && data.elections.some(election => election.id === electionId) ? { mode: 'single', electionId } : null;
  const params = new URLSearchParams(location.search);
  const hasLegacyView = ['page', 'election', 'polls', 'ratio', 'within30', 'min5', 'q', 'brands', 'sort', 'dir', 'selected']
    .some(key => params.has(key));
  if (hasLegacyView && (route || pathname === '/' || pathname === '/index.html')) {
    if (route) {
      params.set('page', route.mode);
      if (route.electionId) params.set('election', route.electionId);
    }
    return parseView(params.toString(), data);
  }
  if (!route) return defaultView(data);
  const saved = historyState?.pollingHistory;
  if (saved?.version === 1 && saved.view && typeof saved.view === 'object' && !Array.isArray(saved.view)
    && viewPath(saved.view) === pathname) return validateView(data, saved.view);
  return defaultView(data, route.electionId, route.mode);
}

export function writeViewHistory(state, history, location, action = 'push') {
  const url = viewPath(state);
  const pollingHistory = { version: 1, view: state };
  if (url === location.pathname + location.search + location.hash
    && JSON.stringify(history.state?.pollingHistory) === JSON.stringify(pollingHistory)) return;
  history[action === 'replace' ? 'replaceState' : 'pushState']({ ...history.state, pollingHistory }, '', url);
}
