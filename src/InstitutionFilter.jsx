import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, MagnifyingGlass, X } from '@phosphor-icons/react';
import { searchBrandOptions } from './publisher-brand.mjs';

export function InstitutionFilter({ options, brandIds, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState(null);
  const button = useRef(null), panel = useRef(null), input = useRef(null);
  const id = useId();
  const chosen = new Set(brandIds === null ? options.map(option => option.id) : brandIds);
  const visible = searchBrandOptions(options, search);
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) button.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current.getBoundingClientRect();
      const gutter = 12, width = Math.min(Math.max(rect.width, 300), window.innerWidth - gutter * 2);
      const below = window.innerHeight - rect.bottom - gutter - 4, above = rect.top - gutter - 4;
      const up = below < 260 && above > below;
      setPosition({ left: Math.max(gutter, Math.min(rect.left, window.innerWidth - width - gutter)), width,
        maxHeight: Math.max(120, up ? above : below), ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
    };
    const outside = event => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) close(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } };
    const focusOutside = event => { if (!panel.current?.contains(event.target) && !button.current?.contains(event.target)) close(); };
    place();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
      document.removeEventListener('focusin', focusOutside); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  function toggle(option) {
    const next = new Set(chosen);
    if (next.has(option.id)) next.delete(option.id); else next.add(option.id);
    onChange(next.size === options.length ? null : options.filter(item => next.has(item.id)).map(item => item.id));
  }
  return <>
    <button ref={button} type="button" className="institution-filter-button" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span>機構：{brandIds === null ? '全部' : `已選 ${chosen.size} / ${options.length}`}</span><CaretDown size={16} />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label="篩選發布品牌" className="institution-filter-panel" style={position || { left: 12, top: 12, width: 'calc(100% - 24px)', maxHeight: 'calc(100dvh - 24px)' }}>
      <div className="institution-filter-heading"><strong>篩選發布品牌</strong><button type="button" className="icon-button" aria-label="關閉機構篩選" onClick={() => close(true)}><X size={18} /></button></div>
      <label className="institution-option-search"><MagnifyingGlass size={16} /><input ref={input} autoFocus type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="搜尋品牌或別名" placeholder="搜尋品牌或別名…" /></label>
      <div className="institution-filter-actions"><button type="button" onClick={() => onChange(null)}>全選</button><button type="button" onClick={() => onChange([])}>取消全選</button><span role="status">已選 {chosen.size} 家</span></div>
      <div className="institution-filter-options" role="group" aria-label="發布品牌選項">
        {visible.map(option => <label key={option.id}><input type="checkbox" checked={chosen.has(option.id)} onChange={() => toggle(option)} /><span>{option.brand}</span></label>)}
        {!visible.length && <p className="small muted">沒有符合搜尋的品牌。</p>}
      </div>
    </div>, document.body)}
  </>;
}
