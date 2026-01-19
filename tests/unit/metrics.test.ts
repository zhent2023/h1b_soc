import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logMetric } from '../../src/lib/metrics';

describe('logMetric', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('logs a JSON payload with metric name and value', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    logMetric('test_metric', 1.23, { tag: 'value' });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(payload.metric).toBe('test_metric');
    expect(payload.value).toBe(1.23);
    expect(payload.tag).toBe('value');
    expect(payload.ts).toBeTypeOf('string');
    spy.mockRestore();
  });
});
