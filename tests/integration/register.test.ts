import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/auth/register/route';
import { GET as authMe } from '../../app/api/v1/auth/me/route';
import { ensurePrismaEngineStartupLogs } from '../../src/db/prismaEnv';

ensurePrismaEngineStartupLogs();

const prisma = new PrismaClient();

describe('register integration', () => {
  const email = `register_${Date.now()}@example.com`;
  const previousAccessMode = process.env.ACCESS_MODE;

  beforeAll(async () => {
    process.env.ACCESS_MODE = 'invite';
    await prisma.$connect();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: 'register_' } },
      select: { id: true },
    });
    if (users.length) {
      await prisma.session.deleteMany({
        where: { userId: { in: users.map((user) => user.id) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
    }
    if (previousAccessMode === undefined) {
      delete process.env.ACCESS_MODE;
    } else {
      process.env.ACCESS_MODE = previousAccessMode;
    }
    await prisma.$disconnect();
  });

  it('registers a user and sets a session cookie', async () => {
    const req = new Request('http://localhost/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify({
        email,
        fullName: 'Register User',
        lawFirm: 'Register Firm',
        password: 'test-password',
        confirmPassword: 'test-password',
        agreeToAttorney: true,
        marketingConsent: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.email).toBe(email);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('h1b_session=');
  });

  it('rejects duplicate email registration', async () => {
    const req = new Request('http://localhost/api/v1/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        fullName: 'Register User',
        lawFirm: 'Register Firm',
        password: 'test-password',
        confirmPassword: 'test-password',
        agreeToAttorney: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('registers and can access /auth/me with session cookie', async () => {
    const uniqueEmail = `register_${Date.now()}@example.com`;
    const req = new Request('http://localhost/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({
        email: uniqueEmail,
        fullName: 'Register User',
        lawFirm: 'Register Firm',
        password: 'test-password',
        confirmPassword: 'test-password',
        agreeToAttorney: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    const cookieValue = cookie ? cookie.split(';')[0] : '';

    const meReq = new Request('http://localhost/api/v1/auth/me', {
      headers: { cookie: cookieValue },
    });
    const meRes = await authMe(meReq);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.email).toBe(uniqueEmail);
  });
});
