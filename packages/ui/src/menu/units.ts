/** Menu sizing units, shared by the menu style pieces (styles.screen.ts, styles.controls.ts) and re-exported from styles.ts. */

/** A length in menu units. */
export const m = (n: number): string => `calc(var(--m) * ${n})`;
/** A font size in menu units, never under 11 px. */
export const mf = (n: number): string => `max(11px, ${m(n)})`;
