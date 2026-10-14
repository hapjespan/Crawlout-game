// Wandklok en rapportage voor de benchmark. Buiten packages/sim/src: de sim zelf heeft geen klok en rekent niet in floats.
export const now = (): number => performance.now();

export function reportBench(r: {
  units: number;
  ticks: number;
  totalMs: number;
  maxMs: number;
  finalHash: number;
  shots?: number;
  deaths?: number;
  scrapIn?: number;
}): void {
  const avg = r.totalMs / r.ticks;
  console.log(
    `bench: ${r.units} units, ${r.ticks} ticks, gemiddeld ${avg.toFixed(3)} ms/tick, max ${r.maxMs.toFixed(2)} ms, ` +
      `eindhash 0x${r.finalHash.toString(16).padStart(8, '0')} (budget 5 ms: ${avg < 5 ? 'binnen' : 'BOVEN'})`,
  );
  if (r.shots !== undefined)
    console.log(
      `bench: ${r.shots} schoten, ${r.deaths ?? 0} doden, ${r.scrapIn ?? 0} scrap afgeleverd`,
    );
}
