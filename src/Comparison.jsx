import { useEffect, useMemo, useState } from 'react';
import { ComparisonDetails } from './ComparisonDetails.jsx';
import { MaeHistogram } from './MaeHistogram.jsx';
import { comparisonHistogramMaximum } from './institution-model.mjs';
import { sortElectionsForDisplay } from './election-navigation.mjs';
import { fmt } from './ui.jsx';

export function Comparison({ data, comparison, onOpenElection }) {
  const [brandId, setBrandId] = useState(null);
  const [transientRevision, setTransientRevision] = useState(0);
  const { rows } = comparison;
  const maximum = useMemo(() => comparisonHistogramMaximum(comparison), [comparison]);
  const elections = useMemo(() => sortElectionsForDisplay(data.elections), [data.elections]);
  const selected = rows.find(row => row.institutionId === brandId);
  useEffect(() => { setBrandId(null); setTransientRevision(value => value + 1); }, [comparison]);
  useEffect(() => {
    const close = () => { setBrandId(null); setTransientRevision(value => value + 1); };
    window.addEventListener('popstate', close);
    return () => window.removeEventListener('popstate', close);
  }, []);
  return <div className="comparison">
    <table className="cross-table" role="table"><caption className="sr-only">民調品牌跨場比較表；依平均誤差升冪，分數單位為百分點。誤差分佈每2百分點一區間，所有機構共用0至{maximum}百分點橫軸，柱高為採計場次占比，縱軸0至100%；虛線為中位數。</caption>
      <colgroup><col className="cross-brand-column" /><col className="cross-average-column" /><col className="cross-count-column" /><col className="cross-median-column" /><col className="cross-distribution-column" /><col className="cross-details-column" /></colgroup>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">機構</th><th scope="col" role="columnheader" className="number" aria-sort="ascending">↑ 平均誤差(MAE)<small>百分點</small></th><th scope="col" role="columnheader" className="number">採計場次</th><th scope="col" role="columnheader" className="number">中位數<small>百分點</small></th><th scope="col" role="columnheader">誤差分佈<small>場次占比<span className="histogram-median-key">中位數</span></small></th><th scope="col" role="columnheader">詳情</th></tr></thead>
      <tbody role="rowgroup">{rows.map(row => <tr role="row" key={row.institutionId}>
        <th scope="row" role="rowheader" className="cross-brand">{row.brand}</th>
        <td role="cell" className="number cross-average"><span className="cross-mobile-label" aria-hidden="true">平均誤差(MAE)</span><strong className="accent">{fmt(row.average)}</strong><small className="cross-mobile-label" aria-hidden="true">百分點</small></td>
        <td role="cell" className="number cross-count"><span className="cross-mobile-label" aria-hidden="true">採計場次</span>{row.averageCount}<small className="cross-mobile-label" aria-hidden="true">場</small></td>
        <td role="cell" className="number cross-median"><span className="cross-mobile-label" aria-hidden="true">中位數</span>{fmt(row.median)}<small className="cross-mobile-label" aria-hidden="true">百分點</small></td>
        <td role="cell" className="cross-distribution"><span className="cross-mobile-label" aria-hidden="true">誤差分佈<small>場次占比<span className="histogram-median-key">中位數</span></small></span><MaeHistogram points={row.availablePerElection} maximum={maximum} median={row.median} elections={elections} brand={row.brand} onOpenDetails={() => setBrandId(row.institutionId)} resetToken={transientRevision} /></td>
        <td role="cell" className="cross-details"><button type="button" className="button comparison-detail-button" aria-label={`查看${row.brand}機構詳情`} onClick={() => setBrandId(row.institutionId)}>詳情</button></td>
      </tr>)}</tbody>
    </table>
    {!rows.length && <div className="compact-empty">目前沒有符合篩選條件的機構</div>}
    {selected && <ComparisonDetails data={data} row={selected} maximum={maximum} onOpenElection={onOpenElection} onClose={() => setBrandId(null)} />}
  </div>;
}
