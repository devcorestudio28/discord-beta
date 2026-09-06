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
let activeServer = null;
let serverChannels = [];

function showApp(user) {
  currentUser = user;
  $('#authScreen').classList.add('hidden');
  $('.app-shell').classList.remove('locked');
  $('.user-copy strong').textContent = user.displayName;
  $('.avatar.me').textContent = user.displayName.slice(0, 2).toUpperCase();
  loadCommunityServers();
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
$('#addServer').addEventListener('click', () => openSettings('server'));
$('#settingsBtn').addEventListener('click', () => openSettings('profile'));
$('#logoutBtn').addEventListener('click', async () => { try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {} showAuth(); });
['micBtn','headsetBtn'].forEach(id => $('#' + id).addEventListener('click', e => { e.currentTarget.classList.toggle('muted'); e.currentTarget.style.color = e.currentTarget.classList.contains('muted') ? '#f23f42' : ''; toast(e.currentTarget.classList.contains('muted') ? 'Isključeno' : 'Uključeno'); }));

checkSession();

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error || 'Dogodila se greška.');
  return data;
}

async function loadCommunityServers() {
  try {
    const servers = await api('/api/servers');
    const root = $('#dynamicServers'); root.innerHTML = '';
    servers.forEach(server => {
      const button = document.createElement('button'); button.className = 'server-pill database-server';
      button.textContent = server.name.split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase(); button.title = server.name;
      button.addEventListener('click', () => selectServer(server, button)); root.appendChild(button);
    });
    if (servers[0]) selectServer(servers[0], root.firstElementChild);
  } catch (error) { toast(error.message); }
}

async function selectServer(server, button) {
  activeServer = server; $$('.server-pill').forEach(x => x.classList.remove('active')); button?.classList.add('active');
  $('#serverName').firstChild.textContent = `${server.name} `;
  try { serverChannels = await api(`/api/servers/${server.id}/channels`); renderChannels(); } catch (error) { toast(error.message); }
}

function renderChannels() {
  const root = $('#dynamicChannels'); root.innerHTML = '';
  [['text', 'TEKSTUALNI KANALI'], ['voice', 'GLASOVNI KANALI']].forEach(([type, title]) => {
    const section = document.createElement('section'); section.className = 'channel-category';
    section.innerHTML = `<div class="category-title"><span>⌄ &nbsp;${title}</span><button title="Dodaj kanal">+</button></div>`;
    $('.category-title button', section).addEventListener('click', () => createChannel(type));
    serverChannels.filter(channel => channel.type === type).forEach(channel => {
      const button = document.createElement('button'); button.className = `channel ${type === 'voice' ? 'voice' : ''}`;
      button.innerHTML = `<span class="${type === 'voice' ? 'speaker' : 'hash'}">${type === 'voice' ? '🔊' : '#'}</span><span></span><span class="channel-icon">⚙</span>`;
      button.children[1].textContent = channel.name;
      button.addEventListener('click', event => { if (event.target.classList.contains('channel-icon')) editChannel(channel); else type === 'voice' ? joinVoice(channel) : selectTextChannel(channel, button); });
      section.appendChild(button);
    }); root.appendChild(section);
  });
  const first = serverChannels.find(channel => channel.type === 'text');
  if (first) selectTextChannel(first, $$('.channel', root).find(x => x.textContent.includes(first.name)));
}

function selectTextChannel(channel, button) {
  activeChannel = `channel-${channel.id}`; $$('.channel').forEach(x => x.classList.remove('active')); button?.classList.add('active');
  $('#channelTitle').textContent = channel.name; $('.channel-topic').textContent = channel.topic || 'Tekstualni kanal';
  $('#messageInput').placeholder = `Pošalji poruku u #${channel.name}`; $('.channel-intro h1').textContent = `Dobro došli u #${channel.name}!`;
  $('.channel-intro p').innerHTML = `Ovo je početak kanala <strong>#${channel.name}</strong>.`; loadSavedMessages(activeChannel);
}

async function createChannel(type) {
  if (!activeServer) return; const name = prompt(`Ime ${type === 'voice' ? 'glasovnog' : 'tekstualnog'} kanala:`); if (!name) return;
  try { const channel = await api(`/api/servers/${activeServer.id}/channels`, { method: 'POST', body: JSON.stringify({ name, type }) }); serverChannels.push(channel); renderChannels(); toast('Kanal je kreiran.'); } catch (error) { toast(error.message); }
}

async function editChannel(channel) {
  const name = prompt('Novo ime kanala:', channel.name); if (!name) return;
  const topic = channel.type === 'text' ? prompt('Opis kanala:', channel.topic || '') ?? channel.topic : '';
  try { const updated = await api(`/api/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ name, topic }) }); Object.assign(channel, updated); renderChannels(); toast('Kanal je uređen.'); } catch (error) { toast(error.message); }
}

const settings = $('#modalBackdrop');
function openSettings(page = 'profile') { settings.classList.add('open'); renderSettings(page); }
function closeSettings() { settings.classList.remove('open'); }
$('#modalClose').addEventListener('click', closeSettings); settings.addEventListener('click', e => { if (e.target === settings) closeSettings(); });
$$('.settings-nav [data-settings]').forEach(button => button.addEventListener('click', () => renderSettings(button.dataset.settings)));
$('#modalLogout').addEventListener('click', () => $('#logoutBtn').click());

function renderSettings(page) {
  $$('.settings-nav button').forEach(x => x.classList.toggle('active', x.dataset.settings === page)); const root = $('#settingsPage');
  if (page === 'profile') root.innerHTML = `<h2>Moj profil</h2><p>Uredi kako te drugi članovi vide.</p><form id="profileForm"><label>KORISNIČKO IME<input id="profileName" value=""></label><label>STATUS<input id="profileStatus" maxlength="100" placeholder="Što trenutno radiš?"></label><button class="primary-btn">Spremi promjene</button></form>`;
  if (page === 'profile') { $('#profileName').value = currentUser.displayName; $('#profileForm').addEventListener('submit', saveProfile); }
  if (page === 'appearance') { root.innerHTML = `<h2>Izgled</h2><p>Prilagodi izgled aplikacije.</p><label>TEMA<select id="themeSelect"><option value="dark">Tamna</option><option value="light">Svijetla</option></select></label><label><input id="compactMode" type="checkbox" style="width:auto;display:inline;height:auto"> Kompaktni prikaz poruka</label>`; $('#themeSelect').value = localStorage.theme || 'dark'; $('#compactMode').checked = document.body.classList.contains('compact'); $('#themeSelect').onchange = applyAppearance; $('#compactMode').onchange = applyAppearance; }
  if (page === 'voice') root.innerHTML = `<h2>Glas i video</h2><p>Odaberi mikrofon i upravljaj glasovnom vezom.</p><button class="secondary-btn" id="testMic">Testiraj mikrofon</button><button class="primary-btn" id="leaveVoice" style="margin-left:8px">Napusti voice kanal</button><p id="voiceDeviceStatus"></p>`;
  if (page === 'voice') { $('#testMic').onclick = testMicrophone; $('#leaveVoice').onclick = leaveVoice; }
  if (page === 'server') renderServerSettings(root);
}

async function saveProfile(event) { event.preventDefault(); try { currentUser = await api('/api/profile', { method:'PATCH', body:JSON.stringify({ displayName: $('#profileName').value, status: $('#profileStatus').value }) }); $('.user-copy strong').textContent = currentUser.displayName; toast('Profil je spremljen.'); closeSettings(); } catch(error) { toast(error.message); } }
function applyAppearance() { const light = $('#themeSelect').value === 'light'; document.querySelector('.app-shell').classList.toggle('theme-light', light); document.body.classList.toggle('compact', $('#compactMode').checked); localStorage.theme = light ? 'light' : 'dark'; localStorage.compact = $('#compactMode').checked; }
async function renderServerSettings(root) { root.innerHTML = `<h2>Server i kanali</h2><form id="createServerForm" class="settings-row"><label>NOVI SERVER<input id="newServerName" placeholder="Ime servera"></label><button class="primary-btn">Kreiraj server</button></form><h3>${activeServer?.name || ''}</h3><button class="secondary-btn" id="renameServer">Promijeni ime servera</button><div id="manageChannels"></div>`; const list=$('#manageChannels'); serverChannels.forEach(c=>{const row=document.createElement('div');row.className='channel-manage';row.innerHTML=`<b>${c.type==='voice'?'🔊':'#'}</b><span></span><button>Uredi</button>`;row.children[1].textContent=c.name;row.lastElementChild.onclick=()=>editChannel(c);list.appendChild(row)}); $('#createServerForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/servers',{method:'POST',body:JSON.stringify({name:$('#newServerName').value})});await loadCommunityServers();renderSettings('server');toast('Server je kreiran.')}catch(error){toast(error.message)}}; $('#renameServer').onclick=renameServer; }
async function renameServer(){const name=prompt('Novo ime servera:',activeServer.name);if(!name)return;try{activeServer=await api(`/api/servers/${activeServer.id}`,{method:'PATCH',body:JSON.stringify({name})});$('#serverName').firstChild.textContent=`${name} `;await loadCommunityServers();toast('Ime servera je promijenjeno.')}catch(error){toast(error.message)}}

if (localStorage.theme === 'light') document.querySelector('.app-shell').classList.add('theme-light');
if (localStorage.compact === 'true') document.body.classList.add('compact');

let voiceRoom = null, localStream = null; const voicePeers = new Map();
const socket = typeof io === 'function' ? io() : null;
async function joinVoice(channel) { try { leaveVoice(); localStream = await navigator.mediaDevices.getUserMedia({ audio:true }); voiceRoom=`${activeServer.id}:${channel.id}`; socket?.emit('voice:join',voiceRoom); toast(`Spojen na ${channel.name}`); const button=$$('.channel.voice').find(x=>x.textContent.includes(channel.name));button?.insertAdjacentHTML('afterend',`<div class="voice-connected" id="voiceIndicator">● Voice spojen <button onclick="leaveVoice()">Prekini</button></div>`); } catch { toast('Dopusti pristup mikrofonu za voice kanal.'); } }
function peer(id, initiator=false){if(voicePeers.has(id))return voicePeers.get(id);const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream));pc.onicecandidate=e=>{if(e.candidate)socket.emit('voice:signal',{target:id,signal:{candidate:e.candidate}})};pc.ontrack=e=>{let audio=document.getElementById(`audio-${id}`);if(!audio){audio=document.createElement('audio');audio.id=`audio-${id}`;audio.autoplay=true;document.body.appendChild(audio)}audio.srcObject=e.streams[0]};voicePeers.set(id,pc);if(initiator)pc.createOffer().then(o=>pc.setLocalDescription(o).then(()=>socket.emit('voice:signal',{target:id,signal:{description:o}})));return pc}
socket?.on('voice:peers',ids=>ids.forEach(id=>peer(id,true)));socket?.on('voice:user-joined',id=>peer(id,true));socket?.on('voice:signal',async({from,signal})=>{const pc=peer(from);if(signal.description){await pc.setRemoteDescription(signal.description);if(signal.description.type==='offer'){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('voice:signal',{target:from,signal:{description:answer}})}}if(signal.candidate)await pc.addIceCandidate(signal.candidate)});socket?.on('voice:user-left',id=>{voicePeers.get(id)?.close();voicePeers.delete(id);document.getElementById(`audio-${id}`)?.remove()});
function leaveVoice(){if(voiceRoom)socket?.emit('voice:leave',voiceRoom);localStream?.getTracks().forEach(t=>t.stop());voicePeers.forEach(p=>p.close());voicePeers.clear();localStream=null;voiceRoom=null;$('#voiceIndicator')?.remove();toast('Voice veza je prekinuta.');}
async function testMicrophone(){try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});$('#voiceDeviceStatus').textContent='✓ Mikrofon radi i dopušten je.';stream.getTracks().forEach(t=>t.stop())}catch{$('#voiceDeviceStatus').textContent='Mikrofon nije dostupan ili nije dopušten.'}}
