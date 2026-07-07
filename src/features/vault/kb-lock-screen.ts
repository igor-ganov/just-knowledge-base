import { css, html, LitElement, nothing } from 'lit';

/**
 * Lock screen (US-1): create-vault, unlock, and join-from-remote forms. Emits
 * `vault-create` / `vault-unlock` / `vault-join`; never stores the password.
 */
export class KbLockScreen extends LitElement {
  static override properties = {
    mode: { type: String },
    error: { type: String },
    busy: { type: Boolean },
    joining: { type: Boolean, state: true },
    passkeySupported: { type: Boolean },
    passkeyEnabled: { type: Boolean },
  };

  declare mode: 'create' | 'unlock';
  declare error: string;
  declare busy: boolean;
  declare joining: boolean;
  declare passkeySupported: boolean;
  declare passkeyEnabled: boolean;

  constructor() {
    super();
    this.mode = 'unlock';
    this.error = '';
    this.busy = false;
    this.joining = false;
    this.passkeySupported = false;
    this.passkeyEnabled = false;
  }

  static override styles = css`
    :host {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: var(--space-4);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: min(26rem, 100%);
      padding: var(--space-5);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
    }
    h1 {
      margin: 0;
      font-size: 1.4rem;
    }
    p.hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.9rem;
    }
    p.warning {
      margin: 0;
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--color-warning-bg);
      color: var(--color-warning-text);
      font-size: 0.85rem;
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
      font-size: 1rem;
    }
    button {
      padding: var(--space-2) var(--space-3);
      border: none;
      border-radius: var(--radius-sm);
      background: var(--color-accent);
      color: var(--color-accent-contrast);
      font-size: 1rem;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    button.link {
      background: none;
      color: var(--color-accent-strong);
      font-size: 0.85rem;
      text-decoration: underline;
      padding: 0;
    }
    button.passkey {
      background: var(--color-accent);
      font-size: 1.05rem;
    }
    p.divider {
      margin: 0;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 0.8rem;
    }
    label.checkbox {
      flex-direction: row;
      align-items: center;
      gap: var(--space-2);
    }
    [role='alert'] {
      color: var(--color-danger);
      font-size: 0.9rem;
      min-height: 1.2em;
      margin: 0;
    }
  `;

  private submit(event: SubmitEvent): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget instanceof HTMLFormElement ? event.currentTarget : undefined);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirm') ?? '');
    if (this.joining) {
      this.dispatchEvent(
        new CustomEvent('vault-join', {
          detail: {
            password,
            settings: {
              url: String(data.get('url') ?? '').trim(),
              token: String(data.get('token') ?? '').trim(),
              corsProxy: String(data.get('proxy') ?? '').trim(),
            },
          },
        }),
      );
      return;
    }
    switch (this.mode) {
      case 'create': {
        if (password.length < 8) {
          this.error = 'Use at least 8 characters.';
          return;
        }
        if (password !== confirm) {
          this.error = 'Passwords do not match.';
          return;
        }
        this.dispatchEvent(
          new CustomEvent('vault-create', {
            detail: { password, withPasskey: data.get('passkey') === 'on' },
          }),
        );
        return;
      }
      case 'unlock':
        this.dispatchEvent(new CustomEvent('vault-unlock', { detail: { password } }));
        return;
    }
  }

  private renderJoinFields(): unknown {
    return html`
      <label>
        Repository URL
        <input name="url" type="url" required placeholder="https://github.com/you/vault.git" />
      </label>
      <label>
        Access token
        <input name="token" type="password" autocomplete="off" required />
      </label>
      <label>
        CORS proxy
        <input name="proxy" type="url" value="https://cors.isomorphic-git.org" />
      </label>
    `;
  }

  protected override render(): unknown {
    const creating = this.mode === 'create' && !this.joining;
    const heading = this.joining
      ? 'Connect an existing vault'
      : creating
        ? 'Create your vault'
        : 'Unlock your vault';
    const showPasskeyUnlock = this.mode === 'unlock' && this.passkeyEnabled && this.passkeySupported;
    return html`
      <form @submit=${this.submit} aria-busy=${this.busy}>
        <h1>${heading}</h1>
        ${showPasskeyUnlock
          ? html`
              <button
                type="button"
                class="passkey"
                ?disabled=${this.busy}
                @click=${() => this.dispatchEvent(new CustomEvent('vault-unlock-passkey'))}
              >
                🔑 Unlock with passkey
              </button>
              <p class="divider" role="separator">or use your master password</p>
            `
          : nothing}
        ${this.joining ? this.renderJoinFields() : nothing}
        <p class="hint">
          ${creating
            ? 'All notes are encrypted on this device with a key derived from your master password.'
            : 'Enter your master password to decrypt your notes.'}
        </p>
        ${creating
          ? html`<p class="warning">
              There is no password recovery. If you lose the master password, the vault
              cannot be decrypted by anyone — including you.
            </p>`
          : nothing}
        <label>
          Master password
          <input
            name="password"
            type="password"
            autocomplete=${creating ? 'new-password' : 'current-password'}
            required
            autofocus
          />
        </label>
        ${creating
          ? html`<label>
              Repeat password
              <input name="confirm" type="password" autocomplete="new-password" required />
            </label>`
          : nothing}
        ${creating && this.passkeySupported
          ? html`<label class="checkbox">
              <input name="passkey" type="checkbox" checked />
              Enable passkey unlock (recommended) — the password stays as a fallback
            </label>`
          : nothing}
        <p role="alert">${this.error}</p>
        <button type="submit" ?disabled=${this.busy}>
          ${this.busy ? 'Working…' : this.joining ? 'Connect' : creating ? 'Create vault' : 'Unlock'}
        </button>
        ${this.mode === 'create'
          ? html`<button
              type="button"
              class="link"
              @click=${() => {
                this.joining = !this.joining;
              }}
            >
              ${this.joining ? 'Create a new vault instead' : 'Connect an existing vault from a git remote'}
            </button>`
          : nothing}
      </form>
    `;
  }
}

customElements.define('kb-lock-screen', KbLockScreen);
