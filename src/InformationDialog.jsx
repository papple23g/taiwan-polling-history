import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { IconButton, SourceLink, trapDialogFocus } from './ui.jsx';
import { Pagination } from './Pagination.jsx';
import { candidatePortraits } from './candidate-portraits.mjs';
import { SiteInformation } from './SiteInformation.jsx';
function HistoricalSources({ data, electionId }) {
  const [selectedElection, setSelectedElection] = useState(electionId || data.elections[0]?.id);
  const [page, setPage] = useState(0);
  const records = [...(data.historicalContexts || []), ...(data.heldRecords || [])].filter(row => row.electionId === selectedElection);
  const pages = Math.max(1, Math.ceil(records.length / 20));
  return <>
    <p>這些是不同題目或歷史情境的資料，保留供查閱來源與備註，不併入主表的候選人支持度 MAE。缺少的數值保持空白，不當作零。</p>
    <label>選舉 <select aria-label="來源清單選舉" value={selectedElection} onChange={event => { setSelectedElection(event.target.value); setPage(0); }}>{data.elections.map(election => <option key={election.id} value={election.id}>{election.label}</option>)}</select></label>
    <p className="small muted">此場 {records.length} 筆；全資料另保留 {(data.historicalContexts?.length || 0) + (data.heldRecords?.length || 0)} 筆相關歷史資料。</p>
    {records.slice(page * 20, (page + 1) * 20).map(row => <details className="metadata" key={row.id}><summary>{row.brand || '品牌未載'} · {row.fieldworkEnd ? `調查結束 ${row.fieldworkEnd}` : `日期未知 ${row.indexDate || row.dateText || ''}`}</summary>
      {row.reason && <p className="small">備註：{row.reason}</p>}<p className="small">{Object.entries(row.shares || {}).map(([name, value]) => `${name} ${value == null ? '未載' : `${value}%`}`).join('；')}</p>
      <p className="small muted">調查：{row.fieldworkStart || '未載'} 至 {row.fieldworkEnd || '未載'}；發布：{row.publishedAt || '未載'}。{row.question}</p>
      {row.questionCandidateSet?.length > 0 && <p className="small">原問卷名單：{row.questionCandidateSet.join('、')}</p>}
      {row.sources.map((source, index) => <div className="source-item" key={index}><SourceLink source={source} />{source.evidence_summary && <p className="small">{source.evidence_summary}</p>}</div>)}
    </details>)}
    {!records.length && <p>此場目前沒有其他歷史資料。</p>}
    <Pagination page={page} pageCount={pages} onChange={setPage} label="候選情境資料分頁" />
    <p><a href="./data/verified-source.json" download>下載全部民調、候選情境與逐筆來源 JSON</a></p>
  </>;
}
export function InformationDialog({ kind, data, electionId, returnFocus, onClose }) {
  const dialog = useRef(null);
  const priorFocus = useRef(null);
  useEffect(() => { priorFocus.current = returnFocus || document.activeElement; dialog.current.showModal(); return () => { if (priorFocus.current instanceof HTMLElement && priorFocus.current !== document.body && priorFocus.current.isConnected && priorFocus.current.getClientRects().length) priorFocus.current.focus(); else { const menu = document.querySelector('.mobile-menu'); if (menu?.getClientRects().length) menu.focus(); else document.getElementById('main-content')?.focus(); } }; }, []);
  return <dialog ref={dialog} className="information-dialog" onCancel={onClose} onKeyDown={trapDialogFocus} aria-labelledby="dialog-title"><header><div><span className="eyebrow">選情劉伯溫</span><h2 id="dialog-title">{kind === 'usage' ? '使用說明與限制' : kind === 'catalogue' ? '其他歷史資料與來源' : kind === 'method' ? '方法與資料原則' : '資料版本與更正紀錄'}</h2></div><IconButton label="關閉對話框" onClick={onClose}><X size={20} /></IconButton></header><div className="dialog-body">{kind === 'usage' ? <SiteInformation /> : kind === 'catalogue' ? <HistoricalSources data={data} electionId={electionId} /> : kind === 'method' ? <>
    <p className="lead">把每一份歷史民調，放回同一場選舉中檢視。</p><p>目前收錄 {data.polls.length} 筆民調，涵蓋 {data.elections.length} 場選舉；另保留 {(data.historicalContexts?.length || 0) + (data.heldRecords?.length || 0)} 筆相關歷史資料供查看來源。</p>
    <h3>01　逐筆查看來源與數值</h3><p>單場列表收錄資料集中該場的民調，並附來源連結。支持度可與官方結果對齊時，就顯示平均絕對誤差（MAE）；候選人支持度缺漏、候選集合不一致，或題目並非投票意向時不計分。未知欄位保留為「—」，不推測補值。候選情境及不同題目另列供來源查閱。</p>
    <h3>02　先對齊候選人，再計算平均絕對誤差（MAE）</h3><p>民調與大選結果使用同一候選人集合，各自除以該集合的比例或票數總和，換算成合計 100% 的比例。原始比例、未表態與集合外候選人會保留供查閱；未表態不會分配給候選人。</p><div className="formula">平均絕對誤差（MAE） = 各候選人「正規化民調比例 − 正規化實際比例」絕對值的平均</div><p>單位為百分點，數值越小，代表該份民調的候選人比例越接近這一次實際結果。MAE 只描述指定資料與這場選舉的差異；來源有不同說法時，請查看來源及備註。</p>
    <h3>03　查看不同時間範圍</h3><p>單場預設「封關民調」，每個原始調查單位顯示最新一筆；「歷史民調」顯示各波次。選前 30 天預設不勾選；勾選後，只保留調查結束於投票日前 1 至 30 個日曆日的紀錄，第 30 天包含在內，日期以台灣時區認定。日期未知的紀錄不會套入這個範圍，封關模式先選取最新一筆，再套用時間篩選。</p>
    <h3>04　用共同選舉集合比較機構</h3><p>跨選舉比較自動納入全部機構，同名與已列明的別名合併顯示；原始品牌、執行者與來源仍保留在每筆詳情。每個品牌每場最多取一份符合正式比較條件的民調。各場已有的誤差逐一列出，平均則只採全部機構都有資料的共同選舉集合，至少 3 場才顯示。不同選舉集合的平均不可直接並列；點選分數可查看該筆原始資料與來源。</p>
    <h3>05　來源、欄位與更正</h3><p>機構品牌、委託者、出資者、實際執行者及設計分析者分開記錄。每筆可查看來源與備註，也可下載目前列表的 CSV。資料調整會記錄在版本與更正紀錄。</p><p>{data.methodology?.small_difference_caveat}</p><p>切換原始支持度只改變表格的數值呈現；MAE 始終採正規化比例。原始支持度可能包含未決定者，與有效票比例的分母不同。</p><p><a href="./data/verified-source.json" download>下載完整收錄資料、來源與方法 JSON</a></p>
    <details className="portrait-credits"><summary>候選人照片來源與授權（{candidatePortraits.length} 位）</summary><p className="small muted">照片取自 Wikimedia Commons，保留原作者及授權；本站縮小並以圓形裁切顯示，部分原照已由來源裁切。同一人物跨選舉共用照片，邊框依該次選舉的政黨上色。照片不表示作者或人物為本站背書。</p><ul className="portrait-credit-list">{candidatePortraits.map(portrait => <li key={portrait.id}><img src={portrait.src} alt="" width="36" height="36" loading="lazy" /><div><strong>{portrait.name}</strong><p>作者：{portrait.author}</p><a href={portrait.sourceUrl} target="_blank" rel="noopener noreferrer">照片出處</a><a href={portrait.originalSourceUrl} target="_blank" rel="noopener noreferrer">原始來源</a><a href={portrait.licenseUrl} target="_blank" rel="noopener noreferrer">{portrait.license}</a></div></li>)}</ul></details>
  </> : <><p className="lead">目前資料版本 <strong>{data.version}</strong></p><dl className="definition-list"><div><dt>更新日期</dt><dd>{data.updatedAt}</dd></div><div><dt>選舉</dt><dd>{data.elections.length} 場</dd></div><div><dt>民調紀錄</dt><dd>{data.polls.length} 筆</dd></div></dl><h3>更正紀錄</h3>{data.corrections.length ? <ol className="correction-list">{data.corrections.map((c, i) => <li key={`${c.date}-${i}`}><time>{c.date}</time><h4>{c.title}</h4><p>{c.description}</p>{c.source && <SourceLink source={c.source} />}</li>)}</ol> : <p className="muted">尚無已發布的更正紀錄。</p>}<p className="small muted">所有比較依目前版本資料重新計算。CSV 內保留資料版本，便於重現。</p></>}</div><footer><button className="button primary" onClick={onClose}>我知道了<Check size={15} /></button></footer></dialog>;
}

