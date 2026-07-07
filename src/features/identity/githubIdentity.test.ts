import { describe, expect, test } from 'bun:test';
import { currentUserStore } from '@features/settings/settingsService';
import {
  connectIdentity,
  disconnectIdentity,
  fetchGitHubUser,
  identityStore,
  pollDeviceFlow,
  startDeviceFlow,
  type FetchLike,
} from './githubIdentity';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fakeFetch = (handler: (url: string, init?: RequestInit) => Response): FetchLike => {
  return (url, init) => Promise.resolve(handler(url, init));
};

describe('github identity via injected fetch wrapper', () => {
  test('fetchGitHubUser maps the api payload', async () => {
    const fetchLike = fakeFetch((url) =>
      url === 'https://api.github.com/user'
        ? jsonResponse(200, { login: 'igor-ganov', avatar_url: 'https://a.example/i.png' })
        : jsonResponse(404, {}),
    );
    expect(await fetchGitHubUser('tok', fetchLike)).toEqual({
      login: 'igor-ganov',
      avatarUrl: 'https://a.example/i.png',
    });
  });

  test('bad token yields undefined, connect switches user settings identity', async () => {
    const bad = fakeFetch(() => jsonResponse(401, {}));
    expect(await fetchGitHubUser('nope', bad)).toBeUndefined();

    const good = fakeFetch(() => jsonResponse(200, { login: 'teammate' }));
    await connectIdentity('tok', good);
    expect(identityStore.get()?.login).toBe('teammate');
    expect(currentUserStore.get()).toBe('teammate');
    disconnectIdentity();
    expect(currentUserStore.get()).toBe('local');
  });

  test('device flow start and poll go through the proxy and parse states', async () => {
    const seen: string[] = [];
    const fetchLike = fakeFetch((url) => {
      seen.push(url);
      if (url.endsWith('/https://github.com/login/device/code')) {
        return jsonResponse(200, {
          device_code: 'dev',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          interval: 5,
        });
      }
      return jsonResponse(200, { error: 'authorization_pending' });
    });
    const start = await startDeviceFlow('client', 'https://proxy.example', fetchLike);
    expect(start?.userCode).toBe('ABCD-1234');
    expect(seen[0]).toBe('https://proxy.example/https://github.com/login/device/code');

    const pending = await pollDeviceFlow('client', 'dev', 'https://proxy.example', fetchLike);
    expect(pending.kind).toBe('pending');

    const done = await pollDeviceFlow(
      'client',
      'dev',
      '',
      fakeFetch(() => jsonResponse(200, { access_token: 'gho_x' })),
    );
    expect(done).toEqual({ kind: 'token', token: 'gho_x' });
  });
});
