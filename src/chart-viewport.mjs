const AXES = ['aaxis', 'baxis', 'caxis'];
const sum = values => values.reduce((total, value) => total + value, 0);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function initialViewport(model) {
  if (model.kind === 'ternary') return { kind: 'ternary', min: [0, 0, 0] };
  if (model.kind === 'scatter') return { kind: 'scatter', x: [...model.layout.xaxis.range], y: [...model.layout.yaxis.range] };
  return null;
}

export function viewportLayout(layout, viewport) {
  if (viewport?.kind === 'ternary') return { ...layout, ternary: { ...layout.ternary, ...Object.fromEntries(AXES.map((axis, i) => [axis, { ...layout.ternary[axis], min: viewport.min[i] }])) } };
  if (viewport?.kind === 'scatter') return { ...layout, xaxis: { ...layout.xaxis, range: [...viewport.x], autorange: false }, yaxis: { ...layout.yaxis, range: [...viewport.y], autorange: false } };
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
    if (change[`${axis}axis.autorange`] === true) return initial[axis];
    const result = change[`${axis}axis.range`] || viewport[axis].map((value, i) => change[`${axis}axis.range[${i}]`] ?? value);
    return result.every(Number.isFinite) && result[1] > result[0] ? [...result] : viewport[axis];
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

export function focusViewport(viewport, initial, point) {
  if (!viewport || !point?.every(Number.isFinite)) return viewport;
  if (viewport.kind === 'ternary') {
    const span = 100 - sum(viewport.min);
    if (span >= 100 - 1e-9 || point.every((value, i) => value >= viewport.min[i] - 1e-9)) return viewport;
    return { ...viewport, min: projectMin(point.map(value => value - span / 3), 100 - span) };
  }
  const spans = ['x', 'y'].map(axis => viewport[axis][1] - viewport[axis][0]);
  const zoomed = ['x', 'y'].some((axis, i) => spans[i] < initial[axis][1] - initial[axis][0] - 1e-9);
  if (!zoomed || ['x', 'y'].every((axis, i) => point[i] >= viewport[axis][0] && point[i] <= viewport[axis][1])) return viewport;
  const left = spans[0] <= 100 ? clamp(point[0] - spans[0] / 2, 0, 100 - spans[0]) : point[0] - spans[0] / 2;
  const bottom = Math.max(0, point[1] - spans[1] / 2);
  return { kind: 'scatter', x: [left, left + spans[0]], y: [bottom, bottom + spans[1]] };
}
