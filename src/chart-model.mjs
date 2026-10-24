import { normalizeDistribution } from './domain.mjs';
import { officialResultSummary } from './result-model.mjs';

export function makeChartModel(election, rows, selectedId) {
  if (!election) return null;
  const comparisonIds = election.comparisonCandidateIds || election.candidates.map(candidate => candidate.id);
  if (comparisonIds.length === 2) return makeTwoCandidateChart(election, comparisonIds, rows, selectedId);
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
    const backgroundData = regions.map((region, index) => {
      const vertex = [0, 0, 0];
      vertex[index] = 100;
      const midpoints = ids.flatMap((_, other) => {
        if (other === index) return [];
        const midpoint = [0, 0, 0];
        midpoint[index] = midpoint[other] = 50;
        return [midpoint];
      });
      const polygon = [vertex, midpoints[0], [100 / 3, 100 / 3, 100 / 3], midpoints[1]];
      return { type: 'scatterternary', mode: 'lines', name: `${region.name}領先區域`, a: polygon.map(point => point[0]), b: polygon.map(point => point[1]), c: polygon.map(point => point[2]), fill: 'toself', fillcolor: region.fill, line: { color: '#fff', width: 1 }, hoverinfo: 'skip', showlegend: false };
    });
    const shares = names.map((name, index) => `${name}：%{${['a', 'b', 'c'][index]}:.2f}%`).join('<br>');
    return { kind: 'ternary', selectedId: selected?.poll.id || '', pollIds: points.map(row => row.poll.id), regions, backgroundData,
      note: !points.length ? '目前篩選沒有可計算的民調，僅顯示大選結果。' : selected && !points.includes(selected) ? '所選紀錄無可繪製點；其他民調與大選結果仍顯示。' : '',
      data: [{ uid: 'polls', type: 'scatterternary', mode: 'markers', name: '民調', a: points.map(r => r.evaluation.pollNormalized[ids[0]]), b: points.map(r => r.evaluation.pollNormalized[ids[1]]), c: points.map(r => r.evaluation.pollNormalized[ids[2]]), customdata: points.map(r => r.poll.id), text: points.map(r => `${r.brand || r.poll.id}<br>${r.poll.fieldworkEnd || '日期未知'}`), marker: { size: points.map(r => r === selected ? 13 : 8), color: points.map(r => r === selected ? color : '#85afdf'), line: { color: '#fff', width: 1.5 } }, hovertemplate: `%{text}<br>${shares}<extra></extra>` }, { uid: 'official-result', type: 'scatterternary', mode: 'markers', name: '實際結果', a: [result[ids[0]]], b: [result[ids[1]]], c: [result[ids[2]]], marker: { size: 17, color: '#d65359', symbol: 'star', line: { color: '#fff', width: 1 } }, hovertemplate: `實際結果<br>${shares}<extra></extra>` }], layout: { dragmode: 'pan', uirevision: JSON.stringify([election.id, ids, points.map(row => row.poll.id).sort()]), ternary: { sum: 100, bgcolor: '#fff', aaxis: axis(), baxis: axis(), caxis: axis() }, margin: { l: 32, r: 32, t: 88, b: 65 } } };
  }
  if (selected && !calculable.includes(selected)) return null;
  const barResult = selected?.evaluation.resultNormalized || result;
  if (!barResult) return { kind: 'unavailable', reason: '官方票數資料不足，無法繪製目前候選人集合的結果。' };
  return { kind: 'bar', selectedId: selected?.poll.id || '', data: [...(selected ? [{ type: 'bar', orientation: 'h', name: '選取民調', x: ids.map(id => selected.evaluation.pollNormalized[id]), y: names, marker: { color }, customdata: ids.map(() => selected.poll.id), hovertemplate: '%{y} %{x:.2f}%<extra>選取民調</extra>' }] : []), { type: 'bar', orientation: 'h', name: '實際結果', x: ids.map(id => barResult[id]), y: names, marker: { color: '#c96c73' }, hovertemplate: '%{y} %{x:.2f}%<extra>實際結果</extra>' }], layout: { barmode: 'group', xaxis: { range: [0, 100], ticksuffix: '%', gridcolor: '#e3e9f1', zeroline: false }, yaxis: { automargin: true, autorange: 'reversed' }, margin: { l: 102, r: 20, t: 10, b: 30 } } };
}

export function makeChartTooltip(election, model, rows, { pollId, actual = false, regionId } = {}) {
  if (!model || !['scatter', 'ternary'].includes(model.kind)) return null;
  if (regionId) {
    const region = model.regions?.find(item => item.id === regionId);
    return region ? { title: `${region.name}勝選區`, lines: [] } : null;
  }
  const trace = model.data.find(item => actual ? item.uid === 'official-result' : item.customdata?.includes(pollId));
  if (!trace) return null;
  const index = actual ? 0 : trace.customdata.indexOf(pollId);
  const row = actual ? null : rows.find(item => item.poll.id === pollId);
  if (index < 0 || (!actual && !row)) return null;
  const values = model.kind === 'scatter'
    ? [{ label: model.winnerName, value: trace.x[index], unit: '%' }, { label: '平均絕對誤差（MAE）', value: trace.y[index], unit: ' 百分點' }]
    : (election.comparisonCandidateIds || election.candidates.map(candidate => candidate.id)).map((id, axisIndex) => ({ label: election.candidates.find(candidate => candidate.id === id)?.name || id, value: trace[['a', 'b', 'c'][axisIndex]][index], unit: '%' }));
  return { title: actual ? '大選結果' : row.brand || row.poll.id, date: actual ? election.date : row.poll.fieldworkEnd || '日期未知', lines: values.filter(item => Number.isFinite(item.value)).map(item => `${item.label}：${item.value.toFixed(2)}${item.unit}`) };
}

export function chartPollPoint(model, pollId) {
  const trace = model.data.find(item => item.customdata?.includes(pollId));
  if (!trace) return null;
  const index = trace.customdata.indexOf(pollId);
  return (model.kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y']).map(axis => trace[axis][index]);
}

export function chartRenderTraces(model) {
  if (!['scatter', 'ternary'].includes(model.kind)) return model.data;
  const polls = model.data.find(trace => trace.uid === 'polls');
  const selected = polls.customdata.indexOf(model.selectedId);
  const subset = (indices, uid) => {
    const trace = { ...polls, uid, marker: { ...polls.marker } };
    for (const key of ['x', 'y', 'a', 'b', 'c', 'customdata', 'text']) if (Array.isArray(polls[key])) trace[key] = indices.map(i => polls[key][i]);
    for (const key of ['size', 'color']) trace.marker[key] = indices.map(i => polls.marker[key][i]);
    return trace;
  };
  return [subset(polls.customdata.flatMap((_, i) => i === selected ? [] : [i]), 'polls'),
    model.data.find(trace => trace.uid === 'official-result'), subset(selected < 0 ? [] : [selected], 'selected-poll')];
}

function makeTwoCandidateChart(election, ids, rows, selectedId) {
  const unavailable = reason => ({ kind: 'unavailable', reason });
  const official = officialResultSummary(election);
  if (election.result?.status !== 'verified' || !official.complete) return unavailable('官方票數資料不足，無法判定當選人。');
  const mostVotes = Math.max(...election.candidates.map(candidate => election.result.votes[candidate.id]));
  const winners = election.candidates.filter(candidate => election.result.votes[candidate.id] === mostVotes);
  if (winners.length !== 1) return unavailable('官方最高票不唯一，無法判定當選人。');
  const winner = winners[0];
  if (!ids.includes(winner.id)) return unavailable('實際當選人不在目前比較的候選人集合內。');
  const result = normalizeDistribution(official.rawPercent, ids);
  if (!result.ok) return unavailable('官方結果無法依目前候選人集合正規化。');
  const opponentId = ids.find(id => id !== winner.id);
  const regions = candidateRegions(election, [opponentId, winner.id]);

  const score = row => row.evaluation.eligible ? row.evaluation.mae : row.evaluation.provisionalMae;
  const points = rows.filter(row => row.evaluation.candidateIds?.length === 2
    && ids.every(id => row.evaluation.candidateIds.includes(id) && Number.isFinite(row.evaluation.pollNormalized?.[id]))
    && Number.isFinite(score(row)) && score(row) >= 0);
  const selected = rows.find(row => row.poll.id === selectedId);
  const x = points.map(row => row.evaluation.pollNormalized[winner.id]);
  const y = points.map(score);
  const actual = result.values[winner.id];
  const minX = Math.min(50, actual, ...x);
  const maxX = Math.max(50, actual, ...x);
  const padding = Math.max(3, (maxX - minX) * 0.12);
  const color = '#3279cb';

  return {
    kind: 'scatter', winnerName: winner.name || winner.id, regions,
    selectedId: selected?.poll.id || '', pollIds: points.map(row => row.poll.id),
    note: !points.length ? '目前篩選沒有可計算的民調，僅顯示大選結果。'
      : selected && !points.includes(selected) ? '所選紀錄無可繪製點；其他民調與大選結果仍顯示。' : '',
    data: [{
      uid: 'polls', type: 'scatter', mode: 'markers', name: '民調', x, y, cliponaxis: false,
      customdata: points.map(row => row.poll.id),
      text: points.map(row => `${row.brand || row.poll.id}<br>${row.poll.fieldworkEnd || '日期未知'}`),
      marker: { size: points.map(row => row === selected ? 13 : 8), color: points.map(row => row === selected ? color : '#85afdf'), line: { color: '#fff', width: 1.5 } },
      hovertemplate: `%{text}<br>${winner.name || winner.id}：%{x:.2f}%<br>平均絕對誤差（MAE）：%{y:.2f} 百分點<extra></extra>`,
    }, {
      uid: 'official-result', type: 'scatter', mode: 'markers', name: '實際結果', x: [actual], y: [0], cliponaxis: false,
      marker: { size: 17, color: '#d65359', symbol: 'star', line: { color: '#fff', width: 1 } },
      hovertemplate: `實際結果<br>${winner.name || winner.id}：%{x:.2f}%<br>平均絕對誤差（MAE）：0.00 百分點<extra></extra>`,
    }],
    layout: {
      dragmode: 'pan',
      uirevision: JSON.stringify([election.id, ids, points.map(row => row.poll.id).sort()]),
      shapes: [...regions.map((region, index) => ({ type: 'rect', xref: 'x', yref: 'paper', x0: index * 50, x1: (index + 1) * 50, y0: 0, y1: 1, fillcolor: region.fill, line: { width: 0 }, layer: 'below' })), { type: 'line', xref: 'x', yref: 'paper', x0: 50, x1: 50, y0: 0, y1: 1, line: { color: '#b9c6d4', width: 1, dash: 'dot' }, layer: 'below' }],
      xaxis: { title: { text: `${winner.name || winner.id}得票率<br>（正規化 %）`, font: { size: 11 } }, range: [Math.max(0, minX - padding), Math.min(100, maxX + padding)], ticksuffix: '%', gridcolor: '#e3e9f1', zeroline: false, automargin: true },
      yaxis: { title: { text: '平均絕對誤差（MAE）<br>百分點', font: { size: 11 } }, range: [0, Math.max(1, ...y) * 1.15], gridcolor: '#e3e9f1', zerolinecolor: '#b8c7dc', automargin: true },
      margin: { l: 65, r: 18, t: 88, b: 65 },
    },
  };
}
function candidateRegions(election, ids) {
  const colors = { 民主進步黨: [33, 145, 91], 中國國民黨: [51, 104, 190], 台灣民眾黨: [27, 162, 166], 臺灣民眾黨: [27, 162, 166], 親民黨: [228, 137, 39] };
  return ids.map(id => {
    const candidate = election.candidates.find(item => item.id === id);
    const party = candidate?.party || '黨籍未載明';
    const color = colors[party] || [125, 135, 149];
    return { id, name: candidate?.name || id, party, fill: `rgba(${color.join(', ')}, 0.08)`, color: `rgb(${color.join(', ')})` };
  });
}
function axis() { return { title: { text: '', font: { size: 11, color: '#253c60' } }, min: 0, dtick: 20, showticklabels: false, ticks: '', tickfont: { size: 9, color: '#6c7e96' }, gridcolor: '#e3e9f1', linecolor: '#d5deeb', linewidth: 1, ticklen: 2 }; }


