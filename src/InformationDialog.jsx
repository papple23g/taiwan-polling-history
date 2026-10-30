import { useEffect, useRef, useState } from 'react';
import { Check, X } from '@phosphor-icons/react';
import { IconButton, SourceLink, trapDialogFocus } from './ui.jsx';
import { Pagination } from './Pagination.jsx';
import { candidatePortraits } from './candidate-portraits.mjs';
import { CandidateAvatar } from './CandidateAvatar.jsx';
import { SiteInformation } from './SiteInformation.jsx';
import { VerificationEvidence } from './VerificationEvidence.jsx';
import { useElectionDetails } from './use-election-details.mjs';
import { publisherBrandRules, publisherPollRules } from './publisher-brand.mjs';

const catalogueCount = data => Object.values(data.catalogueCounts || {}).reduce((sum, counts) => sum + counts.historicalContexts + counts.heldRecords, 0);

function PollBrandNotes() {
  return <details className="metadata"><summary>民調品牌歸戶成員、理由與依據</summary>
    <p>單場主表、機構多選與跨場比較使用同一套民調品牌。品牌沿用來源原收錄標籤，再依有公開依據的別名或逐筆規則歸戶；標籤可能對應媒體、委託者或執行者，不一概等同發布者或調查執行機構。單場「封關／最新」與跨場均每品牌每場最多取一份，歷史保留全部波次。</p>
    <ul className="publisher-brand-notes">{publisherBrandRules.map(rule => <li key={rule.brand}><strong>{rule.brand}</strong>：{rule.aliases.join('、')}。{rule.reason}<span>{rule.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">依據 {index + 1}</a>)}</span></li>)}</ul>
    <p>共用執行者、委託者、出資者或媒體集團不足以合併不同品牌。以下逐筆歸戶僅適用於列出的民調，不將原品牌的所有紀錄一併改列。</p>
    <ul className="publisher-brand-notes">{publisherPollRules.map(rule => <li key={rule.pollIds[0]}><strong>{rule.originalBrand} → {rule.brand}</strong>。{rule.reason}<details><summary>{rule.pollIds.length} 筆民調與歸戶依據</summary><ul>{rule.pollIds.map(id => <li key={id}>{id}</li>)}</ul>{rule.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">依據 {index + 1}</a>)}</details></li>)}</ul>
    <p>原機構 ID、原收錄品牌、原始執行者、委託者、出資者、設計分析與民調 ID 均保留於詳情及完整資料。歸戶不代表團隊、人員、方法或一手來源核實狀態相同；執行者未知不會改掉品牌名稱，也不因此排除跨場採計。</p>
    <p>機構選單可搜尋品牌、別名與逐筆執行者，但搜尋執行者不會合併品牌。舊版執行機構篩選會依該場對應紀錄還原為品牌選取；沒有對應時回到全選。</p>
  </details>;
}
function HistoricalSources({ data, electionId }) {
  const [selectedElection, setSelectedElection] = useState(electionId || data.elections[0]?.id);
  const [page, setPage] = useState(0);
  const evidence = useElectionDetails(data, selectedElection);
  const sourceObservations = [...(evidence.details?.historicalContexts || []), ...(evidence.details?.heldRecords || [])];
  const recordIds = new Set(sourceObservations.map(row => row.id));
  const records = sourceObservations.filter(row => !row.resolved || !recordIds.has(row.relatedRecordId));
  const pages = Math.max(1, Math.ceil(records.length / 20));
  return <>
    <p>這些是不同題目或歷史情境的資料，保留供查閱來源與備註，不併入主表的候選人支持度 MAE。缺少的數值保持空白，不當作零。</p>
    <label>選舉 <select aria-label="來源清單選舉" value={selectedElection} onChange={event => { setSelectedElection(event.target.value); setPage(0); }}>{data.elections.map(election => <option key={election.id} value={election.id}>{election.label}</option>)}</select></label>
    <p className="small muted">此場 {(data.catalogueCounts?.[selectedElection]?.historicalContexts || 0) + (data.catalogueCounts?.[selectedElection]?.heldRecords || 0)} 筆來源觀察；全資料另保留 {catalogueCount(data)} 筆。同題的重複來源合併顯示，原始紀錄仍保留於完整資料。</p>
    {evidence.loading && <p role="status">正在載入來源目錄與查核資訊…</p>}
    {evidence.error && <div role="alert"><p>{evidence.error}</p><button className="button" onClick={evidence.retry}>重試載入來源</button></div>}
    {records.slice(page * 20, (page + 1) * 20).map(row => <details className="metadata" key={row.id}><summary>{row.brand || '原收錄品牌未載'} · {row.fieldworkEnd ? `調查結束 ${row.fieldworkEnd}` : `日期未知 ${row.indexDate || row.dateText || ''}`}</summary>
      {row.reason && <p className="small">備註：{row.reason}</p>}<p className="small">{Object.entries(row.shares || {}).map(([name, value]) => `${name} ${value == null ? '未載' : `${value}%`}`).join('；')}</p>
      <p className="small muted">調查：{row.fieldworkStart || '未載'} 至 {row.fieldworkEnd || '未載'}；發布：{row.publishedAt || '未載'}。{row.question}</p>
      {row.questionCandidateSet?.length > 0 && <p className="small">原問卷名單：{row.questionCandidateSet.join('、')}</p>}
      {(row.sources || []).map((source, index) => <div className="source-item" key={index}><SourceLink source={source} />{source.evidence_summary && <p className="small">{source.evidence_summary}</p>}</div>)}
      <VerificationEvidence record={row} />
    </details>)}
    {!evidence.loading && !evidence.error && !records.length && <p>此場目前沒有其他歷史資料。</p>}
    {records.length > 0 && <Pagination page={page} pageCount={pages} onChange={setPage} label="候選情境資料分頁" />}
    <p><a href="/data/verified-source.json" download>下載全部民調、候選情境與逐筆來源 JSON</a></p>
  </>;
}
export function InformationDialog({ kind, data, electionId, returnFocus, onClose }) {
  const dialog = useRef(null);
  const priorFocus = useRef(null);
  useEffect(() => { priorFocus.current = returnFocus || document.activeElement; dialog.current.showModal(); return () => { if (priorFocus.current instanceof HTMLElement && priorFocus.current !== document.body && priorFocus.current.isConnected && priorFocus.current.getClientRects().length) priorFocus.current.focus(); else { const menu = document.querySelector('.mobile-menu'); if (menu?.getClientRects().length) menu.focus(); else document.getElementById('main-content')?.focus(); } }; }, []);
  return <dialog ref={dialog} className="information-dialog" onCancel={onClose} onKeyDown={trapDialogFocus} aria-labelledby="dialog-title"><header><div><span className="eyebrow">台灣選情劉伯溫</span><h2 id="dialog-title">{kind === 'usage' ? '使用限制與免責聲明' : kind === 'catalogue' ? '其他題目與來源' : kind === 'method' ? '方法與來源' : '資料版本與更正紀錄'}</h2></div><IconButton label="關閉對話框" onClick={onClose}><X size={20} /></IconButton></header><div className="dialog-body">{kind === 'usage' ? <SiteInformation /> : kind === 'catalogue' ? <HistoricalSources data={data} electionId={electionId} /> : kind === 'method' ? <>
    <h3>誤差怎麼算</h3><p>平均絕對誤差（MAE）將同一候選集合的民調與官方票數各自換算為合計 100%，再平均各候選人的絕對差；單位為百分點，越小越接近該場結果。缺值不補零，未表態不分配。</p>
    <h3>跨場怎麼看</h3><p>跨場按民調品牌比較：同一品牌每場採計一份可計算民調，再按該品牌自身場次等權平均。品牌沿用來源原收錄標籤及有依據的別名、逐筆歸戶，不一概等同發布者或執行機構；原始執行者、委託、出資及設計分析角色在詳情揭露，不額外計權。誤差分佈顯示各區間占該品牌採計場次的比例，垂直虛線標示中位數；點分佈圖或「詳情」可查看逐場資料。各品牌涵蓋場次可能不同，排序不代表同條件的可信度或責任評價。</p>
    <h3>圖表怎麼讀</h3><p>藍點代表民調，紅星代表已核實官方結果；雙人圖中，兩者的水平距離就是 MAE。選前只呈現支持度，不預測結果或勝率。</p>
    <h3>來源與限制</h3><p>點表格「詳情」查看逐筆來源、查核、缺漏及衝突；單場表列其他位置可選取並定位圖點。可計算與來源核實是不同判定，本資料集不保證完整涵蓋。</p>
    <details className="metadata"><summary>計算與缺漏</summary>
      <p>民調與官方整數票數使用同一候選集合，各自除以該集合的支持度或票數總和，換算成合計 100% 的比例，再計算下式；所有運算使用未四捨五入值。</p><div className="formula">平均絕對誤差（MAE） = 各候選人「正規化民調比例 − 正規化實際比例」絕對值的平均</div>
      {data.methodology?.local_history_candidate_rule && <p>{data.methodology.local_history_candidate_rule}</p>}
      <p>原始支持度、未表態與集合外候選人保留供查閱，未表態不分配給候選人。切換原始／正規化比例只改表格顯示，不改 MAE 或圖表；原始支持度可能包含未決定者，與有效票比例的分母不同。未知欄位顯示「—」，不推測補值。</p>
      <p>來源核實、算術可算及正式評分資格分開判定。已完成選舉在輸入可對齊時可顯示計算結果，不因執行者、樣本或方法未知而封鎖算術；候選情境不符、非投票意向、未解支持度衝突、無效支持度或官方票數則不計分。回答合計超過 100.5% 時可保留帶警示的試算，正式評分仍使用嚴格一致性條件。</p>
      <p>正式評分另要求六核心欄位的一手依據、選前發布、候選人與數值一致及官方結果核實；六核心為支持度、調查結束日、發布日、執行者、樣本與方法。兩份獨立完整二手來源可交叉核對，同一發布稿的轉載只算一個證據家族；二手交叉核對不取得正式評分資格，納入跨場平均也不代表已完成核實。</p>
      <p>選前資料不產生官方結果、MAE 或跨場分數，不因時間經過自動補入。主表使用主要比較集合，完整已收錄選項保留於詳情；其他題目、候選情境及原始問卷尚未核實的限制，保留於來源目錄或逐筆詳情。</p>
      <p>淡色底標示該列所列候選人中支持度最高者；並列一起標示。點列內其他位置選取並定位資料點，點「詳情」才開啟來源抽屜；只開啟詳情或點圖不自動平移。</p>
      <p>歸戶民調品牌、原收錄品牌、原始執行者、委託者、出資者及設計分析者分開記錄。逐欄查核、原始觀察、更正及未解衝突均保留；資料調整可由版本與更正紀錄查閱。</p><p>{data.methodology?.small_difference_caveat}</p><p><a href="/data/verified-source.json" download>下載完整收錄資料、來源與方法 JSON</a></p>
    </details>
    <details className="metadata"><summary>封關日期與跨場採計</summary>
      <p>首頁預設 2022 年臺北市長選舉。已完成選舉預設「封關」、正規化比例及 MAE 升冪；從導覽進入 2026 選前選舉時，預設「歷史」、原始比例及調查開始日降冪。單場表格的「調查日期」顯示調查開始日，排序也依該日；開始日未知時保留未知。一般「歷史」顯示全部波次，播放器顯示播放日期以前各品牌最新的可繪波次；選前的「最新」與已完成選舉的「封關」皆按民調品牌選取。</p>
      <p>單場「封關／最新」跨查核狀態，先依調查結束日、再依發布日取最新一筆；來源明示封關不壓過較新波次。調查結束日未知時，若發布日晚於最新已知結束日，可作選取代理，但結束日仍未知；結束日全未知或最新支持度衝突的單位排除並計數。日期未知置後，不以索引日期代填。</p>
      <p>單場預設不勾選「選前 30 天」；從單場導覽進入跨場比較時，預設勾選「選前 30 天」及「採計至少 5 場」。同一分頁重新整理及上一頁／下一頁保留篩選、排序與選取，重按目前跨場導覽不重設。網址只表示頁面與選舉，複製到新分頁或分享給別人時顯示該頁預設畫面。30 天窗口依調查結束日判定，為投票日前第 1 至 30 個台灣日曆日，第 30 天包含在內；結束日未知不納入。單場先選最新再套日期篩選，歷史模式逐筆篩選。</p>
      <p>機構下拉列出全場民調品牌，可搜尋品牌名稱、有依據的別名或逐筆執行者；選單搜尋只縮小選項，全選及取消全選仍作用於全場品牌。取消全選不顯示民調，一般檢視仍保留已完成選舉的官方結果；播放器依播放日期顯示結果。切換選舉回到全選。</p>
      <p>跨場納入已完成選舉中有公開來源、官方結果完整核實且可計算的已收錄民調，包含待核實紀錄；來源查核狀態及執行者、樣本、方法缺漏不阻擋品牌採計。已知調查結束日或發布日在投票日及之後者排除。未啟用日期篩選時，日期未知可納入，未知仍保留為未知。</p>
      <p>跨場啟用 30 天篩選時，先限有效調查結束日在窗口內，再選每個品牌每場的一份可計算民調，最後依採計場次篩機構。選取時優先有公開證據的明示封關，其次依較新調查結束日、發布日，未知日期置後；同優先級且比較候選支持度相同可取穩定代表，來源或核實等中繼欄位差異不擋採計。比較支持度衝突則排除，不以較準者或 ID 裁決，也不因機構誤差偏大刪除紀錄。</p>
      <p>平均誤差(MAE) 依每個品牌自身採計場次等權平均，有 1 場即可計算；中位數是逐場誤差排序後的中間值，偶數場取中間兩值平均；最大誤差是採計範圍內最大的一場，三者單位均為百分點。主表列出中位數，機構抽屜保留中位數與最大誤差數值。採計場次經目前時間篩選及每品牌每場去重後計算。預設只顯示至少 5 場的機構，取消後全部品牌合併於同一表格，包含零場機構；5 場只是展示門檻，不保證統計可靠性。</p>
      <p>平均值使用未四捨五入分數升冪排序，零分保留，無平均值排最後，同值維持既有順序。各機構場次可能不同，即使沒有全部機構共同選舉，仍計算各自平均並顯示逐場分數；排序不代表同條件的可信度排名，也無法將誤差責任完全歸因於品牌或執行機構。無法採計者留白，不補零或改寫查核狀態。</p>
      <p>誤差分佈使用未四捨五入的逐場 MAE，每 2 個百分點分一組。區間包含左端、不含右端，只有最後一組包含共同上界；真正的零誤差歸入第一組。柱高為該區間場次除以機構採計場次，縱軸固定為 0–100%；零場機構不畫分佈。垂直虛線位於未四捨五入的中位數；區間提示列出該區間內的完整選舉名稱與各場 MAE。</p>
      <p>所有機構共用橫軸上界：依目前日期條件、套用至少 5 場門檻前的全部品牌最大逐場 MAE，向上取至 10 的倍數，最低為 30 個百分點。勾選或取消 5 場門檻不改刻度。分佈與場次只描述目前收錄範圍，不保證統計可靠性，也不代表各機構的採計選舉相同。</p>
      <p>點誤差分佈圖或「詳情」開啟機構抽屜，可查看放大圖、展開區間數值、逐場的選舉、調查結束日、MAE、核實狀態與來源，以及展開未採計項目。歸戶品牌、原品牌、原始執行者、委託、出資與設計分析等資訊保留於逐場詳情，不額外計權。調查結束日未知時保留未知；逐場依年度及地區順序排列。點逐場 MAE 可進入該場歷史並精確選取該筆。抽屜及分佈提示不保存於網址或瀏覽歷史，重新整理、上一頁／下一頁或離開跨場頁面時關閉。</p>
    </details>
    <details className="metadata"><summary>圖表與官方分類</summary>
      <p>雙人一維散點圖的橫軸是固定比較集合第一人的正規化支持度，另一人為 100% 減去該值；所有點在同一條水平線，沒有日期縱軸。官方結果完整核實時才畫紅星，民調點到星號的水平距離等於雙人 MAE；結果缺漏時仍可畫有效民調。50% 左側是第二人的區域，右側是第一人，交界表示平手；歷史稱「勝選區」，選前稱「支持度領先區」。</p>
      <p>三人使用三角圖，超過三人使用比例長條圖；未選取的長條圖只顯示官方比例。歷史三角集合固定；沒有可畫點時，仍保留有效官方結果與三角區域。缺支持度、候選情境不符、非投票意向或未解支持度衝突的紀錄只留表格；能否繪圖與正式評分資格分開。</p>
      <p>指向三角圖的候選人頭像或姓名，或用鍵盤聚焦，可查看該候選人的支持度刻度；移開、失焦或按 Escape 關閉。手機點頭像切換，查看民調點或結果星號時會保留，再點同一頭像、空白或圖外可關閉。兩邊相同百分比的輔助線表示相同正規化支持度；背景越深支持度越高，從 0% 的白色漸變至 100% 的政黨色（32% 不透明度），暫時取代領先區。放大後刻度自動細分，色深仍對應真實比例；拖曳、縮放、取消觸控、調整圖表大小或圖表脈絡改變時清除效果，保留既有視野。</p>
      <p>雙人圖與三角圖的「歷史」預設顯示歷程路線，以箭頭依調查開始日由舊到新連接目前可見的同品牌民調；同日資料分岔，開始日未知或無效不連線。雙人圖向右的箭頭上彎、向左的箭頭下彎，只用於區分方向，弧線高度不代表資料或兩次調查之間的變化。選取有連線的民調會以紫色強調該品牌路線及其他可見點；箭頭位於其他點上方，所選點在最上層。線段不表示兩點間沒有其他波次，同品牌的調查也可能使用不同題目、方法或樣本，路線不是預測。</p>
      <p>時間播放器依調查開始日回放目前篩選中可繪製的民調，按實際天數安排進度；開始日不代表資料當天已發布。每個品牌顯示當時最新可繪日期的波次，同日多筆保留；開始日未知或無法繪圖的紀錄不排入播放。播放日期旁顯示距投票日的台灣日曆天數，投票日後顯示已過天數。1× 速度播放完整時間範圍約需 7.5 秒。播放器啟用期間，不論播放或暫停均隱藏表格與詳情，仍可調整機構及 30 天篩選；變更篩選會暫停並重建時間軸。拖曳時間軸可即時查看該日真實快照。已完成選舉在投票日前不顯示官方結果及 MAE；選前選舉沒有結果。</p>
      <p>播放器在同一張圖上移動民調點；1× 每段約 0.2 秒，速度可調整。同日多點以交叉淡入淡出呈現，不任意配對；資料密集時先完成目前轉場，再接最新目標。點圖可暫停日期，未完成的點會繼續移至該日期的最新目標，在 1× 最多約 0.4 秒、0.1× 最多約 4 秒。暫停後將滑鼠移到點上或在觸控裝置點按可查看提示；移動中的提示不顯示支持度，到位後才顯示真實數值。切換到背景會暫停，回到前景仍保持暫停，未完成的移動會繼續走完。播放器即使在系統啟用減少動態效果時仍會移動。轉場不代表調查之間有觀測值或預測；不同波次的題目、方法或樣本也可能不同。</p>
      <p>雙人圖與三角圖的民調點預設顯示一至兩字的品牌縮寫，可用「顯示名稱」切換。民調點以調查結束日距選舉日的台灣日曆天數表示深淺：選前 1–7 天不透明度 100%、8–14 天 80%、15–30 天 60%、超過 30 天 40%。一維圖及歷史三人圖的日期未知、無效、選舉當日或選後紀錄使用藍色空心點；選前三人圖須有完整有效的調查結束日才繪點。提示保留實際天數或未知，不以發布日代填；官方星號完全不透明，一般檢視的選取與滑過不改點的大小、深淺或實際位置。</p>
      <p>2026 選前以固定兩人為基礎；可見篩選紀錄中，任何其他單一候選人的原始支持度達 5% 時，加入支持度最高的第三人，改用固定三人三角圖。同值依較新有效調查結束日、發布日及候選人 ID 排序，未知日期最後。先決定第三人門檻，再排除無日期或支持度不完整的畫點紀錄；即使全無完整點，仍保留三人總覽。</p>
      <p>選前三角圖僅正規化固定三人，不合計其餘人選或未表態，不改表格及計分的候選集合。選前圖不對民調數據平滑、平均或預測；「支持度領先區」只表示正規化比例中何者最高，交界為平手，不是勝率或選舉結果。</p>
      <p>一般檢視的圖表支援拖曳平移、游標或雙指中點縮放，雙人圖只作水平操作；雙擊按目前資料還原範圍。同場、同圖型、同候選組合的波次、機構、日期篩選、排序、選取及版面切換均保留視野，包含無點狀態；切換選舉、圖型或候選組合才還原。重疊紀錄可由表格逐筆選取；表列選取若已在視野就不移動，否則保留倍率定位該點。</p>
      <p>候選人圖例與區域色採當次官方推薦政黨分類：民進黨綠、國民黨藍、民眾黨青、親民黨橘，其餘／未知／無黨籍及未經政黨推薦為灰色，不從個人身分或聯盟支持推定。2012 年宋楚瑜以連署方式登記，官方合併分類不等於沒有黨籍；2022 年黃珊珊亦列於「無黨籍及未經政黨推薦」。<a href="https://www.sef.org.tw/files/8944/40AD0401-BC6B-49CA-AE59-A93EDBD5C6D9.pdf" target="_blank" rel="noopener noreferrer">2012 中選會結果說明</a>、<a href="https://vote.nccu.edu.tw/cec/vote3.asp?pass1=L%3A8%3A%3AI%3E%3B88888888iii%28%28" target="_blank" rel="noopener noreferrer">2022 臺北官方選舉資料</a>。</p>
    </details>
    <PollBrandNotes />
    <details className="portrait-credits"><summary>候選人照片來源與授權（{candidatePortraits.length} 位）</summary><p className="small muted">照片的原始來源、作者與授權逐筆列於下方；本站縮小並以圓形裁切顯示，部分原照已由來源裁切。同一人物跨選舉共用照片，邊框依該次選舉的政黨上色。照片不表示作者或人物為本站背書。</p><ul className="portrait-credit-list">{candidatePortraits.map(portrait => <li key={portrait.id}><CandidateAvatar candidate={{ id: portrait.id, color: '#dbe2e9' }} portrait={portrait} loading="lazy" /><div><strong>{portrait.name}</strong><p>作者：{portrait.author}</p><a href={portrait.sourceUrl} target="_blank" rel="noopener noreferrer">照片出處</a><a href={portrait.originalSourceUrl} target="_blank" rel="noopener noreferrer">原始來源</a><a href={portrait.licenseUrl} target="_blank" rel="noopener noreferrer">{portrait.license}</a></div></li>)}</ul></details>
  </> : <><p className="lead">目前資料版本 <strong>{data.version}</strong></p><dl className="definition-list"><div><dt>更新日期</dt><dd>{data.updatedAt}</dd></div><div><dt>選舉</dt><dd>{data.elections.length} 場</dd></div><div><dt>民調紀錄</dt><dd>{data.polls.length} 筆</dd></div></dl><h3>更正紀錄</h3>{data.corrections.length ? <ol className="correction-list">{data.corrections.map((c, i) => <li key={`${c.date}-${i}`}><time>{c.date}</time><h4>{c.title}</h4><p>{c.description}</p>{c.source && <SourceLink source={c.source} />}</li>)}</ol> : <p className="muted">尚無已發布的更正紀錄。</p>}<p className="small muted">所有比較依目前版本資料重新計算。完整 JSON 保留資料版本，便於重現。</p></>}</div><footer><button className="button primary" onClick={onClose}>我知道了<Check size={15} /></button></footer></dialog>;
}

