import crypto from 'node:crypto';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.AUTH_SERVER_PORT || 8787);
const masterAdminPassword = process.env.MASTER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'church-admin';
const societyPasswordConfig = parseSocietyPasswordConfig(process.env.SOCIETY_ADMIN_PASSWORDS);
const sessionMaxAgeMs = 1000 * 60 * 60 * 12;

type AdminRole = 'master' | 'society';

interface SessionRecord {
  expiry: number;
  role: AdminRole;
  society: string | null;
}

const sessions = new Map<string, SessionRecord>();

app.use(express.json());

function parseCookie(cookieHeader: string | undefined, key: string): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === key) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

function parseSocietyPasswordConfig(rawValue: string | undefined): Record<string, string> {
  if (!rawValue) return {};

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([society, password]) => [society.trim(), String(password ?? '').trim()] as const)
        .filter(([society, password]) => society.length > 0 && password.length > 0)
    );
  } catch {
    return {};
  }
}

function normalizeSocietyName(value: string): string {
  return value.trim().toLowerCase();
}

function findSocietyName(input: string): string | null {
  const normalizedInput = normalizeSocietyName(input);
  for (const society of Object.keys(societyPasswordConfig)) {
    if (normalizeSocietyName(society) === normalizedInput) {
      return society;
    }
  }

  return null;
}

function setSessionCookie(res: express.Response, token: string) {
  const maxAgeSeconds = Math.floor(sessionMaxAgeMs / 1000);
  res.setHeader(
    'Set-Cookie',
    `church_admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

function clearSessionCookie(res: express.Response) {
  res.setHeader(
    'Set-Cookie',
    'church_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'
  );
}

function getSession(token: string | null): SessionRecord | null {
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiry) {
    sessions.delete(token);
    return null;
  }

  return session;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiry < now) {
      sessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

app.get('/api/admin/session', (req, res) => {
  const token = parseCookie(req.headers.cookie, 'church_admin_session');
  const session = getSession(token);
  res.json({
    authenticated: Boolean(session),
    role: session?.role ?? null,
    society: session?.society ?? null,
  });
});

app.get('/api/admin/societies', (_req, res) => {
  res.json({
    societies: Object.keys(societyPasswordConfig),
  });
});

app.post('/api/admin/login', (req, res) => {
  const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
  const requestedSociety = typeof req.body?.society === 'string' ? req.body.society : '';

  if (!candidate) {
    res.status(400).json({ message: 'Password is required.' });
    return;
  }

  const masterExpectedBuffer = Buffer.from(masterAdminPassword);
  const candidateBuffer = Buffer.from(candidate);

  if (
    masterExpectedBuffer.length === candidateBuffer.length &&
    crypto.timingSafeEqual(masterExpectedBuffer, candidateBuffer)
  ) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expiry: Date.now() + sessionMaxAgeMs, role: 'master', society: null });
    setSessionCookie(res, token);
    res.json({ ok: true, role: 'master', society: null });
    return;
  }

  const societyName = requestedSociety ? findSocietyName(requestedSociety) : null;
  if (!societyName) {
    res.status(400).json({ message: 'Select a society before signing in.' });
    return;
  }

  const societyExpectedPassword = societyPasswordConfig[societyName];
  const societyExpectedBuffer = Buffer.from(societyExpectedPassword);

  if (
    societyExpectedBuffer.length !== candidateBuffer.length ||
    !crypto.timingSafeEqual(societyExpectedBuffer, candidateBuffer)
  ) {
    res.status(401).json({ message: `Invalid password for ${societyName}.` });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiry: Date.now() + sessionMaxAgeMs, role: 'society', society: societyName });
  setSessionCookie(res, token);

  res.json({ ok: true, role: 'society', society: societyName });
});

app.post('/api/admin/logout', (req, res) => {
  const token = parseCookie(req.headers.cookie, 'church_admin_session');
  if (token) {
    sessions.delete(token);
  }

  clearSessionCookie(res);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Admin auth server listening on http://localhost:${port}`);
});
