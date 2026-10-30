import { reviewStatusLabel, SourceLink } from './ui.jsx';

const fields = {
  brand: '調查品牌', sourceUrl: '來源網址', classification: '題目分類', notes: '備註', missingFields: '待核對欄位', candidateSet: '候選組合', questionCandidateSet: '完整題目人選', shares: '候選支持度',
  fieldworkStart: '調查起日', fieldworkEnd: '調查結束日', fieldworkDates: '調查日期', publishedAt: '發布日期',
  executor: '執行者', sampleSize: '調查樣本', sampleSizeSupportQuestion: '支持度題樣本',
  surveyTotalSampleSize: '全調查／跨市總樣本', supportDenominator: '支持度題母體', sampleComposition: '樣本組成',
  method: '調查方式', population: '調查母體', region: '調查地區', question: '原始題目', productType: '題目類型',
  undecided: '未表態', other: '其他回答', otherResponses: '其他回答分類', noneOfCandidates: '皆不支持',
  commissioner: '委託者', funder: '出資者', designAndAnalysis: '設計分析', samplingFrame: '抽樣框', weighting: '加權方式',
  reportedMarginOfError: '刊載誤差', reportedConfidenceLevel: '信心水準', explicitFinalPoll: '明示封關依據',
  shareQualifiers: '支持度數值限制', context: '題目情境', rawVotes: '原始票數', totalVotes: '總票數',
  excludedCandidates: '集合外候選人', otherCandidateSupport: '其他候選人支持度',
  primaryPublisherFulltext: '原始發布全文', originalFulltextVerification: '原始全文核實', originalQuestion: '原始題目',
  completeCandidateScenario: '完整候選情境', completeOriginalQuestionnaire: '完整原始問卷', independentFieldReview: '獨立逐欄核實',
  independentPrimaryReview: '獨立一手核實',
};
const fieldLabel = field => fields[field] || (field.startsWith('shares.') ? `${field.slice(7)}支持度` : field);
const observed = value => value === null || value === undefined ? '未知' : Array.isArray(value) ? value.join('、') : typeof value === 'object' ? Object.entries(value).map(([key, item]) => `${key}：${item ?? '未知'}`).join('；') : String(value);
export function VerificationEvidence({ record }) {
  const review = record?.verificationReview;
  if (!review) return null;
  return <section className="source-section verification-evidence" aria-label="逐欄核對結果"><h3 className="detail-section-title">逐欄核對結果</h3><p><strong>{reviewStatusLabel(record)}</strong> · {review.checkedAt || '查核日期未載'}</p><p className="small">{review.reason}</p>{review.missingFields?.length > 0 && <p className="small muted">尚缺依據：{review.missingFields.map(fieldLabel).join('、')}</p>}
    {Object.entries(review.fieldEvidence || {}).map(([field, evidence]) => <div className="source-item" key={field}><strong className="small">{fieldLabel(field)}</strong><SourceLink source={{ title: '查看欄位依據', url: evidence.url }} /><small>{evidence.locator || '原文相關段落'}{evidence.checkedAt && ` · ${evidence.checkedAt}`}</small>{evidence.note && <p className="small">{evidence.note}</p>}</div>)}
    {(review.corrections?.length > 0 || review.conflicts?.length > 0) && <details className="metadata"><summary>原始觀察、更正及來源差異</summary>{review.corrections?.map((change, index) => <p className="small" key={`correction-${index}`}><strong>{fieldLabel(change.field)}</strong><br />原記錄：{observed(change.original)}<br />核對後：{observed(change.corrected)}{change.evidence?.url && <SourceLink source={{ title: '更正依據', url: change.evidence.url }} />}</p>)}{review.conflicts?.map((conflict, index) => <p className="small" key={`conflict-${index}`}>{typeof conflict === 'string' ? conflict : conflict.detail || conflict.reason || observed(conflict)}{conflict.url && <SourceLink source={{ title: '差異來源', url: conflict.url }} />}</p>)}</details>}
    {review.notes?.length > 0 && <details className="metadata"><summary>樣本、波次與核對限制</summary>{review.notes.map((note, index) => <p className="small" key={index}>{note}</p>)}</details>}
    {review.relatedRecordIds?.length > 0 && <p className="small muted">相關紀錄：{review.relatedRecordIds.join('、')}。保留原始身分及來源，樣本不重複加總。</p>}
  </section>;
}
