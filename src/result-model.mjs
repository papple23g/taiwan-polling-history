export function officialResultSummary(election) {
  const result=election?.result || {};
  const ids=(election?.candidates || []).map(c=>c.id);
  const valid=value=>typeof value==='number' && Number.isFinite(value) && value>=0;
  const complete=ids.length>0 && ids.every(id=>valid(result.votes?.[id]));
  const sum=complete?ids.reduce((total,id)=>total+result.votes[id],0):null;
  const supplied=result.validVotes !== null && result.validVotes !== undefined;
  const providedValid=valid(result.validVotes) && result.validVotes>0;
  const consistent=!complete || !supplied || providedValid && Math.abs(sum-result.validVotes)<=Math.max(1,sum,result.validVotes)*Number.EPSILON*8;
  const total=supplied ? providedValid && consistent ? result.validVotes : null : sum>0 ? sum : null;
  return { total, complete: complete && total!==null && consistent, totalFrom: supplied?'published':'candidate-sum', rawPercent:Object.fromEntries(ids.map(id=>[id,valid(result.votes?.[id]) && total>0 ? result.votes[id]/total*100 : null])) };
}
export function formatVoteCount(value) { return typeof value==='number' && Number.isFinite(value) && value>=0 ? value.toLocaleString('zh-TW') : '—'; }

export function leadingSupport(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) return null;
  const maximum = Math.max(...values);
  return maximum > 0 ? maximum : null;
}
