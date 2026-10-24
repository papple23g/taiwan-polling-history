import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGitHubStars, loadGitHubStars, repositoryApiUrl } from '../src/github.mjs';

test('GitHub stars retain a real zero and accept nonnegative integer counts', async () => {
  for (const count of [0, 1284]) {
    const result = await fetchGitHubStars(async (url, options) => {
      assert.equal(url, repositoryApiUrl);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.referrerPolicy, 'no-referrer');
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({ stargazers_count: count });
    });
    assert.equal(result, count);
  }
});

test('GitHub failures and malformed counts stay unknown rather than becoming zero', async () => {
  assert.equal(await fetchGitHubStars(async () => new Response('', { status: 403 })), null);
  assert.equal(await fetchGitHubStars(async () => { throw new Error('offline'); }), null);
  assert.equal(await fetchGitHubStars(async () => new Response('not JSON')), null);
  for (const count of [undefined, null, -1, 1.5, '0', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await fetchGitHubStars(async () => Response.json({ stargazers_count: count })), null);
  }
});

test('GitHub requests time out without a usable star count', async () => {
  let aborted = false;
  const value = await fetchGitHubStars((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }), 10);
  assert.equal(aborted, true);
  assert.equal(value, null);
});

test('repeated consumers share one request during the page lifetime', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({ stargazers_count: 0 }); };
  try {
    const first = loadGitHubStars();
    const second = loadGitHubStars();
    assert.equal(first, second);
    assert.deepEqual(await Promise.all([first, second, loadGitHubStars()]), [0, 0, 0]);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
