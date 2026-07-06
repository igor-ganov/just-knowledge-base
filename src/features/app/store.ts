/** Minimal observable value — the UI-state primitive shared by all components. */
export type Unsubscribe = () => void;

export type Store<T> = {
  readonly get: () => T;
  readonly set: (value: T) => void;
  readonly update: (transform: (value: T) => T) => void;
  readonly subscribe: (listener: (value: T) => void) => Unsubscribe;
};

export const createStore = <T>(initial: T): Store<T> => {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  const set = (value: T): void => {
    current = value;
    listeners.forEach((listener) => listener(current));
  };
  return {
    get: () => current,
    set,
    update: (transform) => set(transform(current)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
