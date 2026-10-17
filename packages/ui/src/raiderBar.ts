import { h } from 'preact';
import type { ComponentChild } from 'preact';
import type { RaiderStats } from './types.js';

/** Cages whose garrison is below what the revolt rule asks (the sim lets slaves escape after a grace period). */
export function understaffedCages(stats: RaiderStats): RaiderStats['cages'] {
  return stats.cages.filter((c) => c.slaves > 0 && c.guards < c.guardsNeeded);
}

/**
 * Raiders' top bar (next to the brass resource bar): slaves (working of all, prisoners on their way), fighters against
 * the tent safety net, and the cages with their guard count. Red when fighters are under the safety-net threshold or
 * a cage has too few guards. null without Raider stats (the Dwellers see nothing).
 */
export function RaiderBar(props: { stats: RaiderStats | null }): ComponentChild {
  const s = props.stats;
  if (s === null) return null;
  const lowFighters = s.fighters < s.safetyThreshold;
  const short = understaffedCages(s);
  const slaveText = `${s.slavesWorking} aan het werk${s.prisoners > 0 ? `, ${s.prisoners} gevangen` : ''}`;
  const netText = s.tentReady
    ? `Onder ${s.safetyThreshold} vechters komt er een Plunderaar bij de tent`
    : `Onder ${s.safetyThreshold} vechters helpt een tent: bouw er een`;
  const cageText = s.cages
    .map(
      (c) => `${c.naam}: ${c.slaves}/${c.capacity} slaven, ${c.guards}/${c.guardsNeeded} bewakers`,
    )
    .join('; ');
  return h(
    'ul',
    { class: 'co-panel co-raiders', 'aria-label': 'Raiders: slaven en vechters' },
    h(
      'li',
      {
        class: 'co-raider-item',
        'data-raider': 'slaves',
        title: `Slaven: ${s.slaves}, ${slaveText}`,
      },
      h('span', { class: 'co-raider-label' }, 'Slaven'),
      h('b', null, String(s.slaves)),
      h('span', { class: 'co-raider-sub' }, `· ${slaveText}`),
    ),
    h(
      'li',
      {
        class: lowFighters ? 'co-raider-item co-raider-warn' : 'co-raider-item',
        'data-raider': 'fighters',
        title: `Vechters: ${s.fighters}. ${netText}.`,
      },
      h('span', { class: 'co-raider-label' }, 'Vechters'),
      h('b', null, `${s.fighters}/${s.safetyThreshold}`),
      h('span', { class: 'co-raider-sub' }, lowFighters ? 'vangnet' : 'genoeg'),
    ),
    s.cages.length > 0
      ? h(
          'li',
          {
            class: short.length > 0 ? 'co-raider-item co-raider-warn' : 'co-raider-item',
            'data-raider': 'cages',
            title: cageText,
          },
          h('span', { class: 'co-raider-label' }, 'Kooi'),
          h(
            'b',
            null,
            `${s.cages.reduce((n, c) => n + c.guards, 0)}/${s.cages.reduce((n, c) => n + c.guardsNeeded, 0)}`,
          ),
          h(
            'span',
            { class: 'co-raider-sub' },
            short.length > 0 ? 'te weinig bewakers' : 'bewaakt',
          ),
        )
      : null,
  );
}
