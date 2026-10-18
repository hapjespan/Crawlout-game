// Split from view.ts to stay under the 5,000-token file limit; view.ts re-exports the public surface.
// Holds: PvpForm, linkStatus, PlayerRow, PvpLobby, SettingsScreen, MenuApp.
import type { MenuController } from './controller.js';
import type { PvpState, MenuAction } from './flow.js';
import { type ComponentChild, h } from 'preact';
import { type LobbyRow, lobbyRows, lobbyControls } from './lobbyModel.js';
import type { MenuContent } from './types.js';
import {
  type ShadowSetting,
  SHADOW_CHOICES,
  SETTING_LABELS,
  type DetailSetting,
  DETAIL_CHOICES,
  type HudScaleSetting,
  HUD_SCALE_CHOICES,
} from './settings.js';
import { useRef, useEffect } from 'preact/hooks';
import { AiScreen, MainMenu, RadioGroup, Splash } from './view.part1.js';

function PvpForm(props: { ctl: MenuController; pvp: PvpState }): ComponentChild {
  const { ctl, pvp } = props;
  const set = (action: MenuAction): void => ctl.dispatch(action);
  const field = (
    id: string,
    label: string,
    value: string,
    key: 'name' | 'room' | 'relayUrl',
    help: string,
    opts: { autofocus?: boolean; placeholder?: string; maxLength?: number } = {},
  ): ComponentChild =>
    h(
      'div',
      { class: 'co-m-row' },
      h('label', { class: 'co-m-label', for: id }, label),
      h('input', {
        id,
        class: 'co-m-field',
        type: 'text',
        value,
        autocomplete: 'off',
        spellcheck: false,
        autocapitalize: 'off',
        'aria-describedby': `${id}-help`,
        ...(opts.maxLength ? { maxLength: opts.maxLength } : {}),
        ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
        ...(opts.autofocus ? { 'data-autofocus': '' } : {}),
        onInput: (e: Event) =>
          set({ type: 'pvp/form', patch: { [key]: (e.target as HTMLInputElement).value } }),
      }),
      h('p', { class: 'co-m-row-help', id: `${id}-help` }, help),
    );
  return h(
    'section',
    { style: 'width:min(calc(var(--m) * 860),96vw)', 'aria-labelledby': 'co-m-pvp-title' },
    h(
      'div',
      { class: 'co-panel co-m-plate' },
      h(
        'div',
        { class: 'co-m-headrow' },
        h('span', { class: 'co-m-tab' }, 'Speler tegen speler'),
        h('h1', { class: 'co-m-heading', id: 'co-m-pvp-title', tabIndex: -1 }, 'Kies een kamer'),
      ),
      h(
        'form',
        {
          class: 'co-m-form',
          noValidate: true,
          onSubmit: (e: Event) => {
            e.preventDefault();
            ctl.dispatch({ type: 'pvp/connect', create: pvp.form.room.trim() === '' });
          },
        },
        field('co-m-name', 'Jouw naam', pvp.form.name, 'name', 'Zo zien de andere spelers je.', {
          autofocus: true,
          maxLength: 24,
        }),
        field(
          'co-m-room',
          'Kamercode',
          pvp.form.room,
          'room',
          'Typ de code van een vriend om te joinen, of maak een nieuwe kamer.',
          { placeholder: 'bijvoorbeeld K7M2X', maxLength: 24 },
        ),
        field(
          'co-m-relay',
          'Relay-adres',
          pvp.form.relayUrl,
          'relayUrl',
          'De server die het potje verbindt. Standaard dezelfde computer als deze pagina, poort 8787.',
        ),
        pvp.formError
          ? h(
              'div',
              { class: 'co-m-status', 'data-tone': 'bad', role: 'alert' },
              h('span', { class: 'co-m-lamp', 'aria-hidden': 'true' }),
              pvp.formError,
            )
          : null,
        h(
          'div',
          { class: 'co-m-actions', style: 'margin-top:calc(var(--m) * 6)' },
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-m-btn',
              onClick: () => ctl.dispatch({ type: 'back' }),
            },
            '‹ Terug',
          ),
          h(
            'div',
            { class: 'co-m-actions-end' },
            h(
              'button',
              {
                type: 'button',
                class: 'co-btn co-m-btn',
                onClick: () => ctl.dispatch({ type: 'pvp/connect', create: false }),
              },
              'Kamer joinen',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'co-btn co-m-btn co-m-primary',
                onClick: () => ctl.dispatch({ type: 'pvp/connect', create: true }),
              },
              'Nieuwe kamer',
            ),
          ),
        ),
      ),
    ),
  );
}

function linkStatus(pvp: PvpState): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const url = pvp.form.relayUrl;
  if (pvp.link === 'up') return { tone: 'ok', text: `Verbonden met ${url}` };
  if (pvp.link === 'down' && !pvp.everUp)
    return {
      tone: 'bad',
      text: `Geen verbinding met ${url}. Draait de relay? Er wordt opnieuw geprobeerd.`,
    };
  if (pvp.link === 'down')
    return { tone: 'bad', text: 'Verbinding met de relay verbroken, opnieuw verbinden…' };
  return { tone: 'warn', text: `Verbinden met ${url}…` };
}

function PlayerRow(props: {
  ctl: MenuController;
  row: LobbyRow;
  content: MenuContent;
  canChange: boolean;
}): ComponentChild {
  const { ctl, row, content } = props;
  const faction = content.factions.find((f) => f.key === row.faction);
  return h(
    'li',
    { class: 'co-m-player', ...(row.you ? { 'data-you': '' } : {}) },
    h(
      'span',
      { class: 'co-m-pname' },
      row.name,
      row.you ? h('span', { class: 'co-tag' }, 'Jij') : null,
      row.host ? h('span', { class: 'co-tag' }, 'Host') : null,
      row.ai ? h('span', { class: 'co-tag' }, 'AI') : null,
      !row.online && !row.ai ? h('span', { class: 'co-tag' }, 'Offline') : null,
    ),
    row.you && props.canChange
      ? h(RadioGroup, {
          label: 'Jouw factie',
          value: row.faction,
          variant: 'seg',
          onChange: (key) => ctl.deps.lobbyRequest({ kind: 'setFaction', faction: key }),
          options: content.factions.map((f) => ({ value: f.key, label: f.name })),
        })
      : h(
          'span',
          { class: 'co-m-pfaction' },
          faction ? `${faction.name} (${faction.subtitle})` : row.faction,
        ),
    row.ready
      ? h(
          'span',
          { class: 'co-m-pstate', 'data-ready': '' },
          h('span', { class: 'co-m-lamp', 'aria-hidden': 'true' }),
          'Klaar',
        )
      : h(
          'span',
          { class: 'co-m-pstate', 'data-wait': '' },
          h('span', { class: 'co-m-lamp', 'aria-hidden': 'true', style: 'opacity:.4' }),
          'Wacht',
        ),
  );
}

function PvpLobby(props: {
  ctl: MenuController;
  pvp: PvpState;
  content: MenuContent;
}): ComponentChild {
  const { ctl, pvp, content } = props;
  const rows = lobbyRows(pvp.lobby?.players ?? [], pvp.lobby?.youId ?? null);
  const controls = lobbyControls(rows, content.map.maxPlayers, pvp.link);
  const status = linkStatus(pvp);
  const otherFaction =
    content.factions.find((f) => f.key !== controls.me?.faction)?.key ??
    content.factions[0]?.key ??
    'dwellers';
  const ai = rows.find((r) => r.ai);
  return h(
    'section',
    { style: 'width:min(calc(var(--m) * 980),96vw)', 'aria-labelledby': 'co-m-lobby-title' },
    h(
      'div',
      { class: 'co-panel co-m-plate' },
      h('span', { class: 'co-m-tab' }, 'Lobby'),
      h(
        'div',
        { class: 'co-m-roomhead' },
        h(
          'div',
          null,
          h('span', { class: 'co-m-roomlabel', id: 'co-m-lobby-title' }, 'Kamercode'),
          h(
            'span',
            { class: 'co-m-roomcode', 'aria-label': `Kamercode ${pvp.roomId.split('').join(' ')}` },
            pvp.roomId,
          ),
        ),
        h(
          'div',
          null,
          h('span', { class: 'co-m-roomlabel' }, 'Kaart'),
          h('span', { class: 'co-m-pfaction' }, `${content.map.name} (${content.map.sizeLabel})`),
        ),
      ),
      h(
        'ul',
        { class: 'co-m-players', 'aria-label': 'Spelers in de kamer' },
        rows.length === 0
          ? h(
              'li',
              { class: 'co-m-player' },
              h('span', { class: 'co-m-pfaction' }, 'Nog niemand in de kamer…'),
            )
          : rows.map((row) =>
              h(PlayerRow, { key: row.playerId, ctl, row, content, canChange: pvp.link === 'up' }),
            ),
      ),
      h(
        'div',
        { class: 'co-m-status', 'data-tone': status.tone, role: 'status' },
        h('span', { class: 'co-m-lamp', 'aria-hidden': 'true' }),
        status.text,
      ),
      pvp.notice
        ? h(
            'div',
            { class: 'co-m-status', 'data-tone': 'bad', role: 'alert' },
            h('span', { class: 'co-m-lamp', 'aria-hidden': 'true' }),
            pvp.notice,
          )
        : null,
      h('p', { class: 'co-m-note', 'aria-live': 'polite' }, controls.hint),
      h(
        'div',
        { class: 'co-m-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'co-btn co-m-btn',
            'data-autofocus': '',
            onClick: () => ctl.dispatch({ type: 'back' }),
          },
          '‹ Terug',
        ),
        h(
          'div',
          { class: 'co-m-actions-end' },
          controls.canRemoveAi && ai
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'co-btn co-m-btn',
                  onClick: () => ctl.deps.lobbyRequest({ kind: 'removeAi', playerId: ai.playerId }),
                },
                'AI verwijderen',
              )
            : null,
          controls.canAddAi
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'co-btn co-m-btn',
                  onClick: () => ctl.deps.lobbyRequest({ kind: 'addAi', faction: otherFaction }),
                },
                'AI toevoegen',
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-m-btn co-m-primary',
              disabled: !controls.actionEnabled,
              onClick: () => ctl.deps.lobbyRequest({ kind: 'ready', ready: controls.actionReady }),
            },
            controls.actionLabel,
          ),
        ),
      ),
    ),
  );
}

function SettingsScreen(props: { ctl: MenuController }): ComponentChild {
  const { ctl } = props;
  const s = ctl.settings;
  const row = (label: string, id: string, control: ComponentChild, note?: string): ComponentChild =>
    h(
      'div',
      { class: 'co-m-setrow' },
      h('span', { class: 'co-m-label', id }, label),
      control,
      note ? h('p', { class: 'co-m-setnote' }, note) : null,
    );
  const onOff = [
    { value: 'on', label: 'Aan' },
    { value: 'off', label: 'Uit' },
  ] as const;
  return h(
    'section',
    { style: 'width:min(calc(var(--m) * 940),96vw)', 'aria-labelledby': 'co-m-set-title' },
    h(
      'div',
      { class: 'co-panel co-m-plate' },
      h(
        'div',
        { class: 'co-m-headrow' },
        h('span', { class: 'co-m-tab' }, 'Instellingen'),
        h('h1', { class: 'co-m-heading', id: 'co-m-set-title', tabIndex: -1 }, 'Instellingen'),
      ),
      row(
        'Schaduwen',
        'co-m-set-shadows',
        h(RadioGroup<ShadowSetting>, {
          label: 'Schaduwkwaliteit',
          value: s.shadows,
          variant: 'seg',
          autofocus: true,
          onChange: (shadows) => ctl.setSettings({ shadows }),
          options: SHADOW_CHOICES.map((v) => ({ value: v, label: SETTING_LABELS.shadows[v] })),
        }),
        'Automatisch kiest hoog op WebGPU en laag op WebGL2.',
      ),
      row(
        'Detail',
        'co-m-set-detail',
        h(RadioGroup<DetailSetting>, {
          label: 'Detailniveau van gebouwen, bomen en eenheden',
          value: s.detail,
          variant: 'seg',
          onChange: (detail) => ctl.setSettings({ detail }),
          options: DETAIL_CHOICES.map((v) => ({ value: v, label: SETTING_LABELS.detail[v] })),
        }),
        'Zuinig schakelt eerder naar eenvoudiger modellen: fijner voor een trage computer.',
      ),
      row(
        'HUD-grootte',
        'co-m-set-hud',
        h(RadioGroup<HudScaleSetting>, {
          label: 'Grootte van de HUD in het spel',
          value: s.hudScale,
          variant: 'seg',
          onChange: (hudScale) => ctl.setSettings({ hudScale }),
          options: HUD_SCALE_CHOICES.map((v) => ({ value: v, label: SETTING_LABELS.hudScale[v] })),
        }),
      ),
      ctl.deps.skinAvailable
        ? row(
            'HUD-uiterlijk',
            'co-m-set-skin',
            h(RadioGroup, {
              label: 'Uiterlijk van de HUD',
              value: s.hudSkin ? 'on' : 'off',
              variant: 'seg',
              onChange: (v) => ctl.setSettings({ hudSkin: v === 'on' }),
              options: [
                { value: 'on', label: 'Kunst van de ontwerper' },
                { value: 'off', label: 'Roest en Fosfor (CSS)' },
              ],
            }),
            'Alleen op deze computer: de kunst staat lokaal en zit niet in de uitgebrachte versie.',
          )
        : row(
            'HUD-uiterlijk',
            'co-m-set-skin',
            h('p', { class: 'co-m-pfaction', style: 'margin:0' }, 'Roest en Fosfor'),
          ),
      row(
        'Geluid',
        'co-m-set-sound',
        h(RadioGroup, {
          label: 'Geluid',
          value: s.sound ? 'on' : 'off',
          variant: 'seg',
          onChange: (v) => ctl.setSettings({ sound: v === 'on' }),
          options: [...onOff],
        }),
        'Plaatshouder: het spel heeft nog geen geluid. De keuze wordt bewaard.',
      ),
      ctl.reloadNeeded
        ? h(
            'div',
            { class: 'co-m-reload', role: 'status' },
            h('span', null, 'Schaduwen en detail gelden na opnieuw laden.'),
            h(
              'button',
              { type: 'button', class: 'co-btn co-m-btn', onClick: () => ctl.deps.reload() },
              'Nu opnieuw laden',
            ),
          )
        : null,
      h(
        'div',
        { class: 'co-m-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'co-btn co-m-btn',
            onClick: () => ctl.dispatch({ type: 'back' }),
          },
          '‹ Terug',
        ),
        h('span', { class: 'co-m-sub', style: 'margin:0' }, 'Wijzigingen worden direct bewaard.'),
      ),
    ),
  );
}

export function MenuApp(props: { ctl: MenuController }): ComponentChild {
  const { ctl } = props;
  const { state, visible } = ctl;
  const root = useRef<HTMLDivElement>(null);
  const content = ctl.content;
  // Focus the first control of a screen when it opens (the splash prompt once loaded), so the keyboard works at once.
  const phase = `${state.screen}:${state.pvp.phase}:${state.loaded}:${visible}`;
  useEffect(() => {
    if (!visible) return;
    const el = root.current?.querySelector<HTMLElement>('[data-autofocus]');
    if (el && root.current?.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
  }, [phase]);
  let screen: ComponentChild;
  switch (state.screen) {
    case 'splash':
      screen = h(Splash, { ctl, state, content });
      break;
    case 'main':
      screen = h(MainMenu, { ctl });
      break;
    case 'ai':
      screen = h(AiScreen, { ctl, state, content });
      break;
    case 'pvp':
      screen =
        state.pvp.phase === 'form'
          ? h(PvpForm, { ctl, pvp: state.pvp })
          : h(PvpLobby, { ctl, pvp: state.pvp, content });
      break;
    default:
      screen = h(SettingsScreen, { ctl });
  }
  return h(
    'div',
    {
      ref: root,
      class: 'co-hud co-menu',
      lang: 'nl',
      hidden: !visible,
      'data-screen': state.screen,
      // A click anywhere on the splash continues, like a key.
      onClick: () => ctl.dispatch({ type: 'continue' }),
    },
    h('div', {
      class: 'co-m-fx co-m-haze',
      'aria-hidden': 'true',
      ...(ctl.deps.stillBackground ? { 'data-still': '' } : {}),
    }),
    h('div', { class: 'co-m-fx co-m-scan', 'aria-hidden': 'true' }),
    h('div', { class: 'co-m-fx co-m-flicker', 'aria-hidden': 'true' }),
    h('main', { class: 'co-m-screen-root' }, screen),
  );
}
