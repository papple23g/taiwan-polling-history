function clipPolygon(points, side) {
  const output = [];
  for (let index = 0; index < points.length; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const a = side(start);
    const b = side(end);
    if (a >= -1e-9) output.push(start);
    if ((a >= 0) !== (b >= 0)) {
      const ratio = a / (a - b);
      output.push(start.map((value, axis) => value + (end[axis] - value) * ratio));
    }
  }
  return output;
}

export function polygonPath(points) {
  return points.length < 3 ? '' : `M${points.map(point => point.map(value => +value.toFixed(4)).join(',')).join('L')}Z`;
}

export function candidateScaleGeometry(area, viewport, index) {
  if (!area || ![0, 1, 2].includes(index) || viewport?.kind !== 'ternary'
    || viewport.min?.length !== 3 || !viewport.min.every(value => Number.isFinite(value) && value >= 0)) return null;
  const { left, right, top, bottom } = area;
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  const span = 100 - viewport.min.reduce((total, value) => total + value, 0);
  if (span <= 0) return null;
  const vertices = [[(left + right) / 2, top], [left, bottom], [right, bottom]];
  const vertex = vertices[index];
  const others = vertices.filter((_, other) => other !== index);
  const minimum = viewport.min[index], maximum = minimum + span;
  const target = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= target - 1e-10);
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const center = [(left + right) / 2, (top + 2 * bottom) / 3];
  const edges = others.map(other => {
    const dx = other[0] - vertex[0], dy = other[1] - vertex[1];
    const length = Math.hypot(dx, dy);
    let normal = [dy / length, -dx / length];
    if (normal[0] * ((other[0] + vertex[0]) / 2 - center[0]) + normal[1] * ((other[1] + vertex[1]) / 2 - center[1]) < 0) normal = normal.map(value => -value);
    return { other, normal };
  });
  const ticks = [];
  for (let multiple = Math.ceil((minimum - 1e-9) / step); multiple * step <= maximum + 1e-9; multiple++) {
    const value = Number((multiple * step).toFixed(digits));
    const fraction = Math.max(0, Math.min(1, (value - minimum) / span));
    const points = others.map(other => other.map((coordinate, axis) => coordinate + fraction * (vertex[axis] - coordinate)));
    const labels = edges.map(({ normal }, edge) => {
      let [x, y] = points[edge].map((coordinate, axis) => coordinate + normal[axis] * 12);
      let anchor = normal[0] < -0.2 ? 'end' : normal[0] > 0.2 ? 'start' : 'middle';
      if (normal[1] > 0.9 && fraction <= 1e-9) {
        const atLeft = points[edge][0] < center[0];
        x = points[edge][0] + (atLeft ? -6 : 6); y = bottom - 6; anchor = atLeft ? 'end' : 'start';
      }
      return { x, y, anchor, point: points[edge], end: points[edge].map((coordinate, axis) => coordinate + normal[axis] * 5) };
    });
    if (fraction >= 1 - 1e-9) {
      labels.splice(0, 2, index === 0 ? { x: vertex[0] - 12, y: vertex[1] + 3, anchor: 'end' }
        : { x: vertex[0] + (index === 1 ? -6 : 6), y: bottom - 6, anchor: index === 1 ? 'end' : 'start' });
    }
    ticks.push({ value, label: `${value.toFixed(digits)}%`, points, labels });
  }
  // The gradient follows the normal to the opposite edge, so equal support has equal color.
  const [start, end] = others;
  const delta = end.map((value, axis) => value - start[axis]);
  const projection = delta.reduce((total, value, axis) => total + value * (vertex[axis] - start[axis]), 0) / delta.reduce((total, value) => total + value * value, 0);
  const from = start.map((value, axis) => value + projection * delta[axis]);
  return { triangle: polygonPath(vertices), minimum, maximum, step, ticks,
    gradient: { from, to: vertex, startOpacity: minimum / 100 * 0.32, endOpacity: maximum / 100 * 0.32 } };
}

export function regionHoverGeometry(kind, area, viewport, index, extension = 6) {
  if (!['ternary', 'strip'].includes(kind)) return null;
  const { left, right, top, bottom } = area;
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0 || !viewport) return null;
  if (kind === 'strip') {
    if (![0, 1].includes(index) || !viewport.x?.every(Number.isFinite) || viewport.x[1] <= viewport.x[0]) return null;
    const split = left + (50 - viewport.x[0]) / (viewport.x[1] - viewport.x[0]) * width;
    const extra = Math.max(0, Math.min(6, extension));
    const start = index === 0 ? left - extra : Math.max(left - extra, split);
    const end = index === 0 ? Math.min(right + extra, split) : right + extra;
    if (end <= start) return null;
    const points = [[start, top - extra], [end, top - extra], [end, bottom + extra], [start, bottom + extra]];
    return { points, d: polygonPath(points), clip: polygonPath([[left, top], [right, top], [right, bottom], [left, bottom]]) };
  }
  const original = [[(left + right) / 2, top], [right, bottom], [left, bottom]];
  const center = [0, 1].map(axis => original.reduce((sum, point) => sum + point[axis], 0) / original.length);
  const radius = Math.max(...original.map(point => Math.hypot(point[0] - center[0], point[1] - center[1])));
  // Expand the plot boundary, then intersect with unchanged candidate half-planes.
  // The same calculation works when zoom places the equal-support point offscreen.
  let points = original.map(point => point.map((value, axis) => center[axis] + (value - center[axis]) * (1 + Math.max(0, Math.min(6, extension)) / radius)));
  if (kind === 'ternary') {
    const span = 100 - viewport.min.reduce((sum, value) => sum + value, 0);
    const support = ([x, y]) => {
      const a = (bottom - y) / height;
      const b = (right - x) / width - a / 2;
      return [a, b, 1 - a - b].map((value, axis) => viewport.min[axis] + value * span);
    };
    for (let other = 0; other < 3; other++) if (other !== index) points = clipPolygon(points, point => {
      const values = support(point);
      return values[index] - values[other];
    });
  } else return null;
  return { points, d: polygonPath(points), clip: polygonPath(original) };
}
