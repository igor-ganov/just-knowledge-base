import { createStore } from '@features/app/store';
import { switchUser } from '@features/settings/settingsService';

/**
 * GitHub identity (spec github-identity): the user is whoever the git
 * credential says they are. Two paths to a token: a PAT typed into sync
 * settings, or the OAuth device flow (client-only; the code/token endpoints
 * lack CORS, so they go through the same ciphertext-only proxy as git).
 * `api.github.com` itself serves CORS, so identity lookup is direct.
 */
export type GitHubUser = {
  readonly login: string;
  readonly avatarUrl: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const identityStore = createStore<GitHubUser | undefined>(undefined);

export const fetchGitHubUser = async (
  token: string,
  fetchLike: FetchLike = fetch,
): Promise<GitHubUser | undefined> => {
  try {
    const response = await fetchLike('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { readonly login?: string; readonly avatar_url?: string };
    return body.login === undefined ? undefined : { login: body.login, avatarUrl: body.avatar_url ?? '' };
  } catch {
    return undefined;
  }
};

/** Connect identity from a token; switches per-user settings (AC-C5.3). */
export const connectIdentity = async (token: string, fetchLike: FetchLike = fetch): Promise<GitHubUser | undefined> => {
  const user = await fetchGitHubUser(token, fetchLike);
  if (user !== undefined) {
    identityStore.set(user);
    switchUser(user.login);
  }
  return user;
};

export const disconnectIdentity = (): void => {
  identityStore.set(undefined);
  switchUser('local');
};

export type DeviceFlowStart = {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalSeconds: number;
};

const proxied = (proxy: string, url: string): string => (proxy === '' ? url : `${proxy.replace(/\/$/u, '')}/${url}`);

export const startDeviceFlow = async (
  clientId: string,
  proxy: string,
  fetchLike: FetchLike = fetch,
): Promise<DeviceFlowStart | undefined> => {
  try {
    const response = await fetchLike(proxied(proxy, 'https://github.com/login/device/code'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      readonly device_code?: string;
      readonly user_code?: string;
      readonly verification_uri?: string;
      readonly interval?: number;
    };
    if (body.device_code === undefined || body.user_code === undefined) return undefined;
    return {
      deviceCode: body.device_code,
      userCode: body.user_code,
      verificationUri: body.verification_uri ?? 'https://github.com/login/device',
      intervalSeconds: body.interval ?? 5,
    };
  } catch {
    return undefined;
  }
};

export type DeviceFlowPoll =
  | { readonly kind: 'token'; readonly token: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed'; readonly reason: string };

export const pollDeviceFlow = async (
  clientId: string,
  deviceCode: string,
  proxy: string,
  fetchLike: FetchLike = fetch,
): Promise<DeviceFlowPoll> => {
  try {
    const response = await fetchLike(proxied(proxy, 'https://github.com/login/oauth/access_token'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const body = (await response.json()) as { readonly access_token?: string; readonly error?: string };
    if (body.access_token !== undefined) return { kind: 'token', token: body.access_token };
    if (body.error === 'authorization_pending' || body.error === 'slow_down') return { kind: 'pending' };
    return { kind: 'failed', reason: body.error ?? 'unknown error' };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : 'network error' };
  }
};
