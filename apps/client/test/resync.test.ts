import { describe, expect, it } from 'vitest';
import type { FrameBundle } from '@crawlout/protocol';
import { BundleFeed, base64ToBuffer, bufferToBase64 } from '../src/net/resync.js';

const b = (frame: number): FrameBundle => ({ frame, commands: [] });
const frames = (list: FrameBundle[]): number[] => list.map((x) => x.frame);

describe('base64 roundtrip', () => {
  it('keeps every byte, also for buffers larger than one chunk', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const back = new Uint8Array(base64ToBuffer(bufferToBase64(bytes.buffer)));
    expect(back.length).toBe(bytes.length);
    expect(back.every((v, i) => v === bytes[i])).toBe(true);
  });

  it('handles the empty buffer', () => {
    expect(base64ToBuffer(bufferToBase64(new ArrayBuffer(0))).byteLength).toBe(0);
  });
});

describe('BundleFeed', () => {
  it('releases live bundles once and in order', () => {
    const feed = new BundleFeed();
    expect(frames(feed.push(b(0)))).toEqual([0]);
    expect(frames(feed.push(b(1)))).toEqual([1]);
    expect(feed.push(b(1))).toEqual([]);
    expect(feed.push(b(0))).toEqual([]);
  });

  it('never skips a gap: later bundles wait until the missing frame arrives', () => {
    const feed = new BundleFeed();
    expect(frames(feed.push(b(0)))).toEqual([0]);
    expect(feed.push(b(2))).toEqual([]);
    expect(feed.push(b(3))).toEqual([]);
    expect(feed.gapAt).toBe(1);
    expect(feed.released).toBe(0);
    expect(frames(feed.push(b(1)))).toEqual([1, 2, 3]);
    expect(feed.gapAt).toBeUndefined();
    expect(frames(feed.push(b(4)))).toEqual([4]);
  });

  it('keeps a gap after resume: only the contiguous part is released', () => {
    const feed = new BundleFeed();
    feed.pause();
    feed.push(b(7));
    expect(frames(feed.resume(3, [b(3), b(4), b(6)]))).toEqual([3, 4]);
    expect(frames(feed.push(b(5)))).toEqual([5, 6, 7]);
  });

  it('holds live bundles while paused and merges them with the resync bundles on resume', () => {
    const feed = new BundleFeed();
    feed.push(b(0));
    feed.push(b(1));
    feed.pause();
    expect(feed.push(b(5))).toEqual([]);
    expect(feed.push(b(6))).toEqual([]);
    // state at frame 3; the relay history covers 3..5 (5 overlaps with the live ones)
    expect(frames(feed.resume(3, [b(3), b(4), b(5)]))).toEqual([3, 4, 5, 6]);
    expect(frames(feed.push(b(7)))).toEqual([7]);
    expect(feed.push(b(6))).toEqual([]);
  });

  it('does not release bundles older than the loaded state', () => {
    const feed = new BundleFeed();
    for (let f = 0; f < 10; f++) feed.push(b(f));
    // a reloaded tab: state at frame 6 replaces the sim; frames 6..9 must be re-released, 0..5 not
    expect(frames(feed.resume(6, [b(6), b(7)]))).toEqual([6, 7, 8, 9]);
  });

  it('a duplicate resync bundle does not replace the stored one', () => {
    const feed = new BundleFeed();
    const first: FrameBundle = { frame: 2, commands: [] };
    feed.pause();
    feed.push(first);
    const out = feed.resume(2, [{ frame: 2, commands: [] }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(first);
  });

  it('prunes old history', () => {
    const feed = new BundleFeed();
    for (let f = 0; f < 3000; f++) feed.push(b(f));
    expect(frames(feed.resume(2990, [])).length).toBe(10);
  });
});
