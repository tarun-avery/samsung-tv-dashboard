'use strict';
const byId = (id) => document.getElementById(id);
const stored = (key) => {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch (_) { return null; }
};
const persist = (key, value) => {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch (_) {}
};
let phone = stored('watchlist-phone');
let pending = stored('watchlist-draft');
let tracker = null;

function notice(text, error = false) {
  const status = byId('status');
  status.classList.toggle('error', error);
  status.textContent = text;
}
function screens() {
  if (phone && Date.now() >= phone.expiresAt * 1000) phone = null;
  persist('watchlist-phone', phone);
  byId('pairing').hidden = Boolean(phone);
  byId('composer').hidden = !phone;
}
async function request(path, data, auth) {
  const headers = {'Content-Type': 'application/json'};
  if (auth) headers.Authorization = 'Bearer ' + auth;
  let response;
  try {
    response = await fetch(path, {method: data ? 'POST' : 'GET', headers, body: data ? JSON.stringify(data) : undefined, cache:'no-store'});
  } catch (_) {
    throw new Error('Cannot reach the Mac. Check that both devices are on the same Wi-Fi, then retry.');
  }
  let result;
  try { result = await response.json(); } catch (_) { throw new Error('The Mac returned an unreadable response. Please retry.'); }
  if (!response.ok) {
    if (auth && response.status === 401) { phone = null; screens(); }
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}
async function pair(body) {
  const button = byId('code-form').querySelector('button');
  button.disabled = true;
  try {
    phone = await request('/api/join', body);
    pending = null;
    persist('watchlist-draft', null);
    screens();
    notice('Connected. Titles you add will be collected by this TV.');
  } catch (err) {
    notice(err.message, true);
  } finally {
    button.disabled = false;
  }
}
function fields() {
  const series = byId('title-form').elements.kind.value === 'series';
  document.querySelectorAll('.series-field').forEach((el) => {
    el.hidden = !series;
    el.querySelector('input').disabled = !series;
  });
  byId('runtime-label').textContent = series ? 'Episode time' : 'Running time';
}
function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const octets = Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
  return [octets.slice(0,8), octets.slice(8,12), octets.slice(12,16), octets.slice(16,20), octets.slice(20)].join('-');
}
byId('code-form').addEventListener('submit', (event) => {
  event.preventDefault();
  pair({code:byId('code').value.trim()});
});
byId('title-form').addEventListener('change', fields);
byId('title-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  if (!phone || button.disabled) return;
  if (tracker) { clearTimeout(tracker); tracker = null; }
  const item = {title:byId('title').value.trim(), kind:form.elements.kind.value,
    minutes:Number(byId('minutes').value), service:byId('service').value,
    season:Number(byId('season').value), episode:Number(byId('episode').value)};
  if (!pending || JSON.stringify(item) !== JSON.stringify(pending.item)) {
    pending = {id:makeId(), item};
    persist('watchlist-draft', pending);
  }
  button.disabled = true;
  try {
    const result = await request('/api/items', {...item, id:pending.id}, phone.phoneToken);
    pending = null;
    persist('watchlist-draft', null);
    notice(result.state === 'saved' ? 'Saved on your TV: ' + item.title : 'Queued for your TV: ' + item.title + '. Keep Add from phone open on the TV to collect it.');
    if (result.state === 'queued') track(result.id, item.title, 30);
    form.reset();
    fields();
  } catch (err) {
    notice(err.message, true);
  } finally {
    button.disabled = false;
  }
});
function track(id, title, remaining) {
  tracker = setTimeout(async () => {
    if (!phone) return;
    try {
      const reply = await request('/api/items/' + id, null, phone.phoneToken);
      if (reply.state === 'saved') { notice('Saved on your TV: ' + title); return; }
      if (remaining > 1) track(id, title, remaining - 1);
    } catch (_) { /* The accepted title stays queued while the devices reconnect. */ }
  }, 2500);
}
const join = new URLSearchParams(location.hash.slice(1)).get('join');
if (location.hash) history.replaceState(null, '', location.pathname);
screens();
if (join) pair({joinToken:join});
if (pending && phone) {
  const values = pending.item;
  Object.keys(values).forEach((key) => { if (byId('title-form').elements[key]) byId('title-form').elements[key].value = values[key]; });
  fields();
  notice('Your last submission was interrupted. Retry to check or resend the same title.');
}
