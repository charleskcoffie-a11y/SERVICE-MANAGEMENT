import crypto from 'node:crypto';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.AUTH_SERVER_PORT || 8787);
const adminPassword = process.env.ADMIN_PASSWORD || 'church-admin';
const sessionMaxAgeMs = 1000 * 60 * 60 * 12;

const sessions = new Map<string, number>();

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

function isSessionValid(token: string | null): boolean {
  if (!token) return false;

  const expiry = sessions.get(token);
  if (!expiry) return false;

  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }

  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of sessions.entries()) {
    if (expiry < now) {
      sessions.delete(token);
    }
  }
}, 5 * 60 * 1000);

app.get('/api/admin/session', (req, res) => {
  const token = parseCookie(req.headers.cookie, 'church_admin_session');
  res.json({ authenticated: isSessionValid(token) });
});

app.post('/api/admin/login', (req, res) => {
  const candidate = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!candidate) {
    res.status(400).json({ message: 'Password is required.' });
    return;
  }

  const expectedBuffer = Buffer.from(adminPassword);
  const candidateBuffer = Buffer.from(candidate);

  if (
    expectedBuffer.length !== candidateBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, candidateBuffer)
  ) {
    res.status(401).json({ message: 'Invalid admin password.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + sessionMaxAgeMs);
  setSessionCookie(res, token);

  res.json({ ok: true });
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
