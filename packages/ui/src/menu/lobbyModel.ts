import type { LobbyPlayer } from '@crawlout/protocol';

/**
 * What the lobby screen shows and which buttons it offers, derived from the relay's lobby message. Pure, so the rules
 * (who is "you", who is the host, when may the host start) are tested without a screen or a relay.
 *
 * The relay has no client-sent `start`: it starts the match as soon as every human is ready and there are at least two
 * players (human or AI). So "Start potje" for the host is "ready", enabled only once everybody else is ready, and the
 * other players have a plain "Klaar" toggle. A faction change un-readies that player (relay rule), a join un-readies all.
 */

export interface LobbyRow extends LobbyPlayer {
  you: boolean;
  host: boolean;
}

export type LobbyLink = 'connecting' | 'up' | 'down';

export interface LobbyControls {
  /** The row of this client, or null while the lobby is not known yet. */
  me: LobbyRow | null;
  isHost: boolean;
  /** Label of the main button: "Start potje" (host) or "Klaar" / "Niet meer klaar". */
  actionLabel: string;
  actionEnabled: boolean;
  /** The ready value the main button sends. */
  actionReady: boolean;
  /** One line under the list (Dutch). */
  hint: string;
  canAddAi: boolean;
  canRemoveAi: boolean;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The player id of this client in a lobby message. The lobby message carries no `you`, so the client recognises itself
 * by the name it joined with; the relay makes human names unique in a room by appending " 2", " 3" to a duplicate.
 * Of several matches the one with the highest suffix is the newest joiner, and this client's first lobby message is the
 * one its own join caused; later messages keep the id found then (`previous`) as long as that row still has that name.
 */
export function identifyYou(
  players: readonly LobbyPlayer[],
  sentName: string,
  previous: number | null,
): number | null {
  const wanted = sentName.trim().toLowerCase();
  const suffix = new RegExp(`^${escapeRegExp(wanted)} (\\d+)$`);
  const rank = (p: LobbyPlayer): number => {
    if (p.ai) return -1;
    const name = p.name.toLowerCase();
    if (name === wanted) return 1;
    const m = suffix.exec(name);
    return m ? Number(m[1]) : -1;
  };
  if (previous !== null) {
    const p = players.find((x) => x.playerId === previous);
    if (p && rank(p) > 0) return previous;
  }
  let best: LobbyPlayer | null = null;
  for (const p of players) if (rank(p) > 0 && (best === null || rank(p) > rank(best))) best = p;
  return best?.playerId ?? null;
}

/** The host is the lowest human player id (relay rule). */
export function hostId(players: readonly LobbyPlayer[]): number | null {
  let host: number | null = null;
  for (const p of players) if (!p.ai && (host === null || p.playerId < host)) host = p.playerId;
  return host;
}

export function lobbyRows(players: readonly LobbyPlayer[], youId: number | null): LobbyRow[] {
  const host = hostId(players);
  return [...players]
    .sort((a, b) => a.playerId - b.playerId)
    .map((p) => ({ ...p, you: p.playerId === youId, host: p.playerId === host }));
}

export function lobbyControls(
  rows: readonly LobbyRow[],
  maxPlayers: number,
  link: LobbyLink,
  mode: string | null = null,
): LobbyControls {
  const me = rows.find((r) => r.you) ?? null;
  const isHost = me?.host === true;
  const off = {
    me,
    isHost,
    actionLabel: isHost ? 'Start potje' : 'Klaar',
    actionEnabled: false,
    actionReady: true,
    canAddAi: false,
    canRemoveAi: false,
  };
  if (link !== 'up' || me === null)
    return {
      ...off,
      hint: link === 'down' ? 'Geen verbinding met de relay.' : 'Verbinden met de kamer…',
    };
  const others = rows.filter((r) => !r.you && !r.ai);
  const hasAi = rows.some((r) => r.ai);
  const count = rows.length;
  const base = {
    ...off,
    // Survival co-op has no AI yet (the scripted AI does not know it): no AI slots
    canAddAi: isHost && count < maxPlayers && mode !== 'survival',
    canRemoveAi: isHost && hasAi,
  };
  if (count > maxPlayers)
    return {
      ...base,
      hint: `Deze kaart is voor ${maxPlayers} spelers: er zijn er te veel in de kamer.`,
    };
  if (mode === 'survival' && hasAi)
    return { ...base, hint: 'Survival kent nog geen AI: verwijder de AI uit de kamer.' };
  if (count < 2)
    return {
      ...base,
      hint: isHost
        ? mode === 'survival'
          ? 'Survival co-op: wacht op een tweede speler (alleen spelen kan via Tegen AI).'
          : 'Wacht op een tweede speler, of voeg een AI toe.'
        : 'Wacht op de andere spelers…',
    };
  if (me.ready)
    return {
      ...base,
      actionLabel: 'Niet meer klaar',
      actionEnabled: true,
      actionReady: false,
      hint: isHost ? 'Het potje start zo…' : 'Wachten op de host…',
    };
  if (isHost) {
    const waiting = others.filter((r) => !r.ready).length;
    return {
      ...base,
      actionLabel: 'Start potje',
      actionEnabled: waiting === 0,
      hint:
        waiting === 0
          ? 'Iedereen is klaar. Start het potje.'
          : `Wachten tot iedereen klaar is (${others.length - waiting} van ${others.length}).`,
    };
  }
  return {
    ...base,
    actionLabel: 'Klaar',
    actionEnabled: true,
    hint: 'Kies je factie en druk op Klaar.',
  };
}

/** Dutch text for the relay's error messages (they are short Dutch phrases already; unknown ones pass through). */
export function relayErrorText(message: string): string {
  switch (message) {
    case 'room is vol':
      return 'De kamer is vol.';
    case 'potje is al gestart':
      return 'Dit potje is al gestart.';
    case 'alleen de host mag dit':
      return 'Alleen de host mag dit.';
    case 'vervangen door een nieuwe verbinding':
      return 'Je bent met een andere tab of browser in deze kamer gekomen.';
    default:
      return message;
  }
}
