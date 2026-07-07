import { css, html, LitElement, nothing } from 'lit';
import { pollDeviceFlow, startDeviceFlow, type DeviceFlowStart } from '@features/identity/githubIdentity';
import { defaultCorsProxy, type SyncSettings } from './syncConfig';

const CLIENT_ID_KEY = 'jkb-github-client-id';

/**
 * Sync settings dialog (AC-7.1): remote URL, access token, CORS proxy, and the
 * auto-lock interval. Emits `sync-save` with the new settings.
 */
export class KbSyncDialog extends LitElement {
  static override properties = {
    settings: { attribute: false },
    autoLockMinutes: { type: Number },
    passkeySupported: { type: Boolean },
    passkeyEnabled: { type: Boolean },
    notice: { type: String },
    deviceFlow: { attribute: false, state: true },
    deviceFlowStatus: { type: String, state: true },
  };

  declare settings: SyncSettings | undefined;
  declare autoLockMinutes: number;
  declare passkeySupported: boolean;
  declare passkeyEnabled: boolean;
  declare notice: string;
  declare deviceFlow: DeviceFlowStart | undefined;
  declare deviceFlowStatus: string;

  private deviceFlowActive = false;

  constructor() {
    super();
    this.autoLockMinutes = 15;
    this.passkeySupported = false;
    this.passkeyEnabled = false;
    this.notice = '';
    this.deviceFlowStatus = '';
  }

  private async runDeviceFlow(): Promise<void> {
    const root = this.renderRoot;
    const clientInput = root.querySelector('input[name="ghClientId"]');
    const proxyInput = root.querySelector('input[name="proxy"]');
    const clientId = clientInput instanceof HTMLInputElement ? clientInput.value.trim() : '';
    const proxy = proxyInput instanceof HTMLInputElement ? proxyInput.value.trim() : defaultCorsProxy;
    if (clientId === '') {
      this.deviceFlowStatus = 'Enter your GitHub OAuth app client id first.';
      return;
    }
    globalThis.localStorage?.setItem(CLIENT_ID_KEY, clientId);
    this.deviceFlowStatus = 'Requesting device code…';
    const start = await startDeviceFlow(clientId, proxy);
    if (start === undefined) {
      this.deviceFlowStatus = 'Could not reach GitHub (check the CORS proxy and client id).';
      return;
    }
    this.deviceFlow = start;
    this.deviceFlowStatus = 'Waiting for authorization…';
    this.deviceFlowActive = true;
    const poll = async (): Promise<void> => {
      if (!this.deviceFlowActive) return;
      const result = await pollDeviceFlow(clientId, start.deviceCode, proxy);
      switch (result.kind) {
        case 'token': {
          const tokenInput = root.querySelector('input[name="token"]');
          if (tokenInput instanceof HTMLInputElement) tokenInput.value = result.token;
          this.deviceFlow = undefined;
          this.deviceFlowActive = false;
          this.deviceFlowStatus = 'Signed in — token filled below, press Save.';
          return;
        }
        case 'pending':
          setTimeout(() => void poll(), (start.intervalSeconds + 1) * 1000);
          return;
        case 'failed':
          this.deviceFlow = undefined;
          this.deviceFlowActive = false;
          this.deviceFlowStatus = `Sign-in failed: ${result.reason}`;
          return;
      }
    };
    setTimeout(() => void poll(), start.intervalSeconds * 1000);
  }

  static override styles = css`
    dialog {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      padding: var(--space-4);
      width: min(30rem, 90vw);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 45%);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    h2 {
      margin: 0;
      font-size: 1.1rem;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      font-size: 0.9rem;
    }
    input {
      padding: var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-bg);
      color: var(--color-text);
    }
    p.hint {
      margin: 0;
      font-size: 0.8rem;
      color: var(--color-text-muted);
    }
    .row {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    button {
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
    }
    button.primary {
      background: var(--color-accent);
      border-color: var(--color-accent);
      color: var(--color-accent-contrast);
    }
  `;

  show(): void {
    const dialog = this.renderRoot.querySelector('dialog');
    dialog?.showModal();
  }

  private close(): void {
    this.renderRoot.querySelector('dialog')?.close();
  }

  private save(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    this.dispatchEvent(
      new CustomEvent('sync-save', {
        bubbles: true,
        composed: true,
        detail: {
          settings: {
            url: String(data.get('url') ?? '').trim(),
            token: String(data.get('token') ?? '').trim(),
            corsProxy: String(data.get('proxy') ?? '').trim(),
          },
          autoLockMinutes: Number(data.get('autolock') ?? 15),
        },
      }),
    );
    this.close();
  }

  protected override render(): unknown {
    return html`
      <dialog aria-label="Sync and security settings">
        <form @submit=${this.save} method="dialog">
          <h2>Sync via git remote</h2>
          <p class="hint">
            Everything pushed to the remote is ciphertext — the provider and the CORS
            proxy never see your notes or your key.
          </p>
          <label>
            Repository URL
            <input name="url" type="url" placeholder="https://github.com/you/vault.git" .value=${this.settings?.url ?? ''} />
          </label>
          <label>
            Access token
            <input name="token" type="password" autocomplete="off" .value=${this.settings?.token ?? ''} />
          </label>
          <details>
            <summary>Sign in with GitHub instead (device flow)</summary>
            <label>
              OAuth app client id
              <input
                name="ghClientId"
                type="text"
                autocomplete="off"
                .value=${globalThis.localStorage?.getItem(CLIENT_ID_KEY) ?? ''}
              />
            </label>
            <button type="button" @click=${() => void this.runDeviceFlow()}>Sign in with GitHub</button>
            ${this.deviceFlow === undefined
              ? nothing
              : html`<p class="hint">
                  Enter code <strong>${this.deviceFlow.userCode}</strong> at
                  <a href=${this.deviceFlow.verificationUri} target="_blank" rel="noopener noreferrer"
                    >${this.deviceFlow.verificationUri}</a
                  >
                </p>`}
            <p class="hint">${this.deviceFlowStatus}</p>
          </details>
          <label>
            CORS proxy
            <input name="proxy" type="url" .value=${this.settings?.corsProxy ?? defaultCorsProxy} />
          </label>
          <h2>Security</h2>
          <label>
            Auto-lock after inactivity (minutes)
            <input name="autolock" type="number" min="1" max="240" .value=${String(this.autoLockMinutes)} />
          </label>
          ${this.passkeySupported && !this.passkeyEnabled
            ? html`
                <label>
                  Master password (to enable passkey unlock)
                  <input name="enrollPassword" type="password" autocomplete="current-password" />
                </label>
                <button
                  type="button"
                  @click=${(event: Event) => {
                    const root =
                      event.currentTarget instanceof HTMLElement
                        ? (event.currentTarget.closest('form') ?? undefined)
                        : undefined;
                    const input = root?.querySelector('input[name="enrollPassword"]');
                    const password = input instanceof HTMLInputElement ? input.value : '';
                    this.dispatchEvent(
                      new CustomEvent('passkey-enroll', { detail: { password }, bubbles: true, composed: true }),
                    );
                  }}
                >
                  🔑 Enable passkey unlock
                </button>
              `
            : nothing}
          ${this.passkeyEnabled ? html`<p class="hint">Passkey unlock is enabled for this vault.</p>` : nothing}
          <p class="hint" role="status">${this.notice}</p>
          <div class="row">
            <button type="button" @click=${this.close}>Cancel</button>
            <button type="submit" class="primary">Save</button>
          </div>
        </form>
      </dialog>
    `;
  }
}

customElements.define('kb-sync-dialog', KbSyncDialog);
