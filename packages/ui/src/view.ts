import { h } from 'preact';
import type { ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlayerStatus } from '@crawlout/protocol';
import { ABILITY_KEYS, ACTIONS, PERK_KEYS, ROLE_LABEL, keyLabel } from './controller.js';
import type { HudController, HudState } from './controller.js';
import { drawMinimap } from './minimap.js';
import type { AlertKind, RosterGroup, SelectedEntity, TargetingKind, UnitActivity } from './types.js';

const TARGETING_TEXT: Record<TargetingKind, string> = {
  move: 'Kies een bestemming op de kaart (Esc om te annuleren)',
  attackMove: 'Kies een aanvalsdoel op de kaart (Esc om te annuleren)',
  gather: 'Kies een grondstofbron op de kaart (Esc om te annuleren)',
  heroAbility: 'Kies een doelpositie voor de ability (Esc om te annuleren)',
};

const fmt = (n: number | undefined): string => (n === undefined ? '–' : String(n));

function Counter(props: { label: string; value: string; full?: boolean }): ComponentChild {
  return h(
    'li',
    { class: 'co-counter' },
    h('span', { class: 'co-counter-label' }, props.label),
    h('span', { class: props.full ? 'co-counter-value co-full' : 'co-counter-value' }, props.value),
  );
}

function Counters(props: { status: PlayerStatus | null }): ComponentChild {
  const s = props.status;
  const full = s !== null && s.pop >= s.popCap;
  return h(
    'ul',
    { class: 'co-panel co-counters', 'aria-label': 'Voorraad en bewoners' },
    h(Counter, { label: 'Scrap', value: fmt(s?.scrap) }),
    h(Counter, { label: 'Bewoners', value: fmt(s?.settlers) }),
    h(Counter, { label: 'Pop', value: s ? `${s.pop}/${s.popCap}` : '–', full }),
    h(Counter, { label: 'Bedden', value: fmt(s?.beds) }),
  );
}

function HpBar(props: { pct: number }): ComponentChild {
  const pct = Math.max(0, Math.min(100, props.pct));
  return h(
    'div',
    { class: pct < 30 ? 'co-hp co-low' : 'co-hp', role: 'meter', 'aria-label': 'Gezondheid', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
    h('span', { style: { width: `${pct}%` } }),
  );
}

function SelectionPanel(props: { selection: readonly SelectedEntity[] }): ComponentChild {
  const sel = props.selection;
  let body: ComponentChild;
  if (sel.length === 0) {
    body = h('p', { class: 'co-empty' }, 'Niets geselecteerd');
  } else if (sel.length === 1 && sel[0]) {
    const u = sel[0];
    body = [
      h('p', { class: 'co-unit-name' }, u.loadoutName ?? `Type ${u.typeId}`),
      h('p', { class: 'co-unit-meta' }, `Loadout: ${u.loadoutName ?? 'geen'} · Rol: ${u.role ? ROLE_LABEL[u.role] : 'geen'} · ${u.hpPct}%`),
      h(HpBar, { pct: u.hpPct }),
    ];
  } else {
    body = h(
      'ul',
      { class: 'co-grid' },
      sel.map((u) =>
        h(
          'li',
          { class: 'co-cell', key: u.id, title: `Type ${u.typeId}, ${u.loadoutName ?? 'geen loadout'}, ${u.hpPct}%` },
          h('b', null, u.role ? ROLE_LABEL[u.role].slice(0, 1) : '?'),
          h(HpBar, { pct: u.hpPct }),
        ),
      ),
    );
  }
  return h(
    'section',
    { class: 'co-panel co-selection', 'aria-label': 'Selectie' },
    h('h2', null, sel.length > 1 ? `Selectie (${sel.length})` : 'Selectie'),
    body,
  );
}

const ACTIVITY_TEXT: Record<UnitActivity, string> = {
  idle: 'Niets te doen',
  moving: 'Onderweg',
  gathering: 'Verzamelt',
  carrying: 'Brengt scrap terug',
  building: 'Bouwt',
  fighting: 'Vecht',
};

/** Eenhedenbalk: per type een knop met aantal en het aantal zonder taak; klik selecteert, de lijst toont wat elke unit doet. */
function RosterBar(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (state.roster.length === 0) return null;
  const selected = new Set(state.selection.map((s) => s.id));
  const open: RosterGroup | undefined = state.roster.find((g) => g.key === state.rosterOpen);
  return h(
    'section',
    { class: 'co-panel co-roster', 'aria-label': 'Eenheden per type' },
    open
      ? h(
          'ul',
          { class: 'co-roster-list', 'aria-label': `${open.naam}: ${open.units.length} eenheden` },
          open.units.map((u, i) =>
            h(
              'li',
              { key: u.id },
              h(
                'button',
                {
                  type: 'button',
                  class: selected.has(u.id) ? 'co-roster-unit co-selected' : 'co-roster-unit',
                  'data-activity': u.activity,
                  'aria-label': `${open.naam} ${i + 1}: ${ACTIVITY_TEXT[u.activity]}, ${u.hpPct}% gezondheid`,
                  'aria-pressed': selected.has(u.id),
                  onClick: (e: MouseEvent) => ctl.selectRosterUnit(u.id, e.shiftKey),
                },
                h('span', { class: 'co-activity-dot', 'aria-hidden': 'true' }),
                h('span', { class: 'co-roster-unit-text' }, ACTIVITY_TEXT[u.activity]),
                h(HpBar, { pct: u.hpPct }),
              ),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'co-roster-groups' },
      state.roster.map((g) => {
        const idle = g.units.filter((u) => u.activity === 'idle').length;
        const allSelected = g.units.length > 0 && g.units.every((u) => selected.has(u.id));
        return h(
          'button',
          {
            key: g.key,
            type: 'button',
            class: allSelected ? 'co-roster-group co-selected' : 'co-roster-group',
            'aria-label': `${g.naam}: ${g.units.length}, waarvan ${idle} zonder taak. Klik om ze te selecteren.`,
            'aria-expanded': state.rosterOpen === g.key,
            disabled: g.units.length === 0,
            onClick: (e: MouseEvent) => ctl.selectGroup(g.key, e.shiftKey),
          },
          h('span', { class: 'co-roster-name' }, g.naam),
          h('span', { class: 'co-roster-count' }, String(g.units.length)),
          idle > 0 ? h('span', { class: 'co-roster-idle', title: `${idle} zonder taak (punt-toets: volgende)` }, `${idle} vrij`) : null,
        );
      }),
    ),
  );
}

function CommandCard(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  return h(
    'section',
    { class: 'co-panel co-commands', 'aria-label': 'Commando\'s' },
    h('h2', null, 'Commando\'s'),
    h(
      'div',
      { class: 'co-buttons' },
      ACTIONS.filter((a) => ctl.isAvailable(a) || a.requires === undefined).map((a) => {
        const pressed =
          a.id === 'build' ? state.buildMenuOpen || state.placement !== null : a.id === 'hero' ? state.showHero : a.id === 'craft' ? state.craftMenuOpen : a.id === 'minimap' ? state.showMinimap : a.id === 'lobby' ? state.showLobby : state.targeting === a.id;
        return h(
          'button',
          {
            key: a.id,
            type: 'button',
            class: 'co-btn',
            disabled: !ctl.isEnabled(a),
            'aria-label': `${a.label} (sneltoets ${keyLabel(a.key)})`,
            'aria-keyshortcuts': a.key === ' ' ? 'Space' : a.key.toUpperCase(),
            'aria-pressed': pressed,
            'data-action': a.id,
            onClick: () => ctl.run(a.id),
          },
          h('span', null, a.label),
          h('span', { class: 'co-key', 'aria-hidden': 'true' }, keyLabel(a.key)),
        );
      }),
    ),
    state.buildMenuOpen ? h(BuildMenu, { ctl, state }) : null,
    h(CraftMenu, { ctl, state }),
  );
}

function BuildMenu(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const noBuilder = ctl.selectedBuilders().length === 0;
  return h(
    'div',
    { class: 'co-menu', role: 'group', 'aria-label': 'Bouwmenu' },
    noBuilder ? h('p', { class: 'co-empty' }, 'Selecteer een bouwer om te bouwen.') : null,
    state.buildOptions.length === 0 ? h('p', { class: 'co-empty' }, 'Geen gebouwen beschikbaar.') : null,
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
            h('span', null, o.naam),
            h('span', { class: o.affordable ? 'co-cost' : 'co-cost co-full' }, `${o.scrapCost} · ${o.footprint.w}x${o.footprint.h}`),
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
  );
}

const SPECIAL_NAMES = ['Kracht', 'Perceptie', 'Uithoudingsvermogen', 'Charisma', 'Intelligentie', 'Behendigheid', 'Geluk'] as const;

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
        cooling ? h('span', { class: 'co-cooldown', style: { width: `${Math.min(100, a.cooldownPct)}%` } }) : null,
      );
    }),
  );
}

function HeroPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  const hero = state.status?.hero;
  if (!hero || !state.showHero) return null;
  const naam = (hero.heroId !== undefined ? ctl.heroName(hero.heroId) : undefined) ?? 'Held';
  const pct = hero.xpNext !== undefined && hero.xpNext > 0 ? Math.max(0, Math.min(100, Math.round((hero.xp / hero.xpNext) * 100))) : null;
  const pending = ctl.pendingPerks();
  return h(
    'section',
    { class: 'co-panel co-hero', 'aria-label': 'Held' },
    h('h2', null, `${naam} · level ${hero.level}${state.heroDead ? ' · gevallen' : ''}`),
    pct !== null
      ? h(
          'div',
          { class: 'co-xp', role: 'meter', 'aria-label': 'Ervaring', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, title: `${hero.xp} / ${hero.xpNext} xp` },
          h('span', { style: { width: `${pct}%` } }),
        )
      : null,
    h(
      'ul',
      { class: 'co-special', 'aria-label': 'SPECIAL' },
      hero.special.map((v, i) => h('li', { key: i, title: SPECIAL_NAMES[i], 'aria-label': `${SPECIAL_NAMES[i]} ${v}` }, h('b', null, 'SPECIAL'[i]), h('span', null, String(v)))),
    ),
    hero.revivesLeft !== undefined ? h('p', { class: 'co-revives' }, `Oplappen: nog ${hero.revivesLeft}x`) : null,
    state.heroDead && ctl.canRevive()
      ? h(
          'button',
          { type: 'button', class: 'co-btn co-revive', 'data-action': 'revive', 'aria-label': 'Held oplappen (sneltoets V)', onClick: () => ctl.revive() },
          h('span', null, 'Oplappen'),
          h('span', { class: 'co-key', 'aria-hidden': 'true' }, 'V'),
        )
      : null,
    h(HeroAbilities, { ctl, state }),
    pending > 0
      ? h(
          'div',
          { class: 'co-perks', role: 'group', 'aria-label': 'Kies een perk' },
          h('p', { class: 'co-perk-title' }, `Level-up: kies een perk (${pending})`),
          state.perkOptions.map((p, i) =>
            h(
              'button',
              {
                key: p.perkId,
                type: 'button',
                class: 'co-btn co-perk',
                'data-perk': p.perkId,
                title: p.beschrijving,
                'aria-label': `Perk ${p.naam}${p.beschrijving ? `: ${p.beschrijving}` : ''}${PERK_KEYS[i] ? ` (sneltoets ${PERK_KEYS[i]?.toUpperCase()})` : ''}`,
                onClick: () => ctl.pickPerk(p.perkId),
              },
              h('span', null, p.naam),
              PERK_KEYS[i] ? h('span', { class: 'co-key', 'aria-hidden': 'true' }, PERK_KEYS[i]?.toUpperCase()) : null,
            ),
          ),
        )
      : null,
  );
}

function BuildingPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl } = props;
  const entries = ctl.buildingEntries();
  if (entries.length === 0) return null;
  const digitsActive = ctl.buildingPanelActive();
  return h(
    'section',
    { class: 'co-panel co-building', 'aria-label': 'Gebouw' },
    h('h2', null, 'Gebouw'),
    h(
      'ul',
      { class: 'co-build-list' },
      entries.map((e, i) =>
        h(
          'li',
          { key: `${e.kind}${e.kind === 'research' ? e.techId : e.buildingId}` },
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-build-option',
              disabled: !e.affordable,
              'data-research': e.kind === 'research' ? e.techId : undefined,
              'data-recruit': e.kind === 'recruit' ? e.buildingId : undefined,
              'aria-label': `${e.kind === 'research' ? 'Onderzoek' : 'Rekruteer'} ${e.naam}, ${e.scrapCost} scrap${e.affordable ? '' : ', te duur'}${digitsActive && i < 9 ? ` (sneltoets ${i + 1})` : ''}`,
              onClick: () => ctl.chooseBuildingEntry(i),
            },
            h('span', null, `${e.kind === 'research' ? 'Onderzoek' : 'Rekruteer'} ${e.naam}`),
            h('span', { class: e.affordable ? 'co-cost' : 'co-cost co-full' }, String(e.scrapCost)),
            digitsActive && i < 9 ? h('span', { class: 'co-key', 'aria-hidden': 'true' }, String(i + 1)) : null,
          ),
        ),
      ),
    ),
  );
}

function CraftMenu(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  if (!state.craftMenuOpen) return null;
  return h(
    'div',
    { class: 'co-menu', role: 'group', 'aria-label': 'Craftmenu' },
    h(
      'ul',
      { class: 'co-build-list' },
      state.craftOptions.map((o, i) =>
        h(
          'li',
          { key: o.loadoutId },
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-build-option',
              disabled: !o.affordable,
              'data-craft': o.loadoutId,
              'aria-label': `Craft ${o.naam}, ${o.scrapCost} scrap${o.affordable ? '' : ', te duur'} (sneltoets ${i + 1})`,
              onClick: () => ctl.chooseCraft(o.loadoutId),
            },
            h('span', null, o.naam),
            h('span', { class: o.affordable ? 'co-cost' : 'co-cost co-full' }, String(o.scrapCost)),
            h('span', { class: 'co-key', 'aria-hidden': 'true' }, String(i + 1)),
          ),
        ),
      ),
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
  if (!m || !state.showMinimap) return null;
  const onClick = (e: MouseEvent): void => {
    const el = e.currentTarget as HTMLCanvasElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    ctl.minimapClick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  return h(
    'section',
    { class: 'co-panel co-minimap', 'aria-label': 'Minimap' },
    h('canvas', { ref, class: 'co-minimap-canvas', width: 160, height: 160, role: 'img', 'aria-label': 'Minimap, klik om de camera te verplaatsen', onClick }),
  );
}

const ALERT_TEXT: Record<AlertKind, string> = {
  attack: 'Aanval!',
  settlerLost: 'Bewoner verloren',
  claimLost: 'Claim verloren',
};

function Toasts(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  return h(
    'ul',
    { class: 'co-toasts', role: 'log', 'aria-live': 'polite', 'aria-label': 'Waarschuwingen' },
    state.toasts.map((t) =>
      h(
        'li',
        { key: t.id },
        h(
          'button',
          { type: 'button', class: `co-btn co-toast co-toast-${t.kind}`, 'data-alert': t.kind, 'aria-label': `${ALERT_TEXT[t.kind]}, ga naar de locatie`, onClick: () => ctl.focusAlert(t) },
          ALERT_TEXT[t.kind],
        ),
        h('button', { type: 'button', class: 'co-toast-close', 'aria-label': 'Sluit waarschuwing', onClick: () => ctl.dismissToast(t.id) }, '×'),
      ),
    ),
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
      h('button', { type: 'button', class: 'co-btn', 'aria-label': 'Klaar (sneltoets R)', disabled: !ctl.canToggleReady(), onClick: () => ctl.toggleReady() }, 'Klaar (R)'),
      ctl.isHost()
        ? h('button', { type: 'button', class: 'co-btn', 'aria-label': 'Instellingen (sneltoets O)', onClick: () => ctl.openHostSettings() }, 'Instellingen (O)')
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
    { class: 'co-panel co-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'co-surrender-title' },
    h('p', { id: 'co-surrender-title' }, 'Weet je zeker dat je wilt opgeven? Je verliest het potje.'),
    h(
      'div',
      { class: 'co-actions' },
      h('button', { ref: yes, type: 'button', class: 'co-btn co-danger', 'aria-label': 'Ja, opgeven', onClick: () => props.ctl.confirmSurrender() }, 'Ja, opgeven'),
      h('button', { ref: no, type: 'button', class: 'co-btn', 'aria-label': 'Nee, doorspelen', onClick: () => props.ctl.cancelSurrender() }, 'Nee, doorspelen'),
    ),
  );
}

export function Hud(props: { ctl: HudController }): ComponentChild {
  const { ctl } = props;
  const [, setTick] = useState(0);
  useEffect(() => ctl.onChange(() => setTick((n) => n + 1)), [ctl]);
  const state = ctl.getState();
  const { desync, stall } = state.network;
  return h(
    'div',
    { class: 'co-hud' },
    h(Counters, { status: state.status }),
    h(
      'div',
      { class: 'co-top-right' },
      h('button', { type: 'button', class: 'co-btn', 'aria-label': 'Opgeven', onClick: () => ctl.requestSurrender() }, 'Opgeven'),
    ),
    desync
      ? h('div', { class: 'co-panel co-banner co-desync', role: 'alert' }, `Desync gedetecteerd op frame ${desync.frame}. Het potje is gestopt.`)
      : stall && stall.waitingFor.length > 0
        ? h('div', { class: 'co-panel co-banner co-stall', role: 'status' }, `Gepauzeerd: wachten op ${stall.waitingFor.map((id) => ctl.playerName(id)).join(', ')}…`)
        : null,
    state.targeting ? h('div', { class: 'co-panel co-targeting', role: 'status' }, TARGETING_TEXT[state.targeting]) : null,
    h(PlacementBar, { ctl, state }),
    h(Minimap, { ctl, state }),
    h(HeroPanel, { ctl, state }),
    h(Toasts, { ctl, state }),
    h(LobbyPanel, { ctl, state }),
    h(BuildingPanel, { ctl, state }),
    h(SelectionPanel, { selection: state.selection }),
    h(RosterBar, { ctl, state }),
    h(CommandCard, { ctl, state }),
    state.confirmSurrender ? h(SurrenderDialog, { ctl }) : null,
  );
}
