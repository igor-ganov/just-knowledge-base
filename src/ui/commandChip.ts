import { html, type TemplateResult } from 'lit';
import { bindingFor, commandEnabled } from '@core/commands/commandRegistry';
import { formatChord } from '@core/commands/hotkeys';

/**
 * Show-hotkeys overlay primitive (AC-C4.1/4.2): each component renders its
 * actionable control's label through this helper. When the mode is on and the
 * command's conditions hold, the label is replaced by its key chip — chips are
 * rendered by the owning component, so the overlay works across shadow roots.
 */
export const commandLabel = (
  commandId: string,
  label: unknown,
  showHotkeys: boolean,
): TemplateResult | unknown => {
  if (!showHotkeys || !commandEnabled(commandId)) return label;
  const chord = formatChord(bindingFor(commandId));
  return chord === ''
    ? label
    : html`<kbd class="hotkey-chip" title=${String(label)}>${chord}</kbd>`;
};
