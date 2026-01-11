"use client";

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
      <h1>Sign In</h1>
      <p>Use the credentials provided by your administrator.</p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label>
          Email
          <input
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit" style={{ padding: '10px 14px', cursor: 'pointer' }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        {error ? <span style={{ color: '#b91c1c' }}>{error}</span> : null}
      </form>
    </main>
  );
}
