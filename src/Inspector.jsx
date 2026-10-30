import { useEffect, useLayoutEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import { Detail } from './Detail.jsx';
import { formatCalendarDay } from './domain.mjs';
import { IconButton, trapDialogFocus } from './ui.jsx';
import { useElectionDetails } from './use-election-details.mjs';

export function Inspector({ data, open, election, row, officialSelected, institution, onClearSelection, onClose, hideResult = false }) {
  const evidence = useElectionDetails(data, election?.id, open && Boolean(row) && !officialSelected);
  const fullPoll = evidence.details?.polls.find(poll => poll.id === row?.poll.id);
  const dialog = useRef(null);
  const returnFocus = useRef(null);
  const pointerGesture = useRef(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open) {
      if (element.open) element.close();
      const previous = returnFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
      return;
    }
    if (element.open) return;
    returnFocus.current = document.activeElement;
    element.scrollTop = 0;
    element.showModal();
  }, [open]);
  useEffect(() => () => { if (dialog.current?.open) dialog.current.close(); }, []);
  const contents = <>
    <header className="inspector-heading"><div><h2 id="inspector-title">{officialSelected ? '大選結果' : row?.brand || (election?.phase === 'pre_result' ? '調查詳情' : '計算詳情')}</h2><p>{row ? `調查開始 ${formatCalendarDay(row.poll.fieldworkStart) || '未知'}` : election?.label}</p></div><div className="inspector-actions"><IconButton className="inspector-close" label="關閉計算詳情" onClick={onClose}><X size={22} /></IconButton></div></header>
    <div id="inspector-body" className="inspector-body">
      {row && !officialSelected && !fullPoll
        ? evidence.error ? <div role="alert"><p>{evidence.error}</p><button className="button" onClick={evidence.retry}>重試載入詳情</button></div>
          : <p role="status">正在載入這筆民調的完整來源與查核資訊…</p>
        : <Detail row={row ? { ...row, poll: fullPoll } : null} officialSelected={officialSelected} election={election} institution={institution} hideResult={hideResult} />}
    </div>
  </>;
  const outsideDialog = event => {
    const bounds = dialog.current?.getBoundingClientRect();
    return event.target === dialog.current && bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  const backgroundTarget = target => target instanceof Element && !target.closest('button, a, input, select, textarea, label, summary, [role="button"], [contenteditable="true"], h2, h3, h4, p, span, strong, small, td, th, dt, dd, li');
  return <dialog id="inspector-panel" ref={dialog} className="inspector-panel inspector-dialog" aria-modal="true" aria-labelledby="inspector-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={trapDialogFocus}
    onPointerDown={event => { pointerGesture.current = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId, outside: outsideDialog(event), background: backgroundTarget(event.target), moved: false } : null; }}
    onPointerMove={event => { const start = pointerGesture.current; if (start?.pointerId === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) start.moved = true; }}
    onPointerCancel={() => { pointerGesture.current = null; }}
    onClick={event => {
      const start = pointerGesture.current;
      pointerGesture.current = null;
      if (!start || start.moved || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6) return;
      if (start.outside && outsideDialog(event)) { onClearSelection(); onClose(); }
      else if (!start.outside && start.background && !outsideDialog(event) && backgroundTarget(event.target)) onClearSelection();
    }}
    >{contents}</dialog>;
}
