"use client";

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from '../page.module.css';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [lawFirm, setLawFirm] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToAttorney, setAgreeToAttorney] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (!active) return;
        if (res.ok) {
          router.replace('/');
        }
      } catch {
        if (!active) return;
      }
    };
    checkAuth();
    return () => {
      active = false;
    };
  }, [router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!agreeToAttorney) {
      setError('Please confirm you are a licensed attorney or professional.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          fullName,
          lawFirm,
          password,
          confirmPassword,
          agreeToAttorney,
          marketingConsent,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Registration failed');
      }
      const welcomeName = fullName.trim();
      if (welcomeName) {
        sessionStorage.setItem('welcomeName', welcomeName);
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden="true">
        <div className={`${styles.orb} ${styles.orbPrimary}`} />
        <div className={`${styles.orb} ${styles.orbSecondary}`} />
        <div className={`${styles.orb} ${styles.orbAccent}`} />
      </div>
      <div className={styles.container}>
        <div className={styles.brand}>
          <h1 className={styles.title}>H1B SOC</h1>
          <p className={styles.subtitle}>
            Create an account to access wage and SOC intelligence for attorneys.
          </p>
        </div>
        <section className={styles.loginGrid}>
          <div>
            <h2 className={styles.loginTitle}>Create account</h2>
            <p className={styles.subtitle}>
              This tool is designed for licensed attorneys and immigration professionals.
            </p>
            <div className={styles.loginMeta}>
              Already have an account?{' '}
              <a className={styles.link} href="/login">
                Sign in
              </a>
              .
            </div>
          </div>
          <div className={`${styles.card} ${styles.loginCard}`}>
            <form onSubmit={onSubmit} className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Work Email</span>
                <input
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  data-testid="register-email"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Full Name</span>
                <input
                  className={styles.input}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  data-testid="register-name"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Law Firm</span>
                <input
                  className={styles.input}
                  value={lawFirm}
                  onChange={(event) => setLawFirm(event.target.value)}
                  required
                  data-testid="register-firm"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Password</span>
                <input
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  data-testid="register-password"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Confirm Password</span>
                <input
                  className={styles.input}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  data-testid="register-confirm"
                />
              </label>
              <label className={styles.checkboxRow}>
                <input
                  className={styles.checkboxInput}
                  type="checkbox"
                  checked={agreeToAttorney}
                  onChange={(event) => setAgreeToAttorney(event.target.checked)}
                  required
                  data-testid="register-attorney"
                />
                <span className={styles.checkboxText}>
                  I confirm I am a licensed attorney or immigration professional.
                </span>
              </label>
              <label className={styles.checkboxRow}>
                <input
                  className={styles.checkboxInput}
                  type="checkbox"
                  checked={marketingConsent}
                  onChange={(event) => setMarketingConsent(event.target.checked)}
                  data-testid="register-marketing"
                />
                <span className={styles.checkboxText}>
                  I agree to receive product updates and announcements (unsubscribe anytime).
                </span>
              </label>
              <button
                type="submit"
                className={`${styles.primaryButton} ${styles.fullWidth}`}
                data-testid="register-submit"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
              {error ? <span className={styles.error}>{error}</span> : null}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
