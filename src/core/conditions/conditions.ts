import { createStore, type Store, type Unsubscribe } from '@features/app/store';

/**
 * Named boolean app states (spec commands-and-hotkeys, US-C2). The single
 * uniform way state is exposed to commands, hotkeys, and UI chips: anyone can
 * read a condition or subscribe to it; only feature code that owns a condition
 * sets it.
 */
const registry = new Map<string, Store<boolean>>();

const storeOf = (key: string): Store<boolean> => {
  const existing = registry.get(key);
  if (existing !== undefined) return existing;
  const created = createStore(false);
  registry.set(key, created);
  return created;
};

export const defineCondition = (key: string, initial: boolean): void => {
  storeOf(key).set(initial);
};

export const setCondition = (key: string, value: boolean): void => {
  const store = storeOf(key);
  if (store.get() !== value) store.set(value);
};

export const getCondition = (key: string): boolean => storeOf(key).get();

export const subscribeCondition = (key: string, listener: (value: boolean) => void): Unsubscribe =>
  storeOf(key).subscribe(listener);

export const allHold = (keys: ReadonlyArray<string>): boolean => keys.every(getCondition);

/** Notify on any change of any listed condition (AC-C2.2). */
export const subscribeAll = (keys: ReadonlyArray<string>, listener: () => void): Unsubscribe => {
  const subscriptions = keys.map((key) => subscribeCondition(key, () => listener()));
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
};

/** Test seam: reset the registry between unit tests. */
export const resetConditionsForTest = (): void => registry.clear();
