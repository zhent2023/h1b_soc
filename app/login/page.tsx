"use client";

import { useEffect, useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const storedEmail = localStorage.getItem('accessEmail') ?? '';
    const storedKey = localStorage.getItem('accessKey') ?? '';
    setEmail(storedEmail);
    setAccessKey(storedKey);
  }, []);

  const onSave = () => {
    localStorage.setItem('accessEmail', email.trim());
    localStorage.setItem('accessKey', accessKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 16px' }}>
      <h1>Access Login</h1>
      <p>Enter your invite credentials to continue.</p>
      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label>
          Email
          <input
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Access Key
          <input
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 6 }}
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={onSave}
          style={{ padding: '10px 14px', cursor: 'pointer' }}
        >
          Save
        </button>
        {saved ? <span>Saved.</span> : null}
      </div>
    </main>
  );
}
