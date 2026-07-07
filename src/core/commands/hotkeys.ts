/**
 * Hotkey abstraction (US-C3): a chord is data, never a raw string comparison
 * scattered through components. Parsing, formatting (chip symbols), and
 * matching live here; the dispatcher resolves a keydown to at most one command.
 */
export type Chord = {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly key: string;
};

export const parseChord = (text: string): Chord | undefined => {
  const parts = text
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const key = parts.at(-1)?.toLowerCase() ?? '';
  if (key === '') return undefined;
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  return {
    ctrl: modifiers.has('ctrl') || modifiers.has('cmd') || modifiers.has('mod'),
    alt: modifiers.has('alt'),
    shift: modifiers.has('shift'),
    key,
  };
};

export const chordOfEvent = (event: KeyboardEvent): Chord => ({
  ctrl: event.ctrlKey || event.metaKey,
  alt: event.altKey,
  shift: event.shiftKey,
  key: event.key.toLowerCase(),
});

export const sameChord = (left: Chord, right: Chord): boolean =>
  left.ctrl === right.ctrl && left.alt === right.alt && left.shift === right.shift && left.key === right.key;

const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  ',': ',',
  '/': '/',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '⏎',
  ' ': 'Space',
};

/** Chip form, e.g. `Ctrl+Shift+K` → "Ctrl ⇧ K". */
export const formatChord = (chord: Chord | undefined): string => {
  if (chord === undefined) return '';
  const key = KEY_SYMBOLS[chord.key] ?? chord.key.toUpperCase();
  return [chord.ctrl ? 'Ctrl' : '', chord.alt ? 'Alt' : '', chord.shift ? '⇧' : '', key]
    .filter((part) => part !== '')
    .join(' ');
};

/** AC-C3.3: keystrokes inside editable targets belong to the editor. */
export const isEditableTarget = (target: EventTarget | undefined): boolean => {
  const element = target instanceof Element ? target : undefined;
  if (element === undefined) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return true;
  return element.closest('[contenteditable="true"], .cm-content') !== null;
};
