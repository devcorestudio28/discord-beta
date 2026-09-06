const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

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
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      channel VARCHAR(64) NOT NULL DEFAULT 'general',
      author VARCHAR(64) NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_channel_created (channel, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('MySQL je spojen i tablica messages je spremna.');
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

app.get('/api/messages', async (req, res) => {
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

app.post('/api/messages', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Baza nije konfigurirana.' });
  const channel = String(req.body.channel || 'general').trim().slice(0, 64);
  const author = String(req.body.author || 'ktoma').trim().slice(0, 64);
  const body = String(req.body.body || '').trim().slice(0, 4000);
  if (!channel || !author || !body) return res.status(400).json({ error: 'Poruka nije ispravna.' });

  try {
    const [result] = await pool.execute(
      'INSERT INTO messages (channel, author, body) VALUES (?, ?, ?)',
      [channel, author, body]
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
