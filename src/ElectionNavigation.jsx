import { useId } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { electionNavigationItems } from './election-navigation.mjs';

export function ElectionNavigation({ elections, electionId, active, expandedYears, onToggleYear, onSelect }) {
  const prefix = useId();
  const electionButton = (election, presidential = false) => <button key={election.id}
    className={'election-item' + (presidential ? ' presidential-election' : '') + (active && election.id === electionId ? ' active' : '')}
    aria-current={active && election.id === electionId ? 'page' : undefined} onClick={() => onSelect(election.id)}>
    {presidential ? `${election.year} 總統選舉` : `${election.region}長選舉`}
  </button>;
  return <nav className="election-navigation" aria-label="選舉清單">
    {electionNavigationItems(elections).map(item => {
      if (item.kind === 'president') return electionButton(item.election, true);
      const selected = active && item.elections.find(election => election.id === electionId);
      const expanded = expandedYears.has(item.year);
      const id = `${prefix}-elections-${item.year}`;
      const yearLabel = `${item.year} 地方選舉`;
      return <div className="election-year" key={item.year}>
        <button className={'election-year-toggle' + (item.preResult ? ' pre-result-year' : '') + (selected ? ' current-year' : '')}
          aria-expanded={expanded} aria-controls={id}
          aria-label={`${yearLabel}${item.preResult ? '（選前）' : ''}，${item.elections.length}場${selected ? `，目前選取${selected.region}長選舉` : ''}`}
          onClick={() => onToggleYear(item.year)}>
          <CaretRight size={14} aria-hidden="true" /><span className={'election-year-label' + (item.preResult ? ' pre-result' : '')}><span className="election-year-name">{yearLabel}</span>{item.preResult && <span className="election-year-status">（選前）</span>}</span><small>{item.elections.length}場</small>
        </button>
        <div className="election-year-items" id={id} hidden={!expanded}>
          {expanded && item.elections.map(election => electionButton(election))}
        </div>
      </div>;
    })}
    {!elections.length && <p className="sidebar-empty">收錄資料後逐筆列出。</p>}
  </nav>;
}
