// Split from view.ts to stay under the 5,000-token file limit; view.ts re-exports the public surface.
// Holds: BRAND, TAGLINE, Option, RadioGroup, Typed, cursor, +6 more.
import { type ComponentChild, h } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import type { MenuController } from './controller.js';
import type { HeroArchetype } from '@crawlout/protocol';
import {
  type MenuState,
  RANDOM_FACTION,
  GAME_TYPES,
  type GameTypeId,
  DEFAULT_HERO,
} from './flow.js';
import type { MenuContent, MenuFaction } from './types.js';
import { drawMinimap } from '../minimap.js';

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
  /** Skin picture for a card, as the `data-portrait` key (`hero-voorman`); nothing is drawn without a skin. */
  portrait?: string;
}

/**
 * A radio group of buttons: Tab enters it once, the arrows move and choose (skipping what is disabled), Home and End jump.
 * `variant` is the look: cards (big, with text) or a segmented row.
 */
export function RadioGroup<T extends string>(props: {
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
        o.portrait
          ? h('span', {
              class: 'co-m-choice-portrait',
              'data-portrait': o.portrait,
              'aria-hidden': 'true',
            })
          : null,
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

export function Splash(props: {
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

export function MainMenu(props: { ctl: MenuController }): ComponentChild {
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

/**
 * Hero choice (protocol 0.19.0): the three hero cards of a faction (name, archetype, passive, ability), Krijger
 * preselected. Null for a faction without heroes in the content (the menu then shows no choice).
 */
export function HeroPicker(props: {
  faction: MenuFaction | undefined;
  value: HeroArchetype | undefined;
  onChange(archetype: HeroArchetype): void;
  label?: string;
}): ComponentChild {
  const heroes = props.faction?.heroes ?? [];
  if (heroes.length === 0) return null;
  const label = props.label ?? 'Jouw held';
  return h(
    'div',
    { class: 'co-m-section' },
    h('h2', null, label),
    h(RadioGroup<HeroArchetype>, {
      label,
      value: props.value ?? DEFAULT_HERO,
      cols: 3,
      variant: 'cards',
      class: 'co-m-heroes',
      onChange: props.onChange,
      options: heroes.map((x) => ({
        value: x.archetype,
        label: x.name,
        tag: x.role,
        text: `Passief: ${x.passive}. ${x.ability}.`,
        aria: `${x.name}, ${x.role}. Passief: ${x.passive}. Ability ${x.ability}.`,
        ...(x.key ? { portrait: `hero-${x.key}` } : {}),
      })),
    }),
  );
}

export function AiScreen(props: {
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
          h(HeroPicker, {
            faction: content.factions.find((f) => f.key === ai.faction),
            value: ai.hero,
            onChange: (archetype) => ctl.dispatch({ type: 'ai/hero', archetype }),
          }),
          ai.gameType === 'survival'
            ? h(
                'div',
                { class: 'co-m-section' },
                h(
                  'p',
                  { class: 'co-m-sub', style: 'margin:0' },
                  'Alleen tegen de golven, zonder AI. Samen met 1 tot 3 anderen? Kies Speler tegen speler en zet het speltype op Survival co\u2011op.',
                ),
              )
            : h(
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
