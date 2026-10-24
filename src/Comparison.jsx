import { ArrowSquareOut, Info } from '@phosphor-icons/react';
import { fmt } from './ui.jsx';

export function Comparison({ data, comparison, onOpenElection }) {
  const label = id => data.elections.find(election => election.id === id)?.label || id;
  return <div className="comparison">
    <div className="view-intro"><div><span className="eyebrow">逐場查看，每筆可追溯</span><h3>每一場的誤差，都列在這裡</h3><p>全部機構自動納入；同名與別名合併，每個品牌每場取一份資料。</p></div><span className="large-count">{comparison.rows.length}<small>機構品牌</small></span></div>
    <div className="comparison-note"><Info size={18} aria-hidden="true" /><p>{comparison.commonElectionIds.length < comparison.minimum
      ? `全部機構共有 ${comparison.commonElectionIds.length} 場共同選舉；至少 ${comparison.minimum} 場才顯示跨場平均 MAE。各場已有數值仍列於下表。`
      : `本次平均使用全部機構都有資料的 ${comparison.commonElectionIds.length} 場選舉。`} 點選分數可查看該筆民調與來源。</p></div>
    <div className="table-scroll" tabIndex="0" role="region" aria-label="跨選舉比較表，可水平捲動">
      <table className="cross-table"><caption className="sr-only">全部機構品牌的跨選舉誤差；缺值不補零，平均只採共同選舉。</caption>
        <thead><tr><th>機構品牌</th><th>跨場平均 MAE<small>百分點</small></th><th>共同場次</th>{comparison.displayElectionIds.map(id => <th key={id}><button className="text-link" onClick={() => onOpenElection(id)}>{label(id)}<ArrowSquareOut size={12} /></button></th>)}<th>資料覆蓋與缺漏</th></tr></thead>
        <tbody>{comparison.rows.map(row => <tr key={row.institutionId}>
          <th scope="row">{row.brand}</th><td className="number accent">{fmt(row.average)}</td><td>{comparison.commonElectionIds.length}</td>
          {comparison.displayElectionIds.map(id => { const point = row.availablePerElection.find(item => item.electionId === id); return <td key={id} className="number">{point ? <button className="text-link" onClick={() => onOpenElection(id, point.pollId)} aria-label={`${row.brand}，${label(id)}，誤差 ${fmt(point.mae)} 百分點，查看來源與計算`}>{fmt(point.mae)}</button> : '—'}</td>; })}
          <td className="coverage-cell">有資料 {row.availableElectionIds.length} 場<br /><small title={row.missingElectionIds.map(label).join('、')}>缺漏 {row.missingElectionIds.length} 場</small></td>
        </tr>)}</tbody>
      </table>
      {!comparison.rows.length && <div className="compact-empty">尚無可比較的機構資料</div>}
    </div>
    <p className="small muted">跨場平均 MAE 是同一組共同選舉的描述統計；各品牌自己的資料平均不可直接並列。缺值顯示「—」。</p>
  </div>;
}
