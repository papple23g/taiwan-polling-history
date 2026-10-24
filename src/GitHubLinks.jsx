import { useEffect, useState } from 'react';
import { Bug, GithubLogo, Star } from '@phosphor-icons/react';
import { issuesUrl, loadGitHubStars, repositoryUrl } from './github.mjs';

export function GitHubLinks() {
  const [stars, setStars] = useState(null);
  useEffect(() => {
    let active = true;
    loadGitHubStars().then(count => { if (active) setStars(count); });
    return () => { active = false; };
  }, []);
  return <nav className="header-links" aria-label="專案與問題回報">
    <a className="github-link" href={repositoryUrl} target="_blank" rel="noopener noreferrer" aria-label={`GitHub 原始碼${stars === null ? '' : `，${stars} 顆 Star`}（另開分頁）`}>
      <GithubLogo size={21} aria-hidden="true" /><span className="github-label">GitHub</span>
      {stars !== null && <span className="github-stars"><Star size={14} aria-hidden="true" /><span>{stars.toLocaleString('en-US')}</span></span>}
    </a>
    <a href={issuesUrl} target="_blank" rel="noopener noreferrer" aria-label="問題回報：GitHub Issues（另開分頁）"><Bug size={18} aria-hidden="true" /><span>問題回報</span></a>
  </nav>;
}
