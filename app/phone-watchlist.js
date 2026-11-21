// The companion generates each QR offline and queues submissions until this TV confirms a save.
function createPhoneWatchlist(store, library, ui) {
  'use strict';
  var key = 'dashboard.phonePair.v1';
  var helper = '', token = '', receipts = [], pair = null, request = null, timer = null;
  var page = 'setup', revision = 0, message = '', lastTitle = '', lastCount = 0;
  var input = document.getElementById('guide-value');
  var title = document.getElementById('panel-title');
  var note = document.getElementById('panel-note');
  var apps = {
    'Netflix':['org.tizen.netflix-app','Netflix'],
    'Paramount+':['rJyOSqC6Up.PPlusIntl','Paramount+','Paramount Plus'],
    'Crunchyroll':['OGLLvqej7u.CrunchyrollWebApp','Crunchyroll'],
    'Prime Video':['evKhCgZelL.AmazonIgnitionLauncher2','Prime Video','Amazon Prime Video','Amazon Video'],
    'Apple TV':['Y6A54cEa22.AppleTV','Apple TV','Apple TV+'],
    'Disney+':['MCmYXNxgcu.DisneyPlus','Disney+','Disney Plus']
  };

  function origin(value) {
    var match = /^(?:(https?):\/\/)?([a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(String(value || '').trim());
    if (!match || (match[3] && (+match[3] < 1 || +match[3] > 65535))) { return ''; }
    var port = match[3] || (match[1] ? '' : '47831');
    return (match[1] || 'http').toLowerCase()+'://'+match[2].toLowerCase()+(port ? ':'+port : '');
  }

  function readPair() {
    var saved;
    try { saved = JSON.parse(window.localStorage.getItem(key)); } catch (ignored) {}
    saved = saved || {};
    helper = origin(ui.host || saved.origin);
    token = helper && helper === saved.origin && typeof saved.tvToken === 'string' ? saved.tvToken : '';
    receipts = token && Array.isArray(saved.receipts) ? saved.receipts : [];
  }

  function savePair() {
    window.localStorage.setItem(key, JSON.stringify({origin:helper,tvToken:token,receipts:receipts}));
  }

  function stop() {
    revision++;
    clearTimeout(timer);
    timer = null;
    if (request) { request.abort(); request = null; }
    pair = null;
  }

  function current(id) { return revision === id && ui.active(); }

  function json(method, path, payload, callback) {
    var id = revision, xhr = new XMLHttpRequest(), finished = false;
    request = xhr;
    function done(code, result) {
      if (finished) { return; }
      finished = true;
      if (request === xhr) { request = null; }
      if (current(id)) { callback(code, result); }
    }
    try {
      xhr.open(method,helper+path,true);
      xhr.timeout = 8000;
      if (token) { xhr.setRequestHeader('Authorization','Bearer '+token); }
      if (payload) { xhr.setRequestHeader('Content-Type','application/json'); }
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (ignored) {}
        done(xhr.status,data);
      };
      xhr.onerror = xhr.ontimeout = function () { done(0,null); };
      xhr.send(payload ? JSON.stringify(payload) : null);
    } catch (error) { done(0,null); }
  }

  function span(parent, tag, cls, value) {
    var child = document.createElement(tag);
    child.className = cls;
    child.textContent = value;
    parent.appendChild(child);
    return child;
  }

  function status(text) {
    message = text;
    var el = document.getElementById('phone-pairing-status');
    if (el) { el.textContent = message; }
  }

  function connectedCard() {
    ui.note(' ');
    note.textContent = '';
    var card = span(note,'span','phone-pairing-card','');
    if (pair.expiresAt*1000 > Date.now()) {
      if (pair.qrDataUrl) {
        var image = document.createElement('img');
        image.className = 'phone-pairing-qr'; image.width = 160; image.height = 160;
        image.alt = 'Scan to add a title'; image.src = pair.qrDataUrl;
        card.appendChild(image);
      }
      var copy = span(card,'span','phone-pairing-copy','');
      span(copy,'span','phone-pairing-prompt','Scan with a phone on the same Wi-Fi, or open ');
      span(copy,'span','phone-pairing-address',pair.phoneBaseUrl);
      span(copy,'span','phone-pairing-prompt',' and enter code ');
      span(copy,'strong','phone-pairing-code',pair.phoneCode);
    } else {
      span(card,'span','phone-pairing-copy','This code expired. Choose New phone code to pair again.');
    }
    span(note,'span','phone-pairing-status',message).id = 'phone-pairing-status';
  }

  function render(position) {
    ui.clear();
    title.textContent = 'Add from phone';
    input.hidden = true;
    if (page === 'setup') {
      ui.note(message || 'Start the watchlist companion on your Mac. Enter the address it shows.');
      input.type = 'text'; input.maxLength = 180;
      input.setAttribute('aria-label','Mac companion address');
      input.value = helper; input.hidden = false;
      ui.option('Connect to Mac',connectInput);
    } else if (page === 'connecting') {
      ui.note('Connecting to the watchlist companion…');
    } else if (page === 'ready') {
      connectedCard();
      ui.option('New phone code',connect);
    } else {
      ui.note(message);
      ui.option('Try again',connect);
    }
    if (page !== 'setup' && page !== 'connecting' && !ui.host) {
      ui.option('Change Mac address',function () {
        stop(); page = 'setup'; message = ''; render(0);
      });
    }
    ui.option('Back',back);
    ui.focus(position || 0);
    if (page === 'setup') { input.focus(); input.select(); }
  }

  function fail(text) {
    stop(); page = 'error'; message = text; render(0);
  }

  function connectInput() {
    var target = origin(input.value);
    if (!target) { ui.note('Enter the Mac address shown by the companion, including its port.'); input.focus(); return; }
    if (target !== helper) { token = ''; receipts = []; }
    helper = target;
    connect();
  }

  function connect() {
    stop(); page = 'connecting'; message = ''; render(0);
    json('POST','/api/pair',{},function (code, data) {
      if ((code === 401 || code === 403) && token) {
        token = ''; receipts = []; connect(); return;
      }
      if (code !== 201 || !data || typeof data.tvToken !== 'string' || !data.tvToken ||
          !/^\d{8}$/.test(data.phoneCode) || !origin(data.phoneBaseUrl) ||
          typeof data.expiresAt !== 'number' || data.expiresAt*1000 <= Date.now()) {
        fail('Could not pair with the Mac. Check the companion address and keep the companion running on the same network.');
        return;
      }
      token = data.tvToken;
      try { savePair(); } catch (error) { fail('Could not save this TV’s connection. Check the available storage and retry.'); return; }
      pair = {expiresAt:data.expiresAt,phoneCode:String(data.phoneCode),phoneBaseUrl:data.phoneBaseUrl};
      if (typeof data.qrDataUrl === 'string' && data.qrDataUrl.length < 400000 &&
          /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(data.qrDataUrl)) { pair.qrDataUrl = data.qrDataUrl; }
      page = 'ready'; message = 'Keep this screen open to receive titles.'; render(0);
      poll();
    });
  }

  function later(delay) {
    var id = revision;
    timer = setTimeout(function () { if (current(id)) { poll(); } },delay);
  }

  function service(name, installed) {
    if (!Object.prototype.hasOwnProperty.call(apps,name)) { return null; }
    var names = apps[name];
    for (var i = 0; i < installed.length; i++) {
      var item = installed[i];
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name) { continue; }
      if (item.id === names[0] || names.slice(1).some(function (alias) {
        return alias.toLowerCase() === item.name.trim().toLowerCase();
      })) { return {id:item.id,name:item.name}; }
    }
    return null;
  }

  function whole(value) { return typeof value === 'number' && value === Math.floor(value) && value >= 1 && value <= 999; }

  function receive(queue, installed) {
    var ids = [], skipped = '', existing = {}, receiptChanged = false;
    store.titles().forEach(function (entry) { existing[entry.id] = true; });
    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      if (!item || typeof item.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
        skipped = 'An invalid submission is waiting on the companion.'; continue;
      }
      var id = 'phone-'+item.id;
      if (!existing[id] && receipts.indexOf(item.id) < 0) {
        var app = service(item.service,installed);
        if (!app) {
          skipped = 'A title is waiting for its streaming app to be installed.'; continue;
        }
        var season = item.season === undefined ? 1 : item.season;
        var episode = item.episode === undefined ? 1 : item.episode;
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 80 ||
            !whole(item.minutes) || !whole(season) || !whole(episode) ||
            (item.kind !== 'film' && item.kind !== 'series')) {
          skipped = 'A title has invalid details. Check the companion.'; continue;
        }
        store.save({id:id,title:item.title.trim(),kind:item.kind,minutes:item.minutes,
          season:season,episode:episode,finished:false,service:app});
        existing[id] = true;
        lastCount++; lastTitle = item.title.trim();
      }
      if (receipts.indexOf(item.id) < 0) { receipts.push(item.id); receiptChanged = true; }
      ids.push(item.id);
    }
    if (receiptChanged) { savePair(); }
    return {ids:ids,skipped:skipped};
  }

  function resultText(skipped) {
    var imported = lastCount ? 'Added '+lastCount+' · '+lastTitle+'. ' : '';
    return imported+(skipped || 'Waiting for more titles.');
  }

  function poll() {
    if (!pair || !ui.active()) { return; }
    if (!pair.wasExpired && pair.expiresAt*1000 <= Date.now()) {
      pair.wasExpired = true;
      connectedCard();
    }
    json('GET','/api/queue',null,function (code, data) {
      if (code === 401 || code === 403) { fail('The companion session ended. Choose Try again to reconnect.'); return; }
      if (code !== 200 || !data || !Array.isArray(data.items)) {
        status('Connection interrupted. Retrying…'); later(4500); return;
      }
      if (!data.items.length) {
        if (receipts.length) {
          receipts = [];
          try { savePair(); } catch (ignored) {}
        }
        status(resultText('')); later(2500); return;
      }
      var id = revision;
      library.installed(function (catalog) {
        if (!current(id)) { return; }
        var received;
        try { received = receive(data.items,catalog); }
        catch (error) { status('Could not save a title. It will stay on the Mac until a retry succeeds.'); later(4500); return; }
        if (!received.ids.length) { status(resultText(received.skipped)); later(4500); return; }
        json('POST','/api/ack',{ids:received.ids},function (ack, reply) {
          if (ack === 200 && reply && reply.ok === true) {
            receipts = receipts.filter(function (value) { return received.ids.indexOf(value) < 0; });
            try { savePair(); } catch (ignored) {}
            status(resultText(received.skipped));
          } else { status('Saved on TV. Retrying confirmation with the Mac…'); }
          later(2500);
        });
      },function () {
        if (current(id)) { status('Could not read the TV’s installed apps. Retrying…'); later(4500); }
      });
    });
  }

  function open() {
    stop(); readPair(); lastCount = 0; lastTitle = ''; message = '';
    if (helper) { connect(); }
    else { page = 'setup'; render(0); }
  }
  function back() { stop(); input.hidden = true; ui.done(); }

  return {
    open:open, close:stop, render:render, back:back,
    key:function (event) {
      if (page !== 'setup' || input.hidden || event.target !== input) { return false; }
      var code = event.keyCode;
      if (code === 13 || code === 65376) { event.preventDefault(); connectInput(); }
      else if (code === 27 || code === 10009 || code === 65385) { event.preventDefault(); back(); }
      else if (code === 40 || code === 9) { event.preventDefault(); ui.focus(0); }
      return true;
    },
    focusField:function () {
      if (page !== 'setup' || input.hidden) { return false; }
      input.focus(); return true;
    }
  };
}
