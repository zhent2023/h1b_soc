"use client";

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from '../page.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Login failed');
      }
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          <p className={styles.subtitle}>Secure access to wage and SOC intelligence.</p>
        </div>
        <section className={styles.loginGrid}>
          <div>
            <h2 className={styles.loginTitle}>Sign in</h2>
            <p className={styles.subtitle}>Use the credentials provided by your administrator.</p>
            <div className={styles.loginMeta}>
              Invite-only access. For help, contact your admin.
            </div>
          </div>
          <div className={`${styles.card} ${styles.loginCard}`}>
            <form onSubmit={onSubmit} className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Email</span>
                <input
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
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
                />
              </label>
              <button
                type="submit"
                className={`${styles.primaryButton} ${styles.fullWidth}`}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              {error ? <span className={styles.error}>{error}</span> : null}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
