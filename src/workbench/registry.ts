import { buildIndex } from '@features/search/indexes';
import '@features/vault/kb-lock-screen';
import '@features/app/kb-file-panel';
import '@features/settings/kb-settings-dialog';
import '@features/sync/kb-sync-dialog';

/**
 * Component workbench registry (spec component-workbench): every entry mounts
 * one component (or composition) in isolation with live-editable props — the
 * "wrappers of external data" that make components pure and testable.
 */
export type Control = {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'boolean' | 'select';
  readonly options?: ReadonlyArray<string>;
};

export type WorkbenchEntry = {
  readonly name: string;
  readonly description: string;
  readonly controls: ReadonlyArray<Control>;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly mount: (host: HTMLElement, props: Readonly<Record<string, unknown>>) => void;
};

const demoIndex = buildIndex([
  { id: 'a', title: 'Alpha note', body: 'about #demo things and [[Beta note]]', space: 'private' },
  { id: 'b', title: 'Beta note', body: 'more #demo and #workbench content', space: 'private' },
  { id: 'c', title: 'Team plan', body: 'shared #roadmap', space: 'public' },
]);

const demoTree = {
  private: {
    id: '',
    name: '',
    folders: [
      { id: 'f1', name: 'Projects', folders: [], notes: [demoIndex.snapshots[0] ?? { id: 'a', title: 'Alpha note', body: '' }] },
    ],
    notes: [demoIndex.snapshots[1] ?? { id: 'b', title: 'Beta note', body: '' }],
  },
  public: { id: '', name: '', folders: [], notes: [demoIndex.snapshots[2] ?? { id: 'c', title: 'Team plan', body: '' }] },
};

const assignProps = (element: HTMLElement, props: Readonly<Record<string, unknown>>): void => {
  for (const [key, value] of Object.entries(props)) {
    Reflect.set(element, key, value);
  }
};

export const workbenchEntries: ReadonlyArray<WorkbenchEntry> = [
  {
    name: 'kb-lock-screen',
    description: 'Create / unlock / join forms with passkey affordances',
    controls: [
      { key: 'mode', label: 'Mode', kind: 'select', options: ['create', 'unlock'] },
      { key: 'error', label: 'Error text', kind: 'text' },
      { key: 'busy', label: 'Busy', kind: 'boolean' },
      { key: 'passkeySupported', label: 'Passkey supported', kind: 'boolean' },
      { key: 'passkeyEnabled', label: 'Passkey enrolled', kind: 'boolean' },
    ],
    defaults: { mode: 'unlock', error: '', busy: false, passkeySupported: true, passkeyEnabled: true },
    mount: (host, props) => {
      const element = document.createElement('kb-lock-screen');
      assignProps(element, props);
      host.replaceChildren(element);
    },
  },
  {
    name: 'kb-file-panel',
    description: 'Folder trees for both spaces, tags, sync footer',
    controls: [
      { key: 'query', label: 'Search query', kind: 'text' },
      { key: 'tagFilter', label: 'Tag filter', kind: 'text' },
      { key: 'saveState', label: 'Save state', kind: 'select', options: ['saved', 'saving', 'dirty'] },
      { key: 'syncConfigured', label: 'Sync configured', kind: 'boolean' },
      { key: 'userLogin', label: 'User login', kind: 'text' },
      { key: 'showHotkeys', label: 'Show hotkeys', kind: 'boolean' },
    ],
    defaults: { query: '', tagFilter: '', saveState: 'saved', syncConfigured: true, userLogin: 'igor-ganov', showHotkeys: false },
    mount: (host, props) => {
      const element = document.createElement('kb-file-panel');
      assignProps(element, { index: demoIndex, tree: demoTree, selectedId: 'a', syncStatus: { state: 'ok' }, ...props });
      element.style.height = '30rem';
      host.replaceChildren(element);
    },
  },
  {
    name: 'kb-settings-dialog',
    description: 'Settings with the hotkey editor (opens as a modal)',
    controls: [{ key: 'section', label: 'Section', kind: 'select', options: ['general', 'hotkeys'] }],
    defaults: { section: 'general' },
    mount: (host, props) => {
      const element = document.createElement('kb-settings-dialog');
      host.replaceChildren(element);
      const section = props['section'] === 'hotkeys' ? 'hotkeys' : 'general';
      requestAnimationFrame(() => {
        const dialog = element.shadowRoot?.querySelector('dialog');
        if ('show' in element && typeof element.show === 'function') element.show(section);
        dialog?.close();
        dialog?.show();
      });
    },
  },
  {
    name: 'kb-sync-dialog',
    description: 'Remote settings, device flow, passkey enrollment',
    controls: [
      { key: 'passkeySupported', label: 'Passkey supported', kind: 'boolean' },
      { key: 'passkeyEnabled', label: 'Passkey enrolled', kind: 'boolean' },
      { key: 'notice', label: 'Notice', kind: 'text' },
    ],
    defaults: { passkeySupported: true, passkeyEnabled: false, notice: '' },
    mount: (host, props) => {
      const element = document.createElement('kb-sync-dialog');
      assignProps(element, {
        settings: { url: 'https://github.com/you/vault.git', token: '', corsProxy: 'https://cors.isomorphic-git.org' },
        autoLockMinutes: 15,
        ...props,
      });
      host.replaceChildren(element);
      requestAnimationFrame(() => {
        const dialog = element.shadowRoot?.querySelector('dialog');
        dialog?.show();
      });
    },
  },
];
