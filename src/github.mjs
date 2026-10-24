export const repositoryUrl = 'https://github.com/papple23g/taiwan-polling-history';
export const issuesUrl = `${repositoryUrl}/issues`;
export const repositoryApiUrl = 'https://api.github.com/repos/papple23g/taiwan-polling-history';

export async function fetchGitHubStars(fetcher = globalThis.fetch, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(repositoryApiUrl, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const { stargazers_count: count } = await response.json();
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

let starsRequest;
export function loadGitHubStars() {
  starsRequest ??= fetchGitHubStars();
  return starsRequest;
}
