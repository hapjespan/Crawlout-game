import { h, render, type ComponentChild } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { installHudStyles, installSkin, setSkinAttribute } from '../install.js';
import type { HudSkin } from '../skin.js';
import { ensureMenuStyles } from './mount.js';

export interface MatchEndOptions {
  won: boolean;
  /** "vernietiging", "dominantie" or "opgave". */
  how: string;
  /** "Terug naar menu". */
  onMenu(): void;
  skin?: HudSkin;
  skinOn?: boolean;
}

function MatchEnd(props: MatchEndOptions): ComponentChild {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus({ preventScroll: true }), []);
  const title = props.won ? 'Gewonnen' : 'Verloren';
  return h(
    'div',
    { class: 'co-hud co-m-endroot', lang: 'nl' },
    h(
      'div',
      {
        class: 'co-panel co-m-plate co-m-endplate',
        role: 'alertdialog',
        'aria-labelledby': 'co-m-end-title',
        'aria-describedby': 'co-m-end-how',
      },
      h('span', { class: 'co-m-tab' }, 'Potje afgelopen'),
      h(
        'h1',
        { class: 'co-m-title', id: 'co-m-end-title', ...(props.won ? {} : { 'data-lost': '' }) },
        title,
      ),
      h('p', { class: 'co-m-sub', id: 'co-m-end-how' }, `door ${props.how}.`),
      h(
        'div',
        { class: 'co-m-end-actions' },
        h(
          'button',
          {
            ref: button,
            type: 'button',
            class: 'co-btn co-m-btn co-m-primary',
            onClick: props.onMenu,
          },
          'Terug naar menu',
        ),
      ),
    ),
  );
}

/** Shows the end of a match (Gewonnen or Verloren) in `el` with a "Terug naar menu" button, in the menu's look. */
export function mountMatchEnd(el: HTMLElement, options: MatchEndOptions): void {
  const doc = el.ownerDocument;
  installHudStyles(doc);
  ensureMenuStyles(doc);
  if (installSkin(doc, options.skin, true)) setSkinAttribute(el, options.skinOn ?? true);
  render(h(MatchEnd, options), el);
}
