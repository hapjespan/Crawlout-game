import { h } from 'preact';
import type { ComponentChild } from 'preact';
import type { HudState } from './controller.js';
import { font, u } from './units.js';

// Survival co-op (ui 0.20.0, sim 0.27.0 Sim.survivalStatus): the wave panel under the top bar. The client turns the sim
// status into this view (apps/client/src/game/survival.ts); the HUD only shows it. All texts are Dutch.

/** The next wave's weight: the highest rank of its units (sim RANK_*). */
export type SurvivalRank = 'normal' | 'miniboss' | 'boss';

/** A build zone on the minimap, in sim units; the own one is drawn brighter. */
export interface MinimapZone {
  x: number;
  y: number;
  radius: number;
  own: boolean;
}

/** The build zones as rings: the own one solid in the own colour, the others thin and dim. */
export function drawSurvivalZones(
  ctx: CanvasRenderingContext2D,
  zones: readonly MinimapZone[],
  sx: number,
  sy: number,
  own: string,
): void {
  for (const z of zones) {
    ctx.strokeStyle = own;
    ctx.globalAlpha = z.own ? 0.9 : 0.35;
    ctx.lineWidth = z.own ? 1.5 : 1;
    ctx.beginPath();
    ctx.ellipse(z.x * sx, z.y * sy, z.radius * sx, z.radius * sy, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The survival run for the HUD; null outside the game type Survival. Keep the object stable while nothing changes. */
export interface SurvivalView {
  /** Waves started (0 before wave 1) and the total. */
  wave: number;
  waves: number;
  /** The next wave: number, name (data), rank and seconds until it starts; null after the last wave. */
  next: { wave: number; naam: string; rank: SurvivalRank; inSeconds: number } | null;
  /** Target of the latest started wave and its living units; null before wave 1. */
  target: { name: string; isYou: boolean; alive: number } | null;
  /** Living enemies of all started waves. */
  alive: number;
}

const mmss = (totalSeconds: number): string => {
  const t = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const RANK_TEXT: Record<SurvivalRank, string> = {
  normal: '',
  miniboss: 'mini-boss',
  boss: 'eindbaas',
};

/** The warning line for the next wave, or null for a normal one. */
export function survivalWarning(v: SurvivalView): string | null {
  const n = v.next;
  if (!n || n.rank === 'normal') return null;
  return `Let op: golf ${n.wave} brengt de ${RANK_TEXT[n.rank]} ${n.naam}`;
}

/** The wave counter, the countdown to the next wave, the boss warning and the target of the current wave. */
export function SurvivalPanel(props: { state: HudState }): ComponentChild {
  const v = props.state.survival;
  if (!v) return null;
  const warn = survivalWarning(v);
  const countdown = v.next
    ? `Golf ${v.next.wave} (${v.next.naam}) over ${mmss(v.next.inSeconds)}`
    : 'Laatste golf: versla alle vijanden';
  return h(
    'div',
    { class: 'co-panel co-dominance co-survival', role: 'group', 'aria-label': 'Survival' },
    h(
      'div',
      { class: 'co-dom-row' },
      h('span', { class: 'co-dom-text co-survival-wave' }, `Golf ${v.wave}/${v.waves}`),
      h('span', { class: 'co-survival-alive', title: 'Levende vijanden' }, `${v.alive} vijanden`),
    ),
    h(
      'div',
      { class: 'co-dom-row', 'aria-live': 'off' },
      h('span', { class: 'co-dom-text' }, countdown),
    ),
    warn
      ? h(
          'div',
          { class: 'co-dom-row co-dom-warn', role: 'status', 'data-survival-warning': '' },
          h('span', { class: 'co-dom-text' }, warn),
        )
      : null,
    v.target
      ? h(
          'div',
          { class: v.target.isYou ? 'co-dom-row co-dom-warn' : 'co-dom-row' },
          h(
            'span',
            { class: 'co-dom-text', 'data-survival-target': '' },
            v.target.isYou
              ? `Doel van deze golf: jij (${v.target.alive} over)`
              : `Doel van deze golf: ${v.target.name} (${v.target.alive} over)`,
          ),
        )
      : null,
  );
}

/** CSS of the survival panel (appended to the HUD styles). */
export const SURVIVAL_CSS = `
.co-hud .co-survival{top:${u(74)};gap:${u(2)}}
.co-survival-wave{font-weight:700}
.co-survival-alive{opacity:.8;font-size:${font(11)};margin-left:auto}`;
