import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChartBar, ClockCounterClockwise, Info, List, Table, WarningCircle, X } from '@phosphor-icons/react';
import { filterAndSortRows, normalizePollSupport, selectSingleElectionPolls } from './domain.mjs';
import { compareInstitutionBrands, filterComparisonBrands } from './institution-model.mjs';
import { electionBrandOptions, filterPublisherRows } from './publisher-brand.mjs';
import { InstitutionFilter } from './InstitutionFilter.jsx';
import { loadDataset } from './load-data.mjs';
import { defaultView, readView, validateView, writeViewHistory } from './view-state.mjs';
import { Comparison } from './Comparison.jsx';
import { InformationDialog } from './InformationDialog.jsx';
import { Inspector } from './Inspector.jsx';
import { PollChart } from './PollChart.jsx';
import { makeChartModel } from './chart-model.mjs';
import { PollTable } from './PollTable.jsx';
import { ElectionNavigation } from './ElectionNavigation.jsx';
import { IconButton } from './ui.jsx';
import { officialResultSummary } from './result-model.mjs';
import { GitHubLinks } from './GitHubLinks.jsx';
import { SiteFooter } from './SiteInformation.jsx';
import { workspaceNeedsFlow } from './panel-layout.mjs';

const EMPTY = { version: '—', updatedAt: '—', elections: [], institutions: [], polls: [], corrections: [] };
const shortTitle = e => !e ? '歷史民調資料' : e.id.endsWith('president') ? e.year + ' 總統選舉' : e.year + ' ' + e.region + '長選舉';

export function App() {
  const [data, setData] = useState(EMPTY);
  const [phase, setPhase] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState(() => defaultView(EMPTY));
  const viewRef = useRef(view);
  const { electionId, mode, within30Days, minimumFiveElections, pollView, showNormalized, query, brandIds, sort, selection } = view;
  const selectedId = selection?.kind === 'poll' ? selection.pollId : '';
  const officialSelected = selection?.kind === 'official';
  const [chartFocusRequest, setChartFocusRequest] = useState(null);
  const [information, setInformation] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [desktopNavOpen, setDesktopNavOpen] = useState(true);
  const [expandedNavYears, setExpandedNavYears] = useState(() => new Set());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [workspaceFlow, setWorkspaceFlow] = useState(true);
  const isMobile = viewportWidth <= 760;
  const navigationVisible = !isMobile && desktopNavOpen;
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const navRef = useRef(null);
  const menuRef = useRef(null);
  const mobileDialogRef = useRef(null);
  const informationReturnFocus = useRef(null);
  const workspace = useRef(null);
  const tableScroll = useRef(null);

  function updateView(patch, action = 'push', dataset = data) {
    const next = validateView(dataset, { ...viewRef.current, ...patch });
    viewRef.current = next; setView(next);
    writeViewHistory(next, window.history, window.location, action);
    if (!next.selection) setChartFocusRequest(null);
  }
  const setWithin30Days = value => updateView({ within30Days: value });
  const setPollView = value => updateView({ pollView: value });
  const setShowNormalized = value => updateView({ showNormalized: value });
  const setQuery = value => updateView({ query: value }, 'replace');
  const setBrandIds = value => updateView({ brandIds: value });
  const setSort = value => updateView({ sort: typeof value === 'function' ? value(viewRef.current.sort) : value });
  const setSelection = value => updateView({ selection: value });

  async function reload() {
    setPhase('loading'); setLoadError('');
    try {
      const result = await loadDataset();
      setData(result.data);
      const next = readView(window.location, window.history.state, result.data);
      updateView(next, 'replace', result.data);
      setChartFocusRequest(null);
      const destination = result.data.elections.find(item => item.id === next.electionId);
      if (destination && !destination.id.endsWith('president')) setExpandedNavYears(current => new Set([...current, destination.year]));
      setPhase('ready');
    } catch (error) { setLoadError(error.message); setPhase('error'); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (phase !== 'ready') return;
    const restore = event => {
      const next = readView(window.location, event.state, data);
      updateView(next, 'replace');
      setChartFocusRequest(null); setMobileNav(false);
      setInspectorOpen(false);
      const destination = data.elections.find(item => item.id === next.electionId);
      if (destination && !destination.id.endsWith('president')) setExpandedNavYears(current => new Set([...current, destination.year]));
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [data, phase]);
  useEffect(() => {
    const navigationMedia = matchMedia('(max-width: 760px)');
    const update = () => setViewportWidth(window.innerWidth);
    const updateNav = () => { if (!navigationMedia.matches) { const hadFocus = navRef.current?.contains(document.activeElement); setMobileNav(false); if (hadFocus) requestAnimationFrame(() => document.getElementById('main-content')?.focus()); } };
    window.addEventListener('resize', update);
    navigationMedia.addEventListener('change', updateNav);
    return () => { window.removeEventListener('resize', update); navigationMedia.removeEventListener('change', updateNav); };
  }, []);
  useEffect(() => { if (mobileNav) { mobileDialogRef.current?.showModal(); navRef.current?.querySelector('button')?.focus(); } }, [mobileNav]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    if (mobileNav || information || inspectorOpen && mode === 'single') document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileNav, information, inspectorOpen, mode]);

  const election = data.elections.find(e => e.id === electionId);
  const preResult = election?.phase === 'pre_result';
  const collectionCoverage = data.scope?.local_history_collection?.coverage?.find(item => item.year === election?.year && item.region === election?.region);
  const visibleCandidates = election ? (election.comparisonCandidateIds || election.candidates.map(c => c.id)).map(id => election.candidates.find(c => c.id === id)).filter(Boolean) : [];
  const institutions = useMemo(() => new Map(data.institutions.map(i => [i.id, i])), [data]);
  const tableSelection = useMemo(() => election ? selectSingleElectionPolls(data.polls, election, { view: pollView, within30Days })
    : { rows: [], unresolvedCounts: { undatedInstitutionCount: 0, supportConflictInstitutionCount: 0 }, dateUnknownCount: 0, unfilteredCount: 0 },
  [data.polls, election, pollView, within30Days]);
  const baseRows = useMemo(() => tableSelection.rows
    .map(row => ({ ...row, brand: institutions.get(row.poll.institutionId)?.brand || row.poll.institutionId })), [tableSelection, institutions]);
  const brandOptions = useMemo(() => electionBrandOptions(data, electionId), [data, electionId]);
  const rows = useMemo(() => filterAndSortRows(filterPublisherRows(baseRows, brandIds, institutions), { query, sortKey: sort.key, direction: sort.direction }), [baseRows, brandIds, institutions, query, sort]);
  const selected = rows.find(row => row.poll.id === selectedId) || null;
  const officialResult = useMemo(() => election?.result?.status === 'verified' ? officialResultSummary(election) : null, [election]);
  const comparisonStatistics = useMemo(() => compareInstitutionBrands(data, { within30Days }), [data, within30Days]);
  const comparison = useMemo(() => filterComparisonBrands(comparisonStatistics, { minimumFiveElections }), [comparisonStatistics, minimumFiveElections]);
  const chartModel = useMemo(() => makeChartModel(election, rows, selected?.poll.id), [election, rows, selected?.poll.id]);
  const chartTitle = chartModel?.kind === 'strip' ? '兩人比例一維散點圖' : chartModel?.kind === 'ternary' ? '三人比例三角圖' : '候選人比例對照';

  useLayoutEffect(() => {
    const main = workspace.current;
    if (phase !== 'ready' || mode !== 'single' || !main) return;
    const measure = () => {
      const style = getComputedStyle(main);
      const width = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setWorkspaceFlow(workspaceNeedsFlow(width, main.clientHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    measure();
    return () => observer.disconnect();
  }, [phase, mode]);

  useEffect(() => {
    let gesture = null;
    const startGesture = event => { gesture = { x: event.clientX, y: event.clientY, moved: false }; };
    const trackGesture = event => { if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 6) gesture.moved = true; };
    const cancelFromBackground = event => {
      if (gesture?.moved || mode !== 'single' || !selection || !(event.target instanceof Element)) return;
      if (event.target.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="separator"], [role="dialog"], [contenteditable="true"], [data-poll-id], .official-result-row, .chart-section, .detail, .detail-empty, .official-result, .inspector-heading h2, .inspector-heading p, dialog')) return;
      clearSelection();
    };
    document.addEventListener('pointerdown', startGesture, true);
    document.addEventListener('pointermove', trackGesture, true);
    document.addEventListener('click', cancelFromBackground);
    return () => { document.removeEventListener('pointerdown', startGesture, true); document.removeEventListener('pointermove', trackGesture, true); document.removeEventListener('click', cancelFromBackground); };
  }, [mode, selection]);

  function handleElection(id, pollId = '', { revealNavigation = true } = {}) {
    const nextElection = data.elections.find(item => item.id === id);
    const nextPreResult = nextElection?.phase === 'pre_result';
    if (revealNavigation && nextElection && !nextElection.id.endsWith('president')) setExpandedNavYears(current => new Set([...current, nextElection.year]));
    updateView({ ...defaultView(data, id), within30Days: nextPreResult ? false : within30Days,
      pollView: pollId || nextPreResult ? 'history' : 'closing', selection: pollId ? { kind: 'poll', pollId } : null });
    setMobileNav(false);
    setChartFocusRequest(null); setAnnouncement('');
    setInspectorOpen(false);
    if (mobileNav) requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }
  function handleMode(value) {
    updateView({ mode: value, ...(value === 'comparison' && mode !== value ? { within30Days: true, minimumFiveElections: true } : {}) });
    setMobileNav(false); setInspectorOpen(false);
    if (mobileNav) requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }
  function revealTableRow(selector, matchesSelection) {
    if (workspaceFlow) return;
    requestAnimationFrame(() => {
      const container = tableScroll.current;
      const row = container?.querySelector(selector);
      if (!row || !matchesSelection(viewRef.current.selection)) return;
      const bounds = container.getBoundingClientRect();
      const header = container.querySelector('thead');
      const top = Math.max(bounds.top, header?.getBoundingClientRect().bottom || bounds.top);
      const rect = row.getBoundingClientRect();
      if (rect.top < top) container.scrollTop += rect.top - top;
      else if (rect.bottom > bounds.bottom) container.scrollTop += rect.bottom - bounds.bottom;
    });
  }
  function handleSelect(id, fromTable = false, { openDetails = false } = {}) {
    setSelection({ kind: 'poll', pollId: id });
    if (openDetails) setInspectorOpen(true);
    if (!fromTable && !openDetails) revealTableRow(`[data-poll-id="${CSS.escape(id)}"]`, selection => selection?.kind === 'poll' && selection.pollId === id);
    setChartFocusRequest(previous => fromTable ? { kind: 'poll', pollId: id, electionId, sequence: (previous?.sequence || 0) + 1 } : null);
    setAnnouncement('已同步選取民調，圖表與詳情已更新。');
  }
  function handleSelectOfficial(fromTable = false, { openDetails = false } = {}) {
    if (!officialResult) return;
    setSelection({ kind: 'official' });
    if (openDetails) setInspectorOpen(true);
    if (!fromTable && !openDetails) revealTableRow('.official-result-row', selection => selection?.kind === 'official');
    setChartFocusRequest(previous => fromTable ? { kind: 'official', electionId, sequence: (previous?.sequence || 0) + 1 } : null);
    setAnnouncement('已同步選取大選結果，圖表與詳情已更新。');
  }
  function clearSelection() {
    setSelection(null); setChartFocusRequest(null);
    setAnnouncement('已取消選取；圖表範圍保持不變。');
  }
  function handleSort(key) { setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); }
  function closeNav() { setMobileNav(false); requestAnimationFrame(() => menuRef.current?.focus()); }
  function toggleNavigation() { if (isMobile) setMobileNav(value => !value); else setDesktopNavOpen(value => !value); }
  function toggleNavYear(year) { setExpandedNavYears(current => { const next = new Set(current); if (next.has(year)) next.delete(year); else next.add(year); return next; }); }
  function closeInspector() { setInspectorOpen(false); }
  function openInformation(kind) { informationReturnFocus.current = mobileNav ? menuRef.current : document.activeElement; setMobileNav(false); setInformation(kind); }
  function navKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeNav(); }
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], summary')].filter(item => item.getClientRects().length);
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }

  const closingIssueParts = [
    tableSelection.unresolvedCounts.undatedInstitutionCount > 0 && `調查日期全未知 ${tableSelection.unresolvedCounts.undatedInstitutionCount} 家`,
    tableSelection.unresolvedCounts.supportConflictInstitutionCount > 0 && `最新波次支持度衝突 ${tableSelection.unresolvedCounts.supportConflictInstitutionCount} 家`,
  ].filter(Boolean);
  const shownShare = (row, id) => {
    if (!showNormalized) return row.poll.shares?.[id];
    if (preResult) return normalizePollSupport(row.poll, election).values?.[id];
    if (row.evaluation.eligible) return row.evaluation.pollNormalized?.[id];
    const values = visibleCandidates.map(c => row.poll.shares?.[c.id]);
    const total = values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : 0;
    return total > 0 ? row.poll.shares?.[id] / total * 100 : null;
  };
  const nav = <>
    <ElectionNavigation elections={data.elections} electionId={electionId} active={mode === 'single'} expandedYears={expandedNavYears}
      onToggleYear={toggleNavYear} onSelect={id => handleElection(id, '', { revealNavigation: false })} />
    <div className="sidebar-secondary"><button className={mode === 'comparison' ? 'active' : ''} onClick={() => handleMode('comparison')}><ChartBar size={19} />跨場比較</button><button onClick={() => openInformation('method')}><BookOpen size={19} />方法與來源</button><button onClick={() => openInformation('version')}><ClockCounterClockwise size={19} />版本與更正</button></div>
    <p className="sidebar-footnote">收錄 {data.polls.length} 筆民調<br />不代表完整民調資料庫</p>
  </>;

  return <>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳至主要內容</a>
    <header className="app-header"><div className="brand"><button ref={menuRef} className="icon-button navigation-toggle" aria-label={(isMobile ? mobileNav : desktopNavOpen) ? '收合選舉導覽' : '展開選舉導覽'} title="展開／收合選舉導覽" aria-expanded={isMobile ? mobileNav : desktopNavOpen} aria-controls={isMobile ? 'mobile-election-navigation' : 'election-navigation'} onClick={toggleNavigation}><List size={23} /></button><h1>台灣選情劉伯溫</h1><p>台灣民調資料與歷史準確度</p></div><GitHubLinks /></header>
    <div className={['app-shell', !navigationVisible ? 'navigation-collapsed' : '', mode === 'comparison' ? 'comparison-mode' : ''].join(' ')}>
      <aside id="election-navigation" className="sidebar" aria-label="選舉導覽" hidden={!navigationVisible}>{nav}</aside>
      {mobileNav && <dialog ref={mobileDialogRef} className="mobile-nav-overlay" aria-label="選舉導覽選單" onCancel={event => { event.preventDefault(); closeNav(); }} onClick={event => { if (event.target === event.currentTarget) closeNav(); }}><aside id="mobile-election-navigation" ref={navRef} className="mobile-nav" onKeyDown={navKeyDown}><div className="mobile-nav-heading"><strong>台灣選情劉伯溫</strong><IconButton label="關閉選舉導覽" onClick={closeNav}><X size={22} /></IconButton></div>{nav}</aside></dialog>}
      <main ref={workspace} id="main-content" className={['main-content', mode === 'single' && phase === 'ready' ? 'single-workspace' : '', workspaceFlow ? 'workspace-flow' : 'workspace-columns'].join(' ')} tabIndex="-1">
        <div className="workspace-top"><div><h2>{mode === 'single' ? shortTitle(election) : '跨場比較'}</h2></div></div>
        {phase === 'loading' ? <div className="page-state" role="status"><h3>正在讀取民調資料</h3><p>每筆附來源與調查資訊。</p></div> : phase === 'error' ? <div className="page-state error-state" role="alert"><WarningCircle size={32} /><h3>資料暫時無法載入</h3><p>{loadError}</p><button className="button primary" onClick={reload}>重新讀取</button></div> : <>
          {mode === 'comparison' ? <><div className="comparison-window" role="group" aria-label="跨場比較篩選"><label><input type="checkbox" checked={within30Days} onChange={e => setWithin30Days(e.target.checked)} />選前30天</label><label><input type="checkbox" checked={minimumFiveElections} onChange={e => updateView({ minimumFiveElections: e.target.checked })} />採計至少 5 場</label></div><Comparison data={data} comparison={comparison} onOpenElection={handleElection} /></> : <>
            <div className="single-analysis-grid">
            <aside className="chart-filters" aria-label="單場民調篩選">
              <div className="segmented poll-scope-toggle" role="group" aria-label="單場民調範圍"><button type="button" aria-pressed={pollView === 'closing'} onClick={() => setPollView('closing')}>{preResult ? '最新' : '封關'}</button><button type="button" aria-pressed={pollView === 'history'} onClick={() => setPollView('history')}>歷史</button></div>
              <fieldset className="time-filter"><legend>時間篩選</legend><label className="window-toggle"><input type="checkbox" checked={within30Days} onChange={e => setWithin30Days(e.target.checked)} />選前 30 天</label><button className="text-link" aria-label="查看選前30天規則" onClick={() => openInformation('method')}><Info size={16} />篩選說明</button></fieldset>
            </aside>
            <section className="chart-section workspace-chart" aria-label="民調與大選結果圖表"><p className="chart-kicker">{chartTitle} · 正規化比例（%）</p><PollChart model={chartModel} election={election} rows={rows} selectedId={selected?.poll.id} officialSelected={officialSelected} focusRequest={chartFocusRequest} onSelect={handleSelect} onSelectOfficial={handleSelectOfficial} onClearSelection={clearSelection} /></section>
            <div className="single-table-workspace">
            <div className="display-toolbar"><fieldset className="ratio-options"><legend>顯示數值</legend><label className={showNormalized ? '' : 'active'}><input type="radio" name="display-ratio" checked={!showNormalized} onChange={() => setShowNormalized(false)} />原始支持度</label><label className={showNormalized ? 'active' : ''}><input type="radio" name="display-ratio" checked={showNormalized} onChange={() => setShowNormalized(true)} />正規化比例</label></fieldset><button className="icon-button help-button" aria-label="查看比例與平均絕對誤差（MAE） 計算方法" onClick={() => openInformation('method')}><Info size={18} /></button></div>
            <div className="table-toolbar"><InstitutionFilter key={electionId} options={brandOptions} brandIds={brandIds} onChange={setBrandIds} /></div>
            {query && <div className="active-search"><span>搜尋條件：{query}</span><button type="button" className="icon-button" aria-label="清除搜尋條件" onClick={() => setQuery('')}><X size={17} /></button></div>}
            {pollView === 'closing' && closingIssueParts.length > 0 && <p className="small muted" role="status">有 {closingIssueParts.join('；')}，未納入{preResult ? "各機構最新" : "封關民調"}。</p>}
            {within30Days && tableSelection.dateUnknownCount > 0 && <p className="small muted">另有 {tableSelection.dateUnknownCount} 筆調查日期未知，未套入 30 天範圍。<button className="inline-link" onClick={() => setWithin30Days(false)}>取消 30 天篩選</button></p>}
            <section className="data-panel" aria-label="單場民調資料">
              <div ref={tableScroll} className="data-table-scroll" tabIndex="0" role="region" aria-label="民調資料表">
                <PollTable election={election} title={shortTitle(election)} rows={rows} candidates={visibleCandidates} officialResult={officialResult} showNormalized={showNormalized} shownShare={shownShare} selectedId={selected?.poll.id} officialSelected={officialSelected} sort={sort} onSort={handleSort} onSortChange={setSort} onSelect={handleSelect} onSelectOfficial={handleSelectOfficial} />
                {!rows.length && <div className="table-empty"><Table size={32} /><h3>{data.elections.length ? '目前沒有符合條件的民調' : '尚無收錄資料'}</h3><p>缺漏資料不補零；{preResult ? '來源仍可在方法與來源中查閱。' : '大選結果與來源仍可在計算詳情查閱。'}</p>{collectionCoverage?.recordsFound === 0 && <p>本場已檢查公開索引與來源，但未查得可收錄的民調，不表示當年沒有進行民調。</p>}<button className="button" onClick={() => { updateView({ query: '', brandIds: null, within30Days: false }); }}>重設機構與時間篩選</button></div>}
              </div>
              <footer className="table-footer"><span>{pollView === 'closing' ? '每家民調單位取全期間最新一筆' : '顯示各民調單位的全部調查波次'}；共 {rows.length} 筆{within30Days ? '（已套用選前 30 天）' : ''}{!preResult && '；大選結果列在首筆'}</span></footer>
            </section>
            <p className="score-note"><Info size={15} />{preResult ? '尚無官方結果，MAE 留空。' : '切換表格比例不改圖表或分數。'}<button className="inline-link" onClick={() => openInformation('method')}>方法與來源</button><button className="inline-link" onClick={() => openInformation('catalogue')}>其他題目與來源</button></p>
            </div>
            </div>
          </>}
        </>}
        <SiteFooter data={data} onOpenInformation={openInformation} />
      </main>
      {mode === 'single' && phase === 'ready' && <Inspector data={data} open={inspectorOpen} election={election} row={selected} officialSelected={officialSelected} institution={institutions.get(selected?.poll.institutionId)} onClearSelection={clearSelection} onClose={closeInspector} />}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    {information && <InformationDialog kind={information} data={data} electionId={electionId} returnFocus={informationReturnFocus.current} onClose={() => setInformation('')} />}
  </>;
}


