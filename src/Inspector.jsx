import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { PollChart } from './PollChart.jsx';
import { Detail } from './Detail.jsx';
import { IconButton, trapDialogFocus } from './ui.jsx';

export function Inspector({ compact, election, row, rows, institution, focusRequest, onSelect, onClearSelection, onClose }) {
  const dialog = useRef(null);
  const returnFocus = useRef(null);
  const backdropGesture = useRef(null);
  useEffect(() => {
    if (!compact) return;
    const element = dialog.current;
    if (!returnFocus.current) returnFocus.current = document.activeElement;
    element?.showModal();
    return () => { if (element?.open) element.close(); const previous = returnFocus.current; if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected && previous.getClientRects().length) previous.focus(); else document.getElementById('main-content')?.focus(); };
  }, [compact]);
  const candidateCount = (election?.comparisonCandidateIds || election?.candidates || []).length;
  const chartTitle = candidateCount === 2 ? '當選人得票率與誤差' : candidateCount === 3 ? '三人比例三角圖' : '候選人比例對照';
  const contents = <>
    <header className="inspector-heading"><div><h2 id="inspector-title">{row?.brand || '民調總覽'}</h2><p>{row ? (row.poll.fieldworkEnd || '日期未知') : election?.label}</p></div><IconButton label="關閉計算詳情" onClick={onClose}><X size={22} /></IconButton></header>
    <section className="chart-section" aria-label="民調與大選結果圖表"><p className="chart-kicker">{chartTitle} · 正規化 100%</p><PollChart election={election} rows={rows} selectedId={row?.poll.id} focusRequest={focusRequest} onSelect={onSelect} onClearSelection={onClearSelection} /></section>
    <Detail row={row} election={election} institution={institution} />
  </>;
  const outsideDialog = event => {
    const bounds = dialog.current?.getBoundingClientRect();
    return event.target === dialog.current && bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  return compact ? <dialog ref={dialog} className="inspector-dialog" aria-labelledby="inspector-title" onCancel={onClose} onKeyDown={trapDialogFocus}
    onPointerDown={event => { backdropGesture.current = outsideDialog(event) ? { x: event.clientX, y: event.clientY } : null; }}
    onClick={event => { const start = backdropGesture.current; backdropGesture.current = null; if (start && outsideDialog(event) && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) { onClearSelection(); onClose(); } }}
  >{contents}</dialog> : <aside className="inspector" aria-labelledby="inspector-title">{contents}</aside>;
}
