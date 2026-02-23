import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../src/lib/utils/RetryUtils';

describe('IPFS Retry Unit Tests (STEEL)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should succeed after 2 failures (3rd call success)', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('IPFS_TIMEOUT'))
      .mockRejectedValueOnce(new Error('IPFS_TIMEOUT'))
      .mockResolvedValue('manifest_data');
    
    const promise = withRetry(fetcher, { retries: 3, backoffMs: 100 });
    
    // Resolve all retries by advancing timers
    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }
    
    const result = await promise;
    expect(result).toBe('manifest_data');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('should throw after all retries fail', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('PERMANENT_FAILURE'));
    const promise = withRetry(fetcher, { retries: 2, backoffMs: 100 });

    for (let i = 0; i < 3; i++) {
      await vi.runAllTimersAsync();
    }

    await expect(promise).rejects.toThrow('PERMANENT_FAILURE');
    expect(fetcher).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
