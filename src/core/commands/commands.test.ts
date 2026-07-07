import { beforeEach, describe, expect, test } from 'bun:test';
import {
  allHold,
  defineCondition,
  getCondition,
  resetConditionsForTest,
  setCondition,
  subscribeAll,
  subscribeCondition,
} from '../conditions/conditions';
import {
  bindingFor,
  commandEnabled,
  dispatchKeydown,
  executeCommand,
  hotkeyOverridesStore,
  registerCommand,
  resetCommandsForTest,
} from './commandRegistry';
import { formatChord, isEditableTarget, parseChord, sameChord } from './hotkeys';

beforeEach(() => {
  resetConditionsForTest();
  resetCommandsForTest();
});

describe('conditions registry (AC-C2.1, AC-C2.2)', () => {
  test('define, set, read, subscribe', () => {
    defineCondition('vault.unlocked', false);
    const seen: boolean[] = [];
    subscribeCondition('vault.unlocked', (value) => seen.push(value));
    setCondition('vault.unlocked', true);
    setCondition('vault.unlocked', true);
    expect(getCondition('vault.unlocked')).toBe(true);
    expect(seen).toEqual([true]);
  });

  test('allHold and subscribeAll cover multiple keys', () => {
    defineCondition('a', true);
    defineCondition('b', false);
    expect(allHold(['a', 'b'])).toBe(false);
    let notified = 0;
    subscribeAll(['a', 'b'], () => {
      notified += 1;
    });
    setCondition('b', true);
    expect(allHold(['a', 'b'])).toBe(true);
    expect(notified).toBe(1);
  });
});

describe('command registry (AC-C1.1..1.3)', () => {
  test('execute runs only when every condition holds', async () => {
    defineCondition('ready', false);
    let ran = 0;
    registerCommand({
      id: 'test.run',
      title: 'Run',
      context: 'test',
      conditions: ['ready'],
      run: () => {
        ran += 1;
      },
    });
    expect(await executeCommand('test.run')).toBe(false);
    expect(commandEnabled('test.run')).toBe(false);
    setCondition('ready', true);
    expect(await executeCommand('test.run')).toBe(true);
    expect(ran).toBe(1);
  });
});

describe('hotkey model (AC-C3.1..3.3)', () => {
  test('parse, format, compare chords', () => {
    const chord = parseChord('Ctrl+Shift+K');
    expect(chord).toEqual({ ctrl: true, alt: false, shift: true, key: 'k' });
    expect(formatChord(chord)).toBe('Ctrl ⇧ K');
    expect(sameChord(chord ?? { ctrl: false, alt: false, shift: false, key: '' }, parseChord('ctrl + shift + K') ?? { ctrl: false, alt: false, shift: false, key: '' })).toBe(true);
  });

  test('dispatch matches default binding gated by conditions', () => {
    defineCondition('ready', true);
    let ran = 0;
    registerCommand({
      id: 'test.hot',
      title: 'Hot',
      context: 'test',
      conditions: ['ready'],
      defaultHotkey: 'Ctrl+m',
      run: () => {
        ran += 1;
      },
    });
    const event = new KeyboardEvent('keydown', { key: 'm', ctrlKey: true });
    expect(dispatchKeydown(event)).toBe('test.hot');
    setCondition('ready', false);
    expect(dispatchKeydown(event)).toBeUndefined();
    expect(ran).toBe(1);
  });

  test('user override beats default; null unbinds (AC-C3.2)', () => {
    defineCondition('ready', true);
    registerCommand({
      id: 'test.re',
      title: 'Re',
      context: 'test',
      conditions: ['ready'],
      defaultHotkey: 'Ctrl+m',
      run: () => undefined,
    });
    hotkeyOverridesStore.set({ 'test.re': parseChord('Alt+x') ?? null });
    expect(dispatchKeydown(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true }))).toBeUndefined();
    expect(dispatchKeydown(new KeyboardEvent('keydown', { key: 'x', altKey: true }))).toBe('test.re');
    hotkeyOverridesStore.set({ 'test.re': null });
    expect(bindingFor('test.re')).toBeUndefined();
  });

  test('non-editable targets only, unless global (AC-C3.3)', () => {
    expect(isEditableTarget(undefined)).toBe(false);
  });
});
