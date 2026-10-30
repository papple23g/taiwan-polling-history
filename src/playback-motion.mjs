const DURATION_MS = 800;

const samePoints = (entries, points) => {
  if (entries.length !== points.length) return false;
  const ids = new Set(entries.map(entry => entry.point.id));
  return ids.size === entries.length && new Set(points.map(point => point.id)).size === points.length
    && points.every(point => ids.has(point.id));
};

const refreshPoints = (entries, points) => {
  const keys = new Map(entries.map(entry => [entry.point.id, entry.key]));
  return points.map(point => ({ key: keys.get(point.id), point }));
};

export function createPlaybackMotion(initialGroups = new Map()) {
  const states = new Map();
  let nextKey = 0;
  const entry = point => ({ key: `playback-${nextKey++}`, point });

  function reset(groups) {
    states.clear();
    for (const [brand, points] of groups) {
      if (points.length) states.set(brand, { current: points.map(entry), transition: null, queued: null });
    }
  }

  function start(state, points) {
    if (samePoints(state.current, points)) {
      state.current = refreshPoints(state.current, points);
      return;
    }
    const from = state.current;
    const moving = from.length === 1 && points.length === 1
      && from[0].point.position.length === points[0].position.length;
    const to = moving ? [{ key: from[0].key, point: points[0] }] : points.map(entry);
    state.transition = { from, to, moving, elapsed: 0 };
  }

  function update(groups) {
    const brands = new Set([...states.keys(), ...groups.keys()]);
    for (const brand of brands) {
      const points = [...(groups.get(brand) || [])];
      let state = states.get(brand);
      if (!state) {
        if (!points.length) continue;
        state = { current: [], transition: null, queued: null };
        states.set(brand, state);
      }
      if (state.transition) {
        if (samePoints(state.transition.to, points)) {
          state.transition.to = refreshPoints(state.transition.to, points);
          state.queued = null;
        } else {
          state.queued = points;
        }
      } else {
        start(state, points);
      }
    }
  }

  function advance(deltaPlaybackMs) {
    if (!Number.isFinite(deltaPlaybackMs) || deltaPlaybackMs <= 0) return;
    for (const [brand, state] of states) {
      let remaining = deltaPlaybackMs;
      while (state.transition) {
        const transition = state.transition;
        const durationLeft = DURATION_MS - transition.elapsed;
        if (remaining < durationLeft) {
          transition.elapsed += remaining;
          break;
        }
        remaining -= durationLeft;
        state.current = transition.to;
        state.transition = null;
        if (state.queued !== null) {
          const queued = state.queued;
          state.queued = null;
          start(state, queued);
        }
        if (remaining === 0) break;
      }
      if (!state.transition && !state.current.length) states.delete(brand);
    }
  }

  function frame() {
    const result = [];
    const add = (item, alpha, transitioning, from = null, position = item.point.position) => {
      result.push({ key: item.key, point: item.point, position: [...position], alpha, transitioning, from });
    };
    for (const state of states.values()) {
      const transition = state.transition;
      if (!transition) {
        for (const item of state.current) add(item, 1, false);
        continue;
      }
      const t = transition.elapsed / DURATION_MS;
      const progress = t * t * (3 - 2 * t);
      if (transition.moving) {
        const from = transition.from[0].point;
        const to = transition.to[0];
        const position = to.point.position.map((value, index) => from.position[index] + (value - from.position[index]) * progress);
        add(to, 1, true, from, position);
      } else {
        for (const item of transition.from) add(item, 1 - progress, true);
        for (const item of transition.to) add(item, progress, true);
      }
    }
    return result;
  }

  const pending = () => [...states.values()].some(state => state.transition || state.queued !== null);
  reset(initialGroups);
  return { reset, update, advance, frame, pending };
}