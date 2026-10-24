import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { candidatePortraits, portraitByCandidate } from '../src/candidate-portraits.mjs';
import { adaptVerifiedData } from '../scripts/import-verified-data.mjs';
import { evaluatePoll, commonElectionComparison, exportCsv, filterAndSortRows, selectElectionPolls, selectSingleElectionPolls } from '../src/domain.mjs';
import { validateDataset } from '../src/load-data.mjs';
import { chartPollPoint, chartRenderTraces, makeChartModel, makeChartTooltip } from '../src/chart-model.mjs';
import { focusViewport, initialViewport, readViewportChange, ternaryWeights, viewportLayout, viewportRelayout, zoomTernary } from '../src/chart-viewport.mjs';
import { formatVoteCount, officialResultSummary } from '../src/result-model.mjs';
import { compareInstitutionBrands, institutionGroups } from '../src/institution-model.mjs';

const raw = JSON.parse(await readFile(new URL('../public/data/verified-source.json', import.meta.url), 'utf8'));
const data = JSON.parse(await readFile(new URL('../public/data/verified.json', import.meta.url), 'utf8'));
const legacyPolls = data.polls.filter(p => !p.provenance.historical_import);
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-9, `${a} vs ${b}`);

test('complete audited source adapts reproducibly without losing public sources and notes', () => {
  assert.equal(raw.contests.length, 14); assert.equal(raw.polls.length, raw.scope.total_poll_records); assert.equal(raw.polls.filter(p => p.verification_status === 'verified_primary').length, raw.scope.verified_poll_records);
  assert.deepEqual(JSON.parse(JSON.stringify(adaptVerifiedData(raw))), data);
  assert.equal(validateDataset(data), data);
  for (const p of raw.polls) {
    const mapped = data.polls.find(r => r.id === p.id);
    assert.equal(mapped.sources.length, p.sources.length);
    assert.equal(mapped.notes, p.notes.join('\n'));
    assert.equal(mapped.sourceCalculation?.normalized_mae_pp ?? null, p.calculation?.normalized_mae_pp ?? null, p.id);
    assert.deepEqual(mapped.provenance, p);
  }
});
test('all fourteen integer vote totals agree with CEC totals, including corrected results', () => {
  for (const c of raw.contests) {
    assert.ok(c.candidates.every(x => Number.isInteger(x.votes)));
    assert.equal(c.candidates.reduce((sum,x) => sum+x.votes,0), c.valid_votes, c.id);
  }
  const ty = data.elections.find(e => e.id === '2022-taoyuan').result;
  assert.deepEqual(ty.votes, { '張善政': 557572, '賴香伶': 54926, '鄭運鵬': 428983, '鄭寶清': 30282 });
  const tp = data.elections.find(e => e.id === '2018-taipei').result;
  assert.equal(tp.votes['柯文哲'],580663); assert.equal(tp.votes['丁守中'],577096);
});
test('each normalized MAE independently recomputes from reported support and official integer votes', () => {
  for (const p of raw.polls) {
    const c = raw.contests.find(e => e.id === p.contest_id);
    const counts = Object.fromEntries(c.candidates.map(x => [x.name,x.votes]));
    const pollTotal = p.candidate_set.reduce((sum,id) => sum+p.raw_support_percent[id],0);
    const voteTotal = p.candidate_set.reduce((sum,id) => sum+counts[id],0);
    const independent = p.candidate_set.reduce((sum,id) => sum+Math.abs(p.raw_support_percent[id]/pollTotal*100-counts[id]/voteTotal*100),0)/p.candidate_set.length;
    if (Number.isFinite(p.calculation.normalized_mae_pp)) near(independent,p.calculation.normalized_mae_pp);
    else assert.equal(p.calculation.normalized_mae_pp, null, p.id);
    const mapped = data.polls.find(x => x.id === p.id);
    const evaluation = evaluatePoll(mapped,data.elections.find(e => e.id === mapped.electionId), { within30Days: false });
    if (p.calculation.normalized_mae_pp === null) assert.ok(evaluation.calculationReason, p.id);
    if (p.verification_status === 'verified_primary') { assert.equal(evaluation.eligible,true,p.id); near(evaluation.mae,independent); }
    else {
      assert.equal(evaluation.eligible, false, p.id);
      assert.equal(evaluation.mae, null, p.id);
      if (Number.isFinite(p.calculation.normalized_mae_pp)) near(evaluation.provisionalMae, independent);
      else assert.equal(evaluation.provisionalMae, null, p.id);
    }
  }
  assert.equal(data.polls.filter(p => p.isExplicitFinal).length, 12);
});
test('comparable polls have stored MAEs; non-voting questions, unresolved conflicts and candidate contexts stay unscored', () => {
  const withoutScore = raw.polls.filter(p => !Number.isFinite(p.calculation?.normalized_mae_pp));
  assert.deepEqual(withoutScore.map(p => p.id).sort(), [
    '2012-president-history-1c7f77f6dcf4',
    '2012-president-history-33fe0bf2c42e',
    '2012-president-history-6ec1155ca171',
    '2016-president-history-66464f0cd5b4',
    '2016-president-history-8aa0d4da11c9',
    '2016-president-history-d77f94f6d95a',
    '2018-taichung-history-7ad8b8d1fa97',
    '2018-taichung-history-a2d437b86482',
    '2022-taipei-history-e18b91a207aa',
    '2022-taoyuan-history-21146cd2d375',
    '2022-taoyuan-history-f26b3dd8fa51',
    '2024-president-history-17f312f965ba',
    '2024-president-history-592e5ca4e19b',
    '2024-president-history-5cd9df4c11ae',
    '2024-president-history-6ca4ec90cbe9',
    '2024-president-history-8d6cef8686bd',
    '2024-president-history-aeeabda290cc',
    '2024-president-history-b385483b7da9',
  ]);
  const scored = raw.polls.filter(p => Number.isFinite(p.calculation?.normalized_mae_pp));
  assert.equal(scored.length, 771);
  assert.equal(scored.filter(p => p.verification_status === 'verified_primary').length, 360);
  assert.equal(scored.filter(p => p.verification_status !== 'verified_primary').length, 411);
});

test('street-party retains a provisional MAE without gaining formal eligibility', () => {
  const id = '2024-president-wiki-streetparty-street-2023-12-26-1ftgzth';
  const sourcePoll = raw.polls.find(p => p.id === id);
  const poll = data.polls.find(p => p.id === id);
  const election = data.elections.find(item => item.id === poll.electionId);
  const evaluation = evaluatePoll(poll, election, { within30Days: false });
  assert.equal(sourcePoll.verification_status, 'indexed_secondary');
  assert.equal(poll.status, 'pending');
  assert.equal(poll.primaryMae ?? null, null);
  assert.equal(evaluation.eligible, false);
  assert.equal(evaluation.mae, null);
  near(evaluation.provisionalMae, 6.313544064437043);
  near(sourcePoll.calculation.normalized_mae_pp, evaluation.provisionalMae);
  assert.equal(poll.sourceCalculation.is_provisional, true);
});
test('brand and executor units stay separate and common five-election means match audit', () => {
  assert.notEqual(data.polls.find(p => p.id === '2022-taipei-zmedia').institutionId,data.polls.find(p => p.id === '2022-taipei-formosa').institutionId);
  const comparison=commonElectionComparison(data,['tvbs__tvbs-poll-center','formosa__beacon']);
  assert.equal(comparison.commonElectionIds.length,5);
  near(comparison.rows[0].average,1.9790271783820181); near(comparison.rows[1].average,5.976351689491718);
  assert.equal(comparison.rows[0].missingElectionIds.length,5);
  const limited=commonElectionComparison(data,['tvbs__tvbs-poll-center','ettoday__ettoday-poll-cloud']);
  assert.equal(limited.commonElectionIds.length,3); assert.ok(limited.rows.every(r => Number.isFinite(r.average)));
});
test('single-election close/history scopes preserve the real-data rules without changing cross-election results', () => {
  const election = data.elections.find(item => item.id === '2024-president');
  const closing = selectSingleElectionPolls(data.polls, election);
  const history = selectSingleElectionPolls(data.polls, election, { view: 'history' });
  assert.equal(new Set(closing.rows.map(row => row.poll.institutionId)).size, closing.rows.length);
  assert.ok(history.rows.length > closing.rows.length);
  assert.ok(closing.rows.some(row => row.poll.status !== 'verified'), 'closing mode includes source-pending records');
  for (const row of closing.rows) {
    assert.ok(row.poll.source?.url || row.poll.sources?.some(source => source.url), row.poll.id);
    if (row.selectionReason === 'publication-date-proxy') assert.equal(row.poll.fieldworkEnd, null, row.poll.id);
  }
  assert.ok(history.rows.every(row => row.poll.electionId === election.id));
  const comparisonBefore = commonElectionComparison(data, ['tvbs__tvbs-poll-center', 'formosa__beacon']);
  selectSingleElectionPolls(data.polls, election, { view: 'history', within30Days: true });
  selectSingleElectionPolls(data.polls, election, { view: 'closing', within30Days: true });
  assert.deepEqual(commonElectionComparison(data, ['tvbs__tvbs-poll-center', 'formosa__beacon']), comparisonBefore);
});
test('unknown start stays null and the corrected zmedia method is preserved', () => {
  const tvbs=data.polls.find(p => p.id==='2022-taipei-tvbs');
  assert.equal(tvbs.fieldworkStart,null);
  assert.ok(tvbs.sources.some(source => source.access_method === 'full_public_text'));
  assert.ok(tvbs.sources.some(source => source.kind === 'primary_publisher_report' || source.kind === 'primary_report' || source.kind === 'primary_poll_report'));
  assert.equal(tvbs.provenance.fieldwork_start, null);
  const z=data.polls.find(p => p.id==='2022-taipei-zmedia');
  assert.equal(z.samplingFrame,'住宅電話名冊輔助隨機跳號');
  assert.equal(z.provenance.sampling_frame,z.samplingFrame);
});
test('ternary traces use the same named set, poll selection IDs, and an official result star', () => {
  const election=data.elections.find(e => e.id==='2024-president');
  const rows=selectElectionPolls(data.polls,election).map(r => ({...r,brand:r.poll.institutionId}));
  const model=makeChartModel(election,rows,'2024-president-formosa');
  assert.equal(model.kind,'ternary'); assert.equal(model.selectedId,'2024-president-formosa');
  assert.equal(model.data[0].type,'scatterternary'); assert.equal(model.data[1].marker.symbol,'star');
  assert.deepEqual(model.data[0].customdata,rows.map(r=>r.poll.id));
  const n=rows.findIndex(r=>r.poll.id==='2024-president-formosa');
  assert.equal(model.data[0].marker.size[n],13); near(model.data[0].a[n],45.51724137931035);
  near(model.data[1].a[0],40.05030720187538);
});
test('two-candidate scatter includes every calculable row with the displayed MAE and official result star', () => {
  const election=data.elections.find(e=>e.id==='2024-president');
  const rows=selectElectionPolls(data.polls,election,{allPolls:true});
  const changed={...election,comparisonCandidateIds:['賴清德','侯友宜']};
  const mapped=rows.map(r=>({...r,evaluation:evaluatePoll(r.poll,changed)}));
  const two=makeChartModel(changed,mapped,mapped[0].poll.id);
  assert.equal(two.kind,'scatter'); assert.equal(two.data[0].type,'scatter');
  const points=mapped.filter(r=>Number.isFinite(r.evaluation.eligible?r.evaluation.mae:r.evaluation.provisionalMae));
  assert.deepEqual(two.data[0].customdata,points.map(r=>r.poll.id));
  assert.deepEqual(two.data[0].x,points.map(r=>r.evaluation.pollNormalized['賴清德']));
  assert.deepEqual(two.data[0].y,points.map(r=>r.evaluation.eligible?r.evaluation.mae:r.evaluation.provisionalMae));
  assert.equal(two.data[0].marker.size[0],13);
  assert.equal(two.data[1].marker.symbol,'star'); assert.equal(two.data[1].marker.color,'#d65359');
  near(two.data[1].x[0],election.result.votes['賴清德']/(election.result.votes['賴清德']+election.result.votes['侯友宜'])*100);
  assert.deepEqual(two.data[1].y,[0]); assert.equal(two.data[1].cliponaxis,false);
  assert.equal(two.layout.yaxis.range[0],0);
  assert.ok(two.data[0].x.every(x=>x>=two.layout.xaxis.range[0] && x<=two.layout.xaxis.range[1]));
  assert.ok(two.data[0].y.every(y=>y<=two.layout.yaxis.range[1]));
  assert.ok(two.data[0].customdata.some(id => mapped.some(r => r.poll.id === id && !r.evaluation.eligible && Number.isFinite(r.evaluation.provisionalMae))));
});
test('two-candidate scatter normalizes the same pair and finds the winner independent of candidate order', () => {
  const election=data.elections.find(e=>e.id==='2018-tainan');
  assert.ok(election.candidates.length>2);
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const model=makeChartModel(election,rows,rows[0].poll.id);
  const winner=election.candidates.reduce((a,b)=>election.result.votes[a.id]>election.result.votes[b.id]?a:b);
  const pairTotal=election.comparisonCandidateIds.reduce((sum,id)=>sum+election.result.votes[id],0);
  near(model.data[1].x[0],election.result.votes[winner.id]/pairTotal*100);
  assert.notEqual(model.data[1].x[0],officialResultSummary(election).rawPercent[winner.id]);
  const reversed={...election,candidates:[...election.candidates].reverse(),comparisonCandidateIds:[...election.comparisonCandidateIds].reverse()};
  const reversedRows=rows.map(row=>({...row,evaluation:evaluatePoll(row.poll,reversed)}));
  const reordered=makeChartModel(reversed,reversedRows,rows[0].poll.id);
  assert.equal(reordered.winnerName,winner.name);
  assert.deepEqual(reordered.data[0].x,model.data[0].x);
  reordered.data[0].y.forEach((y,index)=>near(y,model.data[0].y[index]));
  near(reordered.data[1].x[0],model.data[1].x[0]);
});
test('two-candidate scatter follows closing, history, date and search table scopes', () => {
  const election=data.elections.find(e=>e.id==='2022-new-taipei');
  const brands=new Map(data.institutions.map(institution=>[institution.id,institution.brand]));
  for (const view of ['closing','history']) for (const within30Days of [false,true]) {
    const rows=selectSingleElectionPolls(data.polls,election,{view,within30Days}).rows.map(row=>({...row,brand:brands.get(row.poll.institutionId)}));
    for (const query of ['', 'ETtoday', 'no-matching-institution']) {
      const filtered=filterAndSortRows(rows,{query,sortKey:'mae',direction:'asc'});
      const model=makeChartModel(election,filtered,filtered[0]?.poll.id);
      const points=filtered.filter(row=>Number.isFinite(row.evaluation.eligible?row.evaluation.mae:row.evaluation.provisionalMae));
      assert.deepEqual(model.pollIds,points.map(row=>row.poll.id));
      assert.deepEqual(model.data[1].y,[0]);
    }
  }
});
test('both point charts use drag-to-pan without changing their plotted scores or candidate order', () => {
  for (const id of ['2024-president', '2022-new-taipei', '2018-tainan']) {
    const election = data.elections.find(item => item.id === id);
    const rows = selectSingleElectionPolls(data.polls, election).rows;
    const model = makeChartModel(election, rows, rows[0].poll.id);
    assert.equal(model.layout.dragmode, 'pan');
    assert.equal(model.regions.length, election.comparisonCandidateIds.length);
    if (model.kind === 'scatter') {
      assert.equal(model.regions[1].name, model.winnerName);
      assert.deepEqual(model.data[0].y, rows.filter(row => model.pollIds.includes(row.poll.id)).map(row => row.evaluation.eligible ? row.evaluation.mae : row.evaluation.provisionalMae));
    } else assert.deepEqual(model.regions.map(candidate => candidate.id), election.comparisonCandidateIds);
  }
});
test('scatter zoom scope stays stable across selection and sorting, and resets for different data or elections', () => {
  const election = data.elections.find(item => item.id === '2022-new-taipei');
  const rows = selectSingleElectionPolls(data.polls, election).rows;
  const initial = makeChartModel(election, rows, rows[0].poll.id);
  const selected = makeChartModel(election, [...rows].reverse(), rows[1].poll.id);
  assert.equal(selected.layout.uirevision, initial.layout.uirevision);
  assert.deepEqual(selected.layout.xaxis.range, initial.layout.xaxis.range);
  assert.deepEqual(selected.layout.yaxis.range, initial.layout.yaxis.range);
  assert.notEqual(makeChartModel(election, rows.slice(1), rows[1].poll.id).layout.uirevision, initial.layout.uirevision);
  assert.notEqual(makeChartModel({ ...election, id: 'another-election' }, rows, rows[0].poll.id).layout.uirevision, initial.layout.uirevision);
});
test('ternary zoom scope is stable across selection and order but resets for a different plotted set', () => {
  const election = data.elections.find(item => item.id === '2024-president');
  const rows = selectSingleElectionPolls(data.polls, election).rows.filter(row => Number.isFinite(row.evaluation.provisionalMae) || row.evaluation.eligible);
  const initial = makeChartModel(election, rows, rows[0].poll.id);
  assert.equal(makeChartModel(election, [...rows].reverse(), rows[1].poll.id).layout.uirevision, initial.layout.uirevision);
  assert.notEqual(makeChartModel(election, rows.slice(1), rows[1].poll.id).layout.uirevision, initial.layout.uirevision);
  assert.notEqual(makeChartModel({ ...election, id: 'other' }, rows, rows[0].poll.id).layout.uirevision, initial.layout.uirevision);
});
test('selected markers are rendered once above the official star in both point charts', () => {
  for (const id of ['2024-president', '2022-new-taipei']) {
    const election = data.elections.find(item => item.id === id);
    const rows = selectSingleElectionPolls(data.polls, election).rows.filter(row => row.evaluation.eligible || Number.isFinite(row.evaluation.provisionalMae));
    for (const selected of [rows[0], rows[1]]) {
      const model = makeChartModel(election, rows, selected.poll.id);
      const traces = chartRenderTraces(model);
      assert.deepEqual(traces.map(trace => trace.uid), ['polls', 'official-result', 'selected-poll']);
      assert.deepEqual(traces[2].customdata, [selected.poll.id]);
      assert.ok(!traces[0].customdata.includes(selected.poll.id));
      assert.equal(new Set([...traces[0].customdata, ...traces[2].customdata]).size, model.pollIds.length);
      assert.deepEqual(chartPollPoint(model, selected.poll.id), model.kind === 'ternary' ? selected.evaluation.candidateIds.map(key => selected.evaluation.pollNormalized[key]) : [selected.evaluation.pollNormalized[model.regions[1].id], selected.evaluation.eligible ? selected.evaluation.mae : selected.evaluation.provisionalMae]);
      const reordered = { ...model, data: [...model.data].reverse() };
      assert.deepEqual(makeChartTooltip(election, reordered, rows, { pollId: selected.poll.id }), makeChartTooltip(election, model, rows, { pollId: selected.poll.id }));
      assert.deepEqual(makeChartTooltip(election, reordered, rows, { actual: true }), makeChartTooltip(election, model, rows, { actual: true }));
    }
  }
});
test('selected trace retains an exact overlap with the official star and supports an empty selection', () => {
  for (const id of ['2024-president', '2022-new-taipei']) {
    const election = data.elections.find(item => item.id === id);
    const rows = selectSingleElectionPolls(data.polls, election).rows;
    const model = makeChartModel(election, rows, rows[0].poll.id);
    const keys = model.kind === 'ternary' ? ['a', 'b', 'c'] : ['x', 'y'];
    const index = model.data[0].customdata.indexOf(model.selectedId);
    for (const key of keys) model.data[0][key][index] = model.data[1][key][0];
    const traces = chartRenderTraces(model);
    for (const key of keys) assert.deepEqual(traces[2][key], traces[1][key]);
    const empty = chartRenderTraces({ ...model, selectedId: 'no-point' });
    assert.deepEqual(empty[2].customdata, []);
    assert.deepEqual(empty[0].customdata, model.pollIds);
  }
});
test('ternary wheel zoom preserves the cursor anchor and clamps to the full triangle and 100x', () => {
  const initial = { kind: 'ternary', min: [0, 0, 0] };
  const weights = [0.4, 0.35, 0.25];
  const zoomed = zoomTernary(initial, weights, -100);
  const span = 100 - zoomed.min.reduce((a, b) => a + b, 0);
  assert.ok(span < 100 && span > 1);
  zoomed.min.forEach((value, i) => near(value + weights[i] * span, weights[i] * 100));
  zoomTernary(zoomed, weights, 100).min.forEach(value => near(value, 0));
  let deep = initial;
  for (let i = 0; i < 100; i++) deep = zoomTernary(deep, weights, -240);
  near(100 - deep.min.reduce((a, b) => a + b, 0), 1);
  for (let i = 0; i < 100; i++) deep = zoomTernary(deep, weights, 240);
  deep.min.forEach(value => near(value, 0));
});
test('ternary pointer conversion accepts triangle boundaries but ignores the outside rectangle', () => {
  const bounds = { left: 10, bottom: 100, width: 100, height: 90 };
  assert.deepEqual(ternaryWeights(bounds, 60, 10), [1, 0, 0]);
  assert.deepEqual(ternaryWeights(bounds, 10, 100), [0, 1, 0]);
  assert.deepEqual(ternaryWeights(bounds, 110, 100), [0, 0, 1]);
  assert.equal(ternaryWeights(bounds, 10, 10), null);
  assert.equal(ternaryWeights(bounds, 60, 101), null);
});
test('ternary focus moves only invisible points, preserving scale even at the triangle boundary', () => {
  const initial = { kind: 'ternary', min: [0, 0, 0] };
  const viewport = { kind: 'ternary', min: [40, 20, 20] };
  assert.equal(focusViewport(viewport, initial, [50, 25, 25]), viewport);
  assert.equal(focusViewport(initial, initial, [1, 1, 98]), initial);
  for (const point of [[10, 30, 60], [1, 0, 99], [100, 0, 0], [0, 100, 0], [0, 0, 100]]) {
    const focused = focusViewport(viewport, initial, point);
    near(focused.min.reduce((a, b) => a + b, 0), 80);
    assert.ok(focused.min.every((value, i) => value >= 0 && value <= point[i] + 1e-9));
  }
  assert.equal(focusViewport(viewport, initial, null), viewport);
  assert.equal(focusViewport(viewport, initial, [null, 50, 50]), viewport);
});
test('scatter focus preserves both spans, retains visible points, and clamps to meaningful boundaries', () => {
  const initial = { kind: 'scatter', x: [40, 80], y: [0, 20] };
  const viewport = { kind: 'scatter', x: [50, 60], y: [2, 7] };
  assert.equal(focusViewport(viewport, initial, [55, 5]), viewport);
  assert.equal(focusViewport(initial, initial, [95, 25]), initial);
  for (const point of [[75, 15], [99, 0]]) {
    const focused = focusViewport(viewport, initial, point);
    near(focused.x[1] - focused.x[0], 10);
    near(focused.y[1] - focused.y[0], 5);
    assert.ok(focused.x[0] >= 0 && focused.x[1] <= 100 && focused.y[0] >= 0);
    assert.ok(point[0] >= focused.x[0] && point[0] <= focused.x[1]);
    assert.ok(point[1] >= focused.y[0] && point[1] <= focused.y[1]);
  }
});
test('public relayout events and subsequent react layouts retain the latest viewport without mutating defaults', () => {
  const election = data.elections.find(item => item.id === '2022-new-taipei');
  const rows = selectSingleElectionPolls(data.polls, election).rows;
  const model = makeChartModel(election, rows, rows[0].poll.id);
  const initial = initialViewport(model);
  const moved = readViewportChange(initial, { 'xaxis.range[0]': 60, 'xaxis.range[1]': 65, 'yaxis.range': [1, 3] }, initial);
  const rendered = viewportLayout(model.layout, moved);
  assert.deepEqual(rendered.xaxis.range, [60, 65]);
  assert.deepEqual(rendered.yaxis.range, [1, 3]);
  assert.deepEqual(initialViewport(model), initial);
  rendered.xaxis.range[0] = 0;
  assert.deepEqual(moved.x, [60, 65]);
  const relayout = viewportRelayout(moved);
  relayout['yaxis.range'][0] = 0;
  assert.deepEqual(moved.y, [1, 3]);
  assert.deepEqual(readViewportChange(moved, { 'xaxis.autorange': true, 'yaxis.autorange': true }, initial), initial);
  const ternary = { kind: 'ternary', min: [0, 0, 0] };
  const zoomed = readViewportChange(ternary, { 'ternary.aaxis.min': 30, 'ternary.baxis.min': 30, 'ternary.caxis.min': 20 }, ternary);
  assert.deepEqual(viewportRelayout(zoomed), { 'ternary.aaxis.min': 30, 'ternary.baxis.min': 30, 'ternary.caxis.min': 20 });
  assert.equal(readViewportChange(zoomed, { 'ternary.aaxis.min': 80 }, ternary), zoomed);
});
test('two-candidate scatter keeps other points and the selected row when its score is missing', () => {
  const election=data.elections.find(e=>e.id==='2022-new-taipei');
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const missing={...rows[0],poll:{...rows[0].poll,id:'missing-score'},evaluation:{...rows[0].evaluation,eligible:false,mae:null,provisionalMae:null,pollNormalized:null}};
  const model=makeChartModel(election,[...rows,missing],missing.poll.id);
  assert.equal(model.kind,'scatter'); assert.equal(model.selectedId,missing.poll.id);
  assert.ok(!model.pollIds.includes(missing.poll.id)); assert.ok(model.pollIds.length>0);
  assert.ok(model.data[0].marker.size.every(size=>size===8));
  assert.match(model.note,/所選紀錄/); assert.deepEqual(model.data[1].y,[0]);
  const stale=makeChartModel(election,rows,'missing-id');
  assert.equal(stale.selectedId,''); assert.ok(stale.data[0].marker.size.every(size=>size===8));
  for (const emptyRows of [[],[missing]]) {
    const empty=makeChartModel(election,emptyRows,emptyRows[0]?.poll.id);
    assert.deepEqual(empty.data[0].x,[]); assert.deepEqual(empty.data[0].y,[]);
    assert.equal(empty.data[1].x.length,1); assert.deepEqual(empty.data[1].y,[0]);
    assert.match(empty.note,/沒有可計算/);
  }
});
test('two-candidate scatter uses existing formal or provisional scores including zero without substituting missing values', () => {
  const election=data.elections.find(e=>e.id==='2022-new-taipei');
  const [row]=selectSingleElectionPolls(data.polls,election).rows;
  const formal={...row,poll:{...row.poll,id:'formal'},evaluation:{...row.evaluation,eligible:true,mae:7,provisionalMae:3}};
  const zero={...row,poll:{...row.poll,id:'zero',fieldworkEnd:null},evaluation:{...row.evaluation,eligible:false,mae:null,provisionalMae:0}};
  const missing={...row,poll:{...row.poll,id:'null'},evaluation:{...row.evaluation,eligible:false,mae:null,provisionalMae:null}};
  const different={...row,poll:{...row.poll,id:'different-pair'},evaluation:{...row.evaluation,candidateIds:['outside','pair']}};
  const model=makeChartModel(election,[formal,zero,missing,different],zero.poll.id);
  assert.deepEqual(model.data[0].customdata,['formal','zero']);
  assert.deepEqual(model.data[0].y,[7,0]); assert.match(model.data[0].text[1],/日期未知/);
  assert.equal(model.data[0].marker.size[1],13);
});
test('two-candidate scatter explains missing, tied or excluded official winners instead of guessing', () => {
  const election=data.elections.find(e=>e.id==='2024-president');
  const pair={...election,comparisonCandidateIds:['賴清德','侯友宜']};
  const missing={...pair,result:{...pair.result,votes:{...pair.result.votes,'柯文哲':null}}};
  assert.match(makeChartModel(missing,[]).reason,/官方票數資料不足/);
  const inconsistent={...pair,result:{...pair.result,validVotes:1}};
  assert.match(makeChartModel(inconsistent,[]).reason,/官方票數資料不足/);
  const tied={...pair,result:{...pair.result,votes:{'賴清德':600,'侯友宜':600,'柯文哲':100},validVotes:1300}};
  assert.match(makeChartModel(tied,[]).reason,/最高票不唯一/);
  const outside={...election,comparisonCandidateIds:['侯友宜','柯文哲']};
  assert.match(makeChartModel(outside,[]).reason,/當選人不在/);
  assert.equal(makeChartModel(outside,[]).kind,'unavailable');
});
test('ternary backgrounds partition the triangle into three candidate-leading regions without interactive points', () => {
  const election=data.elections.find(e=>e.id==='2024-president');
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const model=makeChartModel(election,rows,rows[0].poll.id);
  assert.equal(model.backgroundData.length,3);
  assert.deepEqual(model.regions.map(region=>region.id),election.comparisonCandidateIds);
  model.backgroundData.forEach((trace,index)=>{
    assert.equal(trace.fill,'toself'); assert.equal(trace.hoverinfo,'skip');
    assert.equal(trace.showlegend,false); assert.equal(trace.customdata,undefined);
    assert.equal(trace.fillcolor,model.regions[index].fill);
    const vertices=trace.a.map((a,i)=>[a,trace.b[i],trace.c[i]]);
    for(const vertex of vertices) {
      near(vertex.reduce((sum,value)=>sum+value,0),100);
      assert.ok(vertex.every(value=>value<=vertex[index]));
    }
    const area=Math.abs(vertices.reduce((sum,point,i)=>{
      const next=vertices[(i+1)%vertices.length];
      return sum+point[1]*next[2]-next[1]*point[2];
    },0))/2;
    near(area,5000/3);
  });
  assert.ok(model.regions[0].fill.startsWith('rgba(33, 145, 91,'));
  assert.ok(model.regions[1].fill.startsWith('rgba(51, 104, 190,'));
  assert.ok(model.regions[2].fill.startsWith('rgba(27, 162, 166,'));
  assert.equal(model.data[1].marker.symbol,'star');
});
test('region colors use each election party rather than current candidate affiliation or position', () => {
  const election=data.elections.find(e=>e.id==='2018-taipei');
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const model=makeChartModel(election,rows,rows[0].poll.id);
  assert.equal(model.regions.find(region=>region.id==='柯文哲').fill,'rgba(125, 135, 149, 0.08)');
  const reordered={...election,comparisonCandidateIds:[...election.comparisonCandidateIds].reverse()};
  const reversedRows=rows.map(row=>({...row,evaluation:evaluatePoll(row.poll,reordered)}));
  const reversed=makeChartModel(reordered,reversedRows,rows[0].poll.id);
  for(const region of model.regions) assert.equal(reversed.regions.find(item=>item.id===region.id).fill,region.fill);
  const unknown={...election,candidates:election.candidates.map(candidate=>({...candidate,party:undefined}))};
  assert.ok(makeChartModel(unknown,rows,rows[0].poll.id).regions.every(region=>region.fill==='rgba(125, 135, 149, 0.08)'));
});
test('scatter backgrounds split at 50 percent with the actual winner on the right, regardless of candidate order', () => {
  for(const id of ['2022-new-taipei','2018-tainan']) {
    const election=data.elections.find(e=>e.id===id);
    const rows=selectSingleElectionPolls(data.polls,election).rows;
    const model=makeChartModel(election,rows,rows[0]?.poll.id);
    const [left,right,boundary]=model.layout.shapes;
    assert.deepEqual([left.x0,left.x1,right.x0,right.x1,boundary.x0,boundary.x1],[0,50,50,100,50,50]);
    assert.ok(model.layout.shapes.every(shape=>shape.layer==='below' && shape.yref==='paper' && shape.y0===0 && shape.y1===1));
    assert.ok(model.layout.xaxis.range[0]<50 && model.layout.xaxis.range[1]>50);
    assert.equal(model.regions[1].name,model.winnerName);
    assert.equal(right.fillcolor,model.regions[1].fill);
    assert.equal(left.fillcolor,model.regions[0].fill);
  }
});
test('chart tooltip content retains institution, date, candidate values and existing MAE without HTML', () => {
  const election=data.elections.find(e=>e.id==='2022-new-taipei');
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const row={...rows[0],brand:'很長的機構名稱 <測試>',poll:{...rows[0].poll,fieldworkEnd:null},evaluation:{...rows[0].evaluation,eligible:false,mae:null,provisionalMae:7}};
  const model=makeChartModel(election,[row],row.poll.id);
  const tooltip=makeChartTooltip(election,model,[row],{pollId:row.poll.id});
  assert.equal(tooltip.title,row.brand); assert.equal(tooltip.date,'日期未知');
  assert.equal(tooltip.lines[0],`${model.winnerName}：${model.data[0].x[0].toFixed(2)}%`);
  assert.equal(tooltip.lines[1],'平均絕對誤差（MAE）：7.00 百分點');
  const actual=makeChartTooltip(election,model,[row],{actual:true});
  assert.equal(actual.title,'大選結果'); assert.equal(actual.date,election.date);
  assert.equal(actual.lines[1],'平均絕對誤差（MAE）：0.00 百分點');
  assert.equal(makeChartTooltip(election,model,[row],{pollId:'missing'}),null);
  assert.equal(makeChartTooltip(election,{kind:'unavailable'},[],{actual:true}),null);
  const three=data.elections.find(e=>e.id==='2024-president');
  const threeRows=selectSingleElectionPolls(data.polls,three).rows;
  const triangle=makeChartModel(three,threeRows,threeRows[0].poll.id);
  const triangleTip=makeChartTooltip(three,triangle,threeRows,{pollId:threeRows[0].poll.id});
  assert.equal(triangleTip.lines.length,3);
  three.comparisonCandidateIds.forEach((id,index)=>assert.equal(triangleTip.lines[index],`${id}：${triangle.data[0][['a','b','c'][index]][0].toFixed(2)}%`));
});
test('region tooltips name every compared candidate without poll metadata or changing scores', () => {
  for (const id of ['2022-new-taipei', '2024-president']) {
    const election = data.elections.find(item => item.id === id);
    const rows = selectSingleElectionPolls(data.polls, election).rows;
    const model = makeChartModel(election, rows, rows[0].poll.id);
    const scores = rows.map(row => row.evaluation);
    for (const region of model.regions) assert.deepEqual(makeChartTooltip(election, model, rows, { regionId: region.id }), { title: `${region.name}勝選區`, lines: [] });
    assert.equal(makeChartTooltip(election, model, rows, { regionId: 'unknown' }), null);
    assert.deepEqual(rows.map(row => row.evaluation), scores);
  }
});
test('the real all-brand comparison has unique labels, keeps source identities and shares CSV scores with the table', () => {
  const originalIdentities = data.polls.map(poll => [poll.id, poll.institutionId]);
  const comparison = compareInstitutionBrands(data, { within30Days: false });
  assert.equal(comparison.rows.length, institutionGroups(data.institutions).length);
  assert.ok(comparison.rows.length < new Set(data.institutions.map(institution => institution.brand)).size);
  assert.equal(new Set(comparison.rows.map(row => row.brand)).size, comparison.rows.length);
  for (const brand of ['三立', '東森', '美麗島電子報', '國民黨', '民進黨']) assert.equal(comparison.rows.filter(row => row.brand === brand).length, 1);
  assert.deepEqual(data.polls.map(poll => [poll.id, poll.institutionId]), originalIdentities);
  assert.ok(comparison.exportRows.length > 0);
  for (const row of comparison.exportRows) {
    assert.equal(row.poll, data.polls.find(poll => poll.id === row.poll.id));
    assert.equal(row.evaluation.eligible, true);
    const group = comparison.rows.find(item => item.memberIds.includes(row.poll.institutionId));
    const point = group.availablePerElection.find(item => item.pollId === row.poll.id);
    near(point.mae, row.evaluation.mae);
    assert.ok(row.poll.source.url.startsWith('http'));
  }
});
test('more than three candidates retain grouped proportion bars', () => {
  const ids=['a','b','c','d']; const e={candidates:ids.map(id=>({id,name:id}))};
  const r={poll:{id:'unit-only'},evaluation:{eligible:true,candidateIds:ids,pollNormalized:{a:25,b:25,c:25,d:25},resultNormalized:{a:40,b:30,c:20,d:10}}};
  assert.equal(makeChartModel(e,[r],r.poll.id).kind,'bar');
  assert.equal(makeChartModel(e,[{...r,evaluation:{...r.evaluation,eligible:false}}],r.poll.id),null);
});
test('CSV primary score and calculation remain normalized, even when original values are displayed', () => {
  const election=data.elections.find(e=>e.id==='2024-president');
  const rows=selectElectionPolls(data.polls,election);
  const csv=exportCsv(rows,data);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('normalized_mae_pp')); assert.ok(csv.includes('poll_raw_pct[賴清德]'));
  const cells=[]; let row=[], cell='', quoted=false;
  for(let i=1;i<csv.length;i++) { const ch=csv[i]; if(ch==='"') { if(quoted && csv[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; } else if(ch===',' && !quoted) {row.push(cell);cell='';} else if(ch==='\n' && !quoted) {row.push(cell.replace(/\r$/,''));cells.push(row);row=[];cell='';} else cell+=ch; }
  const headers=cells.shift(); const mapped=cells.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]])));
  const tvbs=mapped.find(r=>r.poll_id==='2024-president-tvbs');
  near(Number(tvbs.mae_percentage_points),1.2027391681857555);
  assert.equal(tvbs.primary_score,'normalized_mae_pp');
  assert.equal(tvbs.poll_source_url,'https://news.tvbs.com.tw/politics/2353891');
});

test('ternary overview preserves an unplottable selection and never substitutes the first poll', () => {
  const election=data.elections.find(e=>e.id==='2024-president');
  const rows=selectElectionPolls(data.polls,election);
  const pending={...rows[0],poll:{...rows[0].poll,id:'unit-pending'},evaluation:{...rows[0].evaluation,eligible:false,mae:null,provisionalMae:null}};
  const model=makeChartModel(election,[...rows,pending],'unit-pending');
  assert.equal(model.selectedId,'unit-pending');
  assert.deepEqual(model.pollIds,rows.map(row=>row.poll.id));
  assert.deepEqual(chartRenderTraces(model).at(-1).customdata,[]);
  assert.match(model.note,/無可繪製點/);
  assert.equal(makeChartModel(election,rows,'missing-id').selectedId,'');
  assert.equal(makeChartModel(election,rows,undefined).selectedId,'');
});

test('both point charts build complete unselected overviews and clearing retains their viewport scope', () => {
  for (const id of ['2024-president','2022-new-taipei']) {
    const election=data.elections.find(election=>election.id===id);
    const rows=selectSingleElectionPolls(data.polls,election).rows;
    const selected=makeChartModel(election,rows,rows[0].poll.id);
    const overview=makeChartModel(election,rows);
    assert.equal(overview.selectedId,'');
    assert.deepEqual(overview.pollIds,selected.pollIds);
    assert.deepEqual(overview.data[1],selected.data[1]);
    assert.ok(overview.data[0].marker.size.every(size=>size===8));
    assert.deepEqual(chartRenderTraces(overview).at(-1).customdata,[]);
    assert.equal(overview.layout.uirevision,selected.layout.uirevision);
    assert.deepEqual(initialViewport(overview),initialViewport(selected));
    const empty=makeChartModel(election,[]);
    assert.deepEqual(empty.pollIds,[]);
    assert.deepEqual(empty.data[1],overview.data[1]);
    assert.match(empty.note,/僅顯示大選結果/);
    assert.equal(empty.regions.length,election.comparisonCandidateIds.length);
  }
});

test('unselected ternary uses the election candidate order and same-set official denominator', () => {
  const election=data.elections.find(election=>election.id==='2024-president');
  const rows=selectSingleElectionPolls(data.polls,election).rows;
  const reordered={...election,comparisonCandidateIds:[...election.comparisonCandidateIds].reverse()};
  const model=makeChartModel(reordered,rows);
  assert.deepEqual(model.regions.map(region=>region.id),reordered.comparisonCandidateIds);
  const point=chartPollPoint(model,rows[0].poll.id);
  point.forEach((value,index)=>near(value,rows[0].evaluation.pollNormalized[reordered.comparisonCandidateIds[index]]));
  const extra={...election,candidates:[...election.candidates,{id:'outside',name:'outside'}],result:{...election.result,validVotes:election.result.validVotes+100,votes:{...election.result.votes,outside:100}}};
  const subset=makeChartModel(extra,rows);
  for (const axis of ['a','b','c']) near(subset.data[1][axis][0],makeChartModel(election,rows).data[1][axis][0]);
  const incomplete={...election,result:{...election.result,votes:{...election.result.votes,[election.comparisonCandidateIds[0]]:null}}};
  assert.equal(makeChartModel(incomplete,rows).kind,'unavailable');
});

test('unselected larger candidate charts show only official proportions', () => {
  const ids=['a','b','c','d'];
  const election={candidates:ids.map(id=>({id,name:id})),result:{status:'verified',votes:{a:40,b:30,c:20,d:10},validVotes:100}};
  const model=makeChartModel(election,[]);
  assert.equal(model.kind,'bar'); assert.equal(model.selectedId,'');
  assert.equal(model.data.length,1); assert.equal(model.data[0].name,'實際結果');
  assert.deepEqual(model.data[0].x,[40,30,20,10]);
});

test('all 26 chart candidates have one attributed local portrait with intact image bytes', async () => {
  const ids=new Set(data.elections.flatMap(election=>election.comparisonCandidateIds));
  assert.equal(ids.size,26); assert.equal(candidatePortraits.length,26);
  assert.equal(new Set(candidatePortraits.map(portrait=>portrait.src)).size,26);
  assert.deepEqual(new Set(portraitByCandidate.keys()),ids);
  for (const portrait of candidatePortraits) {
    assert.match(portrait.src,/^\/candidate-portraits\/q\d+\.(jpg|png)$/);
    assert.ok(portrait.author.length>1); assert.ok(portrait.license.length>2);
    assert.equal(new URL(portrait.sourceUrl).hostname,'commons.wikimedia.org');
    assert.ok(['http:','https:'].includes(new URL(portrait.originalSourceUrl).protocol));
    assert.ok(['http:','https:'].includes(new URL(portrait.licenseUrl).protocol));
    const bytes=await readFile(new URL(`../public${portrait.src}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),portrait.sha256);
    assert.ok(portrait.src.endsWith('.png') ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0]===255 && bytes[1]===216 && bytes[2]===255);
  }
});
test('official result rendering model preserves missing values and derives only a complete total', () => {
  const election={candidates:[{id:'a'},{id:'b'}],result:{votes:{a:600,b:400},validVotes:null}};
  assert.deepEqual(officialResultSummary(election),{total:1000,complete:true,totalFrom:'candidate-sum',rawPercent:{a:60,b:40}});
  const partial=officialResultSummary({...election,result:{votes:{a:600,b:null},validVotes:null}});
  assert.equal(partial.total,null); assert.equal(partial.complete,false); assert.deepEqual(partial.rawPercent,{a:null,b:null});
  const knownTotal=officialResultSummary({...election,result:{votes:{a:600,b:null},validVotes:1000}});
  assert.equal(knownTotal.rawPercent.a,60); assert.equal(knownTotal.rawPercent.b,null); assert.equal(knownTotal.complete,false);
  const conflict=officialResultSummary({...election,result:{votes:{a:600,b:400},validVotes:999}});
  assert.equal(conflict.total,null); assert.equal(conflict.complete,false);
  assert.equal(formatVoteCount(null),'—'); assert.equal(formatVoteCount(undefined),'—'); assert.equal(formatVoteCount(0),'0');
});

test('2026-10-17 added surveys retain audited dates, poll shares, sample sizes and honest missing categories', () => {
  const expected = [
    ['2018-kaohsiung-tvbs', '2018-11-06', 1077, { '陳其邁': 38, '韓國瑜': 48 }],
    ['2018-new-taipei-tvbs', '2018-11-11', 1078, { '蘇貞昌': 34, '侯友宜': 48 }],
    ['2018-taichung-tvbs', '2018-11-09', 1309, { '林佳龍': 39, '盧秀燕': 41 }],
    ['2022-hsinchu-city-tvbs', '2022-11-12', 852, { '高虹安': 33, '沈慧虹': 28, '林耕仁': 19 }],
    ['2022-new-taipei-ettoday', '2022-11-14', 1846, { '侯友宜': 51.2, '林佳龍': 31.7 }],
    ['2022-taoyuan-ettoday', '2022-11-14', 1242, { '張善政': 38.2, '鄭運鵬': 35.3 }],
  ];
  assert.equal(legacyPolls.length, 98);
  assert.equal(new Set(legacyPolls.map(p => p.electionId)).size, 10);
  assert.equal(data.version, '1.3.0+20261018');
  for (const [id, end, size, shares] of expected) {
    const p = raw.polls.find(p => p.id === id);
    assert.ok(p, id);
    assert.equal(p.fieldwork_end, end, id);
    assert.equal(p.sample_size_total, size, id);
    assert.deepEqual(p.raw_support_percent, shares, id);
    assert.ok(p.sources.every(source => /^https:\/\//.test(source.url)), id);
  }
  assert.equal(data.polls.find(p => p.id === '2018-taichung-tvbs').other, 1);
  for (const id of ['2022-hsinchu-city-tvbs', '2022-new-taipei-ettoday', '2022-taoyuan-ettoday']) {
    assert.equal(data.polls.find(p => p.id === id).undecided, null, id);
  }
  for (const id of ['2022-new-taipei-ettoday', '2022-taoyuan-ettoday']) {
    const poll = data.polls.find(p => p.id === id);
    assert.equal(poll.isExplicitFinal, true);
    assert.ok(poll.sources.some(source => source.access_method === 'full_public_text'));
    assert.ok(poll.sources.some(source => source.access_method === 'original_url_secondary_reprint_verified' || source.kind?.startsWith('primary_')));
  }
});

test('new verified coverage adds only qualifying shared elections', () => {
  const comparison = commonElectionComparison(data, ['tvbs__tvbs-poll-center', 'formosa__beacon']);
  assert.deepEqual(new Set(comparison.commonElectionIds), new Set(['2018-taipei', '2018-new-taipei', '2020-president', '2022-taipei', '2024-president']));
  assert.equal(comparison.rows.find(r => r.institutionId === 'tvbs__tvbs-poll-center').availableElectionIds.length, 9);
  const ettoday = commonElectionComparison(data, ['ettoday__ettoday-poll-cloud']);
  assert.equal(ettoday.commonElectionIds.length, 5);
  assert.equal(ettoday.rows[0].missingElectionIds.length, 9);
});

test('the original 83-record 2024 index remains traceable after primary enrichment', async () => {
  const index = JSON.parse(await readFile(new URL('../source-data/wikipedia-2024-index.json', import.meta.url), 'utf8'));
  assert.equal(index.records.length, 83);
  assert.deepEqual(Object.fromEntries(['media', 'rolling', 'internal', 'street'].map(group => [group, index.records.filter(r => r.sourceGroup === group).length])), { media: 50, rolling: 23, internal: 9, street: 1 });
  const originals = legacyPolls.filter(p => p.electionId === '2024-president');
  assert.equal(originals.length, 83);
  assert.equal(new Set(originals.map(p => p.id)).size, 83);
  assert.equal(new Set(originals.map(p => data.institutions.find(i => i.id === p.institutionId)?.brand)).size, 21);
  assert.equal(originals.filter(p => p.status === 'verified').length, 64);
  assert.equal(originals.filter(p => p.status === 'pending').length, 19);
  for (const poll of originals.filter(p => p.status === 'pending')) {
    assert.equal(poll.isExplicitFinal, false, poll.id);
    assert.ok(poll.sources.some(src => src.kind === 'secondary_table_index'), poll.id);
    const evaluation = evaluatePoll(poll, data.elections.find(e => e.id === '2024-president'), { within30Days: false });
    assert.equal(evaluation.mae, null, poll.id);
  }
  const historical = { ...data, elections: data.elections.filter(e => ['2018-taipei', '2020-president', '2022-taipei', '2024-president'].includes(e.id)) };
  const comparison = commonElectionComparison(historical, ['tvbs__tvbs-poll-center', 'formosa__beacon']);
  assert.equal(comparison.commonElectionIds.length, 4);
  near(comparison.rows[0].average, 2.126441481972856);
  near(comparison.rows[1].average, 5.165315211202318);
});
