import { h } from 'preact';
import type { ComponentChild } from 'preact';
import { kindOfTypeId } from '@crawlout/data';
import { CARD_STATE_LABEL } from './controller.js';
import type { HudController, HudState } from './controller.js';
import type { BuildingCard, CardKind, CardState, SelectedEntity } from './types.js';

/** Eenvoudige, neutrale symbolen (24x24, lijn, geen emoji). Onbekende icoonnamen vallen terug op `gear`. */
const ICON_PATHS: Record<string, string> = {
  research: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M8 15h8',
  craft: 'M14 4l6 6-3 3-6-6zM12 8L4 16l-1 5 5-1 8-8',
  revive: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10zM12 9v6M9 12h6',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  blade: 'M18 3l3 3-11 11-3-3zM6 15l-3 6 6-3M4 20l2-2',
  gun: 'M3 10h13l3-2v5H9l-1 5H5l1-5H3z',
  tower: 'M7 21V8l-2-3h14l-2 3v13M7 12h10M10 21v-4h4v4',
  patrol: 'M4 12h12M12 7l5 5-5 5M4 6v12',
  wrench: 'M15 4a4 4 0 0 0-4 5l-7 7 3 3 7-7a4 4 0 0 0 5-4l-3 2-2-2 2-3z',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2 4.5 4.5 0 0 1 8 2c0 6-8 11-8 11z',
  crate: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  robot:
    'M8 8h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM12 8V4M10 13h.01M14 13h.01M4 12v3M20 12v3',
  training: 'M4 15v-6M20 15v-6M7 17V7M17 17V7M7 12h10M2 12h2M20 12h2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.600l2.1 2.100M16.3 16.300l2.1 2.100M5.6 18.400l2.1-2.100M16.3 7.700l2.1-2.1',
};

function Icon(props: { id: string }): ComponentChild {
  const d = ICON_PATHS[props.id] ?? ICON_PATHS.gear;
  return h(
    'svg',
    {
      class: 'co-card-icon',
      viewBox: '0 0 24 24',
      width: 28,
      height: 28,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h('path', { d }),
  );
}

/** Statussymbool naast de statustekst: de status is dus nooit alleen kleur. */
const STATE_GLYPH: Record<CardState, string> = {
  available: 'M12 7v10M7 12h10',
  tooExpensive: 'M12 5l8 14H4zM12 10v4M12 16.500v.5',
  locked: 'M7 11h10v8H7zM9 11V8a3 3 0 0 1 6 0v3',
  busy: 'M7 4h10M7 20h10M8 4c0 5 8 5 8 16M16 4c0 5-8 5-8 16',
  running: 'M12 5a7 7 0 1 0 7 7M12 8v4l3 2',
  done: 'M5 12.500l4.5 4.500L19 7.5',
};

function StateGlyph(props: { state: CardState }): ComponentChild {
  return h(
    'svg',
    {
      class: 'co-card-glyph',
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.4,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h('path', { d: STATE_GLYPH[props.state] }),
  );
}

const KIND_LABEL: Record<CardKind, string> = {
  research: 'Onderzoek',
  craft: 'Craft',
  revive: 'Oplappen',
  produce: 'Robot',
  train: 'Training',
};

/** Volledige tekst voor schermlezers: alles wat de kaart toont, in een zin. */
export function cardLabel(card: BuildingCard, key: string | null): string {
  const parts = [`${KIND_LABEL[card.kind]} ${card.naam}`, `${card.scrapCost} scrap`];
  if (card.seconds > 0) parts.push(`${card.seconds} seconden`);
  if (card.effects.length > 0) parts.push(`Effect: ${card.effects.join(', ')}`);
  if (card.unlocks.length > 0) parts.push(`Ontgrendelt: ${card.unlocks.join(', ')}`);
  let status = `Status: ${CARD_STATE_LABEL[card.state].toLowerCase()}`;
  if (card.state === 'locked' && card.requires.length > 0)
    status += `, vereist: ${card.requires.join(', ')}`;
  else if (card.reason && card.state !== 'running' && card.state !== 'done')
    status += `, ${card.reason}`;
  if (card.state === 'running') status += `, ${clampPct(card.progressPct)}%`;
  parts.push(status);
  if (key !== null && card.state === 'available') parts.push(`sneltoets ${key}`);
  return parts.join('. ');
}

const clampPct = (n: number | undefined): number => Math.max(0, Math.min(100, Math.round(n ?? 0)));

function Card(props: {
  ctl: HudController;
  card: BuildingCard;
  keyActive: boolean;
}): ComponentChild {
  const { ctl, card } = props;
  const startable = ctl.canStartCard(card);
  const key = props.keyActive ? card.hotkey : null;
  const pct = clampPct(card.progressPct);
  const statusText =
    card.state === 'locked' && card.requires.length > 0
      ? `${CARD_STATE_LABEL.locked} · Vereist: ${card.requires.join(', ')}`
      : card.state === 'running'
        ? `${CARD_STATE_LABEL.running} · ${pct}%`
        : CARD_STATE_LABEL[card.state];
  // The reason a card does not start is also the tooltip, so hovering a greyed-out card explains it.
  const reason = ctl.cardReason(card);
  return h(
    'li',
    { class: `co-card co-card-${card.state}`, 'data-state': card.state },
    h(
      'button',
      {
        type: 'button',
        class: 'co-card-main',
        'aria-disabled': !startable,
        'data-card-kind': card.kind,
        'data-card-id': card.id,
        'aria-label': cardLabel(card, key),
        'aria-keyshortcuts': key ?? undefined,
        title: reason ?? undefined,
        // Press and release on the same card start it even when the browser sends no click (the list redrew in
        // between, or a trackpad ctrl+click); the click that follows the same press is skipped by the controller.
        onPointerDown: (e: PointerEvent) => {
          if (e.button === 0) ctl.cardPress(card);
        },
        onPointerUp: () => ctl.cardRelease(card),
        onClick: () => ctl.cardClick(card),
      },
      h(Icon, { id: card.icon }),
      h('span', { class: 'co-card-name' }, card.naam),
      key !== null ? h('span', { class: 'co-key', 'aria-hidden': 'true' }, key) : null,
      h(
        'span',
        { class: 'co-card-meta', 'aria-hidden': 'true' },
        h(
          'span',
          { class: card.state === 'tooExpensive' ? 'co-card-cost co-full' : 'co-card-cost' },
          `${card.scrapCost} scrap`,
        ),
        card.seconds > 0 ? h('span', { class: 'co-card-time' }, `${card.seconds} s`) : null,
      ),
      card.effects.length > 0
        ? h('span', { class: 'co-card-effects', 'aria-hidden': 'true' }, card.effects.join(' · '))
        : null,
      card.unlocks.length > 0
        ? h(
            'span',
            { class: 'co-card-unlocks', 'aria-hidden': 'true' },
            `Ontgrendelt: ${card.unlocks.join(', ')}`,
          )
        : null,
      h(
        'span',
        { class: 'co-card-status', 'aria-hidden': 'true' },
        h(StateGlyph, { state: card.state }),
        statusText,
      ),
    ),
    card.state === 'running'
      ? h(
          'div',
          { class: 'co-card-run' },
          h(
            'div',
            {
              class: 'co-card-progress',
              role: 'progressbar',
              'aria-label': `Voortgang ${card.naam}`,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': pct,
            },
            h('span', { style: { width: `${pct}%` } }),
          ),
          ctl.canCancelCard(card)
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'co-card-cancel',
                  'aria-label': `Annuleer ${KIND_LABEL[card.kind].toLowerCase()} ${card.naam}`,
                  onClick: () => void ctl.cancelCard(card),
                },
                'Annuleer',
              )
            : null,
        )
      : null,
  );
}

function panelTitle(cards: readonly BuildingCard[], selection: readonly SelectedEntity[]): string {
  // One kind of building selected: its own name ("Tent", "Autosloperij"), not the kind of card it offers.
  const names = new Set(
    selection.filter((s) => kindOfTypeId(s.typeId).kind === 'building').map((s) => s.loadoutName),
  );
  const single = names.size === 1 ? [...names][0] : null;
  if (single && !selection.some((s) => kindOfTypeId(s.typeId).kind !== 'building')) return single;
  const only = (kind: CardKind): boolean => cards.every((c) => c.kind === kind);
  if (only('craft')) return 'Craft';
  if (only('produce')) return 'Robotfabriek';
  if (only('train')) return 'Training';
  return 'Gebouw';
}

/** Gebouwpaneel met kaarten per onderzoek, craft, oplappen, robotproductie of training. Zichtbaar zodra de dep kaarten levert voor de selectie. */
export function CardPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (state.cards.length === 0) return null;
  const keyActive = ctl.cardKeysActive();
  const title = panelTitle(state.cards, state.selection);
  return h(
    'section',
    { class: 'co-panel co-cards', 'aria-label': title },
    h('h2', null, title),
    !keyActive && ctl.hasCraftCardsForKeys()
      ? h('p', { class: 'co-empty co-cards-hint' }, 'Druk K om met de cijfertoetsen te kiezen')
      : null,
    state.cardNotice
      ? h('p', { class: 'co-card-notice', role: 'status', 'aria-live': 'polite' }, state.cardNotice)
      : null,
    h(
      'ul',
      { class: 'co-card-list' },
      state.cards.map((c) => h(Card, { key: `${c.kind}:${c.id}`, ctl, card: c, keyActive })),
    ),
  );
}
