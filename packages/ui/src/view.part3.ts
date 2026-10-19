// Split from view.ts to stay under the 5,000-token file limit; view.ts re-exports the public surface.
// Holds: HeroPanel, Minimap, ALERT_TEXT, Toasts, LobbyPanel, SurrenderDialog, +2 more.
import { type HudController, type HudState, PERK_PANEL_KEY } from './controller.js';
import { type ComponentChild, h } from 'preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import { drawMinimap } from './minimap.js';
import type { AlertKind } from './types.js';
import { ResourceBar, SideConsole, UnitConsole } from './consoles.js';
import { RaiderBar } from './raiderBar.js';
import { ProjectPanel } from './project.js';
import { SurvivalPanel } from './survival.js';
import { CardPanel } from './cards.js';
import {
  CommandCard,
  HeroAbilities,
  PerkPanel,
  PlacementBar,
  RosterBar,
  SPECIAL_NAMES,
} from './view.part2.js';
import { Dominance, SelectionPanel, TARGETING_TEXT } from './view.part1.js';

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
  project: 'Bouwproject',
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
    h(ProjectPanel, { ctl, state }),
    h(SurvivalPanel, { state }),
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
