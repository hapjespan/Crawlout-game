import { h } from 'preact';
import type { ComponentChild } from 'preact';
import type { RaiderStats } from './types.js';

/** Slave groups with fewer guards than the guard rule asks (the sim lets slaves escape after a grace period). */
export function understaffedGroups(stats: RaiderStats): RaiderStats['guardGroups'] {
  return stats.guardGroups.filter((g) => g.slaves > 0 && g.guards < g.guardsNeeded);
}

/**
 * Raiders' top bar (next to the brass resource bar): slaves (working of all, prisoners on their way), fighters against
 * the tent safety net, and the guards of all slave groups against what the guard rule asks (data 0.29.0: a Kooi next to
 * the scrap 1, a scrap node in guard mode 1 per 5 slaves, loose fighters 2 per 5). Red when fighters are under the
 * safety-net threshold or a group has too few guards. null without Raider stats (the Dwellers see nothing).
 */
export function RaiderBar(props: { stats: RaiderStats | null }): ComponentChild {
  const s = props.stats;
  if (s === null) return null;
  const lowFighters = s.fighters < s.safetyThreshold;
  const short = understaffedGroups(s);
  const slaveText = `${s.slavesWorking} aan het werk${s.prisoners > 0 ? `, ${s.prisoners} gevangen` : ''}`;
  const netText = s.tentReady
    ? `Onder ${s.safetyThreshold} vechters komt er een Rover bij de tent`
    : `Onder ${s.safetyThreshold} vechters helpt een tent: bouw er een`;
  const guardText = s.guardGroups
    .map((g) => `${g.naam}: ${g.slaves} slaven, bewakers ${g.guards}/${g.guardsNeeded} nodig`)
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
    s.guardGroups.length > 0
      ? h(
          'li',
          {
            class: short.length > 0 ? 'co-raider-item co-raider-warn' : 'co-raider-item',
            'data-raider': 'guards',
            title: `${guardText}. Bewaak (G) op een Kooi of scrapbron houdt slaven aan het werk.`,
          },
          h('span', { class: 'co-raider-label' }, 'Bewakers'),
          h(
            'b',
            null,
            `${s.guardGroups.reduce((n, g) => n + Math.min(g.guards, g.guardsNeeded), 0)}/${s.guardGroups.reduce((n, g) => n + g.guardsNeeded, 0)}`,
          ),
          h(
            'span',
            { class: 'co-raider-sub' },
            short.length > 0 ? 'nodig: slaven lopen weg' : 'bewaakt',
          ),
        )
      : null,
  );
}
