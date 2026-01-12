import { describe, expect, it } from 'vitest';

import { parseRegisterBody } from '../../src/lib/authRegister';

describe('parseRegisterBody', () => {
  it('accepts valid registration payloads', () => {
    const result = parseRegisterBody({
      email: 'Test@Example.com',
      password: 'secret',
      confirmPassword: 'secret',
      fullName: 'Test User',
      lawFirm: 'Test Firm',
      agreeToAttorney: true,
      marketingConsent: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.fullName).toBe('Test User');
      expect(result.data.marketingConsent).toBe(true);
    }
  });

  it('rejects missing required fields', () => {
    const result = parseRegisterBody({
      email: '',
      password: 'secret',
      confirmPassword: 'secret',
      fullName: '',
      lawFirm: '',
      agreeToAttorney: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('required');
    }
  });

  it('rejects mismatched passwords', () => {
    const result = parseRegisterBody({
      email: 'test@example.com',
      password: 'secret',
      confirmPassword: 'different',
      fullName: 'Test User',
      lawFirm: 'Test Firm',
      agreeToAttorney: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Passwords');
    }
  });

  it('rejects missing attorney confirmation', () => {
    const result = parseRegisterBody({
      email: 'test@example.com',
      password: 'secret',
      confirmPassword: 'secret',
      fullName: 'Test User',
      lawFirm: 'Test Firm',
      agreeToAttorney: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('licensed attorney');
    }
  });
});
