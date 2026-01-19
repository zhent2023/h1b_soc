import { describe, expect, it } from 'vitest';

import {
  createSessionToken,
  getCookieValue,
  hashSessionToken,
  SESSION_COOKIE_NAME,
} from '../../src/lib/session';

describe('session helpers', () => {
  it('creates hex session tokens', () => {
    const token = createSessionToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('hashes tokens deterministically', () => {
    const first = hashSessionToken('token');
    const second = hashSessionToken('token');
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('reads cookie values and handles decode errors', () => {
    const req = new Request('http://localhost', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=hello%20world; other=1; broken=%E0%A4`,
      },
    });

    expect(getCookieValue(req, SESSION_COOKIE_NAME)).toBe('hello world');
    expect(getCookieValue(req, 'other')).toBe('1');
    expect(getCookieValue(req, 'broken')).toBe('%E0%A4');
  });

  it('returns null when cookie is missing', () => {
    const req = new Request('http://localhost');
    expect(getCookieValue(req, SESSION_COOKIE_NAME)).toBeNull();
  });

  it('ignores malformed cookie segments', () => {
    const req = new Request('http://localhost', {
      headers: {
        cookie: ' ; malformed; foo=bar',
      },
    });

    expect(getCookieValue(req, SESSION_COOKIE_NAME)).toBeNull();
    expect(getCookieValue(req, 'foo')).toBe('bar');
  });
});
