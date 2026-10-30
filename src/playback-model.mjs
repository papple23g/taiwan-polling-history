import { calendarDay } from './domain.mjs';
import { publisherBrandId } from './publisher-brand.mjs';

const DAY = 86_400_000;
const PLAYBACK_BASE_RATE = 4;

export const playbackElapsed = (elapsedMs, speed) => elapsedMs * speed * PLAYBACK_BASE_RATE;

export function makePlaybackTimeline(election, rows, chart) {
  const supported = ['strip', 'ternary'].includes(chart?.kind);
  if (!supported) return { supported: false, records: [], dates: [], start: null, end: null, missingDateCount: 0, unplottableCount: rows.length };
  const plotted = new Set(chart.pollIds || []);
  const records = rows.flatMap(row => {
    const day = calendarDay(row.poll.fieldworkStart);
    return plotted.has(row.poll.id) && day !== null ? [{ row, day, brandId: publisherBrandId(row.brand) }] : [];
  }).sort((a, b) => a.day - b.day || a.row.poll.id.localeCompare(b.row.poll.id));
  const dates = [];
  for (const record of records) {
    const previous = dates.at(-1);
    if (previous?.day === record.day) previous.count++;
    else dates.push({ day: record.day, count: 1 });
  }
  const electionDay = election.phase === 'pre_result' ? null : calendarDay(election.date);
  const first = dates[0]?.day ?? null;
  const last = dates.at(-1)?.day ?? null;
  return {
    supported, records, dates, electionDay,
    start: first === null ? null : electionDay === null ? first : Math.min(first, electionDay),
    end: last === null ? null : electionDay === null ? last : Math.max(last, electionDay),
    missingDateCount: rows.filter(row => plotted.has(row.poll.id) && calendarDay(row.poll.fieldworkStart) === null).length,
    unplottableCount: rows.filter(row => !plotted.has(row.poll.id)).length,
  };
}

export function playbackSnapshot(timeline, day) {
  const brands = new Map();
  for (const record of timeline.records) {
    if (record.day > day) break;
    const current = brands.get(record.brandId);
    if (!current || current.day < record.day) brands.set(record.brandId, { day: record.day, rows: [record.row] });
    else current.rows.push(record.row);
  }
  return [...brands.values()].flatMap(group => group.rows);
}

export function playbackResultVisible(timeline, day) {
  return timeline.electionDay !== null && Number.isFinite(day) && day >= timeline.electionDay;
}

export function playbackChartModel(model, rows, resultVisible, selectedId) {
  if (!model || !['strip', 'ternary'].includes(model.kind)) return model;
  const ids = new Set(rows.map(row => row.poll.id));
  const data = model.data.flatMap(trace => {
    if (trace.uid === 'official-result') return resultVisible ? [trace] : [];
    if (!Array.isArray(trace.customdata)) return [trace];
    const indices = trace.customdata.flatMap((id, index) => ids.has(id) ? [index] : []);
    const next = { ...trace, marker: { ...trace.marker } };
    for (const key of ['x', 'y', 'a', 'b', 'c', 'customdata', 'candidateIds', 'text', 'hovertext']) {
      if (Array.isArray(trace[key])) next[key] = indices.map(index => trace[key][index]);
    }
    if (Array.isArray(trace.textfont?.color)) {
      next.textfont = { ...trace.textfont, color: indices.map(index => trace.textfont.color[index]) };
    }
    for (const key of ['size', 'color', 'symbol', 'opacity']) {
      if (Array.isArray(trace.marker?.[key])) next.marker[key] = indices.map(index => trace.marker[key][index]);
    }
    if (trace.marker?.line) {
      next.marker.line = { ...trace.marker.line };
      for (const key of ['color', 'width']) if (Array.isArray(trace.marker.line[key])) next.marker.line[key] = indices.map(index => trace.marker.line[key][index]);
    }
    return [next];
  });
  return { ...model, data, pollIds: [...ids], selectedId: ids.has(selectedId) ? selectedId : '', note: '',
    layout: { ...model.layout, ...(model.kind === 'ternary' ? { margin: { ...model.layout.margin, t: 100, b: 54 } } : {}),
      datarevision: JSON.stringify([model.layout?.datarevision, [...ids].sort(), resultVisible]) } };
}

export const playbackDay = value => Number.isFinite(value) ? Math.floor(value / DAY) * DAY : null;
export const playbackDate = value => Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : '';
export function playbackDaysUntilElection(electionDate, day) {
  const electionDay = calendarDay(electionDate);
  return electionDay === null || !Number.isFinite(day) ? null : (electionDay - playbackDay(day)) / DAY;
}
