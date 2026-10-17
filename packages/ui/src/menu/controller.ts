import {
  initialMenuState,
  reduceMenu,
  type MenuAction,
  type MenuEffect,
  type MenuScreen,
  type MenuState,
} from './flow.js';
import { DEFAULT_SETTINGS, needsReload, type MenuSettings } from './settings.js';
import type { MenuContent, MenuDeps } from './types.js';

type Listener = () => void;

/** Keys that never count as "a key" on the splash. */
const SPLASH_IGNORED = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Tab',
  'Escape',
  'ContextMenu',
]);

/** The menu's state, its effects and its keyboard rules; the view only reads this and dispatches. */
export class MenuController {
  state: MenuState;
  settings: MenuSettings;
  /** The settings the page started with: the renderer read those, so a different shadow or detail choice needs a reload. */
  readonly baseline: MenuSettings;
  visible = true;
  private readonly listeners = new Set<Listener>();
  private readonly env: { random(): number; factionKeys: string[] };
  /** What the menu shows; the client hands it over once the data is loaded (the splash is up before that). */
  content: MenuContent;

  constructor(readonly deps: MenuDeps) {
    this.settings = { ...DEFAULT_SETTINGS, ...deps.settings };
    this.baseline = { ...this.settings };
    this.content = deps.content;
    this.env = {
      random: deps.random ?? Math.random,
      factionKeys: deps.content.factions.map((f) => f.key),
    };
    this.state = initialMenuState({
      skipSplash: deps.skipSplash === true,
      factionKey: this.env.factionKeys[0] ?? 'dwellers',
      form: deps.initialForm,
    });
  }

  /** Replaces the content (factions, map); keeps the choices that are still valid. */
  setContent(content: MenuContent): void {
    this.content = content;
    this.env.factionKeys = content.factions.map((f) => f.key);
    const keys = this.env.factionKeys;
    const { ai } = this.state;
    const faction = keys.includes(ai.faction) ? ai.faction : (keys[0] ?? ai.faction);
    if (faction !== ai.faction) this.state = { ...this.state, ai: { ...ai, faction } };
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  dispatch(action: MenuAction): void {
    const { state, effect } = reduceMenu(this.state, action, this.env);
    const changed = state !== this.state;
    this.state = state;
    if (effect) this.run(effect);
    if (changed) this.notify();
  }

  private run(effect: MenuEffect): void {
    if (effect.kind === 'startAi') this.deps.startAi(effect.config);
    else if (effect.kind === 'connect') this.deps.connect(effect.config);
    else this.deps.leave();
  }

  setSettings(patch: Partial<MenuSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.deps.onSettings(this.settings);
    this.notify();
  }

  get reloadNeeded(): boolean {
    return needsReload(this.baseline, this.settings);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.notify();
  }

  /** Jumps to a screen (the client uses it to return to the menu). */
  showScreen(screen: MenuScreen): void {
    this.state = { ...this.state, screen };
    this.visible = true;
    this.notify();
  }

  /**
   * Keyboard rules that no single control owns: any key leaves the splash, Escape goes back, the main menu is
   * navigable with the arrows and the digits. Returns true when the key was used (the caller prevents its default).
   */
  handleKey(
    e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
    root: HTMLElement | null,
  ): boolean {
    if (!this.visible || e.ctrlKey || e.metaKey || e.altKey) return false;
    const { screen, loaded } = this.state;
    if (screen === 'splash') {
      if (SPLASH_IGNORED.has(e.key) || /^F\d+$/.test(e.key)) return false;
      if (loaded) this.dispatch({ type: 'continue' });
      return true;
    }
    if (e.key === 'Escape') {
      if (screen === 'main') return false;
      this.dispatch({ type: 'back' });
      return true;
    }
    if (screen === 'main') {
      const items = root ? [...root.querySelectorAll<HTMLElement>('.co-m-item')] : [];
      const at = items.indexOf(root?.ownerDocument.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length === 0) return false;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        items[(at + step + items.length) % items.length]?.focus();
        return true;
      }
      if (e.key === 'Home' || e.key === 'End') {
        items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
        return items.length > 0;
      }
      const target = ({ '1': 'ai', '2': 'pvp', '3': 'settings' } as const)[
        e.key as '1' | '2' | '3'
      ];
      if (target) {
        this.dispatch({ type: 'open', screen: target });
        return true;
      }
    }
    return false;
  }
}
