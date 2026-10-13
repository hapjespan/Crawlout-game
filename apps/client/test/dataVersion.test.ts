import { describe, expect, it } from 'vitest';
import { readDataVersion } from '@crawlout/relay/server';
import { dataVersionError } from '../src/net/dataVersion.js';

describe('dataVersion over ws', () => {
  it('accepts an equal version', () => {
    expect(dataVersionError('0.6.0', '0.6.0')).toBeNull();
  });

  it('has no exception for 0: an unconfigured relay is an error too', () => {
    expect(dataVersionError('0', '0.6.0')).toContain('data 0');
  });

  it('names both versions on a mismatch', () => {
    const text = dataVersionError('0.5.0', '0.6.0');
    expect(text).toContain('0.5.0');
    expect(text).toContain('0.6.0');
  });

  it('pnpm relay reads data/VERSION', () => {
    expect(readDataVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
