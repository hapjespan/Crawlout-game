// Events voor VFX en audio (contract 1). Geen state: de buffer wordt aan het begin van elke tick geleegd en
// telt niet mee in hash of serialisatie. Bij overloop vallen events weg; de sim zelf leest ze nooit.
export const MAX_EVENTS_PER_TICK = 1024;

export class EventBuffer {
  readonly type = new Uint8Array(MAX_EVENTS_PER_TICK);
  readonly a = new Uint32Array(MAX_EVENTS_PER_TICK);
  readonly b = new Uint32Array(MAX_EVENTS_PER_TICK);
  readonly x = new Int32Array(MAX_EVENTS_PER_TICK);
  readonly y = new Int32Array(MAX_EVENTS_PER_TICK);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  push(type: number, a: number, b: number, x: number, y: number): void {
    const i = this.count;
    if (i >= MAX_EVENTS_PER_TICK) return;
    this.type[i] = type;
    this.a[i] = a;
    this.b[i] = b;
    this.x[i] = x;
    this.y[i] = y;
    this.count = i + 1;
  }
}
