// Split from view.ts to stay under the 5,000-token file limit; view.ts re-exports the public surface.
// Holds: ACTION_HINT, TARGETING_TEXT, mmss, highlightNumbers, DominanceBar, Dominance, +4 more.
import type { TargetingKind, SelectedEntity, RosterGroup, BuildingButton } from './types.js';
import { type ComponentChild, h } from 'preact';
import {
  type HudState,
  threatOf,
  type HudController,
  roleLabelOf,
  roleTagOf,
} from './controller.js';
import { ACTIVITY_TEXT, Typed } from './consoles.js';
import { kindOfTypeId } from '@crawlout/data';

/** Tooltips of the commands that need one (the Raiders' own commands); the other buttons explain themselves. */
export const ACTION_HINT: Partial<Record<string, string>> = {
  capture:
    'Sla een vijandelijke bewoner neer buiten zijn basis; blijf bij hem staan om hem te vangen (rechtsklik werkt ook)',
  liberate:
    'Raak een vijandelijke slaaf of gevangene aan om hem te bevrijden (rechtsklik werkt ook)',
  guard: 'Bewaak een kooi of scrapbron: houdt slaven aan het werk',
};

export const TARGETING_TEXT: Record<TargetingKind, string> = {
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

export function Dominance(props: { state: HudState }): ComponentChild {
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

export function SelectionPanel(props: {
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
export function BuildingButtons(props: { ctl: HudController; state: HudState }): ComponentChild {
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
