import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMaeHistogram } from './institution-model.mjs';

export const histogramInterval = (bin, maximum) => bin.end === maximum
  ? `${bin.start}–${bin.end}百分點（含${bin.end}）` : `${bin.start}–未滿${bin.end}百分點`;

export function MaeHistogram({ points, maximum, median, elections = [], brand, onOpenDetails, expanded = false, resetToken }) {
  const histogram = useMemo(() => buildMaeHistogram(points, maximum), [points, maximum]);
  const [active, setActive] = useState(null);
  const [position, setPosition] = useState(null);
  const control = useRef(null), tooltip = useRef(null), hits = useRef([]);
  const closeTimer = useRef(null), pointerFocus = useRef(false);
  const tooltipId = useId();
  const descriptionId = useId();
  const electionIndex = useMemo(() => new Map(elections.map((election, index) => [election.id, { election, index }])), [elections]);
  useEffect(() => { setActive(null); setPosition(null); }, [histogram, resetToken]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const bin = histogram?.bins[active];
  const members = useMemo(() => [...(bin?.points || [])].sort((left, right) =>
    (electionIndex.get(left.electionId)?.index ?? Infinity) - (electionIndex.get(right.electionId)?.index ?? Infinity)), [bin, electionIndex]);
  const firstOccupied = histogram?.bins.findIndex(item => item.count > 0) ?? 0;
  const hasMedian = histogram?.total > 0 && Number.isFinite(median) && median >= 0 && median <= maximum;
  const plot = expanded ? { left: 36, top: 16, width: 252, height: 112 } : { left: 32, top: 10, width: 196, height: 36 };
  const baseline = plot.top + plot.height;
  const clearClose = () => { clearTimeout(closeTimer.current); };
  const closeSoon = () => { clearClose(); if (document.activeElement !== control.current) closeTimer.current = setTimeout(() => setActive(null), 100); };
  const activate = index => { clearClose(); setActive(index); };
  useLayoutEffect(() => {
    if (!bin) return;
    const place = () => {
      const anchor = (hits.current[active] || control.current)?.getBoundingClientRect();
      const panel = tooltip.current;
      if (!anchor || !panel) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth, viewportHeight = viewport?.height || window.innerHeight;
      const gutter = 12, gap = 8, width = Math.min(340, viewportWidth - gutter * 2);
      if (anchor.bottom < topEdge || anchor.top > topEdge + viewportHeight) { setActive(null); return; }
      const above = anchor.top - topEdge - gutter - gap;
      const below = topEdge + viewportHeight - anchor.bottom - gutter - gap;
      const desiredHeight = Math.min(panel.scrollHeight + 2, viewportHeight - gutter * 2);
      const up = above >= desiredHeight || (below < desiredHeight && above > below);
      const maxHeight = Math.max(40, up ? above : below);
      const left = Math.max(leftEdge + gutter, Math.min(anchor.left + anchor.width / 2 - width / 2, leftEdge + viewportWidth - width - gutter));
      const top = Math.max(topEdge + gutter, up ? anchor.top - gap - Math.min(desiredHeight, maxHeight) : anchor.bottom + gap);
      setPosition(previous => previous?.left === left && previous?.top === top && previous?.width === width && previous?.maxHeight === maxHeight
        ? previous : { left, top, width, maxHeight });
    };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActive(null); } };
    const outside = event => { if (!control.current?.contains(event.target) && !tooltip.current?.contains(event.target)) setActive(null); };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(tooltip.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [active, bin, members]);
  const content = !histogram ? <span className="histogram-empty">分佈資料無法顯示</span>
    : histogram.total === 0 ? <span className="histogram-empty">目前條件下無可採計場次</span>
      : <svg className="mae-histogram" viewBox={expanded ? '0 0 300 164' : '0 0 240 74'} aria-hidden="true">
        {(expanded ? [0, 50, 100] : [0, 100]).map(value => {
          const y = baseline - value / 100 * plot.height;
          return <g key={value}><line className="histogram-grid" x1={plot.left} x2={plot.left + plot.width} y1={y} y2={y} /><text x={plot.left - 5} y={y + 4} textAnchor="end">{value}%</text></g>;
        })}
        {histogram.bins.map((item, index) => {
          const width = plot.width / histogram.bins.length;
          const x = plot.left + index * width;
          const barHeight = item.percentage / 100 * plot.height;
          return <g key={item.start}>
            {index === active && <rect className="histogram-band" x={x} y={plot.top} width={width} height={plot.height} />}
            <rect className={`histogram-bar${index === active ? ' is-active' : ''}`} x={x + width * .22} y={baseline - barHeight} width={Math.max(.5, width * .56)} height={barHeight} rx="1.5" />
          </g>;
        })}
        <line className="histogram-axis" x1={plot.left} x2={plot.left + plot.width} y1={baseline} y2={baseline} />
        {hasMedian && <line className="histogram-median" x1={plot.left + median / maximum * plot.width} x2={plot.left + median / maximum * plot.width} y1={plot.top - 3} y2={baseline + 1} strokeDasharray="3 3" pointerEvents="none" />}
        {histogram.bins.map((item, index) => <rect key={item.start} ref={element => { hits.current[index] = element; }} className="histogram-hit" x={plot.left + index * plot.width / histogram.bins.length} y={plot.top} width={plot.width / histogram.bins.length} height={plot.height} onPointerEnter={() => activate(index)} onPointerDown={() => activate(index)} />)}
        {Array.from({ length: maximum / 10 + 1 }, (_, index) => index * 10).map(value => <text key={value} x={plot.left + value / maximum * plot.width} y={baseline + 19} textAnchor="middle">{value}</text>)}
      </svg>;
  return <div className={`histogram-wrap${expanded ? ' histogram-expanded' : ''}`} onPointerEnter={clearClose} onPointerLeave={closeSoon}>
    <span id={descriptionId} className="sr-only">每 2 百分點一區間，柱高為採計場次占比，縱軸固定 0 至 100%。{hasMedian && `虛線為中位數 ${median.toFixed(2)} 百分點。`}</span>
    <button ref={control} type="button" className="histogram-control" aria-label={`${brand}，誤差分佈，採計${histogram?.total ?? 0}場${hasMedian ? `，中位數${median.toFixed(2)}百分點` : ''}${onOpenDetails ? '，開啟機構詳情' : ''}。左右方向鍵查看每2百分點區間，Home及End查看首尾區間，上下方向鍵捲動場次清單。`}
      aria-describedby={`${descriptionId}${bin ? ` ${tooltipId}` : ''}`} onClick={onOpenDetails || (() => { if (histogram?.total) setActive(value => value ?? firstOccupied); })}
      onPointerDown={() => { pointerFocus.current = true; }} onPointerUp={() => { pointerFocus.current = false; }} onPointerCancel={() => { pointerFocus.current = false; }}
      onFocus={() => { clearClose(); if (!pointerFocus.current && histogram?.total) setActive(value => value ?? firstOccupied); }} onBlur={() => setActive(null)}
      onKeyDown={event => {
        if (event.key === 'Escape' && active !== null) { event.preventDefault(); event.stopPropagation(); setActive(null); }
        if (bin && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault();
          tooltip.current?.scrollBy({ top: (event.key.endsWith('Up') ? -1 : 1) * (event.key.startsWith('Page') ? tooltip.current.clientHeight * .8 : 48) });
          return;
        }
        if (!histogram?.total || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        clearClose();
        setActive(value => event.key === 'Home' ? 0 : event.key === 'End' ? histogram.bins.length - 1
          : Math.max(0, Math.min(histogram.bins.length - 1, (value ?? firstOccupied) + (event.key === 'ArrowLeft' ? -1 : 1))));
      }}>{content}</button>
    {expanded && hasMedian && <p className="histogram-legend"><span className="histogram-median-key" aria-hidden="true" />中位數 {median.toFixed(2)} 百分點</p>}
    {bin && createPortal(<div ref={tooltip} id={tooltipId} className="histogram-tooltip" role="tooltip" onPointerEnter={clearClose} onPointerLeave={closeSoon}
      style={{ position: 'fixed', left: position?.left ?? 12, top: position?.top ?? 12, width: position?.width ?? 'min(340px, calc(100vw - 24px))', maxHeight: position?.maxHeight ?? 'calc(100dvh - 24px)', bottom: 'auto', transform: 'none', visibility: position ? 'visible' : 'hidden' }}>
      <strong>{brand}</strong><span>{histogramInterval(bin, maximum)}：{bin.count}／{histogram.total}場，{bin.percentage.toFixed(1)}%</span>
      {members.length ? <ul className="histogram-tooltip-list">{members.map((point, index) => {
        const election = electionIndex.get(point.electionId)?.election;
        const year = election?.year || election?.date?.slice(0, 4);
        const name = election?.label || point.electionId;
        const label = year ? name.replace(new RegExp(`^${year}年?\\s*`), '') : name;
        return <li key={`${point.electionId}-${point.pollId}-${index}`}><span className="histogram-election-name">{year && <span className="histogram-election-year">{year}年</span>}{label}</span><span className="histogram-election-mae">{point.mae.toFixed(2)} 百分點</span></li>;
      })}</ul> : <span>此區間無採計場次</span>}
    </div>, control.current?.closest('dialog') || document.body)}
  </div>;
}
