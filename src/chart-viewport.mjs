const AXES = ['aaxis', 'baxis', 'caxis'];
const sum = values => values.reduce((total, value) => total + value, 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function supportRange(range) {
  const span = Math.min(100, range[1] - range[0]);
  const lower = clamp(range[0], 0, 100 - span);
  return [lower, lower + span];
}

export function initialViewport(model) {
  if (model.kind === 'ternary') return { kind: 'ternary', min: [0, 0, 0] };
  if (model.kind === 'strip') return { kind: 'strip', x: [...model.layout.xaxis.range], y: [...model.layout.yaxis.range] };
  return null;
}

export function viewportLayout(layout, viewport) {
  if (viewport?.kind === 'ternary') return { ...layout, ternary: { ...layout.ternary, ...Object.fromEntries(AXES.map((axis, i) => [axis, { ...layout.ternary[axis], min: viewport.min[i] }])) } };
  if (viewport?.kind === 'strip') return { ...layout, xaxis: { ...layout.xaxis, range: [...viewport.x], autorange: false }, yaxis: { ...layout.yaxis, range: [...viewport.y], autorange: false } };
  return layout;
}

export function viewportRelayout(viewport) {
  if (viewport.kind === 'ternary') return Object.fromEntries(AXES.map((axis, i) => [`ternary.${axis}.min`, viewport.min[i]]));
  return { 'xaxis.range': [...viewport.x], 'yaxis.range': [...viewport.y], 'xaxis.autorange': false, 'yaxis.autorange': false };
}

export function readViewportChange(viewport, change, initial) {
  if (!viewport) return null;
  if (viewport.kind === 'ternary') {
    const min = AXES.map((axis, i) => change[`ternary.${axis}.min`] ?? viewport.min[i]);
    return min.every(value => Number.isFinite(value) && value >= 0) && sum(min) < 100 ? { ...viewport, min } : viewport;
  }
  const range = axis => {
    if (viewport.kind === 'strip' && axis === 'y') return initial.y;
    if (change[`${axis}axis.autorange`] === true) return initial[axis];
    const values = change[`${axis}axis.range`] || viewport[axis].map((value, i) => change[`${axis}axis.range[${i}]`] ?? value);
    const result = values;
    if (!result.every(Number.isFinite) || result[1] <= result[0]) return viewport[axis];
    return supportRange([result[0], result[0] + clamp(result[1] - result[0], 1, 100)]);
  };
  return { ...viewport, x: range('x'), y: range('y') };
}

// Project onto the nonnegative simplex so a boundary never changes the scale.
function projectMin(values, total) {
  if (total <= 0) return [0, 0, 0];
  const sorted = [...values].sort((a, b) => b - a);
  let prefix = 0;
  let threshold = 0;
  sorted.forEach((value, i) => {
    prefix += value;
    const next = (prefix - total) / (i + 1);
    if (value > next) threshold = next;
  });
  return values.map(value => Math.max(0, value - threshold));
}

export function ternaryWeights(bounds, x, y) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  const a = (bounds.bottom - y) / bounds.height;
  const c = (x - bounds.left) / bounds.width - a / 2;
  const b = 1 - a - c;
  return [a, b, c].every(value => value >= -1e-9 && value <= 1 + 1e-9) ? [a, b, c].map(value => clamp(value, 0, 1)) : null;
}

export function zoomTernary(viewport, weights, delta) {
  const span = 100 - sum(viewport.min);
  const nextSpan = clamp(span * Math.exp(clamp(delta, -240, 240) / 1000), 1, 100);
  const anchor = viewport.min.map((value, i) => value + weights[i] * span);
  return { kind: 'ternary', min: projectMin(anchor.map((value, i) => value - weights[i] * nextSpan), 100 - nextSpan) };
}

export function touchViewport(viewport, bounds, start, current) {
  if (!viewport || !bounds || bounds.width <= 0 || bounds.height <= 0) return viewport;
  const factor = start.distance > 0 && current.distance > 0 ? start.distance / current.distance : 1;
  if (!Number.isFinite(factor) || factor <= 0) return viewport;
  const position = point => {
    const x = (point.x - bounds.left) / bounds.width;
    const y = (bounds.bottom - point.y) / bounds.height;
    return viewport.kind === 'ternary' ? [y, 1 - y / 2 - x, x - y / 2] : [x, y];
  };
  const from = position(start);
  const to = position(current);
  if (![...from, ...to].every(Number.isFinite)) return viewport;
  if (viewport.kind === 'ternary') {
    const span = 100 - sum(viewport.min);
    const nextSpan = clamp(span * factor, 1, 100);
    return { kind: 'ternary', min: projectMin(viewport.min.map((value, i) => value + from[i] * span - to[i] * nextSpan), 100 - nextSpan) };
  }
  if (viewport.kind === 'strip') {
    const span = viewport.x[1] - viewport.x[0];
    const nextSpan = clamp(span * factor, 1, 100);
    const lower = viewport.x[0] + from[0] * span - to[0] * nextSpan;
    return { ...viewport, x: supportRange([lower, lower + nextSpan]) };
  }
  return viewport;
}

export function focusViewport(viewport, initial, points) {
  if (!viewport || !points) return viewport;
  const dimensions = viewport.kind === 'ternary' ? 3 : 2;
  const candidates = (Array.isArray(points[0]) ? points : [points]).filter(point => Array.isArray(point) && point.length === dimensions && point.every(Number.isFinite));
  if (!candidates.length) return viewport;
  if (viewport.kind === 'ternary') {
    const span = 100 - sum(viewport.min);
    if (span >= 100 - 1e-9 || candidates.some(point => point.every((value, i) => value >= viewport.min[i] - 1e-9))) return viewport;
    const point = candidates[0];
    return { ...viewport, min: projectMin(point.map(value => value - span / 3), 100 - span) };
  }
  if (viewport.kind === 'strip') {
    if (candidates.some(point => point[0] >= viewport.x[0] && point[0] <= viewport.x[1])) return viewport;
    const distance = point => Math.abs(point[0] - clamp(point[0], ...viewport.x));
    const point = candidates.reduce((closest, candidate) => distance(candidate) < distance(closest) ? candidate : closest);
    const span = viewport.x[1] - viewport.x[0];
    const lower = point[0] - span / 2;
    return { ...viewport, x: supportRange([lower, lower + span]) };
  }
  return viewport;
}
