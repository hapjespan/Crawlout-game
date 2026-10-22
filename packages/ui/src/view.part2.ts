// Split from view.ts to stay under the 5,000-token file limit; view.ts re-exports the public surface.
// Holds: RosterBar, commandHint, CommandCard, buildingIcon, BuildMenu, PlacementBar, +3 more.
import {
  type HudController,
  type HudState,
  unitStateOf,
  ABILITY_KEYS,
  actionLabel,
  keyLabel,
  PERK_KEYS,
} from './controller.js';
import { type ComponentChild, h } from 'preact';
import type { BuildOption, RosterGroup, UnitState } from './types.js';
import { UNIT_STATE_TEXT, ACTIVITY_TEXT } from './consoles.js';
import { portraitOfGroup } from './portraits.js';
import { kindOfTypeId } from '@crawlout/data';
import { ACTION_HINT, BuildingButtons } from './view.part1.js';

/**
 * Onderbalk naast de selectie: per eenhedentype een knop met aantal en het aantal zonder taak (klik selecteert, de lijst
 * toont wat elke unit doet), en per gebouw met iets te doen een knop (klik selecteert en opent zijn kaarten).
 */
export function RosterBar(props: { ctl: HudController; state: HudState }): ComponentChild {
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
export function CommandCard(props: { ctl: HudController; state: HudState }): ComponentChild {
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

/** "+6 bedden" for a building with beds, else the empty string. */
export const bedsText = (o: BuildOption): string =>
  o.beds !== undefined && o.beds > 0 ? `+${o.beds} ${o.beds === 1 ? 'bed' : 'bedden'}` : '';

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
              'aria-label': `${o.naam}, ${o.scrapCost} scrap, ${o.footprint.w} bij ${o.footprint.h}${bedsText(o) ? `, ${bedsText(o)}` : ''}${o.affordable ? '' : ', te duur'} (sneltoets ${i + 1})`,
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
              `${o.scrapCost} · ${o.footprint.w}x${o.footprint.h}${bedsText(o) ? ` · ${bedsText(o)}` : ''}`,
            ),
            h('span', { class: 'co-key', 'aria-hidden': 'true' }, String(i + 1)),
          ),
        ),
      ),
    ),
  );
}

export function PlacementBar(props: { ctl: HudController; state: HudState }): ComponentChild {
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

export const SPECIAL_NAMES = [
  'Kracht',
  'Perceptie',
  'Uithoudingsvermogen',
  'Charisma',
  'Intelligentie',
  'Behendigheid',
  'Geluk',
] as const;

export function HeroAbilities(props: { ctl: HudController; state: HudState }): ComponentChild {
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

/** Small panel next to the hero panel with the perks the hero can pick: name, effect, requirement; one click chooses. */
export function PerkPanel(props: {
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
