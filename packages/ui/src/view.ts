import { h } from 'preact';
import type { ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { kindOfTypeId } from '@crawlout/data';
import {
  ABILITY_KEYS,
  PERK_KEYS,
  PERK_PANEL_KEY,
  actionLabel,
  roleLabelOf,
  roleTagOf,
  keyLabel,
  threatOf,
  unitStateOf,
} from './controller.js';
import type { HudController, HudState } from './controller.js';
import { CardPanel } from './cards.js';
import {
  ACTIVITY_TEXT,
  ResourceBar,
  SideConsole,
  Typed,
  UNIT_STATE_TEXT,
  UnitConsole,
} from './consoles.js';
import { RaiderBar } from './raiderBar.js';
import { portraitOfGroup } from './portraits.js';
import { drawMinimap } from './minimap.js';
import type {
  AlertKind,
  BuildingButton,
  RosterGroup,
  SelectedEntity,
  TargetingKind,
  UnitState,
} from './types.js';

/** Tooltips of the commands that need one (the Raiders' own commands); the other buttons explain themselves. */
const ACTION_HINT: Partial<Record<string, string>> = {
  capture:
    'Sla een vijandelijke bewoner neer buiten zijn basis; blijf bij hem staan om hem te vangen (rechtsklik werkt ook)',
  liberate:
    'Raak een vijandelijke slaaf of gevangene aan om hem te bevrijden (rechtsklik werkt ook)',
  guard: 'Bewaak een kooi of scrapbron: houdt slaven aan het werk',
};

const TARGETING_TEXT: Record<TargetingKind, string> = {
  move: 'Kies een bestemming op de kaart (Esc om te annuleren)',
  attackMove: 'Kies een aanvalsdoel op de kaart (Esc om te annuleren)',
  gather: 'Kies een grondstofbron op de kaart (Esc om te annuleren)',
  heroAbility: 'Kies een doelpositie voor de ability (Esc om te annuleren)',
  capture: 'Sla een vijandelijke bewoner neer buiten zijn basis (Esc om te annuleren)',
  liberate: 'Kies een slaaf of gevangene om te bevrijden (Esc om te annuleren)',
  guard: 'Kies een kooi of scrapbron om te bewaken (Esc om te annuleren)',
};

function mmss(totalSeconds: number): string {
  const t = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** The numbers of a dominance line (points, time) light up in phosphor; the text itself stays one run of words. */
function highlightNumbers(text: string): ComponentChild[] {
  return text
    .split(/(\d+\/\d+|\d+:\d\d)/)
    .map((part, i) => (i % 2 === 1 ? h('b', { key: i, class: 'co-dom-num' }, part) : part));
}

function DominanceBar(props: {
  label: string;
  now: number;
  max: number;
  text: string;
  warn?: boolean;
}): ComponentChild {
  const max = Math.max(1, props.max);
  const now = Math.max(0, Math.min(max, props.now));
  return h(
    'div',
    { class: props.warn ? 'co-dom-row co-dom-warn' : 'co-dom-row' },
    h(
      'span',
      { class: 'co-dom-text' },
      props.warn ? h('span', { class: 'co-dom-icon', 'aria-hidden': 'true' }, '⚠ ') : null,
      highlightNumbers(props.text),
    ),
    h(
      'div',
      {
        class: 'co-dom-bar',
        role: 'progressbar',
        'aria-label': props.label,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': now,
        'aria-valuetext': props.text,
      },
      h('span', { style: { width: `${(now / max) * 100}%` } }),
    ),
  );
}

function Dominance(props: { state: HudState }): ComponentChild {
  const d = props.state.dominance;
  if (!d) return null;
  const threat = threatOf(d);
  const own = d.pointsHeld >= d.pointsRequired;
  const ownText = own
    ? `Dominantie: ${d.pointsHeld}/${d.pointsRequired} punten, nog ${mmss(d.secondsRequired - d.secondsHeld)}`
    : `Dominantie: ${d.pointsHeld}/${d.pointsRequired} punten`;
  return h(
    'div',
    { class: 'co-panel co-dominance', role: 'group', 'aria-label': 'Dominantie' },
    h(DominanceBar, {
      label: own ? 'Dominantie, tijd vastgehouden' : 'Dominantie, punten vastgehouden',
      now: own ? d.secondsHeld : d.pointsHeld,
      max: own ? d.secondsRequired : d.pointsRequired,
      text: ownText,
    }),
    threat
      ? h(DominanceBar, {
          label: `Dominantie van ${threat.name}, tijd vastgehouden`,
          now: threat.secondsHeld,
          max: d.secondsRequired,
          text: `Let op: ${threat.name} houdt ${threat.pointsHeld}/${d.pointsRequired} punten, nog ${mmss(d.secondsRequired - threat.secondsHeld)}`,
          warn: true,
        })
      : null,
  );
}

function HpBar(props: { pct: number }): ComponentChild {
  const pct = Math.max(0, Math.min(100, props.pct));
  return h(
    'div',
    {
      class: pct < 30 ? 'co-hp co-low' : 'co-hp',
      role: 'meter',
      'aria-label': 'Gezondheid',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': pct,
    },
    h('span', { style: { width: `${pct}%` } }),
  );
}

/** The line the selection screen types out: what the one selected unit is doing, or that it waits for orders. */
function terminalLine(
  sel: readonly SelectedEntity[],
  roster: readonly RosterGroup[],
): string | null {
  if (sel.length === 0) return 'Wacht op bevel';
  const lead = sel[0];
  if (sel.length > 1 || !lead) return null;
  if (lead.enemy)
    return `${lead.ownerLabel ?? 'Vijand'} ${lead.lastSeen ? '(laatst gezien)' : 'in beeld'}`;
  if (lead.note) return lead.note;
  const unit = roster.flatMap((g) => g.units).find((u) => u.id === lead.id);
  const name = lead.loadoutName ?? `Type ${lead.typeId}`;
  return unit ? `${name}: ${ACTIVITY_TEXT[unit.activity]}` : null;
}

function SelectionPanel(props: {
  ctl: HudController;
  selection: readonly SelectedEntity[];
  roster: readonly RosterGroup[];
}): ComponentChild {
  const { ctl } = props;
  const sel = props.selection;
  const line = terminalLine(sel, props.roster);
  let body: ComponentChild;
  const foe = sel.find((s) => s.enemy);
  if (sel.length === 0) {
    body = h('p', { class: 'co-empty' }, 'Niets geselecteerd');
  } else if (foe) {
    // An enemy to inspect: what it is, whose it is and how hurt; no commands for it.
    const kind = kindOfTypeId(foe.typeId).kind;
    const isBuilding = kind === 'building';
    // a scrap node (data 0.29.0): what it is and the guard lines of its slaves, no hp
    const node = kind === 'scrapNode';
    body = [
      h('p', { class: 'co-unit-name' }, foe.loadoutName ?? `Type ${foe.typeId}`),
      h(
        'p',
        { class: 'co-unit-meta' },
        node
          ? (foe.ownerLabel ?? 'Grondstof')
          : `${foe.ownerLabel ?? 'Vijand'} · ${isBuilding ? 'Gebouw' : 'Eenheid'} · ${foe.hpPct}%`,
      ),
      // A ghost (fog of war): what the player last saw of it, not what it is now.
      foe.lastSeen ? h('p', { class: 'co-unit-note co-last-seen' }, 'Laatst gezien') : null,
      foe.detail ? h('p', { class: 'co-unit-detail' }, foe.detail) : null,
      // a bandit whose camp the player's faction takes over (data 0.27.0): how ("Overnemen: ...")
      foe.note ? h('p', { class: 'co-unit-note co-takeover' }, foe.note) : null,
      (foe.lines ?? []).map((l) => h('p', { class: 'co-unit-note co-unit-line', key: l }, l)),
      node ? null : h(HpBar, { pct: foe.hpPct }),
    ];
  } else if (sel.length === 1 && sel[0]) {
    const u = sel[0];
    body = [
      h('p', { class: 'co-unit-name' }, u.loadoutName ?? `Type ${u.typeId}`),
      h(
        'p',
        { class: 'co-unit-meta' },
        kindOfTypeId(u.typeId).kind === 'building'
          ? `Gebouw · ${u.hpPct}%`
          : u.raiderKind
            ? `${roleLabelOf(u) ?? 'Raider'} · ${u.hpPct}%`
            : `Loadout: ${u.loadoutName ?? 'geen'} · Rol: ${roleLabelOf(u) ?? 'geen'} · ${u.hpPct}%`,
      ),
      u.note ? h('p', { class: 'co-unit-note' }, u.note) : null,
      (u.lines ?? []).map((l) => h('p', { class: 'co-unit-note co-unit-line', key: l }, l)),
      h(HpBar, { pct: u.hpPct }),
    ];
  } else {
    body = h(
      'ul',
      { class: 'co-grid' },
      sel.map((u) => {
        const name = u.loadoutName ?? `Type ${u.typeId}`;
        const role = roleLabelOf(u);
        const label = `${name}${role && role !== name ? ` (${role})` : ''}, ${u.hpPct}% gezondheid`;
        // A click on a unit card selects only that unit and puts the camera on it.
        return h(
          'li',
          { key: u.id },
          h(
            'button',
            {
              type: 'button',
              class: 'co-cell',
              'data-unit': u.id,
              title: `${label}. Klik om alleen deze te selecteren en de camera erheen te zetten.`,
              'aria-label': `${label}. Selecteer alleen deze.`,
              onClick: () => ctl.selectSelected(u.id),
            },
            h('b', null, roleTagOf(u)),
            // Decorative: the health is in the card's label, so no meter semantics for 50 cards.
            h(
              'span',
              { class: u.hpPct < 30 ? 'co-hp co-low' : 'co-hp', 'aria-hidden': 'true' },
              h('span', { style: { width: `${Math.max(0, Math.min(100, u.hpPct))}%` } }),
            ),
          ),
        );
      }),
    );
  }
  return h(
    'section',
    {
      class: foe ? 'co-panel co-selection co-selection-enemy' : 'co-panel co-selection',
      'aria-label': 'Selectie',
    },
    h(
      'div',
      { class: 'co-sel-glass' },
      h(
        'h2',
        null,
        foe
          ? kindOfTypeId(foe.typeId).kind === 'scrapNode'
            ? 'Selectie · grondstof'
            : 'Selectie · vijand'
          : sel.length > 1
            ? `Selectie (${sel.length})`
            : 'Selectie',
      ),
      body,
      line ? h(Typed, { text: line }) : null,
    ),
  );
}

/** Gebouwenpaneel: een knop per gebouwtype met aantal, een badge bij beschikbare acties en voortgang bij lopend werk. */
function BuildingButtons(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (state.buildingButtons.length === 0) return null;
  const selected = new Set(state.selection.map((s) => s.id));
  return h(
    'div',
    { class: 'co-building-buttons', role: 'group', 'aria-label': 'Gebouwen' },
    h('span', { class: 'co-building-label', 'aria-hidden': 'true' }, 'Gebouwen'),
    state.buildingButtons.map((b: BuildingButton) => {
      const count = b.sites.length;
      const pct =
        b.progressPct === undefined ? null : Math.max(0, Math.min(100, Math.round(b.progressPct)));
      const busy = b.running > 0;
      const isSelected = b.sites.some((s) => selected.has(s.id));
      const detail = [
        count > 1 ? `${count} gebouwen` : null,
        b.available > 0 ? `${b.available} beschikbaar` : 'niets te starten',
        busy ? `${b.running} bezig${pct !== null ? `, ${pct}%` : ''}` : null,
      ]
        .filter((x) => x !== null)
        .join(', ');
      const hint =
        count > 1
          ? 'Klik om te selecteren en de camera erheen te zetten, nogmaals voor het volgende gebouw.'
          : 'Klik om te selecteren en de camera erheen te zetten.';
      return h(
        'button',
        {
          key: b.key,
          type: 'button',
          class: [
            'co-building-btn',
            isSelected ? 'co-selected' : '',
            b.available > 0 ? 'co-ready' : '',
            busy ? 'co-busy' : '',
          ]
            .filter((c) => c !== '')
            .join(' '),
          'data-building': b.key,
          'aria-label': `${b.naam}: ${detail}. ${hint}`,
          'aria-pressed': isSelected,
          title: `${b.naam}: ${detail}`,
          // The second click of a double click must not cycle on: dblclick selects the current one and focuses it.
          onClick: (e: MouseEvent) => {
            if (e.detail < 2) ctl.selectBuilding(b.key, false, e.shiftKey);
          },
          onDblClick: () => ctl.selectBuilding(b.key, true),
        },
        h('span', { class: 'co-building-name' }, b.naam),
        count > 1 ? h('span', { class: 'co-building-count' }, `×${count}`) : null,
        b.available > 0
          ? h('span', { class: 'co-building-badge', 'aria-hidden': 'true' }, String(b.available))
          : busy
            ? h('span', { class: 'co-building-badge co-building-busy', 'aria-hidden': 'true' }, '…')
            : null,
        pct !== null
          ? h(
              'span',
              {
                class: 'co-building-progress',
                role: 'progressbar',
                'aria-label': `Voortgang ${b.naam}`,
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': pct,
              },
              h('span', { style: { width: `${pct}%` } }),
            )
          : null,
      );
    }),
  );
}

/**
 * Onderbalk naast de selectie: per eenhedentype een knop met aantal en het aantal zonder taak (klik selecteert, de lijst
 * toont wat elke unit doet), en per gebouw met iets te doen een knop (klik selecteert en opent zijn kaarten).
 */
function RosterBar(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (state.roster.length === 0 && state.buildingButtons.length === 0) return null;
  const selected = new Set(state.selection.map((s) => s.id));
  const open: RosterGroup | undefined = state.roster.find((g) => g.key === state.rosterOpen);
  return h(
    'section',
    {
      class:
        state.buildingButtons.length > 0
          ? 'co-panel co-roster co-roster-has-buildings'
          : 'co-panel co-roster',
      'aria-label': 'Eenheden per type',
    },
    open
      ? h(
          'ul',
          { class: 'co-roster-list', 'aria-label': `${open.naam}: ${open.units.length} eenheden` },
          open.units.map((u, i) => {
            const barState = unitStateOf(u.activity);
            const gather =
              u.activity === 'gathering' && u.progressPct !== undefined
                ? Math.max(0, Math.min(100, Math.round(u.progressPct)))
                : null;
            const hp = Math.max(0, Math.min(100, u.hpPct));
            const label = `${open.naam} ${i + 1}: ${UNIT_STATE_TEXT[barState]}, ${ACTIVITY_TEXT[u.activity]}${gather !== null ? ` (${gather}%)` : ''}, ${hp}% gezondheid`;
            // Colour only: green available, orange working, red busy; gathering fills the bar as a loading bar.
            return h(
              'li',
              { key: u.id },
              h(
                'button',
                {
                  type: 'button',
                  class: selected.has(u.id) ? 'co-roster-unit co-selected' : 'co-roster-unit',
                  'data-state': barState,
                  'data-activity': u.activity,
                  'aria-label': label,
                  title: label,
                  'aria-pressed': selected.has(u.id),
                  onClick: (e: MouseEvent) => ctl.selectRosterUnit(u.id, e.shiftKey),
                },
                gather !== null
                  ? h('span', {
                      class: 'co-roster-fill',
                      'aria-hidden': 'true',
                      style: { width: `${gather}%` },
                    })
                  : null,
                h(
                  'span',
                  { class: 'co-roster-hp', 'aria-hidden': 'true' },
                  h('span', { style: { width: `${hp}%` } }),
                ),
              ),
            );
          }),
        )
      : null,
    h('h2', { class: 'co-roster-title', 'aria-hidden': 'true' }, 'Eenheden'),
    h(
      'div',
      { class: 'co-roster-row' },
      h(
        'div',
        { class: 'co-roster-groups' },
        state.roster.map((g) => {
          const idle = g.units.filter((u) => u.activity === 'idle').length;
          const allSelected = g.units.length > 0 && g.units.every((u) => selected.has(u.id));
          // Share of the group per state, as a thin colour bar under the portrait (decorative: the numbers are in the label).
          const per: Record<UnitState, number> = { available: 0, working: 0, busy: 0 };
          for (const u of g.units) per[unitStateOf(u.activity)]++;
          return h(
            'button',
            {
              key: g.key,
              type: 'button',
              class: allSelected ? 'co-roster-group co-selected' : 'co-roster-group',
              'data-group': g.key,
              title: g.naam,
              'aria-label': `${g.naam}: ${g.units.length}, waarvan ${idle} zonder taak. Klik om ze te selecteren.`,
              'aria-expanded': state.rosterOpen === g.key,
              disabled: g.units.length === 0,
              onClick: (e: MouseEvent) => ctl.selectGroup(g.key, e.shiftKey),
            },
            h('span', {
              class: 'co-tile-portrait',
              'aria-hidden': 'true',
              'data-portrait': portraitOfGroup(g.key),
            }),
            h(
              'span',
              { class: 'co-tile-bar', 'aria-hidden': 'true' },
              (['available', 'working', 'busy'] as const).map((st) =>
                per[st] > 0
                  ? h('i', { key: st, 'data-state': st, style: { flexGrow: per[st] } })
                  : null,
              ),
            ),
            h(
              'span',
              { class: 'co-tile-label' },
              h('span', { class: 'co-roster-name' }, g.short ?? g.naam),
              h(
                'span',
                { class: 'co-tile-line' },
                h('span', { class: 'co-roster-count' }, String(g.units.length)),
                idle > 0
                  ? h(
                      'span',
                      {
                        class: 'co-roster-idle',
                        title: `${idle} zonder taak (punt-toets: volgende)`,
                      },
                      `${idle} vrij`,
                    )
                  : null,
              ),
            ),
          );
        }),
      ),
      h(BuildingButtons, { ctl, state }),
    ),
  );
}

/** Wat de commandokaart zegt als er geen knoppen zijn: niets geselecteerd, of een gebouw. */
function commandHint(ctl: HudController, state: HudState): string {
  const sel = ctl.selectionSummary();
  if (state.selection.some((s) => kindOfTypeId(s.typeId).kind === 'scrapNode'))
    return 'Een scrapbron: kies eenheden om te verzamelen of te bewaken (W).';
  if (ctl.enemySelected()) return 'Je bekijkt een vijand: die kun je niet bevelen.';
  if (sel.units === 0 && sel.buildings === 0) return 'Selecteer een eenheid of gebouw.';
  if (sel.units === 0) {
    if (state.cards.length > 0) return 'Kies hierboven wat dit gebouw moet doen.';
    return state.selection.some((s) => s.note)
      ? 'Dit gebouw is nog niet klaar.'
      : 'Dit gebouw heeft nu niets te doen.';
  }
  return '';
}

/** Commandokaart: alleen de commando's die bij de selectie passen, zodat er nooit knoppen staan die niets doen. */
function CommandCard(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const actions = ctl.visibleActions();
  const hint = actions.length === 0 ? commandHint(ctl, state) : '';
  const heroSelected = ctl.heroSelected();
  return h(
    'section',
    { class: 'co-panel co-commands', 'aria-label': "Commando's" },
    actions.length > 0 || heroSelected
      ? h(
          'h2',
          { class: 'co-cmd-title' },
          h('span', { class: 'co-emblem', 'aria-hidden': 'true' }),
          "Commando's",
        )
      : null,
    hint ? h('p', { class: 'co-empty co-commands-hint' }, hint) : null,
    actions.length > 0
      ? h(
          'div',
          { class: 'co-buttons' },
          actions.map((a) => {
            const pressed =
              a.id === 'build'
                ? state.buildMenuOpen || state.placement !== null
                : a.id === 'lobby'
                  ? state.showLobby
                  : state.targeting === a.id;
            return h(
              'button',
              {
                key: a.id,
                type: 'button',
                class: 'co-btn',
                disabled: !ctl.isEnabled(a),
                'aria-label': `${actionLabel(a, ctl.selectionSummary())} (sneltoets ${keyLabel(a.key)})`,
                title: ACTION_HINT[a.id],
                'aria-keyshortcuts': a.key === ' ' ? 'Space' : a.key.toUpperCase(),
                'aria-pressed': pressed,
                'data-action': a.id,
                onClick: () => ctl.run(a.id),
              },
              h('span', { class: 'co-btn-icon', 'aria-hidden': 'true' }),
              h('span', { class: 'co-btn-label' }, actionLabel(a, ctl.selectionSummary())),
              h('span', { class: 'co-key', 'aria-hidden': 'true' }, keyLabel(a.key)),
            );
          }),
        )
      : null,
    heroSelected ? h(HeroAbilities, { ctl, state }) : null,
    state.buildMenuOpen ? h(BuildMenu, { ctl, state }) : null,
  );
}

/** Which drawing a build option gets in the bitmap skin (a name match: the options carry no icon of their own). */
function buildingIcon(naam: string): string {
  const n = naam.toLowerCase();
  if (/woning|huis|bed/.test(n)) return 'home';
  if (/turret|toren|laser/.test(n)) return 'turret';
  if (/robot|fabriek/.test(n)) return 'factory';
  return 'build';
}

function BuildMenu(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const noBuilder = ctl.selectedBuilders().length === 0;
  return h(
    'div',
    { class: 'co-menu', role: 'group', 'aria-label': 'Bouwmenu' },
    noBuilder ? h('p', { class: 'co-empty' }, 'Selecteer een bouwer om te bouwen.') : null,
    state.buildOptions.length === 0
      ? h('p', { class: 'co-empty' }, 'Geen gebouwen beschikbaar.')
      : null,
    h(
      'ul',
      { class: 'co-build-list' },
      state.buildOptions.map((o, i) =>
        h(
          'li',
          { key: o.buildingId },
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-build-option',
              disabled: !ctl.canChooseBuild(o),
              'data-building': o.buildingId,
              'aria-label': `${o.naam}, ${o.scrapCost} scrap, ${o.footprint.w} bij ${o.footprint.h}${o.affordable ? '' : ', te duur'} (sneltoets ${i + 1})`,
              onClick: () => ctl.chooseBuild(o.buildingId),
            },
            h('span', {
              class: 'co-build-icon',
              'aria-hidden': 'true',
              'data-building-icon': buildingIcon(o.naam),
            }),
            h('span', { class: 'co-build-name' }, o.naam),
            h(
              'span',
              { class: o.affordable ? 'co-cost' : 'co-cost co-full' },
              `${o.scrapCost} · ${o.footprint.w}x${o.footprint.h}`,
            ),
            h('span', { class: 'co-key', 'aria-hidden': 'true' }, String(i + 1)),
          ),
        ),
      ),
    ),
  );
}

function PlacementBar(props: { ctl: HudController; state: HudState }): ComponentChild {
  const o = props.state.placement;
  if (!o) return null;
  return h(
    'div',
    { class: 'co-panel co-targeting', role: 'status' },
    `Plaats ${o.naam} (${o.footprint.w}x${o.footprint.h}) op de kaart (Esc om te annuleren)`,
    props.state.placementHint
      ? h('span', { class: 'co-placement-reason' }, ` \u2013 ${props.state.placementHint}`)
      : null,
  );
}

const SPECIAL_NAMES = [
  'Kracht',
  'Perceptie',
  'Uithoudingsvermogen',
  'Charisma',
  'Intelligentie',
  'Behendigheid',
  'Geluk',
] as const;

function HeroAbilities(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (state.heroAbilities.length === 0) return null;
  return h(
    'div',
    { class: 'co-abilities', role: 'group', 'aria-label': 'Abilities' },
    state.heroAbilities.map((a, i) => {
      const key = ABILITY_KEYS[i];
      const cooling = a.cooldownPct > 0;
      return h(
        'button',
        {
          key: a.abilityId,
          type: 'button',
          class: 'co-btn co-ability',
          disabled: !ctl.canUseAbility(a),
          'aria-pressed': state.pendingAbility?.abilityId === a.abilityId,
          'data-ability': a.abilityId,
          'aria-label': `${a.naam}${a.needsTarget ? ', kies een doel' : ''}${cooling ? `, cooldown ${Math.round(a.cooldownPct)}%` : ''}${key ? ` (sneltoets ${key.toUpperCase()})` : ''}`,
          onClick: () => ctl.useAbility(a.abilityId),
        },
        h('span', null, a.naam),
        key ? h('span', { class: 'co-key', 'aria-hidden': 'true' }, key.toUpperCase()) : null,
        cooling
          ? h('span', {
              class: 'co-cooldown',
              style: { width: `${Math.min(100, a.cooldownPct)}%` },
            })
          : null,
      );
    }),
  );
}

function HeroPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const hero = state.status?.hero;
  if (!hero) return null;
  const naam = (hero.heroId !== undefined ? ctl.heroName(hero.heroId) : undefined) ?? 'Held';
  const pct =
    hero.xpNext !== undefined && hero.xpNext > 0
      ? Math.max(0, Math.min(100, Math.round((hero.xp / hero.xpNext) * 100)))
      : null;
  const pending = ctl.pendingPerks();
  return h(
    'section',
    { class: 'co-panel co-hero', 'aria-label': 'Held' },
    h('h2', null, `${naam} · level ${hero.level}${state.heroDead ? ' · gevallen' : ''}`),
    pct !== null
      ? h(
          'div',
          {
            class: 'co-xp',
            role: 'meter',
            'aria-label': 'Ervaring',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': pct,
            title: `${hero.xp} / ${hero.xpNext} xp`,
          },
          h('span', { style: { width: `${pct}%` } }),
        )
      : null,
    h(
      'ul',
      { class: 'co-special', 'aria-label': 'SPECIAL' },
      hero.special.map((v, i) =>
        h(
          'li',
          { key: i, title: SPECIAL_NAMES[i], 'aria-label': `${SPECIAL_NAMES[i]} ${v}` },
          h('b', null, 'SPECIAL'[i]),
          h('span', null, String(v)),
        ),
      ),
    ),
    hero.revivesLeft !== undefined
      ? h('p', { class: 'co-revives' }, `Oplappen: nog ${hero.revivesLeft}x`)
      : null,
    state.heroDead && ctl.canRevive()
      ? h(
          'button',
          {
            type: 'button',
            class: 'co-btn co-revive',
            'data-action': 'revive',
            'aria-label': 'Held oplappen (sneltoets V)',
            onClick: () => ctl.revive(),
          },
          h('span', null, 'Oplappen'),
          h('span', { class: 'co-key', 'aria-hidden': 'true' }, 'V'),
        )
      : null,
    // With the hero selected the commands panel shows the abilities, so they appear once.
    ctl.heroSelected() ? null : h(HeroAbilities, { ctl, state }),
    pending > 0
      ? h(
          'button',
          {
            type: 'button',
            class: 'co-btn co-perk-badge',
            'data-action': 'perks',
            'aria-expanded': state.perkPanelOpen,
            'aria-controls': 'co-perk-panel',
            'aria-keyshortcuts': PERK_PANEL_KEY.toUpperCase(),
            'aria-label': `Kies perk (${pending}), sneltoets ${PERK_PANEL_KEY.toUpperCase()}`,
            onClick: () => ctl.togglePerkPanel(),
          },
          h('span', null, `Kies perk (${pending})`),
          h('span', { class: 'co-key', 'aria-hidden': 'true' }, PERK_PANEL_KEY.toUpperCase()),
        )
      : null,
    pending > 0 && state.perkPanelOpen ? h(PerkPanel, { ctl, state, pending }) : null,
  );
}

/** Small panel next to the hero panel with the perks the hero can pick: name, effect, requirement; one click chooses. */
function PerkPanel(props: {
  ctl: HudController;
  state: HudState;
  pending: number;
}): ComponentChild {
  const { ctl, state, pending } = props;
  return h(
    'div',
    { id: 'co-perk-panel', class: 'co-perk-panel', role: 'group', 'aria-label': 'Kies een perk' },
    h(
      'div',
      { class: 'co-perk-head' },
      h('p', { class: 'co-perk-title' }, `Kies een perk (${pending})`),
      h(
        'button',
        {
          type: 'button',
          class: 'co-perk-close',
          'aria-label': 'Sluit het perk-paneel',
          onClick: () => ctl.closePerkPanel(),
        },
        '×',
      ),
    ),
    state.perkOptions.length === 0
      ? h('p', { class: 'co-empty' }, 'Er zijn geen perks meer om te kiezen.')
      : h(
          'ul',
          { class: 'co-perk-list' },
          state.perkOptions.map((p, i) => {
            const locked = p.available === false;
            const lines =
              p.effects && p.effects.length > 0
                ? p.effects
                : p.beschrijving
                  ? [p.beschrijving]
                  : [];
            const key = PERK_KEYS[i]?.toUpperCase();
            const label = [
              `Perk ${p.naam}`,
              ...lines,
              p.requirement
                ? `vereist ${p.requirement}${locked ? ', nog niet gehaald' : ''}`
                : null,
              key ? `(sneltoets ${key})` : null,
            ]
              .filter((x) => x !== null && x !== '')
              .join(': ')
              .replace(': (sneltoets', ' (sneltoets');
            return h(
              'li',
              { key: p.perkId },
              h(
                'button',
                {
                  type: 'button',
                  class: locked ? 'co-btn co-perk co-perk-locked' : 'co-btn co-perk',
                  'data-perk': p.perkId,
                  'aria-disabled': locked,
                  title: p.flavour ?? p.beschrijving,
                  'aria-label': label,
                  onClick: () => ctl.pickPerk(p.perkId),
                },
                h(
                  'span',
                  { class: 'co-perk-top' },
                  h('span', { class: 'co-perk-name' }, p.naam),
                  key ? h('span', { class: 'co-key', 'aria-hidden': 'true' }, key) : null,
                ),
                lines.map((line) => h('span', { class: 'co-perk-effect', key: line }, line)),
                p.requirement
                  ? h(
                      'span',
                      { class: locked ? 'co-perk-req co-perk-unmet' : 'co-perk-req' },
                      h('span', { 'aria-hidden': 'true' }, locked ? '✗ ' : '✓ '),
                      `Vereist ${p.requirement}${locked ? ' (nog niet gehaald)' : ''}`,
                    )
                  : null,
              ),
            );
          }),
        ),
  );
}

function Minimap(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const m = state.minimap;
  useEffect(() => {
    if (ref.current && m) drawMinimap(ref.current, m, state.status?.playerId ?? 0);
  });
  if (!m) return null;
  const onClick = (e: MouseEvent): void => {
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    ctl.minimapClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  return h(
    'section',
    { class: 'co-panel co-minimap', 'aria-label': 'Minimap' },
    h('canvas', {
      ref,
      class: 'co-minimap-canvas',
      width: 160,
      height: 160,
      role: 'img',
      'aria-label': 'Minimap, klik om de camera te verplaatsen',
      onClick,
    }),
  );
}

const ALERT_TEXT: Record<AlertKind, string> = {
  attack: 'Aanval!',
  settlerLost: 'Bewoner verloren',
  claimLost: 'Claim verloren',
  dominance: 'Tegenstander telt mee voor dominantie!',
  revolt: 'Te weinig bewakers: slaven lopen weg! Zet vechters op Bewaak (G)',
  noBeds: 'Geen vrije bedden',
};

function Toasts(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  return h(
    'ul',
    { class: 'co-toasts', role: 'log', 'aria-live': 'polite', 'aria-label': 'Waarschuwingen' },
    state.toasts.map((t) => {
      const text = t.text ?? ALERT_TEXT[t.kind];
      return h(
        'li',
        { key: t.id },
        h(
          'button',
          {
            type: 'button',
            class: `co-btn co-toast co-toast-${t.kind}`,
            'data-alert': t.kind,
            'aria-label': t.kind === 'dominance' ? text : `${text}, ga naar de locatie`,
            onClick: () => ctl.focusAlert(t),
          },
          text,
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'co-toast-close',
            'aria-label': 'Sluit waarschuwing',
            onClick: () => ctl.dismissToast(t.id),
          },
          '×',
        ),
      );
    }),
  );
}

function LobbyPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const lobby = state.lobby;
  if (!lobby || !state.showLobby) return null;
  return h(
    'section',
    { class: 'co-panel co-lobby', 'aria-label': 'Lobby' },
    h('h2', null, 'Lobby'),
    h(
      'ul',
      { class: 'co-lobby-list' },
      lobby.players.map((p) =>
        h(
          'li',
          { key: p.playerId },
          h('span', null, p.name),
          p.ai ? h('span', { class: 'co-tag' }, 'AI') : null,
          p.playerId === lobby.hostId ? h('span', { class: 'co-tag' }, 'host') : null,
          h('span', { class: p.ready ? 'co-ready' : 'co-notready' }, p.ready ? 'klaar' : 'wacht'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'co-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'co-btn',
          'aria-label': 'Klaar (sneltoets R)',
          disabled: !ctl.canToggleReady(),
          onClick: () => ctl.toggleReady(),
        },
        'Klaar (R)',
      ),
      ctl.isHost()
        ? h(
            'button',
            {
              type: 'button',
              class: 'co-btn',
              'aria-label': 'Instellingen (sneltoets O)',
              onClick: () => ctl.openHostSettings(),
            },
            'Instellingen (O)',
          )
        : null,
    ),
  );
}

function SurrenderDialog(props: { ctl: HudController }): ComponentChild {
  const yes = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    no.current?.focus();
  }, []);
  return h(
    'div',
    {
      class: 'co-panel co-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': 'co-surrender-title',
    },
    h(
      'p',
      { id: 'co-surrender-title' },
      'Weet je zeker dat je wilt opgeven? Je verliest het potje.',
    ),
    h(
      'div',
      { class: 'co-actions' },
      h(
        'button',
        {
          ref: yes,
          type: 'button',
          class: 'co-btn co-danger',
          'aria-label': 'Ja, opgeven',
          onClick: () => props.ctl.confirmSurrender(),
        },
        'Ja, opgeven',
      ),
      h(
        'button',
        {
          ref: no,
          type: 'button',
          class: 'co-btn',
          'aria-label': 'Nee, doorspelen',
          onClick: () => props.ctl.cancelSurrender(),
        },
        'Nee, doorspelen',
      ),
    ),
  );
}

const stopEvent = (e: Event): void => e.stopPropagation();

export function Hud(props: { ctl: HudController }): ComponentChild {
  const { ctl } = props;
  const [, setTick] = useState(0);
  useEffect(() => ctl.onChange(() => setTick((n) => n + 1)), [ctl]);
  const state = ctl.getState();
  const { desync, stall } = state.network;
  return h(
    'div',
    {
      class: 'co-hud',
      // Dutch text: screen readers and the browser pick the right language rules.
      lang: 'nl',
      // Presses on the HUD never reach anything behind or around it (the canvas, document listeners), and the native
      // context menu does not open on a ctrl+click (macOS right click) over a panel.
      onPointerDown: stopEvent,
      onMouseDown: stopEvent,
      onClick: stopEvent,
      onDblClick: stopEvent,
      onAuxClick: stopEvent,
      onContextMenu: (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      },
    },
    h(ResourceBar, { status: state.status, robots: state.raider === null }),
    h(RaiderBar, { stats: state.raider }),
    h(
      'div',
      { class: 'co-top-right' },
      h(
        'button',
        {
          type: 'button',
          class: 'co-btn',
          'aria-label': 'Opgeven',
          onClick: () => ctl.requestSurrender(),
        },
        'Opgeven',
      ),
    ),
    desync
      ? h(
          'div',
          { class: 'co-panel co-banner co-desync', role: 'alert' },
          `Desync gedetecteerd op frame ${desync.frame}. Het potje is gestopt.`,
        )
      : stall && stall.waitingFor.length > 0
        ? h(
            'div',
            { class: 'co-panel co-banner co-stall', role: 'status' },
            `Gepauzeerd: wachten op ${stall.waitingFor.map((id) => ctl.playerName(id)).join(', ')}…`,
          )
        : null,
    state.targeting
      ? h(
          'div',
          { class: 'co-panel co-targeting', role: 'status' },
          TARGETING_TEXT[state.targeting],
        )
      : null,
    h(PlacementBar, { ctl, state }),
    state.hint ? h('div', { class: 'co-panel co-hint', role: 'status' }, state.hint) : null,
    h(Dominance, { state }),
    h(Minimap, { ctl, state }),
    h(HeroPanel, { ctl, state }),
    h(Toasts, { ctl, state }),
    h(LobbyPanel, { ctl, state }),
    h(SelectionPanel, { ctl, selection: state.selection, roster: state.roster }),
    h(RosterBar, { ctl, state }),
    h(SideConsole, { ctl, state }),
    h(UnitConsole, { ctl, state }),
    // Above the right console: the card window sits directly above the commands, so it never covers the minimap or roster.
    h(
      'div',
      { class: 'co-right-col' },
      h(CardPanel, { ctl, state }),
      h(CommandCard, { ctl, state }),
    ),
    state.confirmSurrender ? h(SurrenderDialog, { ctl }) : null,
  );
}
