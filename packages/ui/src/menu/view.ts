import { h, type ComponentChild } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { drawMinimap } from '../minimap.js';
import type { MenuController } from './controller.js';
import {
  GAME_TYPES,
  RANDOM_FACTION,
  type GameTypeId,
  type MenuAction,
  type MenuState,
  type PvpState,
} from './flow.js';
import { lobbyControls, lobbyRows, type LobbyRow } from './lobbyModel.js';
import {
  DETAIL_CHOICES,
  type DetailSetting,
  type HudScaleSetting,
  type ShadowSetting,
  HUD_SCALE_CHOICES,
  SETTING_LABELS,
  SHADOW_CHOICES,
} from './settings.js';
import type { MenuContent, MenuFaction } from './types.js';

/** Dutch Menu: splash, hoofdmenu, "Tegen AI", "Speler tegen speler" (formulier en lobby) en instellingen. */

const BRAND = 'Crawlout';
const TAGLINE = 'Bouw. Plunder. Overleef.';

interface Option<T extends string> {
  value: T;
  label: string;
  text?: string;
  tag?: string;
  disabled?: boolean;
  /** Spoken label when it differs from the visible text. */
  aria?: string;
}

/**
 * A radio group of buttons: Tab enters it once, the arrows move and choose (skipping what is disabled), Home and End jump.
 * `variant` is the look: cards (big, with text) or a segmented row.
 */
function RadioGroup<T extends string>(props: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange(value: T): void;
  variant: 'cards' | 'seg';
  cols?: 2 | 3;
  autofocus?: boolean;
  class?: string;
}): ComponentChild {
  const { options, value } = props;
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const move = (to: Option<T> | undefined): void => {
    if (!to) return;
    props.onChange(to.value);
    const i = options.indexOf(to);
    ref.current?.querySelectorAll<HTMLElement>('[role=radio]')[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const at = enabled.findIndex((o) => o.value === value);
    let next: Option<T> | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else return;
    e.preventDefault();
    move(next);
  };
  const tabbable = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;
  return h(
    'div',
    {
      ref,
      role: 'radiogroup',
      'aria-label': props.label,
      class: props.variant === 'seg' ? 'co-m-seg' : `co-m-cards ${props.class ?? ''}`,
      ...(props.cols ? { 'data-cols': String(props.cols) } : {}),
      onKeyDown,
    },
    options.map((o) =>
      h(
        'button',
        {
          key: o.value,
          type: 'button',
          role: 'radio',
          class: 'co-btn co-m-choice',
          'aria-checked': o.value === value ? 'true' : 'false',
          'aria-disabled': o.disabled ? 'true' : undefined,
          'aria-label': o.aria,
          tabIndex: o.value === tabbable ? 0 : -1,
          ...(props.autofocus && o.value === value ? { 'data-autofocus': '' } : {}),
          onClick: () => {
            if (!o.disabled) props.onChange(o.value);
          },
        },
        h('span', { class: 'co-m-choice-name' }, o.label),
        o.tag ? h('span', { class: o.disabled ? 'co-m-soon' : 'co-m-choice-tag' }, o.tag) : null,
        o.text ? h('span', { class: 'co-m-choice-text' }, o.text) : null,
      ),
    ),
  );
}

const Typed = (text: string): ComponentChild =>
  h('span', { class: 'co-m-type', style: `--n:${Math.max(1, text.length)}` }, text);

const cursor = (): ComponentChild => h('span', { class: 'co-m-cursor', 'aria-hidden': 'true' });

function TitlePlate(props: { small: boolean }): ComponentChild {
  return h(
    'div',
    { class: 'co-panel co-m-plate co-m-titleplate' },
    h('h1', { class: `co-m-title${props.small ? ' co-m-title-small' : ''}` }, BRAND),
    props.small ? null : h('p', { class: 'co-m-tagline' }, TAGLINE),
    h('div', { class: 'co-m-hazard', 'aria-hidden': 'true' }),
  );
}

function Splash(props: {
  ctl: MenuController;
  state: MenuState;
  content: MenuContent;
}): ComponentChild {
  const { ctl, state, content } = props;
  const pct = Math.round(state.progress * 100);
  const version = content.versionLabel ? ` ${content.versionLabel}` : '';
  const step = state.loaded ? 'Alles geladen.' : state.progressLabel || 'Opstarten…';
  return h(
    'section',
    {
      class: 'co-m-splash',
      style: 'width:min(calc(var(--m) * 980),94vw)',
      'aria-label': 'Opstartscherm',
    },
    h(TitlePlate, { small: false }),
    h(
      'div',
      { class: 'co-m-crt', style: 'margin-top:calc(var(--m) * 22)' },
      h(
        'p',
        { class: 'co-m-line', 'aria-hidden': 'true', key: 'sys' },
        '> ',
        Typed(`CRAWLOUT SYSTEEM${version}`.toUpperCase()),
      ),
      h('p', { class: 'co-m-line', key: step, 'aria-live': 'polite' }, '> ', Typed(step)),
      h(
        'div',
        {
          class: 'co-m-bar',
          role: 'progressbar',
          'aria-label': 'Laden',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': pct,
        },
        h('span', { style: `--p:${pct}%` }),
      ),
      h(
        'div',
        { class: 'co-m-pct', 'aria-hidden': 'true' },
        h('span', null, state.loaded ? 'Klaar' : 'Laden'),
        h('span', null, `${pct}%`),
      ),
      state.loaded
        ? h(
            'button',
            {
              type: 'button',
              class: 'co-m-press',
              'data-autofocus': '',
              'aria-label': 'Doorgaan naar het hoofdmenu (druk op een toets of klik)',
              onClick: () => ctl.dispatch({ type: 'continue' }),
            },
            'Druk op een toets',
            cursor(),
            h('span', { class: 'co-m-press-hint' }, 'of klik om verder te gaan'),
          )
        : h('p', { class: 'co-m-loading-note' }, 'Even geduld, het spel wordt geladen', cursor()),
    ),
    content.versionLabel ? h('p', { class: 'co-m-version' }, content.versionLabel) : null,
  );
}

function MainMenu(props: { ctl: MenuController }): ComponentChild {
  const { ctl } = props;
  const items = [
    { key: '1', screen: 'ai', label: 'Tegen AI', sub: 'Skirmish tegen de computer' },
    {
      key: '2',
      screen: 'pvp',
      label: 'Speler tegen speler',
      sub: 'Online via een relay en een kamercode',
    },
    { key: '3', screen: 'settings', label: 'Instellingen', sub: 'Schaduwen, detail en HUD' },
  ] as const;
  return h(
    'section',
    {
      class: 'co-m-main',
      style:
        'width:min(calc(var(--m) * 760),94vw);display:flex;flex-direction:column;align-items:center;gap:calc(var(--m) * 20)',
      'aria-label': 'Hoofdmenu',
    },
    h(TitlePlate, { small: true }),
    h(
      'div',
      { class: 'co-panel co-m-plate' },
      h('span', { class: 'co-m-tab' }, 'Hoofdmenu'),
      h(
        'ul',
        { class: 'co-m-list' },
        items.map((it, i) =>
          h(
            'li',
            { key: it.screen },
            h(
              'button',
              {
                type: 'button',
                class: 'co-m-item',
                'aria-label': `${it.label}, sneltoets ${it.key}`,
                ...(i === 0 ? { 'data-autofocus': '' } : {}),
                onClick: () => ctl.dispatch({ type: 'open', screen: it.screen }),
              },
              h('span', { class: 'co-key co-m-key', 'aria-hidden': 'true' }, it.key),
              h(
                'span',
                null,
                h('span', { class: 'co-m-item-label' }, it.label),
                h('span', { class: 'co-m-item-sub' }, it.sub),
              ),
              h('span', { class: 'co-m-caret', 'aria-hidden': 'true' }, '›'),
            ),
          ),
        ),
      ),
      h(
        'p',
        { class: 'co-m-hints' },
        h('kbd', null, '↑'),
        ' ',
        h('kbd', null, '↓'),
        ' kiezen · ',
        h('kbd', null, 'Enter'),
        ' bevestigen · ',
        h('kbd', null, '1'),
        h('kbd', null, '2'),
        h('kbd', null, '3'),
        ' direct',
      ),
    ),
  );
}

const factionOptions = (factions: readonly MenuFaction[]): Option<string>[] =>
  factions.map((f) => ({
    value: f.key,
    label: f.name,
    tag: `${f.subtitle} · held ${f.hero}`,
    text: f.blurb,
    aria: `${f.name} (${f.subtitle}). ${f.blurb} Held: ${f.hero}.`,
  }));

function MapPreview(props: { content: MenuContent }): ComponentChild {
  const { map } = props.content;
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawMinimap(ref.current, map.minimap, 0);
  }, [map]);
  const dot = (color: string): ComponentChild =>
    h('span', { class: 'co-m-dot', style: `background:${color}` });
  return h(
    'div',
    { class: 'co-m-mapcard' },
    h('h2', { class: 'co-m-mapname' }, map.name),
    h('canvas', {
      ref,
      class: 'co-m-minimap',
      width: 384,
      height: 384,
      role: 'img',
      'aria-label': `Voorbeeld van de kaart ${map.name}: terrein, water, startposities, schrootbronnen en claimpunten.`,
    }),
    h(
      'div',
      { class: 'co-m-legend', 'aria-hidden': 'true' },
      h('span', null, dot('#66bb6a'), 'jouw start'),
      h('span', null, dot('#ef5350'), 'tegenstander'),
      h('span', null, dot('#ffd54f'), 'schrot en claims'),
    ),
    h(
      'ul',
      { class: 'co-m-facts', 'aria-label': 'Kaart en winregels, alleen lezen' },
      h('li', null, h('b', null, 'Grootte'), h('span', null, map.sizeLabel)),
      h(
        'li',
        null,
        h('b', null, 'Spelers'),
        h('span', null, `1 tegen ${Math.max(1, map.maxPlayers - 1)}`),
      ),
      h('li', null, h('b', null, 'Winroutes'), h('span', null, 'Vernietiging, dominantie')),
      h(
        'li',
        null,
        h('b', null, 'Dominantie'),
        h('span', null, `${map.dominance.pointsRequired} punten, ${map.dominance.minutes} min`),
      ),
    ),
    h(
      'p',
      { class: 'co-m-note' },
      'De winregels liggen vast per kaart en zijn hier alleen te lezen.',
    ),
  );
}

function AiScreen(props: {
  ctl: MenuController;
  state: MenuState;
  content: MenuContent;
}): ComponentChild {
  const { ctl, state, content } = props;
  const { ai } = state;
  const factions = factionOptions(content.factions);
  const aiFactions: Option<string>[] = [
    ...content.factions.map((f) => ({ value: f.key, label: f.name })),
    { value: RANDOM_FACTION, label: 'Willekeurig' },
  ];
  const type = GAME_TYPES.find((g) => g.id === ai.gameType);
  return h(
    'section',
    {
      class: 'co-m-aiscreen',
      style: 'width:min(calc(var(--m) * 1120),96vw)',
      'aria-labelledby': 'co-m-ai-title',
    },
    h(
      'div',
      { class: 'co-panel co-m-plate' },
      h(
        'div',
        { class: 'co-m-headrow' },
        h('span', { class: 'co-m-tab' }, 'Tegen AI'),
        h('h1', { class: 'co-m-heading', id: 'co-m-ai-title', tabIndex: -1 }, 'Nieuw potje'),
      ),
      h(
        'div',
        { class: 'co-m-split' },
        h(
          'div',
          null,
          h(
            'div',
            { class: 'co-m-section' },
            h('h2', { id: 'co-m-ai-type' }, 'Speltype'),
            h(RadioGroup<GameTypeId>, {
              label: 'Speltype',
              value: ai.gameType,
              cols: 3,
              variant: 'cards',
              autofocus: true,
              onChange: (id) => ctl.dispatch({ type: 'ai/gameType', id }),
              options: GAME_TYPES.map((g) => ({
                value: g.id,
                label: g.name,
                text: g.blurb,
                ...(g.available
                  ? {}
                  : {
                      tag: 'Binnenkort',
                      disabled: true,
                      aria: `${g.name}, binnenkort beschikbaar. ${g.blurb}`,
                    }),
              })),
            }),
          ),
          h(
            'div',
            { class: 'co-m-section' },
            h('h2', null, 'Jouw factie'),
            h(RadioGroup, {
              label: 'Jouw factie',
              value: ai.faction,
              cols: 2,
              variant: 'cards',
              onChange: (key) => ctl.dispatch({ type: 'ai/faction', key }),
              options: factions,
            }),
          ),
          h(
            'div',
            { class: 'co-m-section' },
            h('h2', null, 'Factie van de AI'),
            h(RadioGroup, {
              label: 'Factie van de AI',
              value: ai.aiFaction,
              variant: 'seg',
              onChange: (key) => ctl.dispatch({ type: 'ai/aiFaction', key }),
              options: aiFactions,
            }),
          ),
          h(
            'div',
            { class: 'co-m-section' },
            h(
              'p',
              { class: 'co-m-sub', style: 'margin:0' },
              h('b', { class: 'co-m-inline-label' }, 'Moeilijkheid '),
              'Standaard (één niveau, een keuze volgt later)',
            ),
          ),
        ),
        h(MapPreview, { content }),
      ),
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
        h(
          'div',
          { class: 'co-m-actions-end' },
          h(
            'span',
            { class: 'co-m-sub', style: 'margin:0', 'aria-live': 'polite' },
            type ? `${type.name} op ${content.map.name}` : '',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'co-btn co-m-btn co-m-primary',
              onClick: () => ctl.dispatch({ type: 'ai/start' }),
            },
            'Start',
          ),
        ),
      ),
    ),
  );
}

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
