import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { playbackDay, playbackElapsed } from './playback-model.mjs';

const INITIAL = { active: false, playing: false, position: null, speed: 1, seekVersion: 0, ready: false };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function usePollPlayback(timeline, scopeKey) {
  const [state, setState] = useState(INITIAL);
  const position = useRef(state.position);
  const previousScope = useRef(scopeKey);
  useLayoutEffect(() => { position.current = state.position; }, [state.position]);

  useEffect(() => {
    const changed = previousScope.current !== scopeKey;
    previousScope.current = scopeKey;
    if (!state.active) return;
    setState(current => {
      if (!Number.isFinite(timeline.start) || !Number.isFinite(timeline.end)) {
        return current.position === null && !current.playing && !changed ? current : { ...current, position: null, playing: false,
          ready: changed ? false : current.ready, seekVersion: current.seekVersion + (changed ? 1 : 0) };
      }
      if (current.position === null) return { ...current, position: timeline.start,
        playing: !changed && current.playing && timeline.end > timeline.start,
        ready: changed ? false : current.ready, seekVersion: current.seekVersion + (changed ? 1 : 0) };
      const next = clamp(current.position, timeline.start, timeline.end);
      return changed || next !== current.position ? { ...current, position: next, playing: false,
        ready: changed ? false : current.ready, seekVersion: current.seekVersion + (changed ? 1 : 0) } : current;
    });
  }, [state.active, scopeKey, timeline.start, timeline.end]);

  useEffect(() => {
    if (!state.active || !state.playing || !state.ready || !Number.isFinite(timeline.start) || timeline.end <= timeline.start) return;
    const origin = position.current ?? timeline.start;
    const started = performance.now();
    let previousDay = playbackDay(origin);
    let frame;
    const tick = now => {
      const next = Math.min(timeline.end, origin + playbackElapsed(now - started, state.speed) / 30_000 * (timeline.end - timeline.start));
      position.current = next;
      const day = playbackDay(next);
      if (day !== previousDay || next === timeline.end) {
        previousDay = day;
        setState(current => current.active && current.playing ? { ...current, position: next, playing: next < timeline.end } : current);
      }
      if (next < timeline.end) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state.active, state.playing, state.ready, state.speed, timeline.start, timeline.end]);

  useEffect(() => {
    if (!state.active) return;
    const pauseWhenHidden = () => {
      if (document.hidden) setState(current => current.playing
        ? { ...current, playing: false, position: position.current ?? current.position }
        : current);
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [state.active]);

  const open = () => setState(current => ({ ...current, active: true, playing: true, position: null, ready: false, seekVersion: current.seekVersion + 1 }));
  const close = () => setState(INITIAL);
  const pause = () => setState(current => current.playing ? { ...current, playing: false, position: position.current ?? current.position } : current);
  const play = () => setState(current => {
    if (!Number.isFinite(timeline.start) || timeline.end <= timeline.start) return current;
    const restart = current.position === null || current.position >= timeline.end;
    return { ...current, playing: true, position: restart ? timeline.start : current.position,
      seekVersion: current.seekVersion + (restart ? 1 : 0) };
  });
  const seek = value => setState(current => Number.isFinite(timeline.start) ? {
    ...current, playing: false, position: clamp(value, timeline.start, timeline.end), seekVersion: current.seekVersion + 1,
  } : current);
  const setSpeed = value => setState(current => ({ ...current, speed: value, position: position.current ?? current.position }));
  const markReady = () => setState(current => current.active && !current.ready ? { ...current, ready: true } : current);
  return { ...state, open, close, pause, play, seek, setSpeed, markReady };
}
