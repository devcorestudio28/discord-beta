const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const toast = (text) => { const el = $('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => el.classList.remove('show'), 1800); };

const channelData = {
  general: ['Glavni chat za sve članove zajednice', 'Pošalji poruku u #general'],
  memes: ['Najbolji memeovi na jednom mjestu', 'Pošalji poruku u #memes'],
  showcase: ['Pokaži zajednici na čemu radiš', 'Pošalji poruku u #showcase'],
  'pomoć': ['Pitaj zajednicu za pomoć', 'Pošalji poruku u #pomoć']
};
let activeChannel = 'general';
let currentUser = null;
let authMode = 'register';

function showApp(user) {
  currentUser = user;
  $('#authScreen').classList.add('hidden');
  $('.app-shell').classList.remove('locked');
  $('.user-copy strong').textContent = user.displayName;
  $('.avatar.me').textContent = user.displayName.slice(0, 2).toUpperCase();
  loadSavedMessages(activeChannel);
}

function showAuth() {
  currentUser = null;
  $('#authScreen').classList.remove('hidden');
  $('.app-shell').classList.add('locked');
}

async function checkSession() {
  try {
    const response = await fetch('/api/auth/me');
    if (response.ok) return showApp(await response.json());
  } catch {}
  showAuth();
}

function setAuthMode(mode) {
  authMode = mode;
  const register = mode === 'register';
  $('#displayNameLabel').style.display = register ? 'block' : 'none';
  $('#authDisplayName').required = register;
  $('#authTitle').textContent = register ? 'Kreiraj korisnički račun' : 'Dobro došao natrag!';
  $('#authSubtitle').textContent = register ? 'Registriraj se kako bi pristupio zajednici.' : 'Prijavi se u svoj Chatter račun.';
  $('#authSubmit').textContent = register ? 'Registriraj se' : 'Prijavi se';
  $('#authSwitch').innerHTML = register ? 'Već imaš račun? <span>Prijavi se</span>' : 'Nemaš račun? <span>Registriraj se</span>';
  $('#authPassword').autocomplete = register ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
}

$('#authSwitch').addEventListener('click', () => setAuthMode(authMode === 'register' ? 'login' : 'register'));
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('#authSubmit'); submit.disabled = true; $('#authError').textContent = '';
  const payload = { displayName: $('#authDisplayName').value, email: $('#authEmail').value, password: $('#authPassword').value };
  try {
    const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Pokušaj ponovno.');
    $('#authForm').reset(); showApp(data);
  } catch (error) { $('#authError').textContent = error.message; }
  finally { submit.disabled = false; }
});

async function loadSavedMessages(channel) {
  $$('.message.saved-message').forEach(message => message.remove());
  try {
    const response = await fetch(`/api/messages?channel=${encodeURIComponent(channel)}`);
    if (!response.ok) return;
    const messages = await response.json();
    messages.forEach(message => renderSavedMessage(message));
  } catch {
    // Statički prikaz i dalje radi ako API nije dostupan tijekom lokalnog pregleda.
  }
}

function renderSavedMessage(message) {
  const article = document.createElement('article');
  article.className = 'message saved-message';
  article.dataset.text = message.body.toLowerCase();
  const date = new Date(message.createdAt);
  const time = Number.isNaN(date.getTime()) ? 'Upravo sada' : date.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
  article.innerHTML = `<div class="avatar me">KT</div><div class="message-body"><div><strong class="name"></strong><time></time></div><p></p></div>`;
  $('.name', article).textContent = message.author;
  $('time', article).textContent = time;
  $('.message-body p', article).textContent = message.body;
  $('#messages').appendChild(article);
  return article;
}

$$('.channel[data-channel]').forEach(button => button.addEventListener('click', () => {
  $$('.channel').forEach(x => x.classList.remove('active'));
  button.classList.add('active');
  const name = button.dataset.channel;
  activeChannel = name;
  $('#channelTitle').textContent = name;
  $('.channel-topic').textContent = channelData[name][0];
  $('#messageInput').placeholder = channelData[name][1];
  $('.channel-intro h1').textContent = `Dobro došli u #${name}!`;
  $('.channel-intro p').innerHTML = `Ovo je početak kanala <strong>#${name}</strong>.`;
  loadSavedMessages(name);
  $('#channelsPanel').classList.remove('open');
}));

$$('.server-pill[data-server]').forEach(button => button.addEventListener('click', () => {
  $$('.server-pill').forEach(x => x.classList.remove('active'));
  button.classList.add('active');
  $('#serverName').firstChild.textContent = `${button.dataset.server} `;
  toast(`Otvoren server ${button.dataset.server}`);
}));

$('#messageForm').addEventListener('submit', sendMessage);
$('#messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e); }
});
$('#messageInput').addEventListener('input', e => {
  e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  $('#typing').textContent = e.target.value ? 'ktoma piše…' : '';
});

async function sendMessage(e) {
  e.preventDefault(); const input = $('#messageInput'); const value = input.value.trim(); if (!value) return;
  input.value = ''; input.style.height = 'auto'; $('#typing').textContent = '';
  let message = { author: currentUser?.displayName || 'Korisnik', body: value, createdAt: new Date().toISOString() };
  try {
    const response = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: activeChannel, body: value }) });
    if (response.ok) message = await response.json();
    else toast('Poruka je prikazana, ali nije spremljena u bazu.');
  } catch { toast('Poruka je prikazana, ali server nije dostupan.'); }
  const article = renderSavedMessage(message);
  article.scrollIntoView({behavior:'smooth'});
}

$$('.reaction').forEach(reaction => reaction.addEventListener('click', () => {
  const count = $('b', reaction); const selected = reaction.classList.toggle('selected'); count.textContent = +count.textContent + (selected ? 1 : -1);
}));

$('#searchInput').addEventListener('input', e => { const q = e.target.value.toLowerCase(); $$('.message').forEach(m => m.style.display = !q || m.dataset.text.includes(q) ? 'flex' : 'none'); });
$('#membersToggle').addEventListener('click', () => $('#membersPanel').classList.toggle('open'));
$('#mobileMenu').addEventListener('click', () => $('#channelsPanel').classList.toggle('open'));
$('#addServer').addEventListener('click', () => toast('Dodavanje servera uskoro dolazi!'));
$('#settingsBtn').addEventListener('click', () => toast('Korisničke postavke'));
$('#logoutBtn').addEventListener('click', async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {} showAuth(); });
['micBtn','headsetBtn'].forEach(id => $('#' + id).addEventListener('click', e => { e.currentTarget.classList.toggle('muted'); e.currentTarget.style.color = e.currentTarget.classList.contains('muted') ? '#f23f42' : ''; toast(e.currentTarget.classList.contains('muted') ? 'Isključeno' : 'Uključeno'); }));

checkSession();
