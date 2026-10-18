import { h } from 'preact';
import type { ComponentChild } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { PlayerStatus } from '@crawlout/protocol';
import { kindOfTypeId } from '@crawlout/data';
import { roleLabelOf } from './controller.js';
import type { HudController, HudState, QuickId } from './controller.js';
import { portraitOfEntity } from './portraits.js';
import type { UnitActivity, UnitState } from './types.js';

/** What a unit bar says to a screen reader and in its tooltip; the bar itself shows colour only, no text. */
export const ACTIVITY_TEXT: Record<UnitActivity, string> = {
  idle: 'niets te doen',
  moving: 'onderweg',
  gathering: 'verzamelt',
  carrying: 'brengt scrap terug',
  building: 'bouwt of craft',
  fighting: 'vecht',
};
export const UNIT_STATE_TEXT: Record<UnitState, string> = {
  available: 'beschikbaar',
  working: 'aan het werk',
  busy: 'bezig',
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const fmt = (n: number | undefined): string => (n === undefined ? '–' : String(n));

/** True when the player asked for less motion (or there is no way to ask, as in a test DOM): then nothing types or blinks. */
function reducedMotion(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A terminal line that types itself out, like the selection screen of the mockup. Purely decorative (the same facts are
 * in the panel above it), so it is hidden from screen readers; without motion it shows at once.
 */
export function Typed(props: { text: string }): ComponentChild {
  const { text } = props;
  const instant = reducedMotion();
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) {
      setN(text.length);
      return undefined;
    }
    setN(0);
    const timer = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(timer);
          return v;
        }
        return v + 1;
      });
    }, 45);
    return () => clearInterval(timer);
  }, [text, instant]);
  return h(
    'p',
    { class: 'co-term-line', 'aria-hidden': 'true' },
    '> ',
    text.slice(0, n),
    h('span', { class: 'co-cursor' }),
  );
}

function Counter(props: {
  kind: string;
  label: string;
  value: string;
  full?: boolean;
}): ComponentChild {
  return h(
    'li',
    { class: `co-counter co-counter-${props.kind}` },
    h('span', { class: 'co-counter-label' }, props.label),
    h('span', { class: props.full ? 'co-counter-value co-full' : 'co-counter-value' }, props.value),
  );
}

/** Top-left brass bar: four windows with live values and a gauge whose needle follows the population. */
export function ResourceBar(props: {
  status: PlayerStatus | null;
  /** False for a faction without robots (the Raiders): the production queue of a tent is no robot counter. */
  robots?: boolean;
}): ComponentChild {
  const s = props.status;
  const full = s !== null && s.pop >= s.popCap;
  const fill = s && s.popCap > 0 ? Math.max(0, Math.min(1, s.pop / s.popCap)) : 0;
  return h(
    'ul',
    { class: 'co-panel co-counters', 'aria-label': 'Voorraad en bewoners' },
    h(Counter, { kind: 'scrap', label: 'Schroot', value: fmt(s?.scrap) }),
    h(Counter, { kind: 'settlers', label: 'Bewoners', value: fmt(s?.settlers) }),
    h(
      'li',
      {
        class: 'co-gauge',
        'aria-hidden': 'true',
        style: { '--co-needle': `${-120 + fill * 240}deg` },
      },
      h('span', { class: 'co-gauge-needle' }),
    ),
    h(Counter, { kind: 'pop', label: 'Populatie', value: s ? `${s.pop}/${s.popCap}` : '–', full }),
    // Robots count for pop but not for beds: the sim reports them next to the settlers' pop.
    props.robots !== false &&
      s &&
      ((s.robotPop ?? 0) > 0 || s.queue.some((q) => q.kind === 'produce'))
      ? h(Counter, { kind: 'robots', label: 'Robots', value: String(s.robotPop ?? 0) })
      : null,
    h(Counter, { kind: 'beds', label: 'Bedden', value: fmt(s?.beds) }),
  );
}

interface QuickDef {
  id: QuickId;
  /** Text on the button. */
  label: string;
  /** Dutch name for screen readers and the tooltip. */
  name: string;
  /** Key that does the same, shown in the tooltip and as aria-keyshortcuts. */
  key?: string;
}

const SIDE_BUTTONS: readonly QuickDef[] = [
  { id: 'hero', label: 'Held', name: 'Held selecteren', key: 'H' },
  { id: 'building', label: 'Gebouwen', name: 'Volgend gebouw met een taak' },
  { id: 'idle', label: 'Vrij', name: 'Volgende eenheid zonder taak', key: '.' },
  { id: 'build', label: 'Bouw', name: 'Bouwmenu', key: 'B' },
  { id: 'lobby', label: 'Lobby', name: 'Lobby', key: 'L' },
];

const KEY_PLATES: readonly QuickDef[] = [
  { id: 'perks', label: 'SKL', name: 'Perks kiezen', key: 'P' },
  { id: 'craft', label: 'INV', name: 'Uitrusting en craft', key: 'K' },
  { id: 'training', label: 'CHR', name: 'Trainingsfaciliteit' },
  { id: 'alert', label: 'PIP', name: 'Naar het laatste alarm', key: ' ' },
  { id: 'menu', label: 'MNU', name: 'Menu: opgeven' },
];

const ROUND_BUTTONS: readonly QuickDef[] = [
  { id: 'hero', label: 'Held', name: 'Held selecteren', key: 'H' },
  { id: 'alert', label: 'Alarm', name: 'Naar het laatste alarm', key: ' ' },
  { id: 'idle', label: 'Vrij', name: 'Volgende eenheid zonder taak', key: '.' },
];

function isPressed(id: QuickId, state: HudState): boolean | undefined {
  switch (id) {
    case 'build':
      return state.buildMenuOpen || state.placement !== null;
    case 'lobby':
      return state.showLobby;
    case 'perks':
      return state.perkPanelOpen;
    case 'craft':
      return state.craftMenuOpen;
    default:
      return undefined;
  }
}

/** One console button: a real action, or (greyed out) a click that says why it cannot run now. */
function QuickButton(props: {
  ctl: HudController;
  state: HudState;
  def: QuickDef;
  class: string;
  children?: ComponentChild;
}): ComponentChild {
  const { ctl, state, def } = props;
  const available = ctl.quickAvailable(def.id);
  const keyName = def.key === ' ' ? 'spatie' : def.key === '.' ? 'punt' : def.key;
  const aria = keyName ? `${def.name} (sneltoets ${keyName})` : def.name;
  return h(
    'button',
    {
      type: 'button',
      class: available ? props.class : `${props.class} co-quick-off`,
      'data-console': def.id,
      'aria-label': aria,
      'aria-disabled': !available,
      'aria-pressed': isPressed(def.id, state),
      'aria-keyshortcuts': def.key === ' ' ? 'Space' : def.key,
      title: aria,
      onClick: () => ctl.quick(def.id),
    },
    props.children ?? def.label,
  );
}

/** Left side console: the riveted case with five round-lamp plates. */
export function SideConsole(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  return h(
    'nav',
    { class: 'co-sidebar', 'aria-label': 'Snelmenu' },
    h('span', { class: 'co-side-tab', 'aria-hidden': 'true' }, 'Menu'),
    SIDE_BUTTONS.map((def) =>
      h(
        QuickButton,
        { key: def.id, ctl, state, def, class: 'co-side-btn' },
        h('span', { class: 'co-side-lamp', 'aria-hidden': 'true' }),
        h('span', { class: 'co-side-label' }, def.label),
      ),
    ),
  );
}

/** The weapon a selected entity carries, as far as the HUD knows it (enemies name theirs in `detail`). */
function weaponName(
  lead: { loadoutName: string | null; detail?: string; enemy?: boolean } | undefined,
): string {
  if (!lead) return '–';
  if (lead.enemy) return /Wapen:\s*([^·(]+)/.exec(lead.detail ?? '')?.[1]?.trim() ?? 'Onbekend';
  return lead.loadoutName ?? '–';
}

/** The hit-point dots of the console: eight lamps, as many lit as the lead entity has eighths of its health. */
function HpDots(props: { pct: number }): ComponentChild {
  const lit = Math.round((props.pct / 100) * 8);
  return h(
    'span',
    { class: 'co-con-dots', 'aria-hidden': 'true' },
    Array.from({ length: 8 }, (_, i) => h('i', { key: i, class: i < lit ? 'co-lit' : '' })),
  );
}

/**
 * Right console: the selected unit as a name tab with a health bar, a CRT portrait, a weapon panel (the weapon, and for
 * the hero the abilities ready and the cooldown as a gauge), a second slot (role, or the hero's abilities), the three
 * round quick buttons and the five key plates (SKL, INV, CHR, PIP, MNU) that run real HUD actions.
 */
export function UnitConsole(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const sel = state.selection;
  const foe = sel.find((s) => s.enemy);
  const own = sel.filter((s) => !s.enemy);
  const lead = foe ?? own[0];
  const isBuilding = !!lead && kindOfTypeId(lead.typeId).kind === 'building';
  // a scrap node shown for its guard lines (data 0.29.0): no enemy, no weapon
  const isNode = !!lead && kindOfTypeId(lead.typeId).kind === 'scrapNode';
  const hero = !foe && ctl.heroSelected();
  const hp = lead ? clampPct(lead.hpPct) : 0;
  const heroName =
    hero && state.status?.hero?.heroId !== undefined
      ? ctl.heroName(state.status.hero.heroId)
      : undefined;
  const baseName = lead ? (heroName ?? lead.loadoutName ?? `Type ${lead.typeId}`) : 'Geen selectie';
  const shown = foe ? 1 : own.length;
  const name = lead ? baseName : 'Niets';
  const rosterUnit = lead
    ? state.roster.flatMap((g) => g.units).find((u) => u.id === lead.id)
    : undefined;
  const status = !lead
    ? 'Niets geselecteerd'
    : foe
      ? `${foe.ownerLabel ?? 'Vijand'} ${foe.lastSeen ? '(laatst gezien)' : 'in beeld'}`
      : shown > 1
        ? `${shown} eenheden geselecteerd`
        : (lead.note ??
          (rosterUnit
            ? `${baseName}: ${ACTIVITY_TEXT[rosterUnit.activity]}`
            : isBuilding
              ? 'Gebouw'
              : baseName));
  const abilities = state.heroAbilities;
  const ready = abilities.filter((a) => a.cooldownPct <= 0).length;
  const cooling = abilities.reduce((m, a) => Math.max(m, a.cooldownPct), 0);
  const gauge = hero && abilities.length > 0 ? 100 - clampPct(cooling) : hp;
  const bigValue =
    hero && abilities.length > 0 ? `${ready}/${abilities.length}` : lead ? String(shown) : '';
  const bigLabel =
    hero && abilities.length > 0
      ? 'klaar'
      : isNode
        ? 'bron'
        : foe
          ? 'vijand'
          : lead
            ? 'gekozen'
            : '';
  const weapon = lead && !isBuilding && !isNode ? weaponName(lead) : '';
  const melee = /knuppel|slag|mes|blade/i.test(weapon);
  const role = lead && !foe ? roleLabelOf(lead) : undefined;
  return h(
    'section',
    {
      class: foe && !isNode ? 'co-console co-console-enemy' : 'co-console',
      'aria-label': 'Eenheid en snelknoppen',
    },
    h(
      'div',
      { class: 'co-con-tab' },
      h('span', { class: 'co-con-name', title: name }, name),
      h(
        'span',
        { class: 'co-con-bar', 'aria-hidden': 'true' },
        h('span', { style: { width: `${hp}%` } }),
      ),
    ),
    h('div', { class: 'co-con-status', 'aria-hidden': 'true' }, status),
    h(HpDots, { pct: hp }),
    h(
      'div',
      {
        class: 'co-con-portrait',
        'aria-hidden': 'true',
        'data-portrait': lead ? portraitOfEntity(lead) : 'none',
      },
      lead ? h('span', { class: 'co-con-hp' }, h('b', null, `${hp}%`), 'HP') : null,
    ),
    h(
      'div',
      { class: 'co-con-weapon', 'aria-hidden': 'true' },
      h('span', { class: 'co-con-title' }, weapon),
      lead && !isBuilding
        ? h('span', { class: 'co-con-gun', 'data-weapon': melee ? 'blade' : 'gun' })
        : null,
      h('span', { class: 'co-con-big' }, h('b', null, bigValue), bigLabel),
      h(
        'span',
        { class: gauge < 30 ? 'co-con-gauge co-low' : 'co-con-gauge' },
        h('span', { style: { height: `${gauge}%` } }),
      ),
    ),
    h(
      'div',
      { class: 'co-con-slot', 'aria-hidden': 'true' },
      h(
        'span',
        { class: 'co-con-title' },
        !lead ? '' : hero && abilities.length > 0 ? 'Abilities' : foe ? 'Eigenaar' : 'Rol',
      ),
      hero && abilities.length > 0
        ? h(
            'ul',
            { class: 'co-con-abilities' },
            abilities
              .slice(0, 3)
              .map((a, i) =>
                h(
                  'li',
                  { key: a.abilityId, class: a.cooldownPct > 0 ? 'co-cooling' : '' },
                  h('b', null, ['Z', 'X', 'C'][i]),
                  a.naam,
                  h('span', { style: { width: `${100 - clampPct(a.cooldownPct)}%` } }),
                ),
              ),
          )
        : h(
            'span',
            { class: 'co-con-text' },
            foe
              ? (foe.ownerLabel ?? 'Vijand')
              : (role ?? (isBuilding ? 'Gebouw' : lead ? 'Eenheid' : '')),
          ),
    ),
    h(
      'div',
      { class: 'co-con-round' },
      ROUND_BUTTONS.map((def) =>
        h(
          QuickButton,
          { key: def.id, ctl, state, def, class: 'co-round-btn' },
          h('span', { class: 'co-sr' }, def.label),
        ),
      ),
    ),
    h(
      'div',
      { class: 'co-con-keys' },
      KEY_PLATES.map((def) =>
        h(QuickButton, { key: def.id, ctl, state, def, class: 'co-key-plate' }),
      ),
    ),
  );
}
