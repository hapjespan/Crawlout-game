// The relay reports the data version it plays in `start`; a client with other data would desync silently.

/** Dutch error text when relay and client disagree on the data version, else null. */
export function dataVersionError(relayVersion: string, clientVersion: string): string | null {
  if (relayVersion === clientVersion) return null;
  return `Deze relay speelt met data ${relayVersion}, jouw client heeft data ${clientVersion}. Ververs de pagina of werk de client bij.`;
}
