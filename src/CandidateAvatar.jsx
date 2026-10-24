import { useState } from 'react';
import { User } from '@phosphor-icons/react';
import { portraitByCandidate } from './candidate-portraits.mjs';

export function CandidateAvatar({ candidate, portrait = portraitByCandidate.get(candidate.id) }) {
  const [failedSource, setFailedSource] = useState(null);
  const available = portrait?.src && failedSource !== portrait.src;
  return <span className={'candidate-avatar' + (available ? '' : ' portrait-unavailable')} aria-hidden="true" style={{ borderColor: candidate.color }} title={available ? undefined : '照片無法顯示'}>
    {available ? <img src={portrait.src} alt="" width="36" height="36" decoding="async" style={{ objectPosition: portrait.objectPosition || '50% 35%' }} onError={() => setFailedSource(portrait.src)} /> : <User size={20} weight="light" />}
  </span>;
}
