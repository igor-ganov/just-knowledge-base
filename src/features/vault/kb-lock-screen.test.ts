import { describe, expect, test } from 'bun:test';
import './kb-lock-screen';
import type { KbLockScreen } from './kb-lock-screen';

/**
 * Component unit tests via data wrappers (spec component-workbench): props in,
 * DOM out — no app state, no network, no vault.
 */
const mount = async (props: Partial<Pick<KbLockScreen, 'mode' | 'error' | 'busy' | 'passkeySupported' | 'passkeyEnabled'>>): Promise<KbLockScreen> => {
  const element = document.createElement('kb-lock-screen');
  Object.assign(element, props);
  document.body.append(element);
  await (element as KbLockScreen).updateComplete;
  return element as KbLockScreen;
};

describe('kb-lock-screen (pure component)', () => {
  test('unlock mode with passkey shows the passkey button', async () => {
    const element = await mount({ mode: 'unlock', passkeySupported: true, passkeyEnabled: true });
    const button = element.shadowRoot?.querySelector('button.passkey');
    expect(button?.textContent).toContain('Unlock with passkey');
    element.remove();
  });

  test('unlock mode without passkey support hides it', async () => {
    const element = await mount({ mode: 'unlock', passkeySupported: false, passkeyEnabled: true });
    expect(element.shadowRoot?.querySelector('button.passkey')).toBeNull();
    element.remove();
  });

  test('create mode shows the no-recovery warning and error text renders', async () => {
    const element = await mount({ mode: 'create', error: 'Boom happened' });
    expect(element.shadowRoot?.textContent).toContain('no password recovery');
    expect(element.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain('Boom happened');
    element.remove();
  });

  test('vault-create event carries password and passkey opt-in', async () => {
    const element = await mount({ mode: 'create', passkeySupported: true });
    const events: Array<{ password: string; withPasskey: boolean }> = [];
    element.addEventListener('vault-create', (event) => {
      events.push((event as CustomEvent<{ password: string; withPasskey: boolean }>).detail);
    });
    const root = element.shadowRoot;
    const password = root?.querySelector('input[name="password"]');
    const confirm = root?.querySelector('input[name="confirm"]');
    if (password instanceof HTMLInputElement) password.value = 'long enough pw';
    if (confirm instanceof HTMLInputElement) confirm.value = 'long enough pw';
    root?.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(events).toEqual([{ password: 'long enough pw', withPasskey: true }]);
    element.remove();
  });
});
