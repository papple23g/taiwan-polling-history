import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { IconButton } from './ui.jsx';
import { pageNumbers } from './pagination.mjs';

export function Pagination({ page = 0, pageCount = 1, onChange, label = '分頁' }) {
  const count = Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 1;
  const current = Math.min(Math.max(Number.isInteger(page) ? page : 0, 0), count - 1);
  const changePage = (nextPage) => { if (nextPage !== current) onChange(nextPage); };
  return <nav className="pagination" aria-label={label}>
    <IconButton type="button" label="上一頁" disabled={current === 0} onClick={() => changePage(current - 1)}><CaretLeft size={16} /></IconButton>
    {pageNumbers(count).map((pageNumber) => <button type="button" className="page-number" key={pageNumber} aria-label={`第 ${pageNumber + 1} 頁`} aria-current={pageNumber === current ? 'page' : undefined} onClick={() => changePage(pageNumber)}>{pageNumber + 1}</button>)}
    <IconButton type="button" label="下一頁" disabled={current + 1 >= count} onClick={() => changePage(current + 1)}><CaretRight size={16} /></IconButton>
  </nav>;
}
