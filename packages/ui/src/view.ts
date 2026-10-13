import { h } from 'preact';
import type { ComponentChild } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlayerStatus } from '@crawlout/protocol';
import { ACTIONS, ROLE_LABEL } from './controller.js';
import type { HudController, HudState } from './controller.js';
import type { SelectedEntity, TargetingKind } from './types.js';

const TARGETING_TEXT: Record<TargetingKind, string> = {
  move: 'Kies een bestemming op de kaart (Esc om te annuleren)',
  attackMove: 'Kies een aanvalsdoel op de kaart (Esc om te annuleren)',
  gather: 'Kies een grondstofbron op de kaart (Esc om te annuleren)',
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
      h('p', { class: 'co-unit-name' }, `Type ${u.typeId}`),
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

function CommandCard(props: { ctl: HudController; state: HudState }): ComponentChild {
  const { ctl, state } = props;
  return h(
    'section',
    { class: 'co-panel co-commands', 'aria-label': 'Commando\'s' },
    h('h2', null, 'Commando\'s'),
    h(
      'div',
      { class: 'co-buttons' },
      ACTIONS.map((a) => {
        const pressed = a.id === 'build' ? state.buildMenuOpen : state.targeting === a.id;
        return h(
          'button',
          {
            key: a.id,
            type: 'button',
            class: 'co-btn',
            disabled: !ctl.isEnabled(a),
            'aria-label': `${a.label} (sneltoets ${a.key.toUpperCase()})`,
            'aria-keyshortcuts': a.key.toUpperCase(),
            'aria-pressed': pressed,
            'data-action': a.id,
            onClick: () => ctl.run(a.id),
          },
          h('span', null, a.label),
          h('span', { class: 'co-key', 'aria-hidden': 'true' }, a.key.toUpperCase()),
        );
      }),
    ),
    state.buildMenuOpen
      ? h('div', { class: 'co-menu', role: 'group', 'aria-label': 'Bouwmenu' }, 'Bouwmenu volgt in een volgende sprint.')
      : null,
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
    h(SelectionPanel, { selection: state.selection }),
    h(CommandCard, { ctl, state }),
    state.confirmSurrender ? h(SurrenderDialog, { ctl }) : null,
  );
}
