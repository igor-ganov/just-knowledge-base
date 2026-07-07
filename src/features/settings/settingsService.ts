import { hotkeyOverridesStore } from '@core/commands/commandRegistry';
import type { Chord } from '@core/commands/hotkeys';
import { createStore } from '@features/app/store';

/**
 * Per-user settings (AC-C5.3): keyed by identity — 'local' until a git/GitHub
 * identity connects, then that login. localStorage (not the vault) because the
 * lock screen itself runs commands before any vault exists.
 */
export type UserSettings = {
  readonly hotkeyOverrides: Readonly<Record<string, Chord | null>>;
  readonly autoLockMinutes: number;
};

const DEFAULTS: UserSettings = { hotkeyOverrides: {}, autoLockMinutes: 15 };

export const currentUserStore = createStore<string>('local');
export const userSettingsStore = createStore<UserSettings>(DEFAULTS);

const storageKey = (user: string): string => `jkb-settings:${user}`;

const readStored = (user: string): UserSettings => {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(user));
    if (raw === undefined || raw === null) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UserSettings>) };
  } catch {
    return DEFAULTS;
  }
};

const persist = (user: string, settings: UserSettings): void => {
  globalThis.localStorage?.setItem(storageKey(user), JSON.stringify(settings));
};

let hydrating = false;

const hydrate = (user: string): void => {
  hydrating = true;
  const settings = readStored(user);
  userSettingsStore.set(settings);
  hotkeyOverridesStore.set(settings.hotkeyOverrides);
  hydrating = false;
};

export const initSettings = (): void => {
  hydrate(currentUserStore.get());
  currentUserStore.subscribe(hydrate);
  hotkeyOverridesStore.subscribe((overrides) => {
    if (hydrating) return;
    updateSettings((settings) => ({ ...settings, hotkeyOverrides: overrides }));
  });
};

export const updateSettings = (transform: (settings: UserSettings) => UserSettings): void => {
  const next = transform(userSettingsStore.get());
  userSettingsStore.set(next);
  persist(currentUserStore.get(), next);
};

/** Called by the identity feature once a git/GitHub login is known. */
export const switchUser = (login: string): void => currentUserStore.set(login);
