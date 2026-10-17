// The session the HUD and the pointer code talk to, before and after a match starts. The menu comes first, so the
// session does not exist yet when the rest of main.ts is wired; this is a stand-in with the Session shape that does
// nothing (no player, no commands) until `attach` hands it the real session, and forwards everything after that.
import type { Session } from './session.js';

export interface SessionSlot extends Session {
  /** Makes `real` the session behind this slot; the slot's `started` follows the real one. */
  attach(real: Session): void;
  /** The attached session, or null before a match. */
  readonly current: Session | null;
}

export function createSessionSlot(): SessionSlot {
  let real: Session | null = null;
  let resolveStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  return {
    get current() {
      return real;
    },
    get playerId() {
      return real?.playerId ?? -1;
    },
    get faction() {
      return real?.faction ?? null;
    },
    get frame() {
      return real?.frame ?? -1;
    },
    started,
    attach(session) {
      real = session;
      void session.started.then(resolveStarted);
    },
    playerName: (id) => real?.playerName(id) ?? `Speler ${id + 1}`,
    sendCommand: (type, payload) => real?.sendCommand(type, payload),
    lobbyRequest: (request) => real?.lobbyRequest(request),
    requestStatus: () => real?.requestStatus(),
    requestFog: () => real?.requestFog(),
    revealAll: (on) => real?.revealAll(on),
    dispose: () => real?.dispose(),
  };
}
