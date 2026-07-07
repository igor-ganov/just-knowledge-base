import { allHold } from '@core/conditions/conditions';
import { createStore } from '@features/app/store';
import { chordOfEvent, isEditableTarget, parseChord, sameChord, type Chord } from './hotkeys';

/**
 * The command abstraction (US-C1): the ONLY way user actions run. Buttons and
 * hotkeys both go through `executeCommand`, which gates on conditions.
 */
export type Command = {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly conditions: ReadonlyArray<string>;
  readonly defaultHotkey?: string;
  /** Global commands also fire while typing (lock, settings, show-hotkeys). */
  readonly global?: boolean;
  readonly run: () => void | Promise<void>;
};

const registry = new Map<string, Command>();
export const commandsStore = createStore<ReadonlyArray<Command>>([]);

/** User hotkey overrides: commandId → chord (or null = unbound). */
export const hotkeyOverridesStore = createStore<Readonly<Record<string, Chord | null>>>({});

export const registerCommand = (command: Command): void => {
  registry.set(command.id, command);
  commandsStore.set([...registry.values()]);
};

export const commandById = (id: string): Command | undefined => registry.get(id);

export const commandEnabled = (id: string): boolean => {
  const command = registry.get(id);
  return command !== undefined && allHold(command.conditions);
};

/** AC-C1.2: execution is a no-op unless every condition holds. */
export const executeCommand = async (id: string): Promise<boolean> => {
  const command = registry.get(id);
  if (command === undefined || !allHold(command.conditions)) return false;
  await command.run();
  return true;
};

export const bindingFor = (id: string): Chord | undefined => {
  const override = hotkeyOverridesStore.get()[id];
  if (override === null) return undefined;
  if (override !== undefined) return override;
  const fallback = registry.get(id)?.defaultHotkey;
  return fallback === undefined ? undefined : parseChord(fallback);
};

/** AC-C3.1: a keydown resolves to at most one enabled command. */
export const dispatchKeydown = (event: KeyboardEvent): string | undefined => {
  const chord = chordOfEvent(event);
  const editable = isEditableTarget(event.target ?? undefined);
  for (const command of registry.values()) {
    const binding = bindingFor(command.id);
    if (binding === undefined || !sameChord(binding, chord)) continue;
    if (editable && command.global !== true) continue;
    if (!allHold(command.conditions)) continue;
    event.preventDefault();
    void command.run();
    return command.id;
  }
  return undefined;
};

/** Test seam. */
export const resetCommandsForTest = (): void => {
  registry.clear();
  commandsStore.set([]);
  hotkeyOverridesStore.set({});
};
