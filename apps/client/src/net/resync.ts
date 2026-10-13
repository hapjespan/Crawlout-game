// Pure resync helpers (no DOM, no worker): base64 of a state dump and the bundle feed that buffers, dedupes and
// orders bundles around a resync. Contract 2, "Reconnect en resync".
import type { FrameBundle } from '@crawlout/protocol';

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

export function base64ToBuffer(text: string): ArrayBuffer {
  const bytes = base64ToBytes(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The relay keeps 1200 frames of history; keeping the same here bounds memory and still covers any resync. */
const KEEP_FRAMES = 1200;

/**
 * Decides which bundles go to the sim worker, in order and exactly once.
 * - live: a pushed bundle is released at once if it directly follows the last released frame; a gap is never
 *   skipped, later bundles wait in the store until the missing one arrives.
 * - paused (during a reconnect, before the state arrives): pushed bundles are only stored.
 * - resume(frame, bundles): the sim was replaced by a state at `frame` (Sim.frame). Everything from `frame` on is
 *   released again, merged from the resync bundles and the stored live bundles, without duplicates.
 */
export class BundleFeed {
  private readonly store = new Map<number, FrameBundle>();
  private lastReleased = -1;
  private paused = false;

  get isPaused(): boolean {
    return this.paused;
  }

  /** Highest frame released to the sim; -1 before the first. */
  get released(): number {
    return this.lastReleased;
  }

  pause(): void {
    this.paused = true;
  }

  push(bundle: FrameBundle): FrameBundle[] {
    if (!this.store.has(bundle.frame)) this.store.set(bundle.frame, bundle);
    return this.paused ? [] : this.drain();
  }

  resume(frame: number, bundles: readonly FrameBundle[]): FrameBundle[] {
    for (const b of bundles) if (!this.store.has(b.frame)) this.store.set(b.frame, b);
    this.lastReleased = frame - 1;
    this.paused = false;
    return this.drain();
  }

  /** Releases only the contiguous run starting at lastReleased + 1; a gap keeps everything behind it stored. */
  private drain(): FrameBundle[] {
    const out: FrameBundle[] = [];
    for (let next = this.lastReleased + 1; ; next++) {
      const bundle = this.store.get(next);
      if (!bundle) break;
      out.push(bundle);
      this.lastReleased = next;
    }
    for (const frame of this.store.keys()) if (frame < this.lastReleased - KEEP_FRAMES) this.store.delete(frame);
    return out;
  }

  /** First frame the feed waits for (undefined = nothing buffered behind a gap). Lets the UI show a stall. */
  get gapAt(): number | undefined {
    const next = this.lastReleased + 1;
    if (this.store.has(next)) return undefined;
    for (const f of this.store.keys()) if (f > next) return next;
    return undefined;
  }
}
