import { useLayoutEffect, useMemo, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { sortElectionsForDisplay } from './election-navigation.mjs';
import { buildMaeHistogram } from './institution-model.mjs';
import { MaeHistogram, histogramInterval } from './MaeHistogram.jsx';
import { firstPublicSource, fmt, IconButton, pollStatusLabel, SourceLink, trapDialogFocus } from './ui.jsx';
import { useElectionDetails } from './use-election-details.mjs';
import { publisherBrand } from './publisher-brand.mjs';

function ComparisonElection({ data, election, point, poll, onOpenElection }) {
  const evidence = useElectionDetails(data, election.id, poll?.status !== 'verified');
  const fullPoll = evidence.details?.polls.find(item => item.id === point.pollId);
  const reviewPoll = poll?.status === 'verified' ? poll : fullPoll;
  const record = fullPoll || poll;
  const institution = data.institutions.find(item => item.id === record?.institutionId);
  return <li>
    <div className="comparison-election-heading"><h4>{election.label}</h4><button type="button" className="comparison-score text-link" aria-label={`${election.label}，誤差${fmt(point.mae)}百分點，查看這筆民調`} onClick={() => onOpenElection(election.id, point.pollId)}>{fmt(point.mae)}<small>百分點</small></button></div>
    <dl><div><dt>調查結束日</dt><dd>{poll?.fieldworkEnd || '未知'}</dd></div><div><dt>核實狀態</dt><dd>{reviewPoll ? pollStatusLabel(reviewPoll) : evidence.error ? '核實狀態暫時無法讀取' : <span role="status">載入核實狀態…</span>}</dd></div></dl>
    {evidence.error && <div className="comparison-evidence-error" role="alert"><p>{evidence.error}</p><button type="button" className="button" onClick={evidence.retry}>重試核實資料</button></div>}
    <details className="metadata"><summary>調查角色與原紀錄</summary><dl className="definition-list">{[['民調品牌（歸戶）', record && publisherBrand(record, institution)], ['原收錄品牌', institution?.brand], ['委託者', record?.commissioner], ['出資者', record?.funder], ['原始執行者', record?.executor], ['設計分析', record?.designAndAnalysis], ['原機構 ID', record?.institutionId], ['民調 ID', point.pollId]].map(([title, value]) => <div key={title}><dt>{title}</dt><dd>{value || '未載明'}</dd></div>)}</dl></details>
    <SourceLink source={firstPublicSource(record)}>查看來源</SourceLink>
  </li>;
}

export function ComparisonDetails({ data, row, maximum, onOpenElection, onClose }) {
  const dialog = useRef(null);
  const heading = useRef(null);
  const pointerGesture = useRef(null);
  const elections = useMemo(() => sortElectionsForDisplay(data.elections.filter(election => election.phase !== 'pre_result')), [data.elections]);
  const polls = useMemo(() => new Map(data.polls.map(poll => [poll.id, poll])), [data.polls]);
  const adopted = new Map(row.availablePerElection.map(point => [point.electionId, point]));
  const missing = new Set(row.missingElectionIds);
  const histogram = buildMaeHistogram(row.availablePerElection, maximum);
  useLayoutEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    heading.current.focus({ preventScroll: true });
    return () => {
      if (element.open) element.close();
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
      else document.getElementById('main-content')?.focus({ preventScroll: true });
    };
  }, []);
  const outsideDialog = event => {
    const bounds = dialog.current.getBoundingClientRect();
    return event.target === dialog.current && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  return <dialog ref={dialog} className="inspector-dialog comparison-dialog" aria-modal="true" aria-labelledby="comparison-detail-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={trapDialogFocus}
    onPointerDown={event => { pointerGesture.current = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId, outside: outsideDialog(event), moved: false } : null; }}
    onPointerMove={event => { const start = pointerGesture.current; if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) start.moved = true; }}
    onPointerCancel={() => { pointerGesture.current = null; }}
    onClick={event => { const start = pointerGesture.current; pointerGesture.current = null; if (start?.outside && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6 && outsideDialog(event)) onClose(); }}>
    <header className="inspector-heading"><div><p className="eyebrow">機構詳情</p><h2 id="comparison-detail-title" ref={heading} tabIndex="-1">{row.brand}</h2></div><IconButton label="關閉機構詳情" onClick={onClose}><X size={22} /></IconButton></header>
    <div className="comparison-detail-body">
      <dl className="comparison-statistics">
        <div><dt>平均誤差(MAE)<small>百分點</small></dt><dd className="accent">{fmt(row.average)}</dd></div>
        <div><dt>採計場次</dt><dd>{row.averageCount}<small>場</small></dd></div>
        <div><dt>中位數<small>百分點</small></dt><dd>{fmt(row.median)}</dd></div>
        <div><dt>最大誤差<small>百分點</small></dt><dd>{fmt(row.maximum)}</dd></div>
      </dl>
      <section className="comparison-distribution" aria-labelledby="comparison-distribution-title">
        <h3 id="comparison-distribution-title">誤差分佈</h3><p className="comparison-chart-note">每 2 百分點一區間；柱高為採計場次占比（0–100%）。橫軸為誤差（百分點）。</p>
        <MaeHistogram points={row.availablePerElection} maximum={maximum} median={row.median} elections={elections} brand={row.brand} expanded />
        {histogram?.total > 0 && <details className="comparison-disclosure"><summary>區間數值</summary><table className="histogram-values"><caption className="sr-only">{row.brand}的誤差區間、場次及占比</caption><thead><tr><th scope="col">誤差區間</th><th scope="col" className="number">場次</th><th scope="col" className="number">占比</th></tr></thead><tbody>{histogram.bins.map(bin => <tr key={bin.start}><th scope="row">{histogramInterval(bin, maximum)}</th><td className="number">{bin.count}／{histogram.total}</td><td className="number">{bin.percentage.toFixed(1)}%</td></tr>)}</tbody></table></details>}
      </section>
      <section className="comparison-election-section" aria-labelledby="comparison-adopted-title"><h3 id="comparison-adopted-title">逐場採計明細 <span>{row.averageCount} 場</span></h3>
        {row.averageCount === 0 && <p className="muted">目前條件下無可採計場次</p>}
        <ul className="comparison-election-list">{elections.filter(election => adopted.has(election.id)).map(election => {
          const point = adopted.get(election.id);
          return <ComparisonElection key={election.id} data={data} election={election} point={point} poll={polls.get(point.pollId)} onOpenElection={onOpenElection} />;
        })}</ul>
      </section>
      <details className="comparison-disclosure comparison-missing"><summary>未採計 {row.missingElectionIds.length} 場</summary><p>以下選舉在目前條件下沒有可採計紀錄。</p><ul>{elections.filter(election => missing.has(election.id)).map(election => <li key={election.id}>{election.label}</li>)}</ul></details>
    </div>
  </dialog>;
}
