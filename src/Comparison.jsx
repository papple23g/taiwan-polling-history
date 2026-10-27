import { ArrowSquareOut } from '@phosphor-icons/react';
import { fmt } from './ui.jsx';

export function Comparison({ data, comparison, onOpenElection }) {
  const label = id => data.elections.find(election => election.id === id)?.label || id;
  const { rows, displayElectionIds: electionIds } = comparison;
  return <div className="comparison"><div className="table-scroll" tabIndex="0" role="region" aria-label="跨場比較表，可水平捲動">
    <table className="cross-table"><caption className="sr-only">跨場比較表；依平均誤差升冪，分數單位為百分點。</caption>
      <thead><tr><th scope="col">機構品牌</th><th scope="col" className="number" aria-sort="ascending">↑ 平均誤差(MAE)<small>百分點</small></th><th scope="col" className="number">中位數<small>百分點</small></th><th scope="col" className="number">最大誤差<small>百分點</small></th><th scope="col" className="number">採計場次</th>{electionIds.map(id => <th scope="col" className="number" key={id}><button className="text-link" onClick={() => onOpenElection(id)}>{label(id)}<ArrowSquareOut size={12} /></button></th>)}<th scope="col">資料覆蓋與缺漏</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.institutionId}>
        <th scope="row">{row.brand}</th><td className="number accent">{fmt(row.average)}</td><td className="number">{fmt(row.median)}</td><td className="number">{fmt(row.maximum)}</td><td className="number">{row.averageCount}</td>
        {electionIds.map(id => { const point = row.availablePerElection.find(item => item.electionId === id); return <td key={id} className="number">{point ? <button className="text-link" onClick={() => onOpenElection(id, point.pollId)} aria-label={`${row.brand}，${label(id)}，誤差 ${fmt(point.mae)} 百分點，查看來源與計算`}>{fmt(point.mae)}</button> : '—'}</td>; })}
        <td className="coverage-cell">採計 {row.averageCount} 場<br /><small title={row.missingElectionIds.map(label).join('、')}>未採計 {row.missingElectionIds.length} 場</small></td>
      </tr>)}</tbody>
    </table>
    {!rows.length && <div className="compact-empty">目前沒有符合篩選條件的品牌</div>}
  </div></div>;
}
