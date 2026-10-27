import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChartScatter, Circle, Hand, MouseSimple, Square, Star, WarningCircle } from '@phosphor-icons/react';
import { chartPollPoints, chartRenderTraces, makeChartModel, makeChartTooltip } from './chart-model.mjs';
import { focusViewport, initialViewport, readViewportChange, ternaryWeights, touchViewport, viewportLayout, viewportRelayout, zoomTernary } from './chart-viewport.mjs';
import { CandidateAvatar } from './CandidateAvatar.jsx';
import { candidateScaleGeometry, polygonPath, regionHoverGeometry } from './chart-hover.mjs';
export function PollChart({ election, rows, model: providedModel, selectedId, officialSelected = false, focusRequest, onSelect, onSelectOfficial, onClearSelection }) {
  const target = useRef(null);
  const plotApi = useRef(null);
  const operations = useRef(Promise.resolve());
  const viewport = useRef({ scope: null, value: null });
  const inputHandlers = useRef({});
  const renderScope = useRef(null);
  const handledFocus = useRef(null);
  const clipId = useId();
  const tooltip = useRef(null);
  const regionMove = useRef(null);
  const pointHover = useRef(false);
  const inputPointer = useRef('mouse');
  const pointer = useRef(null);
  const callback = useRef(onSelect);
  const officialCallback = useRef(onSelectOfficial);
  const clearCallback = useRef(onClearSelection);
  const gesture = useRef(null);
  const touchGesture = useRef(null);
  const touchTooltip = useRef(null);
  const lastTouchTap = useRef(null);
  const candidateGuide = useRef(null);
  const guideSync = useRef(null);
  const guidePress = useRef(null);
  callback.current = onSelect;
  officialCallback.current = onSelectOfficial;
  clearCallback.current = onClearSelection;
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState(null);
  const [outline, setOutline] = useState(null);
  const [plotArea, setPlotArea] = useState(null);
  const [guideId, setGuideId] = useState('');
  const [coarsePointer, setCoarsePointer] = useState(() => matchMedia('(any-pointer: coarse)').matches);
  useEffect(() => {
    const media = matchMedia('(any-pointer: coarse)');
    const update = () => setCoarsePointer(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const model = useMemo(() => providedModel ?? makeChartModel(election, rows, selectedId), [providedModel, election, rows, selectedId]);
  const selectionKey = JSON.stringify([officialSelected, model?.selectedId || '']);
  const hasOfficialResult = model?.data?.some(trace => trace.uid === 'official-result') || model?.kind === 'bar' && election?.result?.status === 'verified';
  const pointChart = ['ternary', 'strip'].includes(model?.kind);
  const scope = model?.layout?.uirevision || `${election?.id}:${model?.kind}`;
  const dataScope = model?.layout?.datarevision || scope;
  renderScope.current = dataScope;
  const clearGuide = () => {
    if (!candidateGuide.current) return;
    candidateGuide.current = null;
    setGuideId('');
    guideSync.current?.();
  };
  const activateGuide = (id, mode) => {
    inputHandlers.current.clearHover?.();
    candidateGuide.current = { id, mode, scope, dataScope };
    setGuideId(id);
    guideSync.current?.();
  };
  useLayoutEffect(() => {
    const guide = candidateGuide.current;
    if (guide && (guide.scope !== scope || guide.dataScope !== dataScope || error)) clearGuide();
  }, [scope, dataScope, error]);
  const missingScoreSelection = rows.some(row => row.poll.id === selectedId && !row.evaluation.eligible && !Number.isFinite(row.evaluation.provisionalMae));
  const chartLabel = model?.kind === 'strip' ? `兩人比例一維散點圖。每筆民調一點，同在水平線上；${model.legends[0].name}正規化支持度向右增加。${hasOfficialResult ? '星號為官方結果，橫向距離就是誤差(MAE)，越近越準。' : ''}越接近選舉日越不透明，日期未知或非選前以空心點表示。滾輪或雙指水平縮放，拖曳平移，雙擊還原。重疊點可由表格逐筆選取。` : model?.kind === 'ternary' ? `三位候選人正規化比例三角圖。藍色圓點為民調，白色細框區隔政黨底色。${hasOfficialResult ? '星號為實際結果。' : ''}滾輪或雙指縮放，拖曳平移，雙擊還原完整三角形。手機單點可看提示。${model.regions?.length ? (election.phase === 'pre_result' ? '點支持度領先區另顯示外框。' : '點勝選區另顯示外框。') : ''}點圖表底色可取消選取。表格可用鍵盤逐筆選取。`
      : '候選人民調與實際結果正規化比例對照圖。完整數值列於計算詳情。';
  useLayoutEffect(() => {
    const label = tooltip.current;
    const chart = target.current;
    if (!hover || !label || !chart) return;
    const { width, height } = label.getBoundingClientRect();
    const bounds = chart.getBoundingClientRect();
    const left = hover.x + width + 12 <= bounds.width ? hover.x + 12 : hover.x - width - 12;
    const top = hover.y >= height + 12 ? hover.y - height - 12 : hover.y + 12;
    label.style.left = `${Math.max(8, Math.min(left, bounds.width - width - 8))}px`;
    label.style.top = `${Math.max(8, Math.min(top, bounds.height - height - 8))}px`;
  }, [hover]);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const wheel = event => inputHandlers.current.wheel?.(event);
    const touch = event => inputHandlers.current.touch?.(event);
    const dismissTouchTooltip = event => {
      if (touchTooltip.current && !element.contains(event.target)) inputHandlers.current.clearHover?.();
      if (!element.parentElement.contains(event.target)) clearGuide();
    };
    const dismissGuide = event => {
      if (event.key === 'Escape' && candidateGuide.current) { event.preventDefault(); event.stopPropagation(); clearGuide(); }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) element.addEventListener(type, touch, { capture: true, passive: false });
    document.addEventListener('pointerdown', dismissTouchTooltip, true);
    document.addEventListener('keydown', dismissGuide, true);
    return () => {
      element.removeEventListener('wheel', wheel);
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) element.removeEventListener(type, touch, true);
      document.removeEventListener('pointerdown', dismissTouchTooltip, true);
      document.removeEventListener('keydown', dismissGuide, true);
      touchGesture.current = null;
      touchTooltip.current = null;
      lastTouchTap.current = null;
      inputHandlers.current = {};
      operations.current = operations.current.catch(() => {}).then(() => plotApi.current?.purge(element));
    };
  }, [model?.kind]);
  useEffect(() => {
    let active = true;
    let plot;
    let observer;
    let geometryObserver;
    let geometryFrame;
    let wheelFrame;
    let resizeFrame;
    let touchFrame;
    let pendingTouchViewport;
    let selectedHovered = false;
    let hoveredMarker;
    let hoveredRegion;
    let focusedMarkers = [];
    const finePointer = () => inputPointer.current !== 'touch' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    const element = target.current;
    if (!element || !model || model.kind === 'unavailable') return;
    const initial = initialViewport(model);
    const runPlot = task => {
      operations.current = operations.current.catch(() => {}).then(() => { if (active && element.isConnected) return task(); });
      operations.current.catch(() => { if (active) setError(true); });
      return operations.current;
    };
    // Input remains available while selection redraws wait in the Plotly queue.
    const runInput = task => {
      operations.current = operations.current.catch(() => {}).then(() => {
        if (target.current === element && renderScope.current === dataScope && viewport.current.scope === scope) return task();
      });
      operations.current.catch(() => { if (active) setError(true); });
      return operations.current;
    };
    const decorateMarker = marker => {
      if (marker === hoveredMarker) return;
      hoveredMarker?.classList.remove('chart-point-hover');
      hoveredMarker = marker;
      if (finePointer() && marker) {
        const base = marker.transform.baseVal.numberOfItems ? marker.transform.baseVal.getItem(0).matrix : new DOMMatrix();
        const matrix = new DOMMatrix([base.a, base.b, base.c, base.d, base.e, base.f]);
        // Emphasis retains the marker's actual size and data-point translation.
        element.parentElement.style.setProperty('--marker-hover-transform', matrix.toString());
        marker.classList.add('chart-point-hover');
      }
    };
    const decorateFocus = () => {
      if (!active) return;
      const markers = officialSelected ? [...element.querySelectorAll('.traceofficial-result .point')] : [];
      element.querySelectorAll('.chart-point-focused').forEach(point => { if (!markers.includes(point)) point.classList.remove('chart-point-focused'); });
      focusedMarkers = markers;
      markers.forEach(marker => {
        const base = marker.transform.baseVal.numberOfItems ? marker.transform.baseVal.getItem(0).matrix : new DOMMatrix();
        const matrix = new DOMMatrix([base.a, base.b, base.c, base.d, base.e, base.f]);
        marker.style.setProperty('--marker-focus-transform', matrix.toString());
        marker.classList.add('chart-point-focused');
      });
    };
    const clearRegion = () => {
      if (!hoveredRegion) return;
      const { path, fill, opacity, stroke, strokeOpacity, width, clipPath, clip } = hoveredRegion;
      path.style.fill = fill; path.style.fillOpacity = opacity; path.style.stroke = stroke; path.style.strokeOpacity = strokeOpacity; path.style.strokeWidth = width;
      path.style.clipPath = clipPath;
      clip.remove();
      path.classList.remove('chart-region-raised');
      hoveredRegion = null;
    };
    const clearHover = () => { decorateMarker(null); clearRegion(); pointHover.current = false; selectedHovered = false; touchTooltip.current = null; setHover(null); setOutline(null); };
    let guideGroup;
    let guideSignature;
    const syncGuide = () => {
      if (!active) return;
      const guide = candidateGuide.current;
      const index = model.legends?.findIndex(candidate => candidate.id === guide?.id);
      const background = element.querySelector('.ternarylayer .plotbg');
      const original = background?.querySelector(':scope > path');
      const valid = guide?.scope === scope && guide.dataScope === dataScope && model.kind === 'ternary' && index >= 0 && original;
      element.classList.toggle('chart-candidate-guide-active', Boolean(valid));
      if (!valid) { element.querySelectorAll('.chart-candidate-guide').forEach(group => group.remove()); guideGroup = null; guideSignature = null; return; }
      const box = original.getBBox();
      const geometry = candidateScaleGeometry({ left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height }, viewport.current.value, index);
      if (!geometry) return;
      const color = model.legends[index].color;
      const signature = JSON.stringify([geometry, color, original.getAttribute('d')]);
      if (guideGroup?.isConnected && guideSignature === signature) return;
      if (!guideGroup?.isConnected) {
        background.querySelectorAll('.chart-candidate-guide').forEach(group => group.remove());
        guideGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        guideGroup.setAttribute('class', 'chart-candidate-guide');
        guideGroup.setAttribute('pointer-events', 'none');
        guideGroup.setAttribute('aria-hidden', 'true');
        background.append(guideGroup);
      }
      const svg = (tag, attributes, text) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const gradientId = `${clipId}-candidate-guide`;
      const { gradient } = geometry;
      const fill = svg('linearGradient', { id: gradientId, gradientUnits: 'userSpaceOnUse', x1: gradient.from[0], y1: gradient.from[1], x2: gradient.to[0], y2: gradient.to[1] });
      fill.append(svg('stop', { offset: 0, 'stop-color': color, 'stop-opacity': gradient.startOpacity }), svg('stop', { offset: 1, 'stop-color': color, 'stop-opacity': gradient.endOpacity }));
      const definitions = svg('defs', {});
      definitions.append(fill);
      const nodes = [definitions, svg('path', { class: 'chart-guide-background', d: original.getAttribute('d'), fill: `url(#${gradientId})` })];
      for (const tick of geometry.ticks) {
        const [start, end] = tick.points;
        nodes.push(svg('line', { class: 'chart-guide-line', x1: start[0], y1: start[1], x2: end[0], y2: end[1] }));
        for (const label of tick.labels) {
          if (label.point) nodes.push(svg('line', { class: 'chart-guide-tick', x1: label.point[0], y1: label.point[1], x2: label.end[0], y2: label.end[1] }));
          nodes.push(svg('text', { class: 'chart-guide-label', x: label.x, y: label.y, 'text-anchor': label.anchor, 'dominant-baseline': 'middle' }, tick.label));
        }
      }
      guideGroup.replaceChildren(...nodes);
      guideSignature = signature;
    };
    guideSync.current = syncGuide;
    if (touchTooltip.current?.scope !== dataScope || touchTooltip.current?.selectionKey !== selectionKey) touchTooltip.current = null;
    if (touchGesture.current?.scope !== dataScope) touchGesture.current = null;
    setHover(touchTooltip.current);
    setOutline(null);
    pointHover.current = false;
    setError(false);
    import('plotly.js-dist-min').then(async module => {
      if (!active) return;
      plot = module.default;
      plotApi.current = plot;
      // HTML labels stay within the chart when its workspace scrolls.
      const htmlTooltip = pointChart;
      const traces = htmlTooltip ? chartRenderTraces(model, { touch: coarsePointer }).map(trace => ({ ...trace, hovertemplate: null, hoverinfo: 'none' })) : model.data;
      const decorateOpenPoints = () => traces.forEach(trace => {
        element.querySelectorAll(`.trace${CSS.escape(trace.uid || '')} .point`).forEach((point, index) => {
          point.classList.toggle('chart-point-open', trace.marker?.symbol?.[index] === 'circle-open');
        });
      });
      const decorateSelectedPoint = () => {
        element.querySelectorAll('.chart-selection-halo').forEach(halo => halo.remove());
        const point = element.querySelector('.tracepolls-selected .point');
        if (!point) return;
        const halo = point.cloneNode(false);
        halo.setAttribute('class', 'chart-selection-halo');
        halo.removeAttribute('style');
        halo.setAttribute('aria-hidden', 'true');
        point.before(halo);
      };
      const chartHeight = () => Math.max(385, element.parentElement.clientHeight);
      await runPlot(() => {
        if (viewport.current.scope !== scope) viewport.current = { scope, value: initial };
        const layout = viewportLayout(model.layout, viewport.current.value);
        // Selection moves points between traces even when their coordinates do not change.
        return plot.react(element, [...(model.backgroundData || []), ...traces], { ...layout, datarevision: JSON.stringify([layout.datarevision, selectionKey]), autosize: false, width: Math.max(1, element.parentElement.clientWidth), height: chartHeight(), paper_bgcolor: '#fff', font: { family: 'Noto Sans TC, Microsoft JhengHei, sans-serif', color: '#526580', size: 11 }, showlegend: false, hovermode: 'closest' }, { responsive: false, displayModeBar: false, scrollZoom: false, doubleClick: htmlTooltip ? false : 'reset+autosize', locale: 'zh-TW' });
      });
      if (!active) return;
      decorateOpenPoints(); decorateFocus(); decorateSelectedPoint();
      element.removeAllListeners?.('plotly_click');
      element.removeAllListeners?.('plotly_hover');
      element.removeAllListeners?.('plotly_unhover');
      element.removeAllListeners?.('plotly_relayout');
      element.removeAllListeners?.('plotly_relayouting');
      element.removeAllListeners?.('plotly_afterplot');
      const rememberViewport = change => {
        if (!active) return;
        viewport.current.value = readViewportChange(viewport.current.value, change, initial);
        clearHover();
        clearGuide();
      };
      element.on('plotly_relayout', rememberViewport);
      element.on('plotly_relayouting', rememberViewport);
      const triangleBounds = () => element.querySelector('.ternarylayer .plotbg > path')?.getBoundingClientRect();
      const plotBounds = () => model.kind === 'ternary' ? triangleBounds() : element.querySelector('.nsewdrag')?.getBoundingClientRect();
      const insidePlot = (bounds, x, y) => model.kind === 'ternary' ? Boolean(ternaryWeights(bounds, x, y))
        : bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      const regionPaths = () => !model.regions?.length ? [] : model.kind === 'ternary' ? [...element.querySelectorAll('.ternarylayer path.js-fill')]
        : model.regions.map((_, index) => element.querySelector(`.shapelayer path[data-index="${index}"]`));
      const regionIndexAt = event => {
        const position = new DOMPoint(event.clientX, event.clientY);
        return regionPaths().findIndex(path => { const matrix = path?.getScreenCTM(); return matrix && path.isPointInFill(position.matrixTransform(matrix.inverse())); });
      };
      const updatePlotArea = () => {
        if (!active || !htmlTooltip) return;
        const area = model.kind === 'ternary' ? triangleBounds() : element.querySelector('.nsewdrag')?.getBoundingClientRect();
        if (!area) return;
        const bounds = element.getBoundingClientRect();
        const next = { scope, left: area.left - bounds.left, right: area.right - bounds.left, top: area.top - bounds.top, bottom: area.bottom - bounds.top, width: bounds.width };
        setPlotArea(previous => previous && Object.keys(next).every(key => previous[key] === next[key]) ? previous : next);
      };
      geometryObserver = new MutationObserver(() => {
        if (geometryFrame) return;
        geometryFrame = requestAnimationFrame(() => { geometryFrame = null; updatePlotArea(); });
      });
      geometryObserver.observe(element, { attributes: true, childList: true, subtree: true, attributeFilter: ['d', 'transform', 'width', 'height', 'style'] });
      element.on('plotly_afterplot', () => { decorateOpenPoints(); decorateFocus(); decorateSelectedPoint(); syncGuide(); requestAnimationFrame(updatePlotArea); });
      updatePlotArea();
      syncGuide();
      let pendingWheel = 0;
      let wheelAnchor;
      const wheel = event => {
        if (!['ternary', 'strip'].includes(model.kind)) return;
        const bounds = plotBounds();
        if (!insidePlot(bounds, event.clientX, event.clientY)) return;
        event.preventDefault();
        clearHover();
        clearGuide();
        pendingWheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
        wheelAnchor = model.kind === 'ternary' ? ternaryWeights(bounds, event.clientX, event.clientY) : { bounds, x: event.clientX, y: event.clientY };
        if (wheelFrame) return;
        wheelFrame = requestAnimationFrame(() => {
          wheelFrame = null;
          const delta = pendingWheel;
          const anchor = wheelAnchor;
          pendingWheel = 0;
          runInput(() => {
            viewport.current.value = model.kind === 'ternary' ? zoomTernary(viewport.current.value, anchor, delta)
              : touchViewport(viewport.current.value, anchor.bounds, { ...anchor, distance: 1 }, { ...anchor, distance: Math.exp(-Math.max(-240, Math.min(240, delta)) / 1000) });
            return plot.relayout(element, viewportRelayout(viewport.current.value));
          });
        });
      };
      const reset = () => {
        if (!initial || renderScope.current !== dataScope) return;
        clearHover();
        clearGuide();
        runInput(() => { viewport.current.value = initial; return plot.relayout(element, viewportRelayout(initial)); });
      };
      const markerMatrix = marker => {
        const parent = marker?.parentNode.getScreenCTM();
        return parent && (marker.transform.baseVal.numberOfItems ? parent.multiply(marker.transform.baseVal.getItem(0).matrix) : parent);
      };
      const markerBox = marker => {
        const matrix = markerMatrix(marker);
        if (!matrix) return null;
        const box = marker.getBBox();
        const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
        const left = Math.min(...corners.map(point => point.x));
        const top = Math.min(...corners.map(point => point.y));
        const center = new DOMPoint(0, 0).matrixTransform(matrix);
        return { left, top, centerX: center.x, centerY: center.y, width: Math.max(...corners.map(point => point.x)) - left, height: Math.max(...corners.map(point => point.y)) - top };
      };
      inputHandlers.current = { wheel: event => { clearHover(); wheel(event); }, clearHover,
        reset: event => { if (insidePlot(plotBounds(), event.clientX, event.clientY)) reset(); }, clearFromBackground: event => {
        if (!htmlTooltip) return;
        const hit = pointHitsAt(event, 4)[0];
        if (hit) {
          if (hit.actual) officialCallback.current?.();
          else if (hit.pollId) callback.current(hit.pollId, false, { openDetails: false });
          event.stopPropagation();
          return;
        }
        const bounds = model.kind === 'ternary' ? triangleBounds() : element.querySelector('.nsewdrag')?.getBoundingClientRect();
        const inside = model.kind === 'ternary' ? ternaryWeights(bounds, event.clientX, event.clientY)
          : bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        if (!inside) { clearGuide(); return; }
        clearGuide(); clearHover(); clearCallback.current?.();
      } };
      const selectedPointAt = event => {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
        if (model.kind === 'ternary' && !ternaryWeights(triangleBounds(), event.clientX, event.clientY)) return false;
        const hit = pointHitsAt(event, 0)[0];
        return hit?.selected ? hit : null;
      };
      const tracePoints = uid => element.querySelectorAll(`.trace${CSS.escape(uid)} .point`);
      const markerForHit = hit => hit && tracePoints(hit.traceUid)[hit.pointIndex];
      const plotlyHit = point => {
        if (!point?.data?.uid) return null;
        const pointIndex = point.pointNumber ?? point.pointIndex;
        return { pollId: point.customdata, actual: point.data.uid === 'official-result', traceUid: point.data.uid, pointIndex, candidateId: point.data.candidateIds?.[pointIndex] };
      };
      const pointHitsAt = (event, padding = 5, minimumRadius = 0) => {
        if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return [];
        return traces.flatMap(trace => [...tracePoints(trace.uid)].flatMap((point, index) => {
          const box = markerBox(point);
          if (!box?.width) return [];
          const distance = Math.hypot(event.clientX - box.centerX, event.clientY - box.centerY);
          const direct = point.isPointInFill(new DOMPoint(event.clientX, event.clientY).matrixTransform(markerMatrix(point).inverse()));
          return direct || distance <= Math.max(Math.max(box.width, box.height) / 2 + padding, minimumRadius) ? [{ pollId: trace.customdata?.[index], actual: trace.uid === 'official-result', traceUid: trace.uid, pointIndex: index, candidateId: trace.candidateIds?.[index], selected: trace.uid === 'selected-poll' || trace.uid.endsWith('-selected') || officialSelected && trace.uid === 'official-result', direct, distance }] : [];
        })).reverse().sort((a, b) => Number(b.direct) - Number(a.direct) || a.distance - b.distance || Number(b.selected) - Number(a.selected));
      };
      const touchTap = event => {
        const hit = pointHitsAt(event, 0, 22)[0];
        if (!hit && !insidePlot(plotBounds(), event.clientX, event.clientY)) return;
        if (!hit && candidateGuide.current) { clearGuide(); clearHover(); clearCallback.current?.(); return; }
        const regionId = !hit ? model.regions?.[regionIndexAt(event)]?.id : null;
        const tapTarget = JSON.stringify(hit?.actual ? ['official', hit.candidateId] : hit?.pollId ? ['poll', hit.pollId, hit.candidateId] : ['region', regionId]);
        const previous = lastTouchTap.current;
        const now = performance.now();
        if (previous?.scope === dataScope && previous.target === tapTarget && now - previous.time < 300 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 20) {
          lastTouchTap.current = null;
          reset();
          return;
        }
        lastTouchTap.current = { scope: dataScope, target: tapTarget, time: now, x: event.clientX, y: event.clientY };
        const contents = makeChartTooltip(election, model, rows, hit || { regionId });
        if (!contents) { clearCallback.current?.(); return; }
        const bounds = element.getBoundingClientRect();
        const next = { ...contents, scope: dataScope, regionId, selectionKey: JSON.stringify([Boolean(hit?.actual), hit?.actual ? '' : hit?.pollId || '']), x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        touchTooltip.current = next;
        setHover(next);
        if (hit?.actual) officialCallback.current?.();
        else if (hit?.pollId) callback.current(hit.pollId, false, { openDetails: false });
        else if (regionId) {
          drawRegion(model.regions.findIndex(region => region.id === regionId));
          clearCallback.current?.();
        }
      };
      const touchSample = touches => {
        const points = [...touches].sort((a, b) => a.identifier - b.identifier);
        if (!points.length || points.length > 2) return null;
        return { x: points.reduce((value, point) => value + point.clientX, 0) / points.length, y: points.reduce((value, point) => value + point.clientY, 0) / points.length,
          distance: points.length === 2 ? Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY) : 0,
          ids: points.map(point => point.identifier).join(':') };
      };
      const scheduleTouchViewport = value => {
        pendingTouchViewport = value;
        if (touchFrame) return;
        touchFrame = requestAnimationFrame(() => {
          touchFrame = null;
          const next = pendingTouchViewport;
          runInput(() => { viewport.current.value = next; return plot.relayout(element, viewportRelayout(next)); });
        });
      };
      inputHandlers.current.touch = event => {
        if (!htmlTooltip) return;
        const sample = touchSample(event.touches);
        let state = touchGesture.current;
        if (!state) {
          if (event.type !== 'touchstart' || !sample || !insidePlot(plotBounds(), sample.x, sample.y) && !pointHitsAt({ clientX: sample.x, clientY: sample.y }, 0, 22).length) return;
          state = { scope: dataScope, bounds: plotBounds(), viewport: viewport.current.value, value: viewport.current.value, start: sample, tap: sample, moved: sample.distance > 0 };
          touchGesture.current = state;
        }
        // Plotly tracks one changed touch as a mouse drag; own the entire touch sequence to avoid competing updates.
        event.preventDefault();
        event.stopPropagation();
        inputPointer.current = 'touch';
        clearHover();
        gesture.current = { moved: true, touchHandled: true };
        if (event.type === 'touchcancel') { clearGuide(); touchGesture.current = null; lastTouchTap.current = null; return; }
        if (sample?.distance > 0) clearGuide();
        if (!event.touches.length) {
          touchGesture.current = null;
          const end = event.changedTouches[0];
          if (!state.moved && end && Math.hypot(end.clientX - state.tap.x, end.clientY - state.tap.y) < 6) touchTap(end);
          else lastTouchTap.current = null;
          return;
        }
        if (!sample || sample.ids !== state.start?.ids) {
          clearGuide();
          state.moved = true;
          state.start = sample;
          state.viewport = state.value;
          return;
        }
        if (event.type !== 'touchmove') return;
        if (Math.hypot(sample.x - state.tap.x, sample.y - state.tap.y) >= 6 || sample.distance > 0) state.moved = true;
        if (!state.moved) return;
        clearGuide();
        state.value = touchViewport(state.viewport, state.bounds, state.start, sample);
        scheduleTouchViewport(state.value);
      };
      const drawRegion = index => {
        if (candidateGuide.current) return false;
        const bounds = element.getBoundingClientRect();
        const plotArea = plotBounds();
        const paths = regionPaths();
        const path = paths[index];
        const region = model.regions?.[index];
        if (!plotArea || !path || !region) { clearRegion(); setOutline(null); return false; }
        if (hoveredRegion?.path !== path) {
          clearRegion(); decorateMarker(null);
          const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
          clip.id = `${clipId}-region`;
          clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
          const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          shape.setAttribute('d', path.getAttribute('d'));
          clip.append(shape);
          path.parentNode.append(clip);
          const markerMask = [...element.querySelectorAll('.scatterlayer .point')].map(point => {
            const box = point.getBoundingClientRect();
            if (!box.width || box.right < bounds.left || box.left > bounds.right || box.bottom < bounds.top || box.top > bounds.bottom) return '';
            const left = box.left - bounds.left - 2;
            const right = box.right - bounds.left + 2;
            const top = box.top - bounds.top - 2;
            const bottom = box.bottom - bounds.top + 2;
            return polygonPath([[left, top], [right, top], [right, bottom], [left, bottom]]);
          }).join('');
          hoveredRegion = { path, fill: path.style.fill, opacity: path.style.fillOpacity, stroke: path.style.stroke, strokeOpacity: path.style.strokeOpacity, width: path.style.strokeWidth, clipPath: path.style.clipPath, clip, markerMask };
          path.classList.add('chart-region-raised');
          path.style.fill = region.regionColor;
          path.style.fillOpacity = '0.32';
          path.style.stroke = region.regionColor;
          path.style.strokeOpacity = '1';
          path.style.strokeWidth = '2px';
          path.style.clipPath = `url(#${clip.id})`;
        }
        const area = { left: plotArea.left - bounds.left, right: plotArea.right - bounds.left, top: plotArea.top - bounds.top, bottom: plotArea.bottom - bounds.top };
        const geometry = regionHoverGeometry(model.kind, area, viewport.current.value, index);
        setOutline(geometry ? { ...geometry, color: region.regionColor, fill: model.kind === 'strip' ? 'none' : region.hoverFill, markerMask: hoveredRegion.markerMask } : null);
        return true;
      };
      const showRegion = event => {
        if (!event || !finePointer()) return;
        if (event.buttons || gesture.current?.moved && !gesture.current.released) { clearHover(); return; }
        touchTooltip.current = null;
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
        const selectedHit = selectedPointAt(event);
        if (selectedHit) {
          selectedHovered = true;
          decorateMarker(markerForHit(selectedHit));
          clearRegion();
          const bounds = element.getBoundingClientRect();
          setOutline(null);
          setHover({ ...makeChartTooltip(election, model, rows, selectedHit), x: event.clientX - bounds.left, y: event.clientY - bounds.top });
          return;
        }
        if (selectedHovered) { selectedHovered = false; pointHover.current = false; }
        if (pointHover.current) return;
        if (candidateGuide.current) return;
        if (!model.regions?.length) { clearHover(); return; }
        const plotArea = plotBounds();
        if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) || !insidePlot(plotArea, event.clientX, event.clientY)) { clearHover(); return; }
        const index = regionIndexAt(event);
        if (!drawRegion(index)) { clearHover(); return; }
        const bounds = element.getBoundingClientRect();
        setHover({ ...makeChartTooltip(election, model, rows, { regionId: model.regions[index].id }), x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      };
      regionMove.current = showRegion;
      const showTooltip = event => {
        if (!active || !htmlTooltip || !finePointer() || gesture.current?.moved && !gesture.current.released) return;
        const point = event.points?.[0];
        const selectedHit = selectedPointAt(pointer.current || event.event);
        const hit = selectedHit || pointHitsAt(pointer.current || event.event, 0)[0];
        const contents = makeChartTooltip(election, model, rows, hit || plotlyHit(point) || {});
        selectedHovered = Boolean(selectedHit);
        pointHover.current = Boolean(contents);
        clearRegion();
        decorateMarker(contents ? markerForHit(hit || plotlyHit(point)) : null);
        setOutline(null);
        const bounds = element.getBoundingClientRect();
        setHover(contents ? { ...contents, x: Number.isFinite(event.event?.clientX) ? event.event.clientX - bounds.left : bounds.width / 2, y: Number.isFinite(event.event?.clientY) ? event.event.clientY - bounds.top : bounds.height / 2 } : null);
      };
      element.on('plotly_click', event => {
        if (gesture.current?.moved) return;
        const point = event.points?.[0];
        const position = event.event || pointer.current;
        const hit = pointHitsAt(position, 4)[0] || (!position ? plotlyHit(point) : null);
        if (gesture.current) gesture.current.pointHit = Boolean(hit);
        if (!hit) { clearGuide(); clearHover(); clearCallback.current?.(); return; }
        if (hit.actual) officialCallback.current?.();
        else if (hit.pollId) callback.current(hit.pollId, false, { openDetails: false });
        showTooltip(event);
      });
      if (htmlTooltip) {
        element.on('plotly_hover', showTooltip);
        element.on('plotly_unhover', event => { decorateMarker(null); pointHover.current = false; if (event.event) showRegion(event.event); else clearHover(); });
      }
      if (focusRequest && handledFocus.current !== focusRequest) {
        const matchesSelection = focusRequest.kind === 'official' ? officialSelected : focusRequest.pollId === model.selectedId;
        if (focusRequest.electionId === election.id && matchesSelection && initial) {
          await runPlot(() => {
            const current = viewport.current.value;
            const next = focusViewport(current, initial, chartPollPoints(model, focusRequest.pollId, focusRequest.kind === 'official'));
            if (next === current) return;
            viewport.current.value = next;
            return plot.relayout(element, viewportRelayout(next));
          });
          if (active) handledFocus.current = focusRequest;
        }
      }
      if (!active) return;
      if (touchTooltip.current?.regionId) drawRegion(model.regions.findIndex(region => region.id === touchTooltip.current.regionId));
      let previousSize = `${element.parentElement.clientWidth}:${chartHeight()}`;
      observer = new ResizeObserver(() => {
        if (!active || !element.isConnected || resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null;
          if (!element.parentElement.clientWidth) return;
          updatePlotArea();
          const height = chartHeight();
          const size = `${element.parentElement.clientWidth}:${height}`;
          if (size === previousSize) return;
          previousSize = size;
          clearHover();
          clearGuide();
          runPlot(async () => { await plot.relayout(element, { width: element.parentElement.clientWidth, height, ...(viewport.current.value ? viewportRelayout(viewport.current.value) : {}) }); requestAnimationFrame(updatePlotArea); });
        });
      });
      observer.observe(element.parentElement);
      const svgContainer = element.querySelector('.svg-container');
      if (svgContainer) observer.observe(svgContainer);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; decorateMarker(null); focusedMarkers.forEach(marker => marker.classList.remove('chart-point-focused')); clearRegion(); guideGroup?.remove(); element.classList.remove('chart-candidate-guide-active'); if (guideSync.current === syncGuide) guideSync.current = null; regionMove.current = null; observer?.disconnect(); geometryObserver?.disconnect(); if (resizeFrame) cancelAnimationFrame(resizeFrame); if (geometryFrame) cancelAnimationFrame(geometryFrame); if (touchFrame) cancelAnimationFrame(touchFrame); };
  }, [election, rows, model, selectedId, officialSelected, focusRequest, retry, coarsePointer]);
  if (!model || model.kind === 'unavailable') return <div className="chart-empty"><ChartScatter size={34} weight="light" aria-hidden="true" /><strong>{model?.reason || (missingScoreSelection ? '這筆資料缺少可計算的支持度' : election ? '目前沒有足夠資料繪製圖表' : '請先選取一場選舉')}</strong><p>{missingScoreSelection ? '查看來源與備註，確認題目及候選人支持度。' : election ? '大選結果與每筆來源仍可由表格的「詳情」查閱。' : '選取民調後查看候選人比例與實際結果。'}</p></div>;
  return <>
    {!error && model.kind === 'strip' && <div className="chart-binary-candidates" aria-label="候選人圖例">{[...model.legends].reverse().map(item => <span key={item.id} className="chart-candidate-legend"><CandidateAvatar candidate={item} />{item.name}</span>)}</div>}
    <div className={'chart-surface' + (pointChart ? ' point-chart' : '') + (model.kind === 'strip' ? ' strip-chart' : '') + (model.kind === 'ternary' ? ' ternary-chart' : '')}
      onPointerDownCapture={event => { inputPointer.current = event.pointerType || 'mouse'; if (event.target.closest('.chart-candidate')) { gesture.current = null; return; } inputHandlers.current.clearHover?.(); gesture.current = event.button === 0 ? { x: event.clientX, y: event.clientY, moved: false } : null; }}
      onPointerMoveCapture={event => {
        inputPointer.current = event.pointerType || inputPointer.current;
        if (guidePress.current && event.buttons && Math.hypot(event.clientX - guidePress.current.x, event.clientY - guidePress.current.y) >= 6) { guidePress.current.moved = true; clearGuide(); }
        if (gesture.current && !event.buttons) gesture.current.released = true;
        if (gesture.current && !gesture.current.released && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) >= 6) { gesture.current.moved = true; clearGuide(); }
      }}
      onPointerUpCapture={() => { if (gesture.current) gesture.current.released = true; }}
      onPointerCancel={() => { gesture.current = null; guidePress.current = { moved: true }; clearGuide(); }}
      onClickCapture={event => {
        if (event.target.closest('.chart-candidate')) return;
        const start = gesture.current;
        gesture.current = null;
        if (start?.touchHandled) { event.stopPropagation(); return; }
        // Plotly suppresses native dblclick; the second click still carries the browser's click count.
        if (event.detail === 2 && !start?.moved) { inputHandlers.current.reset?.(event); return; }
        if (start && !start.moved && !start.pointHit && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) inputHandlers.current.clearFromBackground?.(event);
      }}
      onMouseMoveCapture={event => { if (!event.target.closest('.chart-candidate')) regionMove.current?.(event); }} onMouseLeave={() => { if (!touchTooltip.current) inputHandlers.current.clearHover?.(); }}>
      <div className="plot" ref={target} hidden={error} role="img" aria-label={chartLabel + (model.kind === 'ternary' ? '越接近選舉日越不透明，日期未知或非選前以空心點表示。選取與滑過保留點的大小及深淺。' : '')} data-testid="poll-chart" />
      {!error && pointChart && <div className="chart-gesture-hint"><span className="chart-mouse-hint"><MouseSimple size={14} aria-hidden="true" />滾輪放大／縮小</span><span className="chart-touch-hint"><Hand size={14} aria-hidden="true" />雙指縮放 · 單點看提示</span><span><Hand size={14} aria-hidden="true" />拖曳平移</span></div>}
      {!error && model.kind === 'ternary' && model.legends?.length > 0 && plotArea?.scope === scope && <div className="chart-candidates" aria-label="候選人位置">{model.legends.map((candidate, index) => {
        const top = model.kind === 'ternary' && index > 0 ? plotArea.bottom + 10 : plotArea.top - 70;
        const x = model.kind === 'ternary' ? index === 0 ? (plotArea.left + plotArea.right) / 2 : index === 1 ? plotArea.left : plotArea.right : index === 0 ? plotArea.left : plotArea.right;
        return <button key={candidate.id} type="button" className="chart-candidate" style={{ left: Math.max(32, Math.min(x, plotArea.width - 32)), top, '--candidate-color': candidate.color }} title={`${candidate.name} · ${candidate.party}`}
          aria-label={`查看${candidate.name}的正規化支持度刻度`} aria-pressed={guideId === candidate.id} aria-describedby={`${clipId}-guide-help`}
          onPointerEnter={event => { if (event.pointerType === 'mouse' && !event.buttons) activateGuide(candidate.id, 'pointer'); }}
          onPointerLeave={() => { if (candidateGuide.current?.id === candidate.id && candidateGuide.current.mode === 'pointer') clearGuide(); }}
          onPointerDown={event => { guidePress.current = { x: event.clientX, y: event.clientY, moved: false }; }}
          onFocus={event => { if (event.target.matches(':focus-visible')) activateGuide(candidate.id, 'keyboard'); }}
          onBlur={() => { if (candidateGuide.current?.id === candidate.id && candidateGuide.current.mode === 'keyboard') clearGuide(); }}
          onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (candidateGuide.current?.id === candidate.id) clearGuide(); else activateGuide(candidate.id, 'keyboard'); } }}
          onClick={event => {
            event.stopPropagation();
            if (guidePress.current?.moved) return;
            guidePress.current = null;
            if (inputPointer.current === 'touch' || inputPointer.current === 'pen' || event.detail === 0) {
              if (candidateGuide.current?.id === candidate.id) clearGuide(); else activateGuide(candidate.id, event.detail === 0 ? 'keyboard' : 'touch');
            }
          }}><CandidateAvatar candidate={candidate} /><span>{candidate.name}</span></button>;
      })}</div>}
      {!error && outline && <svg className="chart-region-effect" aria-hidden="true"><defs><mask id={clipId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect width="100%" height="100%" fill="white" /><path d={outline.clip} fill="black" /><path d={outline.markerMask} fill="black" /></mask></defs><g mask={`url(#${clipId})`}><path d={outline.d} fill={outline.fill} stroke={outline.color} strokeWidth="1.5" /></g></svg>}
      {!error && hover && <div className="chart-tooltip" ref={tooltip} role="tooltip"><strong>{hover.title}</strong>{hover.date && <span className="chart-tooltip-date">{hover.date}</span>}{hover.lines.map(line => <span key={line}>{line}</span>)}</div>}
    </div>
    {error && <div className="chart-empty" role="alert"><WarningCircle size={28} /><strong>圖表暫時無法載入</strong><p>比例表仍可查看完整數值。</p><button className="button" onClick={() => setRetry(value => value + 1)}>重新載入圖表</button></div>}
    <div className="chart-controls">
    {!error && <div className="chart-legend"><span className="chart-poll-legend"><Circle size={9} weight="fill" />民調</span>{hasOfficialResult && <span className="chart-result-legend">{model.kind === 'bar' ? <Square size={10} weight="fill" /> : <Star size={12} weight="fill" />}實際結果</span>}</div>}
    {!error && model.ageLegend && <div className="chart-legend chart-age-legend" aria-label="民調日期深淺圖例"><span>選前天數</span>{model.ageLegend.map(step => <span key={step.label}><i aria-hidden="true" style={{ opacity: step.opacity }} />{step.label}</span>)}<span><i className="unknown-date" aria-hidden="true" />日期未知／非選前</span></div>}
    {!error && model.kind === 'ternary' && <p className="chart-guide-hint" id={`${clipId}-guide-help`}>指向或點按頭像，查看支持度刻度<span className="sr-only">。亦可用鍵盤聚焦頭像，按 Escape 關閉。背景越深表示該候選人的正規化支持度越高，同一條輔助線上的支持度相同。</span></p>}
    {model.note && <p className="chart-note" role="status">{model.note}</p>}
    </div>
  </>;
}

