import { issuesUrl, repositoryUrl } from './github.mjs';

export const usageSummary = '本站整理已收錄的歷史民調與選舉結果，供查閱與比較，不提供未來選情預測。資料可能有缺漏或誤植；歷史誤差不代表機構整體可信度，使用時請一併查閱原始來源與計算方法。';

export function SiteInformation() {
  return <>
    <p className="lead">{usageSummary}</p>
    <h3>資料涵蓋與核對限制</h3>
    <p>本站是已收錄資料的整理，不是所有歷屆選舉民調的完整普查。來源可能有缺漏、失效或不同說法；未知欄位保留空白，不以零或推測補值。</p>
    <p>主表包含已核實與尚待核對的紀錄。支持度與官方結果可對齊時即可顯示平均絕對誤差（MAE），有數值不代表來源已完成核實；請查看該筆計算詳情中的來源、備註與限制。跨場比較只使用符合正式比較條件的紀錄。</p>
    <h3>如何解讀歷史誤差</h3>
    <p>MAE 描述指定候選人集合中，正規化民調比例與該場官方結果的平均絕對差，單位為百分點。它不是民調報告的抽樣誤差，也不衡量機構整體可信度或未來預測能力。</p>
    <p>調查時間、對象、方式、候選組合及選情變化都會影響比較。微小差距可能低於原報告的四捨五入誤差；本站不宣稱差距具有統計顯著性。</p>
    <h3>問題回報與資料更正</h3>
    <p>如發現錯誤，請透過 <a href={issuesUrl} target="_blank" rel="noopener noreferrer">GitHub Issues 問題回報</a>提供選舉、機構、調查日期、疑似錯誤及可公開查閱的來源。已採納的資料更正會記錄於「版本與更正」。回報內容會公開，請勿附上個人敏感資訊。</p>
    <h3>程式碼、資料與圖片授權</h3>
    <p>本站原創程式碼採 <a href={`${repositoryUrl}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">MIT 授權</a>。民調報告、新聞、照片與第三方套件各依其原有權利或授權處理，不因收錄於本站而一律適用 MIT。</p>
    <p>每筆資料保留公開來源；引用時請標示原始發布者、本站資料版本及計算方法。候選人照片的作者、來源、授權與裁切說明列於「方法與來源」，第三方套件說明見倉庫的 <a href={`${repositoryUrl}/blob/main/THIRD-PARTY-NOTICES.md`} target="_blank" rel="noopener noreferrer">第三方權利說明</a>。</p>
    <h3>隱私與外部服務</h3>
    <p>本站前端未設帳號、回報表單或行為分析，也不以 Cookie 或瀏覽器儲存空間追蹤使用者。頁首 Star 數會向 GitHub 公開 API 請求；點選原始碼、問題回報及資料來源時會前往外部網站。外部服務與網站託管服務可能依其政策處理 IP 位址及必要連線資訊。</p>
  </>;
}

export function SiteFooter({ data, onOpenInformation }) {
  return <footer className="workspace-footer">
    <p>{usageSummary}</p>
    <div className="footer-meta"><span>資料版本 {data.version} · 更新日期 {data.updatedAt}</span><nav aria-label="網站說明"><button onClick={() => onOpenInformation('usage')}>使用說明與限制</button><button onClick={() => onOpenInformation('method')}>方法與來源</button><button onClick={() => onOpenInformation('version')}>版本與更正</button></nav></div>
  </footer>;
}
