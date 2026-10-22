import { h } from 'preact';
import type { ComponentChild } from 'preact';
import type { HudController, HudState } from './controller.js';
import { font, u } from './units.js';

// Win route C, the Bouwproject (ui 0.19.0, protocol 0.16.0 PlayerStatus.project): the project panel under the
// dominance bar, the markers of the strip-mall parts on the minimap. The client turns the sim status into these views
// (apps/client/src/game/project.ts); the HUD only shows them and sends a restore through deps.restoreProject.

/** What a player has of one kind of part. */
export type ProjectHold = 'none' | 'restoring' | 'restored';

/** One kind of part (Supermarkt, Benzinestation, Garage, Watertoren) in the project panel. */
export interface ProjectKindView {
  kind: number;
  naam: string;
  /** Price of a restore (scrap). */
  scrapCost: number;
  mine: ProjectHold;
  /** 0..100 of the own restore in progress. */
  minePct: number;
  /** The best of the opponents. */
  enemy: ProjectHold;
  /** One of your parts of this kind was hit just now (sabotage). */
  underAttack: boolean;
  /** Selected builders can restore a ruin of this kind now (a ruin exists, you lack the kind, you can pay). */
  canRestore: boolean;
}

/** The Bouwproject for the HUD; null without a Bouwproject (Skirmish). Keep the object stable while nothing changes. */
export interface ProjectView {
  secondsRequired: number;
  kinds: readonly ProjectKindView[];
  you: { kindsHeld: number; secondsHeld: number; paused: boolean };
  /** The opponent closest to the win (longest countdown, then most kinds); null without one. */
  leader: { name: string; kindsHeld: number; secondsHeld: number; paused: boolean } | null;
}

/** A part of the strip mall on the minimap: owner null = a ruin. */
export interface MinimapProjectPart {
  x: number;
  y: number;
  owner: number | null;
  restored: boolean;
  underAttack: boolean;
}

const mmss = (totalSeconds: number): string => {
  const t = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const HOLD_TEXT: Record<ProjectHold, string> = {
  none: '—',
  restoring: 'in herstel',
  restored: 'hersteld',
};

function Bar(props: { label: string; now: number; max: number; text: string; warn?: boolean }) {
  const max = Math.max(1, props.max);
  const now = Math.max(0, Math.min(max, props.now));
  return h(
    'div',
    { class: props.warn ? 'co-dom-row co-dom-warn' : 'co-dom-row' },
    h('span', { class: 'co-dom-text' }, props.text),
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

/** The project panel: the own countdown, the opponent's warning, and per kind the state and a restore card. */
export function ProjectPanel(props: { ctl: HudController; state: HudState }): ComponentChild {
  const p = props.state.project;
  if (!p) return null;
  const all = p.kinds.length;
  const own = p.you.kindsHeld >= all;
  const ownText = own
    ? `Bouwproject: ${all}/${all} delen, nog ${mmss(p.secondsRequired - p.you.secondsHeld)}${p.you.paused ? ' (gepauzeerd)' : ''}`
    : `Bouwproject: ${p.you.kindsHeld}/${all} delen hersteld`;
  const lead = p.leader;
  const threat = lead !== null && lead.kindsHeld >= all;
  return h(
    'div',
    { class: 'co-panel co-dominance co-project', role: 'group', 'aria-label': 'Bouwproject' },
    h(Bar, {
      label: own ? 'Bouwproject, countdown' : 'Bouwproject, delen hersteld',
      now: own ? p.you.secondsHeld : p.you.kindsHeld,
      max: own ? p.secondsRequired : all,
      text: ownText,
    }),
    threat
      ? h(Bar, {
          label: `Bouwproject van ${lead.name}, countdown`,
          now: lead.secondsHeld,
          max: p.secondsRequired,
          text: `Let op: ${lead.name} bouwt, nog ${mmss(p.secondsRequired - lead.secondsHeld)}${lead.paused ? ' (gesaboteerd)' : ''}`,
          warn: true,
        })
      : null,
    h(
      'ul',
      { class: 'co-project-kinds' },
      p.kinds.map((k) =>
        h(
          'li',
          { key: k.kind, class: k.underAttack ? 'co-project-kind co-dom-warn' : 'co-project-kind' },
          h('span', { class: 'co-project-name' }, k.naam),
          h(
            'span',
            { class: 'co-project-hold' },
            k.mine === 'restoring' ? `${HOLD_TEXT.restoring} ${k.minePct}%` : HOLD_TEXT[k.mine],
          ),
          h('span', { class: 'co-project-enemy', title: 'Tegenstander' }, HOLD_TEXT[k.enemy]),
          k.canRestore
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'co-btn co-project-restore',
                  'aria-label': `Herstel ${k.naam}, ${k.scrapCost} scrap`,
                  onClick: () => props.ctl.restoreProject(k.kind),
                },
                `Herstel ${k.scrapCost}`,
              )
            : null,
        ),
      ),
    ),
  );
}

/** The parts on the minimap: a square in the owner's colour, outlined amber as a ruin, red while under attack. */
export function drawProjectParts(
  ctx: CanvasRenderingContext2D,
  parts: readonly MinimapProjectPart[],
  sx: number,
  sy: number,
  me: number,
  own: string,
  enemy: string,
): void {
  for (const part of parts) {
    const x = part.x * sx;
    const y = part.y * sy;
    if (part.owner !== null) {
      ctx.fillStyle = part.owner === me ? own : enemy;
      ctx.globalAlpha = part.restored ? 1 : 0.5;
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = part.underAttack ? '#ff5252' : '#ffb74d';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 5, y - 5, 10, 10);
  }
}

/** CSS of the project panel (appended to the HUD styles). */
export const PROJECT_CSS = `
.co-hud .co-project{top:${u(74)};gap:${u(2)}}
.co-project-kinds{list-style:none;margin:${u(2)} 0 0;padding:0;display:grid;grid-template-columns:repeat(2,1fr);gap:${u(2)} ${u(10)};font-size:${font(11)}}
.co-project-kind{display:flex;gap:6px;align-items:center;white-space:nowrap}
.co-project-name{flex:1}
.co-project-hold{opacity:.9}
.co-project-enemy{opacity:.6}
.co-project-restore{padding:0 4px;font-size:.9em;line-height:1.4}`;
