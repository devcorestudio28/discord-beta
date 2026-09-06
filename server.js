const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const app = express();
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.MYSQL_URL;
let pool = null;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname, { extensions: ['html'] }));

async function initializeDatabase() {
  if (!databaseUrl) {
    console.warn('MYSQL_URL nije postavljen; aplikacija radi bez trajnog spremanja poruka.');
    return;
  }

  pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 8,
    enableKeepAlive: true,
    waitForConnections: true,
    queueLimit: 0
  });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      display_name VARCHAR(32) NOT NULL,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      PRIMARY KEY (token_hash),
      INDEX idx_sessions_expiry (expires_at),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      channel VARCHAR(64) NOT NULL DEFAULT 'general',
      author VARCHAR(64) NOT NULL,
      body TEXT NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_channel_created (channel, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [userIdColumn] = await pool.execute("SHOW COLUMNS FROM messages LIKE 'user_id'");
  if (!userIdColumn.length) await pool.execute('ALTER TABLE messages ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER body');
  console.log('MySQL je spojen i tablica messages je spremna.');
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  const match = cookies.find(cookie => cookie.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : null;
}

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hashToken(token), userId, expires]);
  res.cookie('chatter_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', expires, path: '/' });
}

async function requireAuth(req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Baza nije konfigurirana.' });
  const token = cookieValue(req, 'chatter_session');
  if (!token) return res.status(401).json({ error: 'Prijava je obavezna.' });
  const [rows] = await pool.execute(
    'SELECT u.id, u.display_name AS displayName, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW()',
    [hashToken(token)]
  );
  if (!rows[0]) return res.status(401).json({ error: 'Sesija je istekla.' });
  req.user = rows[0];
  req.sessionTokenHash = hashToken(token);
  next();
}

app.get('/api/health', async (_req, res) => {
  if (!pool) return res.status(200).json({ status: 'ok', database: 'not_configured' });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Baza nije konfigurirana.' });
  const displayName = String(req.body.displayName || '').trim().slice(0, 32);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 255);
  const password = String(req.body.password || '');
  if (displayName.length < 2) return res.status(400).json({ error: 'Korisničko ime mora imati najmanje 2 znaka.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Unesi ispravnu e-mail adresu.' });
  if (password.length < 8) return res.status(400).json({ error: 'Lozinka mora imati najmanje 8 znakova.' });
  try {
    const passwordHash = await hashPassword(password);
    const [result] = await pool.execute('INSERT INTO users (display_name, email, password_hash) VALUES (?, ?, ?)', [displayName, email, passwordHash]);
    await createSession(res, result.insertId);
    res.status(201).json({ id: result.insertId, displayName, email });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Račun s ovim e-mailom već postoji.' });
    console.error('Registracija nije uspjela:', error.message);
    res.status(500).json({ error: 'Registracija trenutno nije dostupna.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Baza nije konfigurirana.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.execute('SELECT id, display_name AS displayName, email, password_hash AS passwordHash FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user || !(await verifyPassword(String(req.body.password || ''), user.passwordHash))) return res.status(401).json({ error: 'Pogrešan e-mail ili lozinka.' });
  await createSession(res, user.id);
  res.json({ id: user.id, displayName: user.displayName, email: user.email });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));
app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [req.sessionTokenHash]);
  res.clearCookie('chatter_session', { path: '/' });
  res.status(204).end();
});

app.get('/api/messages', requireAuth, async (req, res) => {
  if (!pool) return res.json([]);
  const channel = String(req.query.channel || 'general').slice(0, 64);
  try {
    const [rows] = await pool.execute(
      'SELECT id, channel, author, body, created_at AS createdAt FROM messages WHERE channel = ? ORDER BY created_at ASC LIMIT 100',
      [channel]
    );
    res.json(rows);
  } catch (error) {
    console.error('Čitanje poruka nije uspjelo:', error.message);
    res.status(500).json({ error: 'Poruke trenutno nisu dostupne.' });
  }
});

app.post('/api/messages', requireAuth, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Baza nije konfigurirana.' });
  const channel = String(req.body.channel || 'general').trim().slice(0, 64);
  const author = req.user.displayName;
  const body = String(req.body.body || '').trim().slice(0, 4000);
  if (!channel || !author || !body) return res.status(400).json({ error: 'Poruka nije ispravna.' });

  try {
    const [result] = await pool.execute(
      'INSERT INTO messages (channel, author, body, user_id) VALUES (?, ?, ?, ?)',
      [channel, author, body, req.user.id]
    );
    const [rows] = await pool.execute(
      'SELECT id, channel, author, body, created_at AS createdAt FROM messages WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Spremanje poruke nije uspjelo:', error.message);
    res.status(500).json({ error: 'Poruka nije spremljena.' });
  }
});

app.get('*splat', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

initializeDatabase()
  .then(() => app.listen(port, '0.0.0.0', () => console.log(`Chatter sluša na portu ${port}.`)))
  .catch(error => {
    console.error('Pokretanje baze nije uspjelo:', error.message);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  if (pool) await pool.end();
  process.exit(0);
});
