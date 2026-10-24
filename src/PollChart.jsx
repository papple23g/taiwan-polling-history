import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChartScatter, Circle, Hand, MouseSimple, Square, Star, WarningCircle } from '@phosphor-icons/react';
import { chartPollPoint, chartRenderTraces, makeChartModel, makeChartTooltip } from './chart-model.mjs';
import { focusViewport, initialViewport, readViewportChange, ternaryWeights, viewportLayout, viewportRelayout, zoomTernary } from './chart-viewport.mjs';
import { CandidateAvatar } from './CandidateAvatar.jsx';
export function PollChart({ election, rows, selectedId, focusRequest, onSelect, onClearSelection }) {
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
  const pointer = useRef(null);
  const callback = useRef(onSelect);
  const clearCallback = useRef(onClearSelection);
  const gesture = useRef(null);
  callback.current = onSelect;
  clearCallback.current = onClearSelection;
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState(null);
  const [outline, setOutline] = useState(null);
  const [plotArea, setPlotArea] = useState(null);
  const model = makeChartModel(election, rows, selectedId);
  const pointChart = ['scatter', 'ternary'].includes(model?.kind);
  const scope = model?.layout?.uirevision || `${election?.id}:${model?.kind}`;
  renderScope.current = scope;
  const missingScoreSelection = rows.some(row => row.poll.id === selectedId && !row.evaluation.eligible && !Number.isFinite(row.evaluation.provisionalMae));
  const options = rows.filter(row => pointChart ? model.pollIds.includes(row.poll.id) : row.evaluation.eligible || Number.isFinite(row.evaluation.provisionalMae));
  const selection = rows.find(row => row.poll.id === model?.selectedId);
  const unplottedSelection = selection && !options.includes(selection);
  const chartLabel = model?.kind === 'scatter'
    ? `${model.winnerName}正規化得票率與平均絕對誤差（MAE） 散點圖。圓點為民調，紅色星號為實際結果，誤差為零。滾輪縮放，拖曳平移，雙擊還原範圍。點圖表底色可取消選取。使用下方選單可用鍵盤選取民調。`
    : model?.kind === 'ternary' ? '三位候選人正規化比例三角圖。圓點為民調，星號為實際結果。滾輪縮放，拖曳平移，雙擊還原完整三角形。點圖表底色可取消選取。使用下方選單可用鍵盤選取民調。'
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
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      inputHandlers.current = {};
      operations.current = operations.current.catch(() => {}).then(() => plotApi.current?.purge(element));
    };
  }, [model?.kind]);
  useEffect(() => {
    let active = true;
    let plot;
    let observer;
    let wheelFrame;
    let selectedHovered = false;
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
        if (target.current === element && renderScope.current === scope && viewport.current.scope === scope) return task();
      });
      operations.current.catch(() => { if (active) setError(true); });
      return operations.current;
    };
    const clearHover = () => { pointHover.current = false; selectedHovered = false; setHover(null); setOutline(null); };
    setHover(null);
    setOutline(null);
    pointHover.current = false;
    setError(false);
    import('plotly.js-dist-min').then(async module => {
      if (!active) return;
      plot = module.default;
      plotApi.current = plot;
      // HTML labels keep multiline text inside its box in scrollable inspectors.
      const htmlTooltip = ['scatter', 'ternary'].includes(model.kind);
      const traces = htmlTooltip ? chartRenderTraces(model).map(trace => ({ ...trace, hovertemplate: null, hoverinfo: 'none' })) : model.data;
      await runPlot(() => {
        if (viewport.current.scope !== scope) viewport.current = { scope, value: initial };
        const layout = viewportLayout(model.layout, viewport.current.value);
        return plot.react(element, [...(model.backgroundData || []), ...traces], { ...layout, autosize: true, height: htmlTooltip ? 385 : 290, paper_bgcolor: '#fff', font: { family: 'Noto Sans TC, Microsoft JhengHei, sans-serif', color: '#526580', size: 11 }, showlegend: false, hovermode: 'closest' }, { responsive: true, displayModeBar: false, scrollZoom: model.kind === 'scatter', doubleClick: htmlTooltip ? false : 'reset+autosize', locale: 'zh-TW' });
      });
      if (!active) return;
      element.removeAllListeners?.('plotly_click');
      element.removeAllListeners?.('plotly_hover');
      element.removeAllListeners?.('plotly_unhover');
      element.removeAllListeners?.('plotly_relayout');
      element.removeAllListeners?.('plotly_relayouting');
      element.removeAllListeners?.('plotly_doubleclick');
      const rememberViewport = change => {
        if (!active) return;
        viewport.current.value = readViewportChange(viewport.current.value, change, initial);
        clearHover();
      };
      element.on('plotly_relayout', rememberViewport);
      element.on('plotly_relayouting', rememberViewport);
      const triangleBounds = () => element.querySelector('.ternarylayer .plotbg > path')?.getBoundingClientRect();
      const updatePlotArea = () => {
        if (!active || !htmlTooltip) return;
        const area = model.kind === 'ternary' ? triangleBounds() : element.querySelector('.nsewdrag')?.getBoundingClientRect();
        if (!area) return;
        const bounds = element.getBoundingClientRect();
        setPlotArea({ scope, left: area.left - bounds.left, right: area.right - bounds.left, top: area.top - bounds.top, bottom: area.bottom - bounds.top, width: bounds.width });
      };
      updatePlotArea();
      let pendingWheel = 0;
      let wheelAnchor;
      const wheel = event => {
        if (model.kind !== 'ternary') return;
        const bounds = triangleBounds();
        const weights = ternaryWeights(bounds, event.clientX, event.clientY);
        if (!weights) return;
        event.preventDefault();
        clearHover();
        pendingWheel += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
        wheelAnchor = weights;
        if (wheelFrame) return;
        wheelFrame = requestAnimationFrame(() => {
          wheelFrame = null;
          const delta = pendingWheel;
          const anchor = wheelAnchor;
          pendingWheel = 0;
          runInput(() => {
            viewport.current.value = zoomTernary(viewport.current.value, anchor, delta);
            return plot.relayout(element, viewportRelayout(viewport.current.value));
          });
        });
      };
      const reset = () => {
        if (!initial || !active) return;
        clearHover();
        runInput(() => { viewport.current.value = initial; return plot.relayout(element, viewportRelayout(initial)); });
      };
      element.on('plotly_doubleclick', reset);
      inputHandlers.current = { wheel, clearFromBackground: event => {
        if (!htmlTooltip) return;
        const bounds = model.kind === 'ternary' ? triangleBounds() : element.querySelector('.nsewdrag')?.getBoundingClientRect();
        const inside = model.kind === 'ternary' ? ternaryWeights(bounds, event.clientX, event.clientY)
          : bounds && event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
        if (!inside) return;
        const hit = [...element.querySelectorAll('.scatterlayer .point')].some(point => {
          const box = point.getBoundingClientRect();
          return box.width > 0 && Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) <= Math.max(box.width, box.height) / 2 + 3;
        });
        if (!hit) { clearHover(); clearCallback.current?.(); }
      } };
      const selectedPointAt = event => {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
        if (model.kind === 'ternary' && !ternaryWeights(triangleBounds(), event.clientX, event.clientY)) return false;
        const point = element.querySelector('.traceselected-poll .point')?.getBoundingClientRect();
        return point?.width > 0 && Math.hypot(event.clientX - point.left - point.width / 2, event.clientY - point.top - point.height / 2) <= point.width / 2;
      };
      const showRegion = event => {
        if (!event) return;
        pointer.current = { clientX: event.clientX, clientY: event.clientY };
        if (selectedPointAt(event)) {
          selectedHovered = true;
          const bounds = element.getBoundingClientRect();
          setOutline(null);
          setHover({ ...makeChartTooltip(election, model, rows, { pollId: model.selectedId }), x: event.clientX - bounds.left, y: event.clientY - bounds.top });
          return;
        }
        if (selectedHovered) { selectedHovered = false; pointHover.current = false; }
        if (!model.regions || pointHover.current) return;
        const bounds = element.getBoundingClientRect();
        const clear = () => { setOutline(null); setHover(null); };
        if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) { clear(); return; }
        const position = new DOMPoint(event.clientX, event.clientY);
        const plotArea = model.kind === 'scatter' ? element.querySelector('.nsewdrag')?.getBoundingClientRect() : triangleBounds();
        if (!plotArea || position.x < plotArea.left || position.x > plotArea.right || position.y < plotArea.top || position.y > plotArea.bottom) { clear(); return; }
        if (model.kind === 'ternary' && !ternaryWeights(plotArea, position.x, position.y)) { clear(); return; }
        const paths = model.kind === 'ternary' ? [...element.querySelectorAll('.ternarylayer path.js-fill')]
          : model.regions.map((_, index) => element.querySelector(`.shapelayer path[data-index="${index}"]`));
        const index = paths.findIndex(path => { const matrix = path?.getScreenCTM(); return matrix && path.isPointInFill(position.matrixTransform(matrix.inverse())); });
        if (index < 0) { clear(); return; }
        const path = paths[index];
        const matrix = path.getScreenCTM();
        let border = { d: path.getAttribute('d'), transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e - bounds.left} ${matrix.f - bounds.top})` };
        if (model.kind === 'scatter') {
          const area = path.getBoundingClientRect();
          const left = Math.max(area.left, plotArea.left) - bounds.left;
          const right = Math.min(area.right, plotArea.right) - bounds.left;
          const top = plotArea.top - bounds.top;
          const bottom = plotArea.bottom - bounds.top;
          border = { d: `M${left},${top}H${right}V${bottom}H${left}Z` };
        } else {
          const left = plotArea.left - bounds.left;
          const top = plotArea.top - bounds.top;
          const right = plotArea.right - bounds.left;
          const bottom = plotArea.bottom - bounds.top;
          border.clip = `M${(left + right) / 2},${top}L${right},${bottom}H${left}Z`;
        }
        const region = model.regions[index];
        setOutline({ ...border, color: region.color });
        setHover({ ...makeChartTooltip(election, model, rows, { regionId: region.id }), x: position.x - bounds.left, y: position.y - bounds.top });
      };
      regionMove.current = showRegion;
      const showTooltip = event => {
        if (!active || !htmlTooltip) return;
        const point = event.points?.[0];
        const selectedHit = selectedPointAt(pointer.current || event.event);
        const contents = makeChartTooltip(election, model, rows, { pollId: selectedHit ? model.selectedId : point?.customdata, actual: !selectedHit && point?.data?.uid === 'official-result' });
        selectedHovered = selectedHit;
        pointHover.current = Boolean(contents);
        setOutline(null);
        const bounds = element.getBoundingClientRect();
        setHover(contents ? { ...contents, x: Number.isFinite(event.event?.clientX) ? event.event.clientX - bounds.left : bounds.width / 2, y: Number.isFinite(event.event?.clientY) ? event.event.clientY - bounds.top : bounds.height / 2 } : null);
      };
      element.on('plotly_click', event => { if (gesture.current && event.points?.length) gesture.current.pointHit = true; const id = selectedPointAt(event.event || pointer.current) ? model.selectedId : event.points?.[0]?.customdata; if (id) callback.current(id); showTooltip(event); });
      if (htmlTooltip) {
        element.on('plotly_hover', showTooltip);
        element.on('plotly_unhover', event => { pointHover.current = false; showRegion(event.event); });
      }
      if (focusRequest && handledFocus.current !== focusRequest) {
        handledFocus.current = focusRequest;
        if (focusRequest.electionId === election.id && focusRequest.pollId === model.selectedId && initial) {
          await runPlot(() => {
            const current = viewport.current.value;
            const next = focusViewport(current, initial, chartPollPoint(model, focusRequest.pollId));
            if (next === current) return;
            viewport.current.value = next;
            return plot.relayout(element, viewportRelayout(next));
          });
        }
      }
      if (!active) return;
      observer = new ResizeObserver(() => { if (active && element.isConnected) { clearHover(); runPlot(async () => { await plot.Plots.resize(element); updatePlotArea(); }); } });
      observer.observe(element);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; regionMove.current = null; observer?.disconnect(); };
  }, [election, rows, selectedId, focusRequest, retry]);
  if (!model || model.kind === 'unavailable') return <div className="chart-empty"><ChartScatter size={34} weight="light" aria-hidden="true" /><strong>{model?.reason || (missingScoreSelection ? '這筆資料缺少可計算的支持度' : election ? '目前沒有足夠資料繪製圖表' : '請先選取一場選舉')}</strong><p>{missingScoreSelection ? '查看來源與備註，確認題目及候選人支持度。' : election ? '大選結果與每筆來源仍可在下方查閱。' : '選取民調後查看候選人比例與實際結果。'}</p></div>;
  return <>
    <div className={'chart-surface' + (pointChart ? ' point-chart' : '')}
      onPointerDownCapture={event => { gesture.current = event.button === 0 ? { x: event.clientX, y: event.clientY, moved: false } : null; }}
      onPointerMoveCapture={event => { if (gesture.current && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) >= 6) gesture.current.moved = true; }}
      onPointerCancel={() => { gesture.current = null; }}
      onClickCapture={event => { const start = gesture.current; gesture.current = null; if (start && !start.moved && !start.pointHit && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) inputHandlers.current.clearFromBackground?.(event); }}
      onMouseMoveCapture={event => regionMove.current?.(event)} onMouseLeave={() => { pointHover.current = false; setHover(null); setOutline(null); }}>
      <div className="plot" ref={target} hidden={error} role="img" aria-label={chartLabel} data-testid="poll-chart" />
      {!error && pointChart && <div className="chart-gesture-hint"><span><MouseSimple size={14} aria-hidden="true" />滾輪放大／縮小</span><span><Hand size={14} aria-hidden="true" />拖曳平移</span></div>}
      {!error && pointChart && plotArea?.scope === scope && <div className="chart-candidates" aria-label="候選人位置">{model.regions.map((candidate, index) => {
        const top = model.kind === 'ternary' && index > 0 ? plotArea.bottom + 4 : plotArea.top - 58;
        const x = model.kind === 'ternary' ? index === 0 ? (plotArea.left + plotArea.right) / 2 : index === 1 ? plotArea.left : plotArea.right : index === 0 ? plotArea.left : plotArea.right;
        return <div key={candidate.id} className="chart-candidate" style={{ left: Math.max(32, Math.min(x, plotArea.width - 32)), top }} title={`${candidate.name} · ${candidate.party}`}><CandidateAvatar candidate={candidate} /><span>{candidate.name}</span></div>;
      })}</div>}
      {!error && outline && <svg className="chart-region-outline" aria-hidden="true">{outline.clip && <defs><clipPath id={clipId}><path d={outline.clip} /></clipPath></defs>}<g clipPath={outline.clip ? `url(#${clipId})` : undefined}><path d={outline.d} transform={outline.transform} fill="none" stroke={outline.color} strokeWidth="1.5" /></g></svg>}
      {!error && hover && <div className="chart-tooltip" ref={tooltip} role="tooltip"><strong>{hover.title}</strong>{hover.date && <span className="chart-tooltip-date">{hover.date}</span>}{hover.lines.map(line => <span key={line}>{line}</span>)}</div>}
    </div>
    {error && <div className="chart-empty" role="alert"><WarningCircle size={28} /><strong>圖表暫時無法載入</strong><p>下方比例表仍可查看完整數值。</p><button className="button" onClick={() => setRetry(value => value + 1)}>重新載入圖表</button></div>}
    {!error && <div className="chart-legend"><span><Circle size={9} weight="fill" />民調</span><span>{model.kind === 'bar' ? <Square size={10} weight="fill" /> : <Star size={12} weight="fill" />}實際結果</span></div>}
    {model.regions && <div className="chart-regions" aria-label="候選人領先區域"><p>淡色底為比較候選人中的領先區域，交界為平手。</p><ul>{model.regions.map(region => <li key={region.id} title={region.party}><i aria-hidden="true" style={{ backgroundColor: region.fill, borderColor: region.color }} />{region.name}</li>)}</ul></div>}
    {pointChart && <p className="chart-note">雙擊還原範圍 · 點表格定位資料點<br />點圖表底色或頁面空白取消選取</p>}
    {model.note && <p className="chart-note" role="status">{model.note}</p>}
    <label className="chart-select">圖表與表格同步選取<select value={model.selectedId} disabled={!options.length} onChange={e => onSelect(e.target.value)}>
      {!model.selectedId && <option value="" disabled>{options.length ? '選取民調' : '沒有可選取的民調'}</option>}
      {unplottedSelection && <option value={selection.poll.id} disabled>{selection.brand} · {selection.poll.fieldworkEnd || '日期未知'} · 無可繪製點</option>}
      {options.map(row => <option key={row.poll.id} value={row.poll.id}>{row.brand} · {row.poll.fieldworkEnd || '日期未知'}</option>)}
    </select></label>
  </>;
}

