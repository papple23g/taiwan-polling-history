import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatCalendarDay } from './domain.mjs';
import { makeChartTooltip, publisherShortLabel, SELECTED_TRAJECTORY_COLOR } from './chart-model.mjs';
import { playbackDay, playbackElapsed, playbackResultVisible, playbackSnapshot } from './playback-model.mjs';
import { createPlaybackMotion } from './playback-motion.mjs';
import './playback-overlay.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const arrayValue = (value, index, fallback) => {
  const item = Array.isArray(value) ? value[index] : value;
  return item ?? fallback;
};

function indexPoints(model) {
  const points = new Map();
  const axes = model?.kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y'];
  for (const trace of model?.data || []) {
    if (trace.uid === 'official-result' || !Array.isArray(trace.customdata)) continue;
    trace.customdata.forEach((id, index) => {
      const position = axes.map(axis => trace[axis]?.[index]);
      if (!id || points.has(id) || !position.every(Number.isFinite)) return;
      points.set(id, {
        id, position,
        size: arrayValue(trace.marker?.size, index, 18),
        opacity: arrayValue(trace.marker?.opacity, index, 1),
        symbol: arrayValue(trace.marker?.symbol, index, 'circle'),
        color: arrayValue(trace.marker?.color, index, '#3279cb'),
        lineColor: arrayValue(trace.marker?.line?.color, index, '#fff'),
        lineWidth: arrayValue(trace.marker?.line?.width, index, 0.75),
      });
    });
  }
  return points;
}

function snapshotGroups(timeline, day, indexed) {
  const groups = new Map();
  if (!timeline?.records || !Number.isFinite(day)) return groups;
  const records = new Map(timeline.records.map(record => [record.row.poll.id, record]));
  for (const row of playbackSnapshot(timeline, day)) {
    const record = records.get(row.poll.id);
    const point = indexed.get(row.poll.id);
    if (!record || !point) continue;
    if (!groups.has(record.brandId)) groups.set(record.brandId, []);
    groups.get(record.brandId).push({ ...point, row, brandId: record.brandId, label: publisherShortLabel(row.brand || row.poll.id) });
  }
  return groups;
}

function geometry(model, area, viewportRef) {
  const viewport = viewportRef?.current?.value;
  if (!area || !viewport || !['strip', 'ternary'].includes(model?.kind)) return null;
  if (area.scope && viewportRef.current.scope && area.scope !== viewportRef.current.scope) return null;
  if (area.scope && model.layout?.uirevision && area.scope !== model.layout.uirevision) return null;
  const { left, right, top, bottom } = area;
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  if (model.kind === 'strip') {
    if (!viewport.x?.every(Number.isFinite) || !viewport.y?.every(Number.isFinite)
      || viewport.x.length !== 2 || viewport.y.length !== 2
      || viewport.x[1] <= viewport.x[0] || viewport.y[1] <= viewport.y[0]) return null;
  } else if (!viewport.min || viewport.min.length !== 3 || !viewport.min.every(Number.isFinite)
    || 100 - viewport.min.reduce((sum, value) => sum + value, 0) <= 0) return null;
  return { left, right, top, bottom, width: right - left, height: bottom - top, kind: model.kind, viewport };
}

function project(position, bounds) {
  if (!bounds || !position.every(Number.isFinite)) return null;
  if (bounds.kind === 'strip') {
    const { x, y } = bounds.viewport;
    return { x: bounds.left + bounds.width * (position[0] - x[0]) / (x[1] - x[0]),
      y: bounds.bottom - bounds.height * (position[1] - y[0]) / (y[1] - y[0]) };
  }
  const min = bounds.viewport.min;
  const span = 100 - min.reduce((sum, value) => sum + value, 0);
  const a = (position[0] - min[0]) / span;
  const c = (position[2] - min[2]) / span;
  return { x: bounds.left + bounds.width * (a / 2 + c), y: bounds.bottom - bounds.height * a };
}

function inside(bounds, x, y) {
  if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return false;
  if (bounds.kind === 'strip') return true;
  const a = (bounds.bottom - y) / bounds.height;
  const c = (x - bounds.left) / bounds.width - a / 2;
  return c >= -1e-6 && 1 - a - c >= -1e-6;
}

function shapePath(bounds) {
  if (!bounds) return '';
  const { left, right, top, bottom } = bounds;
  return bounds.kind === 'ternary' ? `M${left},${bottom}L${(left + right) / 2},${top}L${right},${bottom}Z`
    : `M${left},${top}H${right}V${bottom}H${left}Z`;
}

function starPath(radius) {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    const r = index % 2 ? radius * 0.43 : radius;
    return `${index ? 'L' : 'M'}${Math.cos(angle) * r},${Math.sin(angle) * r}`;
  }).join('') + 'Z';
}

function svgNode(name, className) {
  const element = document.createElementNS(SVG_NS, name);
  if (className) element.setAttribute('class', className);
  return element;
}

function makeMarker(layer) {
  const group = svgNode('g', 'playback-overlay-point');
  const focus = svgNode('circle', 'playback-overlay-focus');
  const selected = svgNode('circle');
  const halo = svgNode('circle');
  const circle = svgNode('circle');
  const star = svgNode('path');
  const text = svgNode('text', 'playback-overlay-label');
  group.append(focus, selected, halo, circle, star, text);
  group.setAttribute('role', 'img');
  layer.appendChild(group);
  return { group, focus, selected, halo, circle, star, text };
}

function officialPoint(model, election, timeline, day) {
  if (election?.phase === 'pre_result' || !timeline || !playbackResultVisible(timeline, day)) return null;
  const trace = model?.data?.find(item => item.uid === 'official-result');
  if (!trace) return null;
  const axes = model.kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y'];
  const position = axes.map(axis => trace[axis]?.[0]);
  if (!position.every(Number.isFinite)) return null;
  return { id: 'official-result', actual: true, position, size: arrayValue(trace.marker?.size, 0, 17),
    color: arrayValue(trace.marker?.color, 0, '#d65359'), opacity: arrayValue(trace.marker?.opacity, 0, 1) };
}

export function PollPlaybackOverlay({ election, model, timeline, position, playing, speed, seekVersion, area, viewportRef, showNames, selectedId, onPause, onMotionStatusChange }) {
  const overlayRef = useRef(null);
  const svgRef = useRef(null);
  const clipPathRef = useRef(null);
  const hitPathRef = useRef(null);
  const layerRef = useRef(null);
  const tooltipRef = useRef(null);
  const motionRef = useRef(null);
  if (!motionRef.current) motionRef.current = createPlaybackMotion();
  const markerNodes = useRef(new Map());
  const frames = useRef([]);
  const activeKey = useRef(null);
  const tooltipSignature = useRef('');
  const closeTimer = useRef(null);
  const pointer = useRef(null);
  const previous = useRef(null);
  const notifiedPending = useRef(false);
  const previousGeometry = useRef('');
  const dirty = useRef(true);
  const [tooltip, setTooltip] = useState(null);
  const tooltipId = `playback-tooltip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const clipId = `playback-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const day = playbackDay(position);
  const indexed = useMemo(() => indexPoints(model), [model]);
  const groups = useMemo(() => snapshotGroups(timeline, day, indexed), [timeline, day, indexed]);
  const snapshotIds = useMemo(() => new Set([...groups.values()].flatMap(group => group.map(point => point.id))), [groups]);
  const current = useRef(null);
  current.current = { election, model, timeline, day, position, playing, speed, seekVersion, area, viewportRef, showNames, selectedId, onPause, onMotionStatusChange, groups, snapshotIds };

  function reportPending() {
    const next = motionRef.current.pending();
    if (next !== notifiedPending.current) {
      notifiedPending.current = next;
      current.current.onMotionStatusChange?.(next);
    }
  }

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function clearTooltip() {
    cancelClose();
    if (activeKey.current === null && !tooltipSignature.current) return;
    activeKey.current = null;
    tooltipSignature.current = '';
    dirty.current = true;
    setTooltip(null);
  }

  function closeSoon() {
    cancelClose();
    closeTimer.current = setTimeout(clearTooltip, 120);
  }

  function positionTooltip() {
    const panel = tooltipRef.current;
    const container = overlayRef.current;
    const entry = frames.current.find(item => item.key === activeKey.current);
    if (!panel || !container || !entry?.screen) return;
    const { width, height } = panel.getBoundingClientRect();
    const left = entry.screen.x + width + 12 <= container.clientWidth ? entry.screen.x + 12 : entry.screen.x - width - 12;
    const top = entry.screen.y >= height + 12 ? entry.screen.y - height - 12 : entry.screen.y + 12;
    panel.style.left = `${Math.max(8, Math.min(left, container.clientWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top, container.clientHeight - height - 8))}px`;
  }

  function refreshTooltip() {
    const state = current.current;
    if (state.playing || !activeKey.current) return;
    const target = frames.current.find(item => item.key === activeKey.current && item.alpha > 0.01);
    if (!target?.screen) { clearTooltip(); return; }
    const overlapping = frames.current.filter(item => item.screen && item.alpha > 0.01
      && Math.hypot(item.screen.x - target.screen.x, item.screen.y - target.screen.y) < 0.5);
    const safeModel = officialPoint(state.model, state.election, state.timeline, state.day) ? state.model
      : { ...state.model, data: (state.model?.data || []).filter(trace => trace.uid !== 'official-result') };
    const rows = (state.timeline?.records || []).map(record => record.row);
    const seen = new Set();
    const items = overlapping.flatMap(item => {
      const point = item.point;
      if (seen.has(point.id)) return [];
      seen.add(point.id);
      if (item.transitioning && !point.actual) {
        const brandEntries = frames.current.filter(entry => entry.point.brandId === point.brandId && entry.transitioning);
        const observed = brandEntries.length ? brandEntries.flatMap(entry => [entry.from, entry.point]) : [point];
        const dates = [...new Set(observed.map(value => formatCalendarDay(value?.row?.poll?.fieldworkStart)).filter(Boolean))].sort();
        return [{ title: point.row.brand || point.id, date: `調查開始 ${dates.length ? dates.join(' → ') : '未知'}`, lines: [] }];
      }
      const result = makeChartTooltip(state.election, safeModel, rows, point.actual ? { actual: true } : { pollId: point.id });
      return result ? [result] : [];
    });
    const signature = JSON.stringify([activeKey.current, items]);
    if (signature !== tooltipSignature.current) {
      tooltipSignature.current = signature;
      setTooltip(items.length ? items : null);
    }
    positionTooltip();
  }

  function showTooltip(key) {
    if (current.current.playing || !key) return;
    cancelClose();
    if (activeKey.current !== key) { activeKey.current = key; dirty.current = true; }
    refreshTooltip();
  }

  function localPoint(event) {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null;
  }

  function hitAt(event) {
    const local = localPoint(event);
    const bounds = geometry(current.current.model, current.current.area, current.current.viewportRef);
    if (!local || !inside(bounds, local.x, local.y)) return null;
    return [...frames.current].reverse().flatMap((entry, order) => {
      if (!entry.screen || entry.alpha <= 0.01 || !inside(bounds, entry.screen.x, entry.screen.y)) return [];
      const distance = Math.hypot(local.x - entry.screen.x, local.y - entry.screen.y);
      const radius = Number.isFinite(entry.point.size) ? entry.point.size / 2 : 9;
      const direct = distance <= radius;
      const threshold = event.pointerType === 'touch' ? 22 : radius + 5;
      return distance <= threshold ? [{ entry, direct, distance, order }] : [];
    }).sort((a, b) => Number(b.direct) - Number(a.direct) || a.distance - b.distance || a.order - b.order)[0]?.entry || null;
  }

  function drawMarker(node, entry, bounds) {
    const { point, screen } = entry;
    const size = Number.isFinite(point.size) && point.size > 0 ? point.size : 18;
    const radius = size / 2;
    const opacity = Number.isFinite(point.opacity) ? Math.max(0, Math.min(1, point.opacity)) : 1;
    const open = String(point.symbol).includes('open');
    const selected = !point.actual && !entry.transitioning && point.id === current.current.selectedId
      && current.current.snapshotIds.has(point.id);
    const visible = inside(bounds, screen.x, screen.y) && entry.alpha > 0.01;
    node.group.setAttribute('transform', `translate(${screen.x} ${screen.y})`);
    node.group.setAttribute('opacity', String(Math.max(0, Math.min(1, entry.alpha))));
    node.group.setAttribute('data-playback-key', entry.key);
    node.group.setAttribute('data-poll-id', point.id);
    node.group.setAttribute('data-testid', point.actual ? 'playback-official-result' : 'playback-poll-point');
    node.group.setAttribute('tabindex', !current.current.playing && visible ? '0' : '-1');
    node.group.setAttribute('aria-label', point.actual ? '大選結果' : `${point.row.brand || point.id}，調查開始 ${formatCalendarDay(point.row.poll.fieldworkStart) || '未知'}`);
    if (activeKey.current === entry.key) node.group.setAttribute('aria-describedby', tooltipId);
    else node.group.removeAttribute('aria-describedby');
    node.focus.setAttribute('r', String(radius + 5));
    node.selected.setAttribute('r', String(radius + 3));
    node.selected.setAttribute('fill', 'none');
    node.selected.setAttribute('stroke', SELECTED_TRAJECTORY_COLOR);
    node.selected.setAttribute('stroke-width', '3');
    node.selected.setAttribute('visibility', selected ? 'visible' : 'hidden');
    node.halo.setAttribute('r', String(radius));
    node.halo.setAttribute('fill', 'none');
    node.halo.setAttribute('stroke', '#fff');
    node.halo.setAttribute('stroke-width', '2.25');
    node.halo.setAttribute('opacity', String(opacity));
    node.halo.setAttribute('visibility', !point.actual && open ? 'visible' : 'hidden');
    node.circle.setAttribute('r', String(radius));
    node.circle.setAttribute('fill', open ? 'none' : point.color || '#3279cb');
    node.circle.setAttribute('stroke', open ? '#3279cb' : point.lineColor || '#fff');
    node.circle.setAttribute('stroke-width', String(Number.isFinite(point.lineWidth) ? point.lineWidth : 0.75));
    node.circle.setAttribute('opacity', String(opacity));
    node.circle.setAttribute('visibility', point.actual ? 'hidden' : 'visible');
    node.star.setAttribute('d', starPath(radius));
    node.star.setAttribute('fill', point.color || '#d65359');
    node.star.setAttribute('stroke', '#fff');
    node.star.setAttribute('stroke-width', '1');
    node.star.setAttribute('opacity', String(opacity));
    node.star.setAttribute('visibility', point.actual ? 'visible' : 'hidden');
    node.text.textContent = point.label || '';
    node.text.setAttribute('fill', open ? '#3279cb' : '#fff');
    node.text.setAttribute('opacity', String(opacity));
    node.text.setAttribute('visibility', !point.actual && current.current.showNames ? 'visible' : 'hidden');
  }

  function paint(bounds) {
    const layer = layerRef.current;
    if (!layer) return;
    const path = shapePath(bounds);
    clipPathRef.current?.setAttribute('d', path);
    hitPathRef.current?.setAttribute('d', path);
    layer.style.visibility = bounds ? 'visible' : 'hidden';
    if (!bounds) { clearTooltip(); return; }
    const next = motionRef.current.frame();
    const official = officialPoint(current.current.model, current.current.election, current.current.timeline, current.current.day);
    if (official) next.push({ key: '__official__', point: official, position: official.position, alpha: 1, transitioning: false, from: null });
    const visibleKeys = new Set();
    frames.current = next.flatMap(entry => {
      const screen = project(entry.position, bounds);
      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return [];
      const painted = { ...entry, screen };
      visibleKeys.add(entry.key);
      let node = markerNodes.current.get(entry.key);
      if (!node) { node = makeMarker(layer); markerNodes.current.set(entry.key, node); }
      drawMarker(node, painted, bounds);
      return [painted];
    });
    for (const [key, node] of markerNodes.current) {
      if (!visibleKeys.has(key)) { node.group.remove(); markerNodes.current.delete(key); }
    }
    if (activeKey.current) refreshTooltip();
  }

  useLayoutEffect(() => {
    const prior = previous.current;
    const reset = !prior || prior.timeline !== timeline || prior.seekVersion !== seekVersion
      || Number.isFinite(position) && Number.isFinite(prior.position) && position < prior.position;
    if (reset) motionRef.current.reset(groups);
    else motionRef.current.update(groups);
    previous.current = { timeline, seekVersion, position };
    if (reset) clearTooltip();
    dirty.current = true;
    reportPending();
  }, [timeline, seekVersion, groups, position]);

  useLayoutEffect(() => {
    dirty.current = true;
    if (playing) clearTooltip();
  }, [playing, area, selectedId, showNames, model]);

  useLayoutEffect(() => { positionTooltip(); }, [tooltip]);

  useEffect(() => {
    let frame = 0;
    let last = null;
    let active = true;
    const tick = time => {
      frame = 0;
      if (!active || document.hidden) { last = null; return; }
      const state = current.current;
      const bounds = geometry(state.model, state.area, state.viewportRef);
      const wasPending = motionRef.current.pending();
      if (bounds && wasPending && last !== null) motionRef.current.advance(playbackElapsed(Math.max(0, time - last), Number.isFinite(state.speed) && state.speed > 0 ? state.speed : 1));
      last = bounds ? time : null;
      const signature = JSON.stringify([bounds?.left, bounds?.right, bounds?.top, bounds?.bottom, bounds?.kind, bounds?.viewport]);
      if (dirty.current || wasPending || signature !== previousGeometry.current) {
        previousGeometry.current = signature;
        dirty.current = false;
        paint(bounds);
      }
      reportPending();
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      last = null;
      if (!document.hidden && active && !frame) frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    if (!document.hidden) frame = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      cancelClose();
      if (notifiedPending.current) {
        notifiedPending.current = false;
        current.current.onMotionStatusChange?.(false);
      }
    };
  }, []);

  useEffect(() => {
    const outside = event => { if (!overlayRef.current?.contains(event.target)) clearTooltip(); };
    const escape = event => { if (event.key === 'Escape') clearTooltip(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, []);

  useEffect(() => {
    const surface = overlayRef.current?.parentElement;
    if (!surface) return;
    let press = null;
    const down = event => {
      if (press) { press.moved = true; return; }
      if (!current.current.playing || event.pointerType === 'mouse' && event.button !== 0) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const move = event => {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 6) press.moved = true;
    };
    const up = event => {
      if (!press || press.id !== event.pointerId) return;
      const start = press;
      press = null;
      if (!start.moved && current.current.playing && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) current.current.onPause?.();
    };
    const cancel = () => { press = null; };
    surface.addEventListener('pointerdown', down, true);
    surface.addEventListener('pointermove', move, true);
    surface.addEventListener('pointerup', up, true);
    surface.addEventListener('pointercancel', cancel, true);
    return () => {
      surface.removeEventListener('pointerdown', down, true);
      surface.removeEventListener('pointermove', move, true);
      surface.removeEventListener('pointerup', up, true);
      surface.removeEventListener('pointercancel', cancel, true);
    };
  }, []);

  const bounds = geometry(model, area, viewportRef);
  const path = shapePath(bounds);
  return <div ref={overlayRef} className="playback-overlay" data-testid="playback-overlay">
    <svg ref={svgRef} role="group" aria-label="民調時間播放圖" onPointerDown={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (pointer.current) { pointer.current.moved = true; return; }
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, playing: current.current.playing };
      if (event.pointerType === 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
    }} onPointerMove={event => {
      if (pointer.current?.id === event.pointerId && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) >= 6) pointer.current.moved = true;
      if (!pointer.current && event.pointerType !== 'touch' && !current.current.playing) {
        const hit = hitAt(event);
        if (hit) showTooltip(hit.key); else closeSoon();
      }
    }} onPointerUp={event => {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      pointer.current = null;
      const local = localPoint(event);
      const valid = !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6
        && local && inside(geometry(current.current.model, current.current.area, current.current.viewportRef), local.x, local.y);
      if (!valid) return;
      if (start.playing) { clearTooltip(); return; }
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        const hit = hitAt(event);
        if (hit) showTooltip(hit.key); else clearTooltip();
      }
    }} onPointerCancel={() => { pointer.current = null; clearTooltip(); }} onPointerLeave={() => { if (!pointer.current) closeSoon(); }}
    onFocus={event => {
      const key = event.target.getAttribute('data-playback-key');
      if (key) showTooltip(key);
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeSoon(); }}
    onKeyDown={event => { if (event.key === 'Escape') clearTooltip(); }}>
      <defs><clipPath id={clipId}><path ref={clipPathRef} d={path} /></clipPath></defs>
      <path ref={hitPathRef} className="playback-overlay-hit" d={path} />
      <g clipPath={`url(#${clipId})`} ref={layerRef} />
    </svg>
    {tooltip && <div ref={tooltipRef} id={tooltipId} className="playback-overlay-tooltip" role="tooltip" onPointerEnter={cancelClose} onPointerLeave={closeSoon}>
      {tooltip.map((item, index) => <section key={`${item.title}-${index}`}><strong>{item.title}</strong>{item.date && <span className="playback-overlay-tooltip-date">{item.date}</span>}{item.lines.map((line, lineIndex) => <span key={lineIndex}>{line}</span>)}</section>)}
    </div>}
  </div>;
}
