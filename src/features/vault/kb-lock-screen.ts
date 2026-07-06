import { css, html, LitElement, nothing } from 'lit';

/**
 * Lock screen (US-1): create-vault and unlock forms. Emits `vault-create` /
 * `vault-unlock` with the password; never stores it anywhere itself.
 */
export class KbLockScreen extends LitElement {
  static override properties = {
    mode: { type: String },
    error: { type: String },
    busy: { type: Boolean },
  };

  declare mode: 'create' | 'unlock';
  declare error: string;
  declare busy: boolean;

  constructor() {
    super();
    this.mode = 'unlock';
    this.error = '';
    this.busy = false;
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
        this.dispatchEvent(new CustomEvent('vault-create', { detail: { password } }));
        return;
      }
      case 'unlock':
        this.dispatchEvent(new CustomEvent('vault-unlock', { detail: { password } }));
        return;
    }
  }

  protected override render(): unknown {
    const creating = this.mode === 'create';
    return html`
      <form @submit=${this.submit} aria-busy=${this.busy}>
        <h1>${creating ? 'Create your vault' : 'Unlock your vault'}</h1>
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
        <p role="alert">${this.error}</p>
        <button type="submit" ?disabled=${this.busy}>
          ${this.busy ? 'Working…' : creating ? 'Create vault' : 'Unlock'}
        </button>
      </form>
    `;
  }
}

customElements.define('kb-lock-screen', KbLockScreen);
