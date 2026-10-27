import { pct, SourceLink } from './ui.jsx';
import { formatVoteCount, officialResultSummary } from './result-model.mjs';
export function OfficialResult({ election }) {
  if (!election?.result || election.result.status !== 'verified') return null;
  const result = election.result;
  const summary = officialResultSummary(election);
  const ids = election.comparisonCandidateIds || election.candidates.map(c => c.id);
  const selected = ids.map(id => election.candidates.find(c => c.id === id)).filter(Boolean);
  const excluded = election.candidates.filter(c => !ids.includes(c.id));
  const table = candidates => <table className="official-result-table"><thead><tr><th>候選人</th><th>正式票數</th><th>有效票 %</th></tr></thead><tbody>{candidates.map(c => <tr key={c.id}><th scope="row">{c.name}</th><td className="number">{formatVoteCount(result.votes?.[c.id])}</td><td className="number">{pct(summary.rawPercent[c.id])}</td></tr>)}</tbody></table>;
  return <section className="official-result"><header className="section-heading"><h3>{summary.complete ? '大選結果' : '大選結果（資料不完整）'}</h3></header><p className="small muted">有效票{summary.totalFrom==='candidate-sum' ? '（由候選人票數加總）' : ''} {formatVoteCount(summary.total)} 票</p>{table(selected)}{excluded.length > 0 && <details><summary>比較集合外 {excluded.length} 位候選人</summary>{table(excluded)}</details>}<p className="small muted">本資料比較集合：{selected.map(c => c.name).join('、')}。比例由官方整數票數重算，缺值不補零。</p>{election.notes?.map((note,i) => <p key={i} className="small result-note">{note}</p>)}{(result.sources || [result.source]).map((source,i) => <div className="source-item" key={i}><strong>{source?.title}</strong><SourceLink source={source}>{source?.url}</SourceLink></div>)}</section>;
}
