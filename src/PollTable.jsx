import { fmt, scoreValue, SortHeading } from './ui.jsx';
import { candidateRegions } from './chart-model.mjs';
import { leadingSupport } from './result-model.mjs';

export function PollTable({ election, title, rows, candidates, officialResult, showNormalized, shownShare, selectedId, officialSelected, sort, onSort, onSortChange, onSelect, onSelectOfficial }) {
  const preResult = election.phase === 'pre_result';
  const officialVotes = candidates.map(candidate => election.result?.votes?.[candidate.id]);
  const officialTotal = officialVotes.every(Number.isFinite) ? officialVotes.reduce((sum, value) => sum + value, 0) : null;
  const regions = candidateRegions(election, candidates.map(candidate => candidate.id));
  const candidateCells = (values, originalValues = values) => {
    const maximum = leadingSupport(originalValues) === null ? null : leadingSupport(values);
    return candidates.map((candidate, index) => {
      const leading = maximum !== null && values[index] === maximum;
      return <td className={'number candidate-cell' + (leading ? ' leading-support' : '')} role="cell" key={candidate.id} style={leading ? { backgroundColor: regions[index].fill } : undefined}><span className="compact-cell-label">{candidate.name}</span><span className="cell-value">{fmt(values[index])}<span className="compact-value-unit">%</span></span>{leading && <span className="sr-only">（本列所列候選人中支持度最高）</span>}</td>;
    });
  };
  const maeCell = value => <td className="number mae-cell" role="cell" title="平均絕對誤差（MAE），單位百分點"><span className="compact-cell-label">誤差(MAE)</span><span className="cell-value">{fmt(value)}<small className="compact-value-unit">百分點</small></span></td>;
  return <>
    <div className="compact-table-sort" role="group" aria-label="民調排序">
      <label>排序<select aria-label="民調排序欄位" value={sort.key} onChange={event => onSortChange({ ...sort, key: event.target.value })}><option value="brand">調查單位</option><option value="date">調查結束</option><option value="mae">誤差(MAE)</option></select></label>
      <button type="button" aria-label={sort.direction === 'asc' ? '改為降冪排序' : '改為升冪排序'} onClick={() => onSortChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>{sort.direction === 'asc' ? '升冪 ↑' : '降冪 ↓'}</button>
    </div>
    <table className="poll-table" role="table">
      <caption className="sr-only">{title}{preResult ? '選前民調資料；尚無官方結果，MAE 留空。' : '民調資料，平均絕對誤差（MAE）是正規化比例的平均絕對誤差，單位百分點。'}</caption>
      <colgroup><col className="index-column" /><col className="institution-column" /><col className="date-column" />{candidates.map(candidate => <col key={candidate.id} />)}<col className="mae-column" /><col className="source-column" /></colgroup>
      <thead role="rowgroup"><tr role="row"><th className="row-index" scope="col">#</th><SortHeading label="調查單位" name="brand" sort={sort} onSort={onSort} /><SortHeading label="調查結束" name="date" sort={sort} onSort={onSort} />{candidates.map(candidate => <th className="candidate-heading" scope="col" key={candidate.id}>{candidate.name}<small>(%)</small></th>)}<SortHeading label="誤差(MAE)" name="mae" sort={sort} onSort={onSort} /><th scope="col">詳情</th></tr></thead>
      <tbody role="rowgroup">
        {officialResult && <tr role="row" className={'official-result-row' + (officialSelected ? ' selected-row' : '')} data-testid="official-result-row" onClick={() => onSelectOfficial(true)}>
          <td className="row-index" role="cell">—</td>
          <th className="institution-cell" scope="row" role="rowheader"><button className="row-select official-result-label" aria-pressed={officialSelected} aria-label="大選結果，定位圖表資料點">大選結果</button></th>
          <td className="date-cell" role="cell"><span className="compact-cell-label">投票日期</span><span>{election.date}</span></td>
          {candidateCells(candidates.map((candidate, index) => !Number.isFinite(officialVotes[index]) ? null : showNormalized ? officialTotal > 0 ? officialVotes[index] / officialTotal * 100 : null : officialResult.rawPercent[candidate.id]))}
          {maeCell(null)}
          <td className="source-cell" role="cell"><button className="row-details text-link" aria-label="查看大選結果詳情與來源" aria-haspopup="dialog" onClick={event => { event.stopPropagation(); onSelectOfficial(false, { openDetails: true }); }}>詳情</button></td>
        </tr>}
        {rows.map((row, index) => <tr role="row" key={row.poll.id} data-poll-id={row.poll.id} onClick={() => onSelect(row.poll.id, true)} className={row.poll.id === selectedId ? 'selected-row' : ''}>
          <td className="row-index" role="cell">{preResult ? '—' : index + 1}</td>
          <th className="institution-cell" scope="row" role="rowheader"><button className="row-select" aria-pressed={row.poll.id === selectedId} aria-label={row.brand + '，' + (row.poll.fieldworkEnd || row.poll.indexDate || '日期未知') + '，定位圖表資料點'}>{row.brand}</button></th>
          <td className="date-cell" role="cell" title={!row.poll.fieldworkEnd ? row.poll.indexDate || row.poll.sourceDateText || undefined : undefined}><span className="compact-cell-label">調查結束</span><span>{row.poll.fieldworkEnd || '日期未知'}{!row.poll.fieldworkEnd && (row.poll.indexDate || row.poll.sourceDateText) && <small>索引 {row.poll.indexDate || row.poll.sourceDateText}</small>}</span></td>
          {candidateCells(candidates.map(candidate => shownShare(row, candidate.id)), candidates.map(candidate => row.poll.shares?.[candidate.id]))}
          {maeCell(scoreValue(row.evaluation))}
          <td className="source-cell" role="cell"><button className="row-details text-link" aria-label={'查看' + row.brand + '民調詳情與來源'} aria-haspopup="dialog" onClick={event => { event.stopPropagation(); onSelect(row.poll.id, false, { openDetails: true }); }}>詳情</button></td>
        </tr>)}
      </tbody>
    </table>
  </>;
}
