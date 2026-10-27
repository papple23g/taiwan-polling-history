import { calendarDay, normalizeDistribution } from './domain.mjs';
import { officialResultSummary } from './result-model.mjs';

const POLL_AGE_STEPS = [
  { days: 7, opacity: 1, label: '1–7 天' },
  { days: 14, opacity: 0.8, label: '8–14 天' },
  { days: 30, opacity: 0.6, label: '15–30 天' },
  { days: Infinity, opacity: 0.4, label: '超過 30 天' },
];

export function makeChartModel(election, rows, selectedId) {
  if (!election) return null;
  const comparisonIds = election.comparisonCandidateIds || election.candidates.map(candidate => candidate.id);
  if (election.phase === 'pre_result') {
    if (!Array.isArray(election.comparisonCandidateIds) || comparisonIds.length !== 2 || new Set(comparisonIds).size !== 2 || comparisonIds.some(id => !election.candidates.some(candidate => candidate.id === id))) return { kind: 'unavailable', reason: '選前圖需要明確指定兩位主要比較候選人。' };
    if (comparisonIds.length === 2) {
      const third = thresholdCandidate(election, comparisonIds, rows);
      return third ? makePreResultTernary(election, [...comparisonIds, third.id], rows, selectedId)
        : makeOneDimensionalChart(election, comparisonIds, rows, selectedId);
    }
  }
  if (comparisonIds.length === 2) return makeOneDimensionalChart(election, comparisonIds, rows, selectedId);
  const selected = rows.find(r => r.poll.id === selectedId);
  const calculable = rows.filter(r => r.evaluation.eligible || Number.isFinite(r.evaluation.provisionalMae));
  const ids = comparisonIds.length === 3 || !selected ? comparisonIds : selected.evaluation.candidateIds;
  const names = ids.map(id => election.candidates.find(c => c.id === id)?.name || id);
  const official = officialResultSummary(election);
  const normalized = official.complete && normalizeDistribution(official.rawPercent, ids);
  const result = normalized?.ok ? normalized.values : null;
  const color = '#3279cb';
  if (ids.length === 3) {
    if (election.result?.status !== 'verified' || !result) return { kind: 'unavailable', reason: '官方票數資料不足，無法繪製目前候選人集合的結果。' };
    const points = calculable.filter(r => r.evaluation.candidateIds?.length === 3
      && ids.every(id => r.evaluation.candidateIds.includes(id) && Number.isFinite(r.evaluation.pollNormalized?.[id])));
    const regions = candidateRegions(election, ids);
    const backgroundData = ternaryBackground(regions);
    const shares = names.map((name, index) => `${name}：%{${['a', 'b', 'c'][index]}:.2f}%`).join('<br>');
    const data = [{ uid: 'polls', type: 'scatterternary', mode: 'markers', name: '民調',
      a: points.map(r => r.evaluation.pollNormalized[ids[0]]), b: points.map(r => r.evaluation.pollNormalized[ids[1]]), c: points.map(r => r.evaluation.pollNormalized[ids[2]]),
      customdata: points.map(r => r.poll.id), candidateIds: points.map(() => null), text: points.map(r => `${r.brand || r.poll.id}<br>${r.poll.fieldworkEnd || '日期未知'}`),
      marker: pollMarker(election, points.map(row => row.poll)), hovertemplate: `%{text}<br>${shares}<extra></extra>` },
      { uid: 'official-result', type: 'scatterternary', mode: 'markers', name: '實際結果', a: [result[ids[0]]], b: [result[ids[1]]], c: [result[ids[2]]], candidateIds: [null],
        marker: { size: 17, color: '#d65359', opacity: 1, symbol: 'star', line: { color: '#fff', width: 1 } }, hovertemplate: `實際結果<br>${shares}<extra></extra>` }];
    return { kind: 'ternary', candidateIds: [...ids], legends: candidateLegends(election, ids), ageLegend: POLL_AGE_STEPS, selectedId: selected?.poll.id || '', pollIds: points.map(row => row.poll.id), regions, backgroundData,
      note: !points.length ? '目前篩選沒有可計算的民調，僅顯示大選結果。' : selected && !points.includes(selected) ? '所選紀錄無可繪製點；其他民調與大選結果仍顯示。' : '',
      data, layout: { dragmode: 'pan', uirevision: viewportRevision(election, 'ternary', ids), datarevision: chartRevision(election, 'ternary', ids, data), ternary: { sum: 100, bgcolor: '#fff', aaxis: axis(), baxis: axis(), caxis: axis() }, margin: { l: 32, r: 32, t: 100, b: 77 } } };
  }
  if (selected && !calculable.includes(selected)) return null;
  const barResult = selected?.evaluation.resultNormalized || result;
  if (!barResult) return { kind: 'unavailable', reason: '官方票數資料不足，無法繪製目前候選人集合的結果。' };
  return { kind: 'bar', selectedId: selected?.poll.id || '', data: [...(selected ? [{ type: 'bar', orientation: 'h', name: '選取民調', x: ids.map(id => selected.evaluation.pollNormalized[id]), y: names, marker: { color }, customdata: ids.map(() => selected.poll.id), hovertemplate: '%{y} %{x:.2f}%<extra>選取民調</extra>' }] : []), { type: 'bar', orientation: 'h', name: '實際結果', x: ids.map(id => barResult[id]), y: names, marker: { color: '#c96c73' }, hovertemplate: '%{y} %{x:.2f}%<extra>實際結果</extra>' }], layout: { barmode: 'group', xaxis: { range: [0, 100], ticksuffix: '%', gridcolor: '#e3e9f1', zeroline: false }, yaxis: { automargin: true, autorange: 'reversed' }, margin: { l: 102, r: 20, t: 10, b: 30 } } };
}

export function makeChartTooltip(election, model, rows, { pollId, actual = false, regionId, traceUid, pointIndex, candidateId } = {}) {
  if (!model || !['ternary', 'strip'].includes(model.kind)) return null;
  if (regionId) {
    const region = model.regions?.find(item => item.id === regionId);
    return region ? { title: `${region.name}${election.phase === 'pre_result' ? '支持度領先區' : '勝選區'}`, lines: [] } : null;
  }
  actual ||= traceUid === 'official-result';
  const traces = traceUid ? chartRenderTraces(model) : model.data;
  const trace = traces.find(item => (!traceUid || item.uid === traceUid)
    && (actual ? item.uid === 'official-result' : item.customdata?.some((id, index) => id === pollId && (!candidateId || item.candidateIds?.[index] === candidateId))));
  if (!trace) return null;
  const matches = index => actual
    ? (!candidateId || trace.candidateIds?.[index] === candidateId)
    : trace.customdata?.[index] === pollId && (!candidateId || trace.candidateIds?.[index] === candidateId);
  const length = (trace.x || trace.a || []).length;
  const index = Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex < length && matches(pointIndex)
    ? pointIndex : Array.from({ length }, (_, i) => i).find(matches) ?? -1;
  const row = actual ? null : rows.find(item => item.poll.id === pollId);
  if (index < 0 || (!actual && !row)) return null;
  const ids = model.candidateIds || election.comparisonCandidateIds || election.candidates.map(candidate => candidate.id);
  const name = id => election.candidates.find(candidate => candidate.id === id)?.name || id;
  if (model.kind === 'strip') {
    const first = trace.x[index];
    if (!Number.isFinite(first)) return null;
    const official = model.data.find(item => item.uid === 'official-result')?.x[0];
    return { title: actual ? '大選結果' : row.brand || pollId, date: actual ? election.date : row.poll.fieldworkEnd || '日期未知',
      lines: [`${name(ids[0])}：${first.toFixed(2)}%（正規化）`, `${name(ids[1])}：${(100 - first).toFixed(2)}%（正規化）`,
        ...(actual ? [] : [pollAgeLabel(election, row.poll),
          ...(Number.isFinite(official) ? [`誤差(MAE)：${Math.abs(first - official).toFixed(2)} 百分點`] : []), ...pollContextLines(row.poll, name)])] };
  }
  const values = ids.map((id, axisIndex) => ({ label: name(id), value: trace[['a', 'b', 'c'][axisIndex]][index], unit: '%' }));
  return { title: actual ? '大選結果' : row.brand || row.poll.id, date: actual ? election.date : row.poll.fieldworkEnd || '日期未知',
    lines: [...values.filter(item => Number.isFinite(item.value)).map(item => `${item.label}：${item.value.toFixed(2)}${item.unit}`), ...(actual ? [] : [pollAgeLabel(election, row.poll)])] };
}

export function chartPollPoint(model, pollId, actual = false) {
  return chartPollPoints(model, pollId, actual)[0] || null;
}

export function chartPollPoints(model, pollId, actual = false) {
  if (!model) return [];
  const keys = model.kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y'];
  const ids = model.candidateIds || [];
  return model.data.flatMap((trace, traceIndex) => {
    if (actual ? trace.uid !== 'official-result' : !Array.isArray(trace.customdata)) return [];
    return (trace[keys[0]] || []).flatMap((_, index) => {
      if (!actual && trace.customdata[index] !== pollId) return [];
      const point = keys.map(key => trace[key]?.[index]);
      if (!point.every(Number.isFinite)) return [];
      const candidateIndex = ids.indexOf(trace.candidateIds?.[index]);
      return [{ point, order: candidateIndex < 0 ? ids.length : candidateIndex, traceIndex, index }];
    });
  }).sort((a, b) => a.order - b.order || a.traceIndex - b.traceIndex || a.index - b.index).map(item => item.point);
}

export function chartRenderTraces(model, { touch = false } = {}) {
  if (!['ternary', 'strip'].includes(model.kind)) return model.data;
  const subset = (source, indices, selected) => {
    const trace = { ...source, uid: `${source.uid}${selected ? '-selected' : ''}`, marker: { ...source.marker } };
    for (const key of ['x', 'y', 'a', 'b', 'c', 'customdata', 'candidateIds', 'text']) if (Array.isArray(source[key])) trace[key] = indices.map(i => source[key][i]);
    for (const key of ['size', 'color', 'symbol', 'opacity']) if (Array.isArray(source.marker?.[key])) trace.marker[key] = indices.map(i => source.marker[key][i]);
    if (touch) trace.marker.size = 14;
    trace.marker.line = { ...source.marker?.line };
    for (const key of ['color', 'width']) if (Array.isArray(source.marker?.line?.[key])) trace.marker.line[key] = indices.map(i => source.marker.line[key][i]);
    return trace;
  };
  const ordinary = [], selected = [], official = [];
  for (const trace of model.data) {
    if (!Array.isArray(trace.customdata) || trace.uid === 'official-result') { official.push(trace); continue; }
    const ordinaryIndices = [], selectedIndices = [];
    trace.customdata.forEach((id, index) => (id === model.selectedId ? selectedIndices : ordinaryIndices).push(index));
    ordinary.push(subset(trace, ordinaryIndices, false));
    if (selectedIndices.length) selected.push(subset(trace, selectedIndices, true));
  }
  return [...ordinary, ...official, ...selected];
}

function pollDaysBefore(election, poll) {
  const end = calendarDay(poll.fieldworkEnd), day = calendarDay(election.date);
  return end === null || day === null ? null : (day - end) / 86400000;
}

function pollAgeLabel(election, poll) {
  const days = pollDaysBefore(election, poll);
  return days === null ? '距選舉日：日期未知或無效' : days > 0 ? `調查結束於選前 ${days} 天` : days === 0 ? '調查結束於選舉當日' : `調查結束於選後 ${-days} 天`;
}

function pollMarker(election, polls) {
  const days = polls.map(poll => pollDaysBefore(election, poll));
  return { size: 10, color: '#3279cb', opacity: days.map(day => day > 0 ? POLL_AGE_STEPS.find(step => day <= step.days).opacity : 1),
    symbol: days.map(day => day > 0 ? 'circle' : 'circle-open'), line: { color: days.map(day => day > 0 ? '#fff' : '#3279cb'), width: 0.75 } };
}

function makeOneDimensionalChart(election, ids, rows, selectedId) {
  const legends = candidateLegends(election, ids);
  const regions = candidateRegions(election, [ids[1], ids[0]]);
  const points = rows.flatMap(row => {
    const values = chartSupport(election, ids, row.poll);
    return values ? [{ row, values }] : [];
  });
  const official = officialResultSummary(election);
  const normalized = election.phase !== 'pre_result' && election.result?.status === 'verified' && official.complete ? normalizeDistribution(official.rawPercent, ids) : null;
  const result = normalized?.ok ? normalized.values : null;
  const data = [{ uid: 'polls', type: 'scatter', mode: 'markers', name: '民調',
    x: points.map(point => point.values[ids[0]]), y: points.map(() => 0), customdata: points.map(point => point.row.poll.id),
    candidateIds: points.map(() => ids[0]), text: points.map(point => `${point.row.brand || point.row.poll.id}<br>${point.row.poll.fieldworkEnd || '日期未知'}`),
    marker: pollMarker(election, points.map(point => point.row.poll)),
    hovertemplate: '%{text}<br>%{x:.2f}%（正規化）<extra></extra>' }];
  if (result) data.push({ uid: 'official-result', type: 'scatter', mode: 'markers', name: '實際結果',
    x: [result[ids[0]]], y: [0], candidateIds: [ids[0]], marker: { size: 17, color: '#d65359', opacity: 1, symbol: 'star', line: { color: '#fff', width: 1 } },
    hovertemplate: '實際結果<br>%{x:.2f}%（正規化）<extra></extra>' });
  const unplotted = rows.length - points.length;
  const supports = [50, ...data.flatMap(trace => trace.x)];
  const min = Math.min(...supports), max = Math.max(...supports);
  const padding = Math.max(3, (max - min) * 0.12);
  return { kind: 'strip', candidateIds: [...ids], legends, regions, ageLegend: POLL_AGE_STEPS, selectedId: rows.some(row => row.poll.id === selectedId) ? selectedId : '',
    pollIds: points.map(point => point.row.poll.id), data,
    note: `${!result && election.phase !== 'pre_result' ? '官方結果未完整核實，暫不顯示結果星號。' : ''}${unplotted ? `另有 ${unplotted} 筆支持度缺漏、候選情境不符或輸入衝突，僅列於表格。` : ''}${!points.length ? '目前篩選沒有可繪製民調。' : ''}`,
    layout: { dragmode: 'pan', uirevision: viewportRevision(election, 'strip', ids), datarevision: chartRevision(election, 'strip', ids, data),
      xaxis: { type: 'linear', title: { text: `${legends[0].name}正規化支持度（%）` }, range: [Math.max(0, min - padding), Math.min(100, max + padding)], minallowed: 0, maxallowed: 100, ticksuffix: '%', gridcolor: '#e3e9f1', zeroline: false },
      yaxis: { range: [-1, 1], visible: false, fixedrange: true },
      shapes: [...regions.map((region, index) => ({ type: 'rect', name: region.id, xref: 'x', yref: 'paper', x0: index * 50, x1: (index + 1) * 50, y0: 0, y1: 1, fillcolor: region.fill, line: { width: 0 }, layer: 'below' })),
        { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0, line: { color: '#c8d4e4', width: 1 }, layer: 'below' },
        { type: 'line', xref: 'x', x0: 50, x1: 50, yref: 'y', y0: -0.1, y1: 0.1, line: { color: '#a7b8cf', width: 1, dash: 'dot' }, layer: 'below' }],
      annotations: [{ x: 50, y: 0.22, xref: 'x', yref: 'y', text: '50% 平手', showarrow: false, font: { color: '#6c7e96', size: 11 } }],
      margin: { l: 35, r: 25, t: 42, b: 58 } } };
}

function ternaryBackground(regions) {
  return regions.map((region, index) => {
      const vertex = [0, 0, 0];
      vertex[index] = 100;
      const midpoints = regions.flatMap((_, other) => {
        if (other === index) return [];
        const midpoint = [0, 0, 0];
        midpoint[index] = midpoint[other] = 50;
        return [midpoint];
      });
      const polygon = [vertex, midpoints[0], [100 / 3, 100 / 3, 100 / 3], midpoints[1]];
      return { type: 'scatterternary', mode: 'lines', name: `${region.name}領先區域`, a: polygon.map(point => point[0]), b: polygon.map(point => point[1]), c: polygon.map(point => point[2]), fill: 'toself', fillcolor: region.fill, line: { color: '#fff', width: 1 }, hoverinfo: 'skip', showlegend: false };
    });
}

function makePreResultTernary(election, ids, rows, selectedId) {
  const regions = candidateRegions(election, ids);
  const points = rows.flatMap(row => {
    const values = chartSupport(election, ids, row.poll);
    return values && chartDate(row.poll.fieldworkEnd) !== null ? [{ row, values }] : [];
  });
  const data = [{ uid: 'polls', type: 'scatterternary', mode: 'markers', name: '民調',
    a: points.map(point => point.values[ids[0]]), b: points.map(point => point.values[ids[1]]), c: points.map(point => point.values[ids[2]]),
    customdata: points.map(point => point.row.poll.id), candidateIds: points.map(() => null),
    text: points.map(point => `${point.row.brand || point.row.poll.id}<br>${point.row.poll.fieldworkEnd || '日期未知'}`),
    marker: pollMarker(election, points.map(point => point.row.poll)) }];
  return { kind: 'ternary', candidateIds: [...ids], legends: candidateLegends(election, ids), ageLegend: POLL_AGE_STEPS, selectedId: rows.some(row => row.poll.id === selectedId) ? selectedId : '',
    pollIds: [...new Set(points.map(point => point.row.poll.id))], regions, backgroundData: ternaryBackground(regions), data,
    note: `${rows.length > points.length ? `另有 ${rows.length - points.length} 筆日期或支持度不完整、候選情境不符或輸入衝突，僅列於表格。` : ''}${!points.length ? '目前篩選沒有日期及三人支持度皆完整的調查；未知值不補零。' : ''}`,
    layout: { dragmode: 'pan', uirevision: viewportRevision(election, 'ternary', ids), datarevision: chartRevision(election, 'ternary', ids, data), ternary: { sum: 100, bgcolor: '#fff', aaxis: axis(), baxis: axis(), caxis: axis() }, margin: { l: 32, r: 32, t: 100, b: 77 } } };
}

function thresholdCandidate(election, mainIds, rows) {
  const candidates = rows.flatMap(row => {
    if (!interpretableSupport(election, mainIds, row.poll)) return [];
    return election.candidates.flatMap(candidate => {
      const share = row.poll.shares?.[candidate.id];
      return !mainIds.includes(candidate.id) && Number.isFinite(share) && share >= 5
        ? [{ id: candidate.id, share, end: chartDate(row.poll.fieldworkEnd), publication: chartDate(row.poll.publishedAt) }] : [];
    });
  });
  const newest = (a, b) => a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a;
  return candidates.sort((a, b) => b.share - a.share || newest(a.end, b.end) || newest(a.publication, b.publication) || compareText(a.id, b.id))[0] || null;
}

function chartSupport(election, ids, poll) {
  if (!interpretableSupport(election, ids, poll)) return null;
  const result = normalizeDistribution(poll.shares, ids);
  return result.ok ? result.values : null;
}

function interpretableSupport(election, ids, poll) {
  if (!poll || poll.electionId && poll.electionId !== election.id || !poll.shares || typeof poll.shares !== 'object' || Array.isArray(poll.shares)) return false;
  const allIds = election.candidates.map(candidate => candidate.id);
  const blockers = [poll.calculationBlocker, poll.verification_review?.calculation_blocker, poll.verificationReview?.calculationBlocker];
  const blocked = /historical_candidate_context|non[_ -]?voting|non[_ -]?candidate|different_candidate_context|candidate_scenario_mismatch|support question.{0,40}(?:not.{0,10}identified|unidentified|unclear)|題目.*候選(?:人)?(?:姓)?名不一致|黨名題|(?:經濟建設能力|福利政策).*題|(?:不可|不能).{0,12}(?:直接)?(?:納|當|用|作).{0,12}(?:投票支持度|候選人MAE|MAE)|尚未裁定|未裁定|互異|不一致|未任選|不任選|未證明為同一波|衝突未解|unresolved.{0,24}(?:support|input|conflict)|(?:support|input).{0,24}conflict/i;
  if (blockers.some(value => value !== undefined && value !== null && value !== false && (typeof value !== 'string' || blocked.test(value)))) return false;
  const products = [poll.productType, poll.product_type, poll.provenance?.product_type].filter(value => value !== undefined && value !== null);
  if (products.some(value => !['voting_intention_poll', 'nonprobability_street_interview'].includes(value))) return false;
  const comparisonSets = [poll.candidateSet, poll.candidate_set, poll.provenance?.candidate_set];
  const questionSets = [poll.questionCandidateSet, poll.question_candidate_set, poll.provenance?.question_candidate_set];
  const comparisonIds = election.phase === 'pre_result' ? election.comparisonCandidateIds : ids;
  const invalidSet = (set, requiredIds) => set != null && (!Array.isArray(set) || !set.length || new Set(set).size !== set.length || set.some(id => !allIds.includes(id)) || requiredIds.some(id => !set.includes(id)));
  if (comparisonSets.some(set => invalidSet(set, comparisonIds)) || questionSets.some(set => invalidSet(set, ids))) return false;
  if (Object.entries(poll.shares).some(([id, value]) => !allIds.includes(id) || value != null && (!Number.isFinite(value) || value < 0 || value > 100))) return false;
  if (Object.values(poll.shares).reduce((sum, value) => sum + (value ?? 0), 0) > 100.5) return false;
  return true;
}

function chartDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return null;
  const day = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== match[1]) return null;
  if (match[2] !== undefined && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59)) return null;
  const result = match[2] === undefined ? day : Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function viewportRevision(election, kind, ids) { return JSON.stringify([election.id, kind, 'linear', ids]); }

function chartRevision(election, kind, ids, data) {
  const axes = kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y'];
  const points = data.flatMap(trace => (trace[axes[0]] || []).map((_, index) => [trace.uid === 'official-result' ? 'official-result' : trace.customdata?.[index], trace.candidateIds?.[index] ?? null, ...axes.map(key => trace[key][index])]))
    .sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  return JSON.stringify([election.id, kind, 'linear', ids, points]);
}

function pollContextLines(poll, name) {
  return [
    `原始支持度：${Object.entries(poll.shares || {}).filter(([, value]) => Number.isFinite(value)).map(([id, value]) => `${name(id)} ${value.toFixed(2)}%`).join('、') || '未載'}`,
    `未表態：${Number.isFinite(poll.undecided) ? `${poll.undecided}%` : '未載'}`,
    `問卷名單：${(poll.questionCandidateSet || poll.candidateSet)?.map(name).join('、') || '未載'}`,
    poll.question || '原始題目未載',
  ];
}

function candidateLegends(election, ids) {
  return candidateRegions(election, ids).map(candidate => ({ id: candidate.id, name: candidate.name, party: candidate.party, color: candidate.regionColor }));
}

function compareText(a, b) { return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; }

export function candidateRegions(election, ids, fillOpacity = 0.22) {
  const regionColors = { 民主進步黨: [0, 140, 69], 中國國民黨: [37, 91, 219], 台灣民眾黨: [0, 175, 205], 臺灣民眾黨: [0, 175, 205], 親民黨: [232, 123, 16] };
  return ids.map(id => {
    const candidate = election.candidates.find(item => item.id === id);
    const party = candidate?.party || '黨籍未載明';
    const regionColor = regionColors[party] || [125, 135, 149];
    return { id, name: candidate?.name || id, party, fill: `rgba(${regionColor.join(', ')}, ${fillOpacity})`, hoverFill: `rgba(${regionColor.join(', ')}, 0.32)`, regionColor: `rgb(${regionColor.join(', ')})`, color: `rgb(${regionColor.join(', ')})` };
  });
}
function axis() { return { title: { text: '', font: { size: 11, color: '#253c60' } }, min: 0, dtick: 20, showticklabels: false, ticks: '', tickfont: { size: 9, color: '#6c7e96' }, gridcolor: '#e3e9f1', linecolor: '#d5deeb', linewidth: 1, ticklen: 2 }; }


