import type { CommandEnvelope, FrameBundle } from '@crawlout/protocol';

/** Te ver vooruit plannen weigeren we (geheugenbescherming). */
export const MAX_SCHEDULE_AHEAD = 200;

interface Pending {
  cmd: CommandEnvelope;
  arrival: number;
}

/**
 * Ordent commando's per frame. Uitvoerframe = cmd.frame + delay; te late commando's gaan naar het
 * eerstvolgende uit te geven frame. Elke advance() geeft precies één bundel, aansluitend, nooit met gat.
 */
export class FrameScheduler {
  private readonly pending = new Map<number, Pending[]>();
  private arrival = 0;
  private next = 0;

  constructor(public delayFrames: number) {}

  /** Frame van de eerstvolgende bundel. */
  get nextFrame(): number {
    return this.next;
  }

  /** Geeft het uitvoerframe terug, of null als het commando te ver vooruit ligt. */
  submit(cmd: CommandEnvelope): number | null {
    const exec = Math.max(cmd.frame + this.delayFrames, this.next);
    if (exec > this.next + MAX_SCHEDULE_AHEAD) return null;
    let list = this.pending.get(exec);
    if (!list) this.pending.set(exec, (list = []));
    list.push({ cmd, arrival: this.arrival++ });
    return exec;
  }

  advance(): FrameBundle {
    const frame = this.next++;
    const list = this.pending.get(frame) ?? [];
    this.pending.delete(frame);
    list.sort((a, b) => a.cmd.playerId - b.cmd.playerId || a.cmd.seq - b.cmd.seq || a.arrival - b.arrival);
    return { frame, commands: list.map((p) => p.cmd) };
  }
}
