import { ArrowSquareOut, ArrowUp, ArrowDown, ArrowsDownUp, ClockCounterClockwise, SealCheck } from '@phosphor-icons/react';
import { publicUrl } from './load-data.mjs';
export const fmt = value => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
export const pct = value => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '—';
export const reviewStatusLabels = { primary_verified: '一手內容已核實', secondary_cross_checked: '二手交叉核實', partial: '部分核對', blocked: '來源無法核實', conflict: '衝突待解' };
export const reviewStatusLabel = row => reviewStatusLabels[row?.verificationReview?.status] || (row?.status === 'verified' ? '一手內容已核實' : '尚待核對');
export const pollStatusLabel = poll => poll.status === 'verified' ? '一手資料已核實'
  : reviewStatusLabels[poll.verificationReview?.status] ||
  (poll.historicalContext ? '歷史情境・待核對'
  : ({ primary_fulltext: '原文已讀・待核對', news_fulltext: '新聞全文・待核對', search_excerpt_only: '僅摘要・待核對' }[poll.provenance?.historical_import?.evidence_tier || poll.provenance?.source_enrichment?.evidence_tier] || '索引資料・待核對'));
export const scoreValue = evaluation => evaluation?.eligible ? evaluation.mae : evaluation?.provisionalMae;
export const scoreLabel = evaluation => evaluation?.eligible ? '正式 MAE' : Number.isFinite(evaluation?.provisionalMae) ? '試算 MAE' : '無法計算';
export const reasonLabel = reason => !reason ? '' : /historical_candidate_context|candidate contexts are not scored/i.test(reason) ? '這筆屬於候選情境，未直接與大選結果比較'
  : /unresolved comparison-input conflict/i.test(reason) ? '支持度來源有未裁定矛盾'
  : /cannot be interpreted for MAE|support question.{0,40}(?:unidentified|unclear)/i.test(reason) ? '來源題目不是候選人投票支持度，無法計算 MAE'
  : /30|window/.test(reason) ? '不在選前 30 天內'
  : /ambiguous|conflicting/.test(reason) ? '支持度或波次有未裁定矛盾'
  : /formal comparison/.test(reason) ? '資料可試算，但不列入正式比較'
  : /product/.test(reason) ? '這份資料不是候選人支持度調查'
  : /scenario|unknown candidate|comparison set/.test(reason) ? '候選組合與比較範圍不符'
  : /exceed/.test(reason) ? '原始數值合計超過可接受範圍'
  : /required date/.test(reason) ? '必要調查或發布日期未核實'
  : /source|Source|public/.test(reason) ? '來源待核實'
  : /missing|Missing|candidate|Candidate|null/.test(reason) ? '候選人或官方票數資料缺漏'
  : /verified|pending/.test(reason) ? '資料尚未完成正式核實'
  : /date|Date|publication|Publication|fieldwork|Fieldwork/.test(reason) ? '調查或發布日期不符合正式條件' : '不符合比較條件';
export const firstPublicSource = poll => ((Array.isArray(poll?.sources) && poll.sources.length > 0) ? poll.sources : [poll?.source]).find(source => publicUrl(source?.url)) || null;
export function SourceLink({ source, children }) { return publicUrl(source?.url) ? <a href={source.url} target="_blank" rel="noopener noreferrer">{children || source.title || '查看來源'}<ArrowSquareOut size={13} aria-hidden="true" /><span className="sr-only">（另開分頁）</span></a> : <span className="muted">來源待補</span>; }
export function IconButton({ label, children, className = '', ...props }) { return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>; }
export function trapDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const elements = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), summary')].filter(element => {
    const closed = element.closest('details:not([open])');
    return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden]') && (!closed || element.tagName === 'SUMMARY' && element.parentElement === closed);
  });
  if (!elements.length) return;
  if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1).focus(); }
  else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
}
export function Badge({ verified, children }) { return <span className={`badge ${verified ? 'verified' : 'pending'}`}>{verified ? <SealCheck size={13} aria-hidden="true" /> : <ClockCounterClockwise size={13} aria-hidden="true" />}{children}</span>; }
export function SortHeading({ label, name, sort, onSort, disabled = false }) { return <th aria-sort={sort.key === name ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button className="sort-button" disabled={disabled} onClick={() => onSort(name)}>{label}{sort.key === name ? sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowsDownUp size={12} />}</button>{name === 'mae' && <small className="metric-unit">百分點</small>}</th>; }

