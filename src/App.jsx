import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarBlank, CaretDown, ChartBar, ClockCounterClockwise, DownloadSimple, Info, List, MagnifyingGlass, SidebarSimple, Table, WarningCircle, X } from '@phosphor-icons/react';
import { exportCsv, filterAndSortRows, selectSingleElectionPolls } from './domain.mjs';
import { compareInstitutionBrands } from './institution-model.mjs';
import { loadDataset } from './load-data.mjs';
import { Comparison } from './Comparison.jsx';
import { InformationDialog } from './InformationDialog.jsx';
import { Inspector } from './Inspector.jsx';
import { firstPublicSource, fmt, IconButton, scoreValue, SourceLink, SortHeading } from './ui.jsx';
import { officialResultSummary } from './result-model.mjs';
import { GitHubLinks } from './GitHubLinks.jsx';
import { SiteFooter } from './SiteInformation.jsx';

const EMPTY = { version: '—', updatedAt: '—', elections: [], institutions: [], polls: [], corrections: [] };
const shortTitle = e => !e ? '歷史民調資料' : e.id.endsWith('president') ? e.year + ' 總統選舉' : e.year + ' ' + e.region + '長選舉';

export function App() {
  const [data, setData] = useState(EMPTY);
  const [phase, setPhase] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [electionId, setElectionId] = useState('');
  const [mode, setMode] = useState('single');
  const [within30Days, setWithin30Days] = useState(false);
  const [pollView, setPollView] = useState('closing');
  const [showNormalized, setShowNormalized] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'mae', direction: 'asc' });
  const [selectedId, setSelectedId] = useState('');
  const [chartFocusRequest, setChartFocusRequest] = useState(null);
  const [information, setInformation] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [isCompact, setIsCompact] = useState(() => matchMedia('(max-width: 1100px)').matches);
  const [inspectorOpen, setInspectorOpen] = useState(() => !matchMedia('(max-width: 1100px)').matches);
  const [announcement, setAnnouncement] = useState('');
  const navRef = useRef(null);
  const menuRef = useRef(null);
  const informationReturnFocus = useRef(null);

  async function reload() {
    setPhase('loading'); setLoadError('');
    try {
      const result = await loadDataset();
      setData(result.data);
      setSelectedId(''); setChartFocusRequest(null);
      setElectionId(result.data.elections.slice().sort((a, b) => b.date.localeCompare(a.date))[0]?.id || '');
      setPhase('ready');
    } catch (error) { setLoadError(error.message); setPhase('error'); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    const media = matchMedia('(max-width: 1100px)');
    const navigationMedia = matchMedia('(max-width: 760px)');
    const update = () => { setIsCompact(media.matches); setInspectorOpen(!media.matches); };
    const updateNav = () => { if (!navigationMedia.matches) { const hadFocus = navRef.current?.contains(document.activeElement); setMobileNav(false); if (hadFocus) requestAnimationFrame(() => document.getElementById('main-content')?.focus()); } };
    media.addEventListener('change', update);
    navigationMedia.addEventListener('change', updateNav);
    return () => { media.removeEventListener('change', update); navigationMedia.removeEventListener('change', updateNav); };
  }, []);
  useEffect(() => { if (mobileNav) navRef.current?.querySelector('button')?.focus(); }, [mobileNav]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    if (mobileNav || information || isCompact && inspectorOpen && mode === 'single') document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [mobileNav, information, isCompact, inspectorOpen, mode]);

  const election = data.elections.find(e => e.id === electionId);
  const visibleCandidates = election ? (election.comparisonCandidateIds || election.candidates.map(c => c.id)).map(id => election.candidates.find(c => c.id === id)).filter(Boolean) : [];
  const institutions = useMemo(() => new Map(data.institutions.map(i => [i.id, i])), [data]);
  const tableSelection = useMemo(() => election ? selectSingleElectionPolls(data.polls, election, { view: pollView, within30Days })
    : { rows: [], unresolvedCounts: { undatedInstitutionCount: 0, supportConflictInstitutionCount: 0 }, dateUnknownCount: 0, unfilteredCount: 0 },
  [data.polls, election, pollView, within30Days]);
  const baseRows = useMemo(() => tableSelection.rows
    .map(row => ({ ...row, brand: institutions.get(row.poll.institutionId)?.brand || row.poll.institutionId })), [tableSelection, institutions]);
  const rows = useMemo(() => filterAndSortRows(baseRows, { query, sortKey: sort.key, direction: sort.direction }), [baseRows, query, sort]);
  const selected = rows.find(row => row.poll.id === selectedId) || null;
  const officialResult = useMemo(() => election?.result?.status === 'verified' ? officialResultSummary(election) : null, [election]);
  const officialCandidateVotes = visibleCandidates.map(candidate => election?.result?.votes?.[candidate.id]);
  const officialCandidateTotal = officialCandidateVotes.every(Number.isFinite) ? officialCandidateVotes.reduce((sum, value) => sum + value, 0) : null;
  const comparison = useMemo(() => compareInstitutionBrands(data, { within30Days }), [data, within30Days]);
  const comparisonExportRows = comparison.exportRows;

  useEffect(() => {
    if (selectedId && !rows.some(row => row.poll.id === selectedId)) {
      setSelectedId(''); setChartFocusRequest(null);
      setAnnouncement('所選民調已不在目前範圍，已取消選取。');
    }
  }, [rows, selectedId]);
  useEffect(() => {
    let gesture = null;
    const startGesture = event => { gesture = { x: event.clientX, y: event.clientY, moved: false }; };
    const trackGesture = event => { if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 6) gesture.moved = true; };
    const cancelFromBackground = event => {
      if (gesture?.moved || mode !== 'single' || !selectedId || !(event.target instanceof Element)) return;
      if (event.target.closest('button, a, input, select, textarea, label, summary, [role="button"], [contenteditable="true"], [data-poll-id], .official-result-row, .chart-section, .detail, .detail-empty, .official-result, .inspector-heading h2, .inspector-heading p, dialog')) return;
      clearSelection();
    };
    document.addEventListener('pointerdown', startGesture, true);
    document.addEventListener('pointermove', trackGesture, true);
    document.addEventListener('click', cancelFromBackground);
    return () => { document.removeEventListener('pointerdown', startGesture, true); document.removeEventListener('pointermove', trackGesture, true); document.removeEventListener('click', cancelFromBackground); };
  }, [mode, selectedId]);

  function handleElection(id, pollId = '') {
    if (pollId) setPollView('history');
    setElectionId(id); setSelectedId(pollId); setMobileNav(false); setMode('single'); setQuery('');
    setChartFocusRequest(null); setAnnouncement('');
    setInspectorOpen(Boolean(pollId) || !isCompact);
    if (mobileNav) requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }
  function handleMode(value) { setMode(value); setMobileNav(false); if (mobileNav) requestAnimationFrame(() => document.getElementById('main-content')?.focus()); }
  function handleSelect(id, fromTable = false) {
    setSelectedId(id); if (!inspectorOpen) openInspector();
    if (fromTable) setChartFocusRequest(previous => ({ pollId: id, electionId, sequence: (previous?.sequence || 0) + 1 }));
    setAnnouncement('已同步選取民調，圖表與計算詳情已更新。');
  }
  function clearSelection() {
    setSelectedId(''); setChartFocusRequest(null);
    setAnnouncement('已取消選取；圖表範圍保持不變。');
  }
  function handleSort(key) { setSort(current => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); }
  function closeNav() { setMobileNav(false); menuRef.current?.focus(); }
  function openInspector() { setInspectorOpen(true); if (!isCompact) requestAnimationFrame(() => document.querySelector('.inspector .inspector-heading button')?.focus()); }
  function closeInspector() { setInspectorOpen(false); if (!isCompact) requestAnimationFrame(() => document.querySelector('.show-inspector')?.focus()); }
  function openInformation(kind) { informationReturnFocus.current = mobileNav ? menuRef.current : document.activeElement; setMobileNav(false); setInformation(kind); }
  function download() {
    const exportRows = mode === 'comparison' ? comparisonExportRows : rows;
    if (!exportRows.length) return;
    const url = URL.createObjectURL(new Blob([exportCsv(exportRows, data)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url;
    link.download = '選情劉伯溫_' + (mode === 'comparison' ? '跨場比較' : electionId) + '_' + data.version + '.csv';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setAnnouncement('已下載 ' + exportRows.length + ' 筆收錄資料（含歷史索引）。');
  }
  function navKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); closeNav(); }
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], summary')];
    if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
  }

  const pollElectionCount = new Set(data.polls.map(p => p.electionId)).size;
  const currentElectionTotal = data.polls.filter(p => p.electionId === electionId).length;
  const closingIssueParts = [
    tableSelection.unresolvedCounts.undatedInstitutionCount > 0 && `調查日期全未知 ${tableSelection.unresolvedCounts.undatedInstitutionCount} 家`,
    tableSelection.unresolvedCounts.supportConflictInstitutionCount > 0 && `最新波次支持度衝突 ${tableSelection.unresolvedCounts.supportConflictInstitutionCount} 家`,
  ].filter(Boolean);
  const shownShare = (row, id) => {
    if (!showNormalized) return row.poll.shares?.[id];
    if (row.evaluation.eligible) return row.evaluation.pollNormalized?.[id];
    const values = visibleCandidates.map(c => row.poll.shares?.[c.id]);
    const total = values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : 0;
    return total > 0 ? row.poll.shares?.[id] / total * 100 : null;
  };
  const nav = <>
    <h2 className="sidebar-title">選舉資料檢視器</h2>
    <button className={'nav-section-button ' + (mode === 'single' ? 'active' : '')} onClick={() => handleMode('single')}><CalendarBlank size={18} />單場選舉</button>
    <nav className="election-navigation" aria-label="歷史選舉">
      <h3>總統選舉</h3>
      {data.elections.filter(e => e.id.endsWith('president')).slice().sort((a, b) => b.date.localeCompare(a.date)).map(e => <button key={e.id} className={'election-item ' + (e.id === electionId && mode === 'single' ? 'active' : '')} onClick={() => handleElection(e.id)} aria-current={e.id === electionId && mode === 'single' ? 'page' : undefined}>{shortTitle(e)}</button>)}
      <h3>縣市長選舉</h3>
      {data.elections.filter(e => !e.id.endsWith('president')).slice().sort((a, b) => b.date.localeCompare(a.date)).map(e => <button key={e.id} className={'election-item ' + (e.id === electionId && mode === 'single' ? 'active' : '')} onClick={() => handleElection(e.id)} aria-current={e.id === electionId && mode === 'single' ? 'page' : undefined}>{shortTitle(e)}</button>)}
      {!data.elections.length && <p className="sidebar-empty">收錄資料後逐筆列出。</p>}
    </nav>
    <div className="sidebar-secondary"><button className={mode === 'comparison' ? 'active' : ''} onClick={() => handleMode('comparison')}><ChartBar size={19} />跨場比較</button><button onClick={() => openInformation('method')}><BookOpen size={19} />方法與來源</button><button onClick={() => openInformation('version')}><ClockCounterClockwise size={19} />版本與更正</button></div>
    <p className="sidebar-footnote">收錄 {data.polls.length} 筆民調<br />不代表完整歷史資料庫</p>
  </>;
  const canExport = mode === 'comparison' ? comparisonExportRows.length > 0 : rows.length > 0;
  const showDesktopInspector = mode === 'single' && inspectorOpen && !isCompact;

  return <>
    <a className="skip-link" href="#main-content">跳至主要內容</a>
    <header className="app-header"><div className="brand"><button ref={menuRef} className="icon-button mobile-menu" aria-label="開啟選舉導覽" onClick={() => setMobileNav(true)}><List size={23} /></button><h1>選情劉伯溫</h1><p>台灣民調資料與歷史準確度</p></div><GitHubLinks /></header>
    <div className={['app-shell', showDesktopInspector ? 'with-inspector' : '', mode === 'comparison' ? 'comparison-mode' : ''].join(' ')}>
      <aside className="sidebar" aria-label="選舉導覽">{nav}</aside>
      {mobileNav && <div className="mobile-nav-overlay" onClick={closeNav}><aside ref={navRef} className="mobile-nav" role="dialog" aria-modal="true" aria-label="選舉導覽選單" onClick={e => e.stopPropagation()} onKeyDown={navKeyDown}><div className="mobile-nav-heading"><strong>選情劉伯溫</strong><IconButton label="關閉選舉導覽" onClick={closeNav}><X size={22} /></IconButton></div>{nav}</aside></div>}
      <main id="main-content" className="main-content" tabIndex="-1">
        <div className="workspace-top"><div><div className="breadcrumb">{mode === 'single' ? '單場選舉' : '歷史民調'} / {mode === 'single' ? shortTitle(election) : '全部機構'}</div><h2>{mode === 'single' ? shortTitle(election) : '跨場比較'}</h2>{election && mode === 'single' && <p className="election-meta">投票日 {election.date} · {election.region} · 大選結果可查</p>}</div><div className="workspace-actions">{mode === 'single' && <label className="election-picker"><CalendarBlank size={17} /><span>選擇選舉</span><CaretDown size={14} /><select aria-label="選擇選舉" value={electionId} onChange={e => handleElection(e.target.value)}>{data.elections.slice().sort((a, b) => b.date.localeCompare(a.date)).map(e => <option key={e.id} value={e.id}>{shortTitle(e)}</option>)}</select></label>}<button className="button export-button" disabled={!canExport} onClick={download} title={mode === 'comparison' ? '下載跨場比較各筆民調及正規化計算' : '下載目前篩選的全部民調及計算'}><DownloadSimple size={17} />下載 CSV</button></div></div>
        {phase === 'loading' ? <div className="page-state" role="status"><h3>正在讀取民調資料</h3><p>每筆附來源與計算。</p></div> : phase === 'error' ? <div className="page-state error-state" role="alert"><WarningCircle size={32} /><h3>資料暫時無法載入</h3><p>{loadError}</p><button className="button primary" onClick={reload}>重新讀取</button></div> : <>
          <p className="coverage-note"><Info size={14} />已收錄 {data.polls.length} 筆民調，涵蓋 {pollElectionCount} 場選舉；{mode === 'single' && election && `此場收錄 ${currentElectionTotal} 筆。`} 誤差越低，代表與官方結果越接近。</p>
          {mode === 'comparison' ? <><div className="comparison-window"><label><input type="checkbox" checked={within30Days} onChange={e => setWithin30Days(e.target.checked)} />選前 30 天</label></div><Comparison data={data} comparison={comparison} onOpenElection={handleElection} /></> : <>
            <div className="display-toolbar"><fieldset className="ratio-options"><legend>顯示數值</legend><label className={showNormalized ? '' : 'active'}><input type="radio" name="display-ratio" checked={!showNormalized} onChange={() => setShowNormalized(false)} />原始支持度</label><label className={showNormalized ? 'active' : ''}><input type="radio" name="display-ratio" checked={showNormalized} onChange={() => setShowNormalized(true)} />正規化比例</label></fieldset><button className="icon-button help-button" aria-label="查看比例與平均絕對誤差（MAE） 計算方法" onClick={() => openInformation('method')}><Info size={18} /></button><span className="toolbar-divider" /><label className="window-toggle"><span>時間篩選</span><input type="checkbox" checked={within30Days} onChange={e => setWithin30Days(e.target.checked)} />選前 30 天</label><button className="icon-button help-button" aria-label="選前30天規則" onClick={() => openInformation('method')}><Info size={16} /></button></div>
            <div className="table-toolbar"><div className="segmented poll-scope-toggle" role="group" aria-label="單場民調範圍"><button type="button" aria-pressed={pollView === 'closing'} onClick={() => setPollView('closing')}>封關民調</button><button type="button" aria-pressed={pollView === 'history'} onClick={() => setPollView('history')}>歷史民調</button></div><label className="search-field"><MagnifyingGlass size={16} /><input aria-label="搜尋機構或民調" type="search" placeholder="搜尋機構…" value={query} onChange={e => setQuery(e.target.value)} /></label>{(isCompact || !inspectorOpen) && <button className="text-link show-inspector" aria-expanded={inspectorOpen} onClick={openInspector}><SidebarSimple size={17} />計算詳情</button>}</div>
            {pollView === 'closing' && closingIssueParts.length > 0 && <p className="small muted" role="status">有 {closingIssueParts.join('；')}，未納入封關民調。</p>}
            {within30Days && tableSelection.dateUnknownCount > 0 && <p className="small muted">另有 {tableSelection.dateUnknownCount} 筆調查日期未知，未套入 30 天範圍。<button className="inline-link" onClick={() => setWithin30Days(false)}>取消 30 天篩選</button></p>}
            <section className="data-panel" aria-label="單場民調資料">
              <div className="data-table-scroll" tabIndex="0" role="region" aria-label="民調資料表，可水平捲動">
                <table className="poll-table">
                  <caption className="sr-only">{shortTitle(election)}民調資料，平均絕對誤差（MAE） 是正規化比例的平均絕對誤差，單位百分點。</caption>
                  <thead><tr><th className="row-index">#</th><SortHeading label="調查單位" name="brand" sort={sort} onSort={handleSort} /><SortHeading label="調查結束" name="date" sort={sort} onSort={handleSort} />{visibleCandidates.map(c => <th className="candidate-heading" key={c.id}>{c.name}<small>(%)</small></th>)}<SortHeading label="平均絕對誤差（MAE）" name="mae" sort={sort} onSort={handleSort} /><th>來源</th></tr></thead>
                  <tbody>{officialResult && <tr className="official-result-row" data-testid="official-result-row"><td className="row-index">—</td><th scope="row"><span className="official-result-label">大選結果</span></th><td className="date-cell">{election.date}</td>{visibleCandidates.map((candidate, index) => { const votes = officialCandidateVotes[index]; const share = !Number.isFinite(votes) ? null : showNormalized ? officialCandidateTotal > 0 ? votes / officialCandidateTotal * 100 : null : officialResult.rawPercent[candidate.id]; return <td className="number" key={candidate.id}>{fmt(share)}</td>; })}<td className="number mae-cell">—</td><td className="source-cell"><SourceLink source={election.result.source || election.result.sources?.[0]}>來源</SourceLink></td></tr>}{rows.map((row, index) => <tr key={row.poll.id} data-poll-id={row.poll.id} onClick={event => { if (!event.target.closest('a')) handleSelect(row.poll.id, true); }} className={row.poll.id === selected?.poll.id && inspectorOpen ? 'selected-row' : ''}><td className="row-index">{index + 1}</td><th scope="row"><button className="row-select" aria-pressed={row.poll.id === selected?.poll.id && inspectorOpen} aria-label={row.brand + '，' + (row.poll.fieldworkEnd || row.poll.indexDate || '日期未知') + '，查看計算詳情'}>{row.brand}</button></th><td className="date-cell">{row.poll.fieldworkEnd || '日期未知'}{!row.poll.fieldworkEnd && (row.poll.indexDate || row.poll.sourceDateText) && <small>索引 {row.poll.indexDate || row.poll.sourceDateText}</small>}</td>{visibleCandidates.map(c => <td className="number" key={c.id}>{fmt(shownShare(row, c.id))}</td>)}<td className="number mae-cell">{fmt(scoreValue(row.evaluation))}</td><td className="source-cell"><SourceLink source={firstPublicSource(row.poll)}>來源</SourceLink></td></tr>)}</tbody>
                </table>
                {!rows.length && <div className="table-empty"><Table size={32} /><h3>{data.elections.length ? '目前沒有符合條件的民調' : '尚無收錄資料'}</h3><p>缺漏資料不補零；大選結果與來源仍可在計算詳情查閱。</p><button className="button" onClick={() => { setQuery(''); setWithin30Days(false); }}>重設搜尋與時間篩選</button></div>}
              </div>
              <footer className="table-footer"><span>{pollView === 'closing' ? '每家民調單位取全期間最新一筆' : '顯示各民調單位的全部調查波次'}；共 {rows.length} 筆{within30Days ? '（已套用選前 30 天）' : ''}；大選結果列在首筆</span></footer>
            </section>
            <p className="score-note"><Info size={15} />平均絕對誤差（MAE） 採同一候選人集合的正規化比例；切換原始支持度不改分數。完整計算、來源與備註請選取紀錄查看。<button className="inline-link" onClick={() => openInformation('method')}>方法與來源</button><button className="inline-link" onClick={() => openInformation('catalogue')}>其他歷史資料與來源</button></p>
          </>}
        </>}
        <SiteFooter data={data} onOpenInformation={openInformation} />
      </main>
      {mode === 'single' && inspectorOpen && phase === 'ready' && <Inspector compact={isCompact} election={election} row={selected} rows={rows} institution={institutions.get(selected?.poll.institutionId)} focusRequest={chartFocusRequest} onSelect={handleSelect} onClearSelection={clearSelection} onClose={closeInspector} />}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    {information && <InformationDialog kind={information} data={data} electionId={electionId} returnFocus={informationReturnFocus.current} onClose={() => setInformation('')} />}
  </>;
}


