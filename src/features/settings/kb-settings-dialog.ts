import { css, html, LitElement, nothing } from 'lit';
import { commandsStore, bindingFor, hotkeyOverridesStore, type Command } from '@core/commands/commandRegistry';
import { chordOfEvent, formatChord, type Chord } from '@core/commands/hotkeys';
import { updateSettings, userSettingsStore } from './settingsService';

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta']);

/**
 * App settings (AC-C5.1..5.3): General section + Hotkeys section with inline
 * rebinding. All changes persist per user via settingsService.
 */
export class KbSettingsDialog extends LitElement {
  static override properties = {
    section: { type: String, state: true },
    capturingId: { type: String, state: true },
  };

  declare section: 'general' | 'hotkeys';
  declare capturingId: string;

  private unsubscribes: Array<() => void> = [];

  constructor() {
    super();
    this.section = 'general';
    this.capturingId = '';
  }

  static override styles = css`
    dialog {
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      padding: 0;
      width: min(38rem, 92vw);
      max-height: 80vh;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 45%);
    }
    header {
      display: flex;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--color-border);
      align-items: center;
    }
    h2 {
      margin: 0;
      font-size: 1.05rem;
      flex: 1;
    }
    nav button[aria-pressed='true'] {
      background: var(--color-accent-soft);
      color: var(--color-accent-strong);
      border-color: var(--color-accent);
    }
    .body {
      padding: var(--space-3) var(--space-4);
      overflow-y: auto;
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    button {
      padding: var(--space-1) var(--space-2);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      cursor: pointer;
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
      max-width: 10rem;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: var(--space-1) var(--space-2);
      border-bottom: 1px solid var(--color-border);
    }
    th {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-muted);
    }
    kbd {
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-sm);
      padding: 0 var(--space-1);
      font-family: inherit;
    }
    .capturing {
      color: var(--color-accent-strong);
      font-weight: 600;
    }
    footer {
      padding: var(--space-2) var(--space-4);
      border-top: 1px solid var(--color-border);
      display: flex;
      justify-content: flex-end;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    const rerender = (): void => this.requestUpdate();
    this.unsubscribes = [commandsStore.subscribe(rerender), hotkeyOverridesStore.subscribe(rerender), userSettingsStore.subscribe(rerender)];
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
  }

  show(section: 'general' | 'hotkeys'): void {
    this.section = section;
    this.renderRoot.querySelector('dialog')?.showModal();
  }

  private close(): void {
    this.capturingId = '';
    this.renderRoot.querySelector('dialog')?.close();
  }

  private onCaptureKey(event: KeyboardEvent): void {
    if (this.capturingId === '') return;
    event.preventDefault();
    event.stopPropagation();
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      this.capturingId = '';
      return;
    }
    if (MODIFIER_KEYS.has(key)) return;
    const override: Chord | null = key === 'backspace' ? null : chordOfEvent(event);
    hotkeyOverridesStore.set({ ...hotkeyOverridesStore.get(), [this.capturingId]: override });
    this.capturingId = '';
  }

  private hotkeyRow(command: Command): unknown {
    const capturing = this.capturingId === command.id;
    const chord = bindingFor(command.id);
    return html`<tr>
      <td>${command.title}</td>
      <td>${command.context}</td>
      <td>
        ${capturing
          ? html`<span class="capturing">press keys… (Esc cancel, ⌫ unbind)</span>`
          : chord === undefined
            ? html`<span>—</span>`
            : html`<kbd>${formatChord(chord)}</kbd>`}
      </td>
      <td>
        <button @click=${() => { this.capturingId = capturing ? '' : command.id; }}>
          ${capturing ? 'Cancel' : 'Change'}
        </button>
      </td>
    </tr>`;
  }

  private renderGeneral(): unknown {
    const settings = userSettingsStore.get();
    return html`<label>
      Auto-lock after inactivity (minutes)
      <input
        type="number"
        min="1"
        max="240"
        .value=${String(settings.autoLockMinutes)}
        @change=${(event: Event) => {
          const value = event.target instanceof HTMLInputElement ? Number(event.target.value) : 15;
          updateSettings((current) => ({ ...current, autoLockMinutes: Math.max(1, value) }));
        }}
      />
    </label>`;
  }

  private renderHotkeys(): unknown {
    const byContext = [...commandsStore.get()].sort((left, right) =>
      `${left.context}${left.title}`.localeCompare(`${right.context}${right.title}`),
    );
    return html`<table aria-label="Hotkeys">
      <thead>
        <tr><th>Command</th><th>Context</th><th>Hotkey</th><th></th></tr>
      </thead>
      <tbody>
        ${byContext.map((command) => this.hotkeyRow(command))}
      </tbody>
    </table>`;
  }

  protected override render(): unknown {
    return html`
      <dialog aria-label="Application settings" @keydown=${this.onCaptureKey}>
        <header>
          <h2>Settings</h2>
          <nav aria-label="Settings sections">
            <button aria-pressed=${this.section === 'general' ? 'true' : 'false'} @click=${() => { this.section = 'general'; }}>General</button>
            <button aria-pressed=${this.section === 'hotkeys' ? 'true' : 'false'} @click=${() => { this.section = 'hotkeys'; }}>Hotkeys</button>
          </nav>
        </header>
        <div class="body">${this.section === 'general' ? this.renderGeneral() : this.renderHotkeys()}</div>
        <footer><button @click=${this.close}>Close</button></footer>
        ${nothing}
      </dialog>
    `;
  }
}

customElements.define('kb-settings-dialog', KbSettingsDialog);
