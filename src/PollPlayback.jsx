import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, X } from '@phosphor-icons/react';
import { playbackDate, playbackDay, playbackDaysUntilElection } from './playback-model.mjs';

const DAY = 86_400_000;

function dateClusters(timeline, width) {
  const span = timeline.end - timeline.start;
  const usable = Math.max(1, width - 16);
  const clusters = [];
  for (const date of timeline.dates) {
    const x = span ? (date.day - timeline.start) / span * usable : 0;
    let cluster = clusters.at(-1);
    if (!cluster || x - cluster.x >= 22) { cluster = { x, dates: [], count: 0 }; clusters.push(cluster); }
    cluster.dates.push(date);
    cluster.count += date.count;
  }
  return clusters;
}

export function PollPlayback({ election, timeline, playback, onOpen }) {
  const marksRef = useRef(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    const element = marksRef.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [playback.active]);
  const clusters = useMemo(() => Number.isFinite(timeline.start) ? dateClusters(timeline, width) : [], [timeline, width]);
  if (!playback.active) return <div className="playback-entry"><button type="button" className="button playback-open" onClick={onOpen} disabled={!timeline.supported}><Play size={16} weight="fill" />播放民調變化</button>{!timeline.supported && <span className="small muted">目前圖型不支援播放。</span>}</div>;
  const valid = Number.isFinite(timeline.start);
  const day = playbackDay(playback.position ?? timeline.start);
  const span = valid ? (timeline.end - timeline.start) / DAY : 0;
  const value = valid ? Math.max(0, Math.min(span, (day - timeline.start) / DAY)) : 0;
  const daysUntilElection = valid ? playbackDaysUntilElection(election?.date, day) : null;
  const countdown = daysUntilElection === null ? '' : daysUntilElection < 0 ? `投票後 ${-daysUntilElection} 天` : `選舉倒數 ${daysUntilElection} 天`;
  const label = valid ? [playbackDate(day), countdown].filter(Boolean).join('，') : '沒有可播放日期';
  const finished = valid && span > 0 && playback.position >= timeline.end && !playback.playing;
  return <section className="poll-playback" aria-label="民調時間播放器" data-testid="poll-playback">
    <div className="playback-controls">
      <button type="button" className="button playback-play" onClick={playback.playing ? playback.pause : playback.play} disabled={!valid || span === 0 || finished && playback.settling}>
        {playback.playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}{playback.playing ? '暫停' : finished ? '重新播放' : '播放'}
      </button>
      <label className="playback-speed">速度<select aria-label="播放速度" value={playback.speed} onChange={event => playback.setSpeed(Number(event.target.value))}>{[0.1, 0.25, 0.5, 1, 2, 4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <strong className="playback-date"><span data-testid="playback-date">{valid ? playbackDate(day) : '無可播放日期'}</span>{countdown && <span className="playback-countdown" data-testid="playback-countdown">{countdown}</span>}</strong>
      <button type="button" className="icon-button playback-close" aria-label="關閉播放器" title="關閉播放器" onClick={playback.close}><X size={18} /></button>
    </div>
    {valid ? <>
      <div ref={marksRef} className="playback-marks" aria-hidden="true">{clusters.map((cluster, index) => <span key={index} className={'playback-mark' + (cluster.count > 3 ? ' grouped' : '')} style={{ left: `${8 + cluster.x}px` }} title={cluster.dates.map(date => `${playbackDate(date.day)}：${date.count} 筆`).join('\n')}>{cluster.count > 3 ? cluster.count : Array.from({ length: cluster.count }, (_, i) => <i key={i} />)}</span>)}</div>
      <input className="playback-range" type="range" aria-label="播放日期" aria-valuetext={label} min="0" max={Math.max(span, 1)} step="1" value={value} disabled={span === 0} onPointerDown={playback.pause} onChange={event => playback.seek(timeline.start + Number(event.target.value) * DAY)} />
      <div className="playback-ends"><span>{playbackDate(timeline.start)}</span><span>{playbackDate(timeline.end)}</span></div>
    </> : null}
  </section>;
}

export function PollPlaybackDetails({ timeline, playback }) {
  if (!playback.active) return null;
  const valid = Number.isFinite(timeline.start);
  const span = valid ? (timeline.end - timeline.start) / DAY : 0;
  return <section className="playback-details" aria-label="民調時間回放說明">
    {valid && <details className="playback-dates"><summary>查看各日期民調筆數</summary><div className="playback-date-list">{timeline.dates.map(date => <button type="button" key={date.day} onClick={() => playback.seek(date.day)}>{playbackDate(date.day)}<span>{date.count} 筆</span></button>)}</div></details>}
    {valid && span === 0 && <p className="playback-note">只有一個播放日期，無法呈現跨日期變化。</p>}
    {!valid && <p className="playback-note" role="status">目前篩選沒有可播放的民調。</p>}
    {!playback.playing && playback.settling && <p className="playback-note" role="status">日期已暫停，圓點正移至目前日期的最新波次。</p>}
    <p className="playback-note">依調查開始日回放，並非發布日。移動只是視覺轉場，不代表兩次調查之間的支持度。</p>
    {(timeline.missingDateCount > 0 || timeline.unplottableCount > 0) && <p className="playback-note">未排入：{[timeline.missingDateCount > 0 && `開始日未知 ${timeline.missingDateCount} 筆`, timeline.unplottableCount > 0 && `不符合目前繪圖條件 ${timeline.unplottableCount} 筆`].filter(Boolean).join('；')}。</p>}
  </section>;
}
