import { useEffect, useState } from 'react';
import { loadElectionDetails } from './load-data.mjs';

export function useElectionDetails(data, electionId, enabled = true) {
  const key = enabled ? data.revision + ':' + electionId : '';
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!key) return;
    let active = true;
    setResult({ key, loading: true });
    loadElectionDetails(data, electionId).then(details => {
      if (active) setResult({ key, details });
    }).catch(error => {
      if (active) setResult({ key, error: error.message });
    });
    return () => { active = false; };
  }, [key, attempt]);
  return { ...(result?.key === key ? result : { loading: Boolean(key) }), retry: () => setAttempt(value => value + 1) };
}
