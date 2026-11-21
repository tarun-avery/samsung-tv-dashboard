(function () {
  'use strict';
  var services = ['Netflix','Paramount+','Crunchyroll','Prime Video','Apple TV','YouTube','Disney+','HDMI 1'];
  var aliases = [['netflix'],['paramountplus'],['crunchyroll'],['primevideo','amazonprimevideo','amazonvideo','amazoninstantvideo'],['appletv','appletvplus'],['youtube'],['disneyplus']];
  // IDs reported by the UE43MU6100. Name lookup also supports later installs.
  var installedIds = ['org.tizen.netflix-app','rJyOSqC6Up.PPlusIntl','OGLLvqej7u.CrunchyrollWebApp','evKhCgZelL.AmazonIgnitionLauncher2','Y6A54cEa22.AppleTV','9Ur5IzDKqV.TizenYouTube','MCmYXNxgcu.DisneyPlus'];
  var stockApps = installedIds.map(function (id,i) { return {id:id,name:services[i]}; });
  var library = createDashboardLibrary(window.tizen,stockApps);
  var lastGridTile = 0, topOrigin = null;
  var tiles = document.querySelector('#tiles');
  var dialog = document.querySelector('aside');
  var buttons = [], selected = 0, playing = false, leavingHDMI = false;
  var footerOrigin = null;
  var labels = services.concat(['Bluetooth audio','Customise','Settings','Recent apps','App Library','Control Centre','TV guide']);
  var selectionName = document.querySelector('#selection-name');
  var editing = false, moving = false, quickMove = false;
  var order = services.map(function (_, index) { return index; });
  try {
    var saved = JSON.parse(localStorage.getItem('dashboard.tileOrder'));
    if (Array.isArray(saved) && saved.length === order.length &&
        order.every(function (id) { return saved.indexOf(id) >= 0; })) { order = saved; }
  } catch (ignored) {}
  var tv = window.tizen;
  var firstVisit = false;
  try {
    firstVisit = !localStorage.getItem('dashboard.welcomeSeen') && !localStorage.getItem('dashboard.preferences') &&
      !localStorage.getItem('dashboard.appLibrary.v1') && !localStorage.getItem('dashboard.tileOrder');
    if (tv) { localStorage.setItem('dashboard.welcomeSeen','1'); }
  } catch (ignored) {}

  function focusTile(index) {
    if (!buttons[index] || buttons[index].hidden) { index = visible()[0]; }
    if (document.activeElement !== buttons[index]) { buttons[index].focus(); }
  }
  function message(title, detail) {
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = detail;
    dialog.hidden = false;
    document.querySelector('#dismiss').focus();
  }
  function dismiss() {
    dialog.hidden = true;
    restoreFocus();
    resetIdle();
  }
  function restoreFocus() {
    if (!dialog.hidden) { document.querySelector('#dismiss').focus(); }
    else if (menu) { options.children[optionIndex].focus(); }
    else if (!playing) { focusTile(selected); }
  }
  var clockNode = document.querySelector('time');
  var weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var weatherNode = document.querySelector('#weather');
  var weatherLocation = window.dashboardWeatherLocation;
  var conditions = document.querySelector('#conditions');
  var nextWeatherCheck = 0;
  var weatherCodes = {
    0:'Clear',1:'Mostly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Freezing fog',
    51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',56:'Freezing drizzle',57:'Freezing drizzle',
    61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Freezing rain',
    71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',
    81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow showers',
    95:'Thunderstorms',96:'Thunderstorms with hail',99:'Thunderstorms with hail'
  };
  function refreshWeather() {
    if (!weatherLocation || !ambientActive || !prefs.weather || document.hidden || Date.now() < nextWeatherCheck) { return; }
    weatherNode.hidden = true;
    nextWeatherCheck = Date.now() + 15*60000;
    function unavailable() { weatherNode.hidden = true; }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET','https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(weatherLocation.latitude)+
        '&longitude='+encodeURIComponent(weatherLocation.longitude)+'&current=temperature_2m,weather_code&timeformat=unixtime');
      xhr.timeout = 8000;
      xhr.onload = function () {
        if (xhr.status !== 200) { unavailable(); return; }
        try {
          var data = JSON.parse(xhr.responseText).current;
          if (!data || typeof data.temperature_2m !== 'number' || !weatherCodes[data.weather_code] ||
              typeof data.time !== 'number' || Math.abs(Date.now()-data.time*1000) > 3600000) { unavailable(); return; }
          conditions.textContent = weatherLocation.name+' · '+Math.round(data.temperature_2m)+'°C · '+weatherCodes[data.weather_code];
          weatherNode.hidden = !prefs.weather;
        } catch (error) { unavailable(); }
      };
      xhr.onerror = xhr.ontimeout = unavailable;
      xhr.send();
    } catch (error) { unavailable(); }
  }
  var clockTimer;
  function clock() {
    clearTimeout(clockTimer);
    if (document.hidden) { return; }
    var now = new Date();
    clockNode.textContent = weekdays[now.getDay()]+' '+now.getDate()+' '+months[now.getMonth()]+' · '+('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    refreshWeather();
    clockTimer = setTimeout(clock,60000 - now.getSeconds()*1000 - now.getMilliseconds());
  }
  function normalize(name) {
    return String(name || '').toLowerCase().replace(/\+/g,'plus').replace(/[^a-z0-9]/g,'');
  }
  var launchScreen = document.querySelector('#launch-screen');
  var pendingLaunch = null;
  var launchTimeout;
  function unlockLaunch(cancelled) {
    clearTimeout(launchTimeout);
    if (cancelled) { latestRequest = null; }
    launchScreen.hidden = true;
    pendingLaunch = null;
  }
  function rememberLaunch(index,request) {
    if (request !== latestRequest) { return; }
    if (request.app) { library.remember(request.app); }
    if (index < 0) { return; }
    if (request === latestRequest && prefs.launched !== index) {
      prefs.launched = index;
      save();
    }
  }
  var latestRequest;
  function launchService(index,request) {
    function launched() {
      rememberLaunch(request.index,request);
    }
    var name = request.app.name;
    function unavailable() { if (pendingLaunch !== request || request.wasHidden) { return; } unlockLaunch(true); message(name,'Open Samsung Home → Apps to check whether this service is installed and available on your TV.'); }
    function findByName() {
      if (pendingLaunch !== request || request.wasHidden) { return; }
      try {
        tv.application.getAppsInfo(function (apps) {
          if (pendingLaunch !== request || request.wasHidden) { return; }
          var match = apps.filter(function (app) { return app.id !== installedIds[index] && aliases[index].indexOf(normalize(app.name)) !== -1; })[0];
          if (!match) { unavailable(); return; }
          try {
            tv.application.launch(match.id, function () {
              if (latestRequest === request) { installedIds[index] = match.id; }
              launched();
            }, unavailable);
          } catch (error) { unavailable(); }
        }, unavailable);
      } catch (error) { unavailable(); }
    }
    if (index === 5 || index === 0) {
      var target = installedIds[index];
      var launchNormally = function () {
        if (pendingLaunch !== request || request.wasHidden) { return; }
        try { tv.application.launch(target,launched,findByName); } catch (error) { findByName(); }
      };
      try {
        var control = new tv.ApplicationControl('http://tizen.org/appcontrol/operation/default');
        tv.application.launchAppControl(control,target,launched,launchNormally);
      } catch (error) { launchNormally(); }
      return;
    }
    try { tv.application.launch(installedIds[index], launched, findByName); } catch (error) { findByName(); }
  }
  var latestSources = null;
  var statusTimer, statusVersion = 0;
  function inputNumber(app) {
    return app && /^input:hdmi[1-9]$/.test(app.id) ? Number(app.id.slice(-1)) : 0;
  }
  function artwork(brand,app) {
    return brand === 7 ? 'url(assets/'+(app.art || 'input')+'.svg)' : 'none';
  }
  function hdmiPort(list,number) {
    if (!list) { return null; }
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'HDMI' && Number(list[i].number) === number) { return list[i]; }
    }
    return null;
  }
  function showHDMIStatus(sources) {
    latestSources = sources;
    services.forEach(function (_, slot) {
      var app = library.home(slot), number = inputNumber(app);
      var status = buttons[slot].querySelector('.hdmi-status');
      status.hidden = !number;
      if (!number) { return; }
      var label = sources && hdmiPort(sources.connected,number) ? 'Device connected' :
        sources && hdmiPort(sources.disconnected,number) ? 'No device connected' : 'Connection unknown';
      var caption = app.name+' · '+label;
      if (status.textContent !== caption) { status.textContent = caption; }
      buttons[slot].setAttribute('aria-label',app.name+', '+label);
    });
  }
  function refreshHDMIStatus() {
    clearTimeout(statusTimer);
    var version = ++statusVersion;
    if (document.hidden) { return; }
    if (!tv || !tv.systeminfo) { showHDMIStatus(null); return; }
    function received(sources) {
      if (version === statusVersion) { showHDMIStatus(sources); }
    }
    try { tv.systeminfo.getPropertyValue('VIDEOSOURCE',received,function () { received(null); }); }
    catch (error) { received(null); }
    statusTimer = setTimeout(refreshHDMIStatus,10000);
  }
  function playHDMI(request) {
    function failed() { if (pendingLaunch !== request) { return; } unlockLaunch(true); message(request.app.name,'Check the connection to HDMI '+inputNumber(request.app)+' or open Samsung Home → Source.'); }
    tv.systeminfo.getPropertyValue('VIDEOSOURCE',function (sources) {
      if (pendingLaunch !== request) { return; }
      var port = sources && hdmiPort(sources.connected,inputNumber(request.app));
      showHDMIStatus(sources);
      if (!port) { failed(); return; }
      try {
        tv.tvwindow.setSource(port,function () {
          if (pendingLaunch !== request) { return; }
          try {
            tv.tvwindow.show(function () {
              if (pendingLaunch !== request) {
                if (!playing && (!pendingLaunch || !inputNumber(pendingLaunch.app))) {
                  try { tv.tvwindow.hide(function () {},function () {}); } catch (ignored) {}
                }
                return;
              }
              rememberLaunch(request.index,request); unlockLaunch(); playing = true;
              document.body.classList.add('playing');
            },failed,['0%','0%','100%','100%'],'MAIN');
          } catch (error) { failed(); }
        },failed,'MAIN');
      } catch (error) { failed(); }
    },failed);
  }
  function brandIndex(app) {
    for (var i=0; i<stockApps.length; i++) { if (stockApps[i].id === app.id) { return i; } }
    return inputNumber(app) ? 7 : -1;
  }
  function appColour(name) {
    var palette = ['#26596a','#4a3f79','#864839','#245c50','#364d83','#70435c'];
    return palette[name.charCodeAt(0) % palette.length];
  }
  function updateTile(slot) {
    var app = library.home(slot), brand = brandIndex(app), button = buttons[slot];
    services[slot] = labels[slot] = actions[slot] = app.name;
    button.setAttribute('data-label',app.name);
    button.setAttribute('data-brand',String(brand));
    button.setAttribute('aria-label',app.name);
    button.style.backgroundColor = brand === 7 ? '' : appColour(app.name);
    button.style.backgroundImage = brand < 0 ? 'none' : artwork(brand,app);
    var mark = button.querySelector('.app-wordmark');
    mark.hidden = brand === 7;
    mark.textContent = app.name;
    button.querySelector('.hdmi-status').hidden = brand !== 7;
    if (selected === slot) { selectionName.textContent = app.name; }
  }
  function launchEntry(app) {
    if (inputNumber(app) && menu) { closeMenu(); }
    var slot = -1;
    for (var i=0; i<services.length; i++) {
      if (library.home(i).id === app.id) { slot = i; break; }
    }
    activate(slot,app);
  }
  function activate(index, app) {
    if (pendingLaunch || playing) { return; }
    app = app || (index >= 0 && index < services.length ? library.home(index) : null);
    if (app && app.id === library.guideTile.id) {
      menuOwner = selected; showMenu('TV guide',0); return;
    }
    var title = app ? app.name : labels[index];
    if (!tv) {
      var detail = inputNumber(app) ? 'HDMI '+inputNumber(app)+' is available on the Samsung TV.' : index === 8 ? 'The paired speaker list is available on the Samsung TV.' : 'This shortcut opens the installed app on the Samsung TV.';
      message(title,detail);
      return;
    }
    var request = {index:index,app:app,external:!!app && !inputNumber(app),wasHidden:false};
    pendingLaunch = latestRequest = request;
    var brand = app ? brandIndex(app) : -1;
    document.querySelector('#launch-label').textContent = inputNumber(app) ? 'Switching to '+title+'…' : 'Opening ' + title + '…';
    launchScreen.hidden = false;
    launchTimeout = setTimeout(function () {
      if (pendingLaunch !== request || request.wasHidden || document.hidden) { return; }
      unlockLaunch(true);
      message(title,'The TV is taking longer than expected. Press Back to return and try again.');
    },15000);
    try {
      if (inputNumber(app)) { playHDMI(request); }
      else if (index === 8) {
        var speakerHelp = function () {
          if (pendingLaunch !== request) { return; }
          unlockLaunch(true);
          message('Bluetooth audio','On your TV, open Home → Settings → Sound → Sound Output → Bluetooth Speaker List, then select your headphones or speaker.');
        };
        try { tv.application.launch('org.tizen.btaudiolist',function () { if (pendingLaunch === request) { unlockLaunch(); } },speakerHelp); }
        catch (error) { speakerHelp(); }
      } else if (brand < 0) {
        tv.application.launch(app.id,function () { rememberLaunch(index,request); },function () {
          if (pendingLaunch !== request || request.wasHidden) { return; }
          unlockLaunch(true); message(title,'Samsung could not open this app. Check its availability in Smart Hub.');
        });
      } else { launchService(brand,request); }
    } catch (error) {
      unlockLaunch(true); message(title,'Open Samsung Home to check whether this shortcut is available on your TV.');
    }
  }
  var panel = document.querySelector('#panel');
  var options = document.querySelector('#options');
  var menu = '', optionIndex = 0, menuOwner = 10, menuEpoch = 0;
  var note = document.querySelector('#panel-note');
  var search = document.querySelector('#app-search');
  var shelfEntries = [], shelfDescription = '';
  var enterTimer = null, enterTile = -1;
  function cancelEnter() {
    clearTimeout(enterTimer); enterTimer = null; enterTile = -1;
  }
  var wallpapers = ['Tide','Dusk','Black'];
  var colours = ['Red','Green','Yellow','Blue'];
  var actions = services.concat(['Bluetooth audio','Last used','Tile options','Recent apps','App Library','Control Centre','TV guide']);
  var defaults = [7,9,10,8];
  var shortcutSlot = 0;
  var prefs = {largeTiles:false,quickLaunch:true,reduceMotion:false,filter:false, hidden:[], fixed:false, first:0, last:0, wallpaper:0, sounds:true, ambient:true, weather:true, launched:-1, shortcuts:defaults.slice()};
  try {
    var stored = JSON.parse(localStorage.getItem('dashboard.preferences')) || {};
    Object.keys(prefs).forEach(function (key) {
      if (typeof stored[key] === typeof prefs[key]) { prefs[key] = stored[key]; }
    });
  } catch (ignored) {}
  function validIndex(value,count) {
    return typeof value === 'number' && value >= 0 && value < count && value === Math.floor(value);
  }
  var hiddenIds = Array.isArray(prefs.hidden) ? prefs.hidden : [];
  prefs.hidden = order.filter(function (id) { return hiddenIds.indexOf(id) !== -1; });
  if (prefs.hidden.length === services.length) { prefs.hidden.shift(); }
  if (visible().indexOf(prefs.first) < 0) { prefs.first = visible()[0]; }
  if (!validIndex(prefs.last,services.length)) { prefs.last = visible()[0]; }
  if (!validIndex(prefs.launched,services.length)) { prefs.launched = -1; }
  if (!validIndex(prefs.wallpaper,wallpapers.length)) { prefs.wallpaper = 0; }
  var storedShortcuts = Array.isArray(prefs.shortcuts) ? prefs.shortcuts : [];
  prefs.shortcuts = defaults.map(function (fallback,i) {
    var action = storedShortcuts[i];
    return validIndex(action,actions.length) ? action : fallback;
  });
  if (!library.recents().length && prefs.launched >= 0) { library.remember(library.home(prefs.launched)); }
  function startAmbient() {
    if (document.hidden || playing || pendingLaunch || editing || menu || !dialog.hidden) { return; }
    ambientActive = true;
    document.body.classList.add('ambient');
    refreshWeather();
  }
  var ambientTimer, ambientActive = false, wakeKey = null, heldAction = null;
  function resetIdle() {
    clearTimeout(ambientTimer);
    if (!prefs.ambient || document.hidden || ambientActive) { return; }
    ambientTimer = setTimeout(startAmbient,300000);
  }
  function wakeDashboard() {
    ambientActive = false;
    document.body.classList.remove('ambient');
    focusTile(selected);
    resetIdle();
  }
  document.addEventListener('click',function (event) {
    var blocked = pendingLaunch || playing || (!dialog.hidden ? !dialog.contains(event.target) : menu && !panel.contains(event.target));
    if (ambientActive || blocked) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (ambientActive) { wakeDashboard(); }
      return;
    }
    if (hiddenTile && event.target !== undoButton) { dismissUndo(); }
    resetIdle();
  },true);
  document.addEventListener('keyup',function (event) {
    if (event.keyCode === 13 && event.target !== search) {
      event.preventDefault();
      var tapped = enterTile;
      cancelEnter();
      if (tapped >= 0 && selected === tapped && document.activeElement === buttons[tapped] &&
          !document.hidden && !menu && dialog.hidden && !ambientActive && !pendingLaunch) { buttons[tapped].click(); }
    }
    if (event.keyCode === heldAction) { heldAction = null; }
    if (event.keyCode === wakeKey) { event.preventDefault(); wakeKey = null; }
  });
  window.addEventListener('blur',function () { cancelEnter(); heldAction = wakeKey = null; });
  var focusTimer = null;
  function save() {
    clearTimeout(focusTimer);
    focusTimer = null;
    try { localStorage.setItem('dashboard.preferences',JSON.stringify(prefs)); } catch (ignored) {}
  }
  function flushFocus() {
    if (focusTimer !== null) { save(); }
  }
  function sound(type) {
    if (!prefs.sounds || !tv) { return; }
    try { tv.tvaudiocontrol.playSound(type); } catch (ignored) {}
  }
  var arrowSounds = ['LEFT','UP','RIGHT','DOWN'];
  window.addEventListener('pagehide',flushFocus);
  function visible() {
    return order.filter(function (id) { return !prefs.filter || prefs.hidden.indexOf(id) < 0; });
  }
  function draw() {
    var shownTiles = visible();
    order.forEach(function (id,position) {
      var button = buttons[id];
      button.hidden = shownTiles.indexOf(id) < 0;
      button.className = moving && selected === id ? 'moving' : '';
      if (tiles.children[position] !== button) { tiles.insertBefore(button,tiles.children[position] || null); }
    });
    document.body.classList.toggle('large-tiles',prefs.largeTiles);
    document.body.classList.toggle('midnight',prefs.wallpaper === 1);
    document.body.classList.toggle('black',prefs.wallpaper === 2);
    document.body.classList.toggle('reduce-motion',prefs.reduceMotion);
  }
  function remember(id) {
    if (id < 8 && prefs.last !== id) { prefs.last = id; clearTimeout(focusTimer); focusTimer = setTimeout(save,350); }
  }
  function addOption(label, action, checked) {
    var button = document.createElement('button');
    button.textContent = label;
    if (typeof checked === 'boolean') {
      button.setAttribute('role','switch');
      button.setAttribute('aria-checked',String(checked));
      button.textContent += checked ? ' · On' : ' · Off';
    }
    button.onclick = function () {
      action();
      if (label !== 'Navigation sounds') { sound(label === 'Back' ? 'BACK' : 'SELECT'); }
    };
    var position = options.children.length;
    button.onfocus = function () { optionIndex = position; };
    options.appendChild(button);
    return button;
  }
  var setupSlot = -1;
  function closeMenu() {
    setupSlot = -1;
    menu = ''; menuEpoch++; shelfEntries = []; panel.hidden = true; focusTile(menuOwner);
    resetIdle();
  }
  var undoButton = document.querySelector('#undo-hide');
  var hiddenTile, undoTimer;
  function dismissUndo() {
    clearTimeout(undoTimer);
    hiddenTile = null;
    var restoreFocus = document.activeElement === undoButton;
    undoButton.hidden = true;
    if (restoreFocus) { focusTile(selected); }
  }
  undoButton.onclick = function () {
    if (!hiddenTile) { return; }
    var previous = hiddenTile;
    dismissUndo();
    prefs.hidden = previous.hidden; prefs.filter = previous.filter; prefs.first = previous.first;
    save(); draw(); focusTile(previous.id); sound('SELECT');
  };
  function panelNote(text) {
    note.textContent = text; note.hidden = !text;
  }
  function appOptions(entries, pick) {
    entries.forEach(function (app) {
      var button = addOption(app.name,function () {
        if (pick) {
          if (setupSlot >= 0) {
            library.pin(setupSlot,app); updateTile(setupSlot);
            var position = order.filter(function (id) { return id !== 7; }).indexOf(setupSlot);
            setupSlot = -1; showMenu('Set up Home apps',position);
          } else { library.pin(menuOwner,app); updateTile(menuOwner); closeMenu(); }
        } else { launchEntry(app); }
      });
      button.className = 'shelf-card';
      var brand = brandIndex(app);
      if (brand === 7) {
        var logo = document.createElement('span');
        logo.className = 'shelf-logo';
        logo.style.backgroundImage = artwork(brand,app);
        logo.setAttribute('aria-hidden','true');
        button.insertBefore(logo,button.firstChild);
      } else { button.style.backgroundColor = appColour(app.name); }
    });
  }
  function fillShelf() {
    var keepSearch = document.activeElement === search;
    var query = search.hidden ? '' : search.value.trim().toLowerCase();
    var matches = query ? shelfEntries.filter(function (app) {
      return app.name.toLowerCase().indexOf(query) !== -1;
    }) : shelfEntries;
    options.textContent = ''; optionIndex = 0;
    panelNote(query && !matches.length ? 'No matching apps.' : shelfDescription);
    appOptions(matches,menu === 'Choose app');
    addOption('Back',backMenu).className = 'shelf-back';
    if (!keepSearch && !document.hidden) { options.children[0].focus(); }
  }
  search.addEventListener('input',fillShelf);
  function renderShelf(page,epoch,entries,description) {
    if (epoch !== menuEpoch || menu !== page) { return; }
    shelfEntries = entries; shelfDescription = description; fillShelf();
  }
  function audioMenu() {
    var audio = tv && tv.tvaudiocontrol;
    try {
      if (!audio) { return; }
      var muted = audio.isMute();
      panelNote('Volume '+audio.getVolume()+'%');
      addOption(muted ? 'Unmute TV' : 'Mute TV',function () {
        try { audio.setMute(!audio.isMute()); showMenu('Control Centre',0); }
        catch (error) { panelNote('Use the volume button on your Samsung remote.'); }
      });
    } catch (ignored) {}
  }
  var inputName = document.getElementById('hdmi-name');
  var inputDraft, favouriteApps = [], savedHomeKey = 'dashboard.myHome.v1';
  var artNames = {input:'HDMI',controller:'Game controller',handheld:'Handheld',receiver:'Media box'};
  function editInput(slot) {
    var current = library.home(slot);
    inputDraft = {port:inputNumber(current) || 1,art:current.art || 'input',name:inputNumber(current) ? current.name : ''};
    showMenu('HDMI shortcut',0);
  }
  function startFavourites() {
    favouriteApps = [];
    showMenu('Choose favourites',0);
  }
  function saveMyHome() {
    try {
      var pins = stockApps.concat([null]).map(function (_,slot) { return library.home(slot); });
      localStorage.setItem(savedHomeKey,JSON.stringify({order:order,prefs:prefs,pins:pins}));
      showMenu('My Home',0); panelNote('My Home saved on this TV.');
    } catch (error) { panelNote('This TV could not save the layout.'); }
  }
  function restoreMyHome() {
    try {
      var layout = JSON.parse(localStorage.getItem(savedHomeKey));
      if (!layout || !Array.isArray(layout.order) || layout.order.length !== 8 ||
          !order.every(function (id) { return layout.order.indexOf(id) >= 0; }) ||
          !Array.isArray(layout.pins) || layout.pins.length !== 8 || !layout.prefs ||
          !Array.isArray(layout.prefs.hidden) || !Array.isArray(layout.prefs.shortcuts)) {
        throw Error('Invalid layout');
      }
      localStorage.setItem('dashboard.tileOrder',JSON.stringify(layout.order));
      order = layout.order;
      Object.keys(prefs).forEach(function (key) {
        if (key !== 'launched' && typeof prefs[key] === typeof layout.prefs[key]) { prefs[key] = layout.prefs[key]; }
      });
      layout.pins.forEach(function (app,slot) { library.pin(slot,app); updateTile(slot); });
      save(); draw(); refreshHDMIStatus(); resetIdle(); showMenu('My Home',0); panelNote('My Home restored.');
    } catch (error) { panelNote('The saved layout could not be restored.'); }
  }
  function renderHomeTools(page,epoch,position) {
    if (page === 'Welcome') {
      panelNote('Choose the apps you want on Home. You can change them later in Customise.');
      addOption('Choose favourites',startFavourites);
      addOption('Keep default tiles',closeMenu);
    } else if (page === 'Choose favourites') {
      panelNote('Reading installed apps…');
      function ready(apps) {
        if (epoch !== menuEpoch) { return; }
        options.textContent = '';
        panelNote('Select up to seven apps in the order you want them on Home.');
        addOption('Apply favourites',function () {
          if (!favouriteApps.length) { panelNote('Choose at least one app first.'); return; }
          // Keep configured HDMI tiles and fill the remaining slots in display order.
          var slots = order.filter(function (id) { return !inputNumber(library.home(id)); });
          if (favouriteApps.length > slots.length) { panelNote('There are '+slots.length+' app slots available.'); return; }
          favouriteApps.forEach(function (app,i) { library.pin(slots[i],app); updateTile(slots[i]); });
          prefs.hidden = slots.slice(favouriteApps.length); prefs.filter = prefs.hidden.length > 0;
          if (visible().indexOf(prefs.first) < 0) { prefs.first = visible()[0]; }
          save(); draw(); closeMenu(); focusTile(slots[0]);
        });
        apps.forEach(function (app) {
          var button = addOption(app.name,function () {
            var i = favouriteApps.indexOf(app);
            if (i >= 0) { favouriteApps.splice(i,1); }
            else if (favouriteApps.length < 7) { favouriteApps.push(app); }
            else { panelNote('Seven apps selected. Deselect one to choose another.'); return; }
            var checked = i < 0;
            button.textContent = (checked ? '✓ ' : '')+app.name;
            button.setAttribute('aria-checked',String(checked));
            panelNote(favouriteApps.length+' selected. Choose Apply favourites to save.');
          });
          button.setAttribute('role','checkbox'); button.setAttribute('aria-checked','false');
        });
        addOption('Back',backMenu); options.children[apps.length ? 1 : 0].focus();
      }
      addOption('Back',backMenu); options.children[0].focus();
      library.installed(ready,function () { if (epoch === menuEpoch) { panelNote('Could not read installed apps. Try again later.'); } });
      return true;
    } else if (page === 'My Home') {
      var exists = false;
      try { exists = !!localStorage.getItem(savedHomeKey); } catch (ignored) {}
      panelNote('Save this TV’s tile layout, appearance, HDMI shortcuts and remote settings.');
      addOption(exists ? 'Update saved layout' : 'Save current layout',exists ? function () { showMenu('Replace saved layout',0); } : saveMyHome);
      if (exists) { addOption('Restore saved layout',restoreMyHome); }
    } else if (page === 'Replace saved layout') {
      panelNote('Replace My Home with the current layout?');
      addOption('Keep existing save',backMenu); addOption('Replace save',saveMyHome);
    } else if (page === 'HDMI shortcut') {
      inputName.hidden = false;
      inputName.value = inputDraft.name;
      var ports = [1,2,3,4];
      if (latestSources) {
        var detected = [];
        (latestSources.connected || []).concat(latestSources.disconnected || []).forEach(function (source) {
          var n = Number(source.number);
          if (source.type === 'HDMI' && n >= 1 && n <= 9 && detected.indexOf(n) < 0) { detected.push(n); }
        });
        if (detected.length) { ports = detected.sort(function (a,b) { return a-b; }); }
      }
      if (ports.indexOf(inputDraft.port) < 0) { ports.push(inputDraft.port); }
      function defaultName() { return inputDraft.art === 'input' ? 'HDMI '+inputDraft.port : artNames[inputDraft.art]; }
      function change(action,index) {
        var name = inputName.value.trim();
        inputDraft.name = name === defaultName() ? '' : name;
        action(); showMenu(page,index);
      }
      panelNote('Press Up from Port to edit the name. Select Port or Artwork to cycle through choices.');
      addOption('Port · HDMI '+inputDraft.port,function () { change(function () {
        inputDraft.port = ports[(ports.indexOf(inputDraft.port)+1)%ports.length];
      },0); });
      addOption('Artwork · '+artNames[inputDraft.art],function () { change(function () {
        var keys = Object.keys(artNames); inputDraft.art = keys[(keys.indexOf(inputDraft.art)+1)%keys.length];
      },1); });
      addOption('Save shortcut',function () {
        library.pin(menuOwner,{id:'input:hdmi'+inputDraft.port,name:inputName.value.trim() || defaultName(),art:inputDraft.art});
        updateTile(menuOwner); refreshHDMIStatus(); closeMenu();
      });
    } else { return false; }
    addOption('Back',backMenu);
    options.children[Math.min(position || 0,options.children.length-1)].focus();
    return true;
  }
  var guide = createTVGuide(createWatchlist({
    getItem:function (key) { return localStorage.getItem(key); },
    setItem:function (key,value) { localStorage.setItem(key,value); }
  }),library,{
    active:function () { return menu === 'TV guide'; },
    refresh:function (position) { showMenu('TV guide',position); },
    close:closeMenu, launch:launchEntry, option:addOption, note:panelNote,
    clear:function () { options.textContent = ''; },
    focus:function (position) { options.children[Math.min(position,options.children.length-1)].focus(); }
  });
  function showMenu(page,position) {
    menu = page; options.textContent = ''; panel.hidden = false;
    var epoch = ++menuEpoch;
    panel.querySelector('h2').textContent = page;
    panel.scrollTop = 0;
    var isShelf = page === 'Recent apps' || page === 'App Library' || page === 'Choose app';
    inputName.hidden = true;
    document.getElementById('guide-value').hidden = true;
    panel.classList.toggle('guide-panel',page === 'TV guide');
    search.value = ''; search.hidden = page !== 'App Library' && page !== 'Choose app';
    panel.classList.toggle('shelf-panel',isShelf);
    panel.classList.toggle('control-panel',page === 'Control Centre');
    panelNote('');
    if (page === 'TV guide') { guide.render(position || 0); return; }
    if (isShelf) {
      if (page === 'Recent apps') {
        var recent = library.recents();
        renderShelf(page,epoch,recent,recent.length ? '' : 'Apps you open from Dashboard will appear here.');
      } else {
        renderShelf(page,epoch,[],'Reading apps from your TV…');
        library.installed(function (apps) {
          var text = page === 'Choose app' ? 'Choose a replacement for '+services[setupSlot >= 0 ? setupSlot : menuOwner]+'.' : '';
          if (!tv) { text = 'Preview shortcuts. Open Dashboard on your TV to see installed apps.'; }
          renderShelf(page,epoch,apps,apps.length ? text : 'No streaming apps were listed by the TV.');
        },function () { renderShelf(page,epoch,[],'Samsung could not provide the app list. Press Back and try again.'); });
      }
      return;
    }
    if (page === 'Control Centre') {
      audioMenu();
      addOption('Audio output',function () { closeMenu(); activate(8); });
      addOption('Start screen saver',function () { closeMenu(); startAmbient(); });
      addOption('Reduce motion',function () {
        prefs.reduceMotion = !prefs.reduceMotion; save(); draw(); showMenu(page,optionIndex);
      },prefs.reduceMotion);
    } else if (page === 'Settings') {
      addOption('Hide selected tiles',function () {
        prefs.filter = !prefs.filter;
        if (visible().indexOf(prefs.first) < 0) { prefs.first = visible()[0]; }
        save(); draw(); showMenu(page,0);
      },prefs.filter);
      if (prefs.filter) { addOption('Choose visible tiles',function () { showMenu('Visible tiles',0); }); }
      addOption('Use a fixed startup tile',function () { prefs.fixed = !prefs.fixed; save(); showMenu(page,prefs.filter ? 2 : 1); },prefs.fixed);
      if (prefs.fixed) { addOption('Startup tile · '+services[prefs.first],function () { showMenu('Startup tile',visible().indexOf(prefs.first)); }); }
      addOption('Navigation sounds',function () {
        prefs.sounds = !prefs.sounds; save(); sound('SELECT'); showMenu(page,optionIndex);
      },prefs.sounds);
      addOption('Ambient mode after 5 minutes',function () { prefs.ambient = !prefs.ambient; save(); resetIdle(); showMenu(page,optionIndex); },prefs.ambient);
      if (weatherLocation) {
        addOption(weatherLocation.name+' weather in ambient mode',function () { prefs.weather = !prefs.weather; weatherNode.hidden = true; nextWeatherCheck = 0; save(); showMenu(page,optionIndex); },prefs.weather);
      }
      addOption('Launch apps on OK press',function () { prefs.quickLaunch = !prefs.quickLaunch; save(); showMenu(page,optionIndex); },prefs.quickLaunch);
    } else if (page === 'Visible tiles') {
      order.forEach(function (id,i) {
        var shown = visible().indexOf(id) >= 0;
        addOption(services[id],function () {
          if (shown && visible().length === 1) { return; }
          if (shown) { prefs.hidden.push(id); } else { prefs.hidden.splice(prefs.hidden.indexOf(id),1); }
          if (visible().indexOf(prefs.first) < 0) { prefs.first = visible()[0]; }
          save(); draw(); showMenu(page,i);
        },shown);
      });
    } else if (page === 'Startup tile') {
      visible().forEach(function (id) {
        addOption(services[id],function () { prefs.first = id; save(); showMenu('Settings',0); });
      });
    } else if (page === 'Customise') {
      addOption('Reorder tiles',function () {
        closeMenu(); editing = true; updateHint(); focusTile(visible()[0]);
      });
      addOption('Wallpaper · '+wallpapers[prefs.wallpaper],function () { showMenu('Wallpaper',prefs.wallpaper); });
      addOption('Remote shortcuts',function () { showMenu('Remote shortcuts',0); });
      addOption('Tile options',function () { showMenu('Select a tile',0); });
      addOption('Set up Home apps',function () { showMenu('Set up Home apps',0); });
      addOption('Large tiles',function () { prefs.largeTiles = !prefs.largeTiles; save(); draw(); showMenu(page,5); },prefs.largeTiles);
      addOption('Choose favourites',startFavourites);
      addOption('My Home',function () { showMenu('My Home',0); });
    } else if (renderHomeTools(page,epoch,position)) {
      return;
    } else if (page === 'Set up Home apps') {
      panelNote('Choose a shortcut to replace with an app from your TV.');
      order.forEach(function (slot) {
        if (slot === 7) { return; }
        addOption(services[slot],function () {
          setupSlot = slot;
          showMenu('Choose app',0);
        });
      });
    } else if (page === 'Select a tile') {
      visible().forEach(function (id) {
        addOption(services[id],function () { menuOwner = id; showMenu('Tile options',0); });
      });
    } else if (page === 'Remote shortcuts') {
      colours.forEach(function (colour,slot) {
        addOption(colour+' · '+actions[prefs.shortcuts[slot]],function () {
          shortcutSlot = slot;
          showMenu('Choose shortcut',prefs.shortcuts[slot]);
        });
      });
    } else if (page === 'Choose shortcut') {
      actions.forEach(function (name,id) {
        addOption(name,function () {
          prefs.shortcuts[shortcutSlot] = id; save(); showMenu('Remote shortcuts',shortcutSlot);
        });
      });
    } else if (page === 'Tile options') {
      panel.querySelector('h2').textContent = services[menuOwner];
      addOption('Move',function () {
        closeMenu(); quickMove = editing = moving = true; updateHint(); draw(); focusTile(menuOwner);
      });
      if (visible().length > 1) {
        addOption('Hide',function () {
          hiddenTile = {id:menuOwner, hidden:prefs.hidden.slice(), filter:prefs.filter, first:prefs.first};
          var current = visible(), pos = current.indexOf(menuOwner);
          if (!prefs.filter) { prefs.hidden = []; }
          prefs.hidden.push(menuOwner); prefs.filter = true;
          menuOwner = current[pos+1] === undefined ? current[pos-1] : current[pos+1];
          if (visible().indexOf(prefs.first) < 0) { prefs.first = menuOwner; }
          save(); draw(); closeMenu();
          undoButton.textContent = services[hiddenTile.id]+' hidden · OK to undo';
          undoButton.hidden = false; undoButton.focus();
          clearTimeout(undoTimer); undoTimer = setTimeout(dismissUndo,6000);
        });
      }
      if (menuOwner >= 0 && menuOwner < stockApps.length) {
        addOption('Choose another app',function () { showMenu('Choose app',0); });
        if (library.home(menuOwner).id !== library.guideTile.id) {
          addOption('Use TV guide on this tile',function () {
            library.pin(menuOwner,library.guideTile); updateTile(menuOwner); closeMenu();
          });
        }
        if (library.customised(menuOwner)) {
          addOption('Restore '+stockApps[menuOwner].name,function () {
            library.pin(menuOwner,null); updateTile(menuOwner); closeMenu();
          });
        }
      }
      addOption('Configure HDMI shortcut',function () { editInput(menuOwner); });
      addOption('Set as startup tile',function () {
        prefs.fixed = true; prefs.first = menuOwner; save(); closeMenu();
      });
    } else if (page === 'Wallpaper') {
      wallpapers.forEach(function (name,id) {
        addOption(name,function () { prefs.wallpaper = id; save(); draw(); showMenu('Customise',1); });
      });
    }
    addOption('Back',backMenu);
    options.children[Math.max(0,Math.min(position,options.children.length-1))].focus();
  }
  function backMenu() {
    if (menu === 'TV guide') { guide.back(); return; }
    if (menu === 'HDMI shortcut') { showMenu('Tile options',0); return; }
    if (menu === 'Choose favourites' || menu === 'My Home') { if (menuOwner === 9) { showMenu('Customise',0); } else { closeMenu(); } return; }
    if (menu === 'Replace saved layout') { showMenu('My Home',0); return; }
    if (menu === 'Choose app' && setupSlot >= 0) {
      var position = order.filter(function (id) { return id !== 7; }).indexOf(setupSlot);
      setupSlot = -1; showMenu('Set up Home apps',position);
    } else if (menu === 'Choose app') { showMenu('Tile options',0); }
    else if (menu === 'Set up Home apps') { showMenu('Customise',4); }
    else if (menu === 'Remote shortcuts') { showMenu('Customise',2); }
    else if (menu === 'Select a tile') { showMenu('Customise',3); }
    else if (menu === 'Choose shortcut') { showMenu('Remote shortcuts',shortcutSlot); }
    else if (menu === 'Wallpaper') { showMenu('Customise',1); }
    else if (menu === 'Startup tile') { showMenu('Settings',prefs.filter ? 3 : 2); }
    else if (menu === 'Visible tiles') { showMenu('Settings',1); }
    else { closeMenu(); }
  }
  function updateHint() {
    var hint = document.querySelector('#hint');
    hint.hidden = !editing;
    hint.textContent = moving ? 'Move with arrows · OK to place' : 'OK to pick a tile · Back to finish';
  }
  services.forEach(function (name,id) {
    var button = document.createElement('button');
    button.setAttribute('aria-label',name);
    button.setAttribute('data-service',id);
    var mark = document.createElement('span');
    mark.className = 'app-wordmark'; mark.hidden = true; button.appendChild(mark);
    var status = document.createElement('span');
    status.className = 'hdmi-status'; status.hidden = true; button.appendChild(status);
    buttons.push(button);
  });
  services.forEach(function (_,id) { updateTile(id); });

  buttons.push(document.querySelector('#air'),document.querySelector('#custom'),document.querySelector('#settings'),
    document.querySelector('#recent'),document.querySelector('#library'),document.querySelector('#centre'),document.querySelector('#guide'));
  buttons.forEach(function (button,id) {
    button.setAttribute('data-label',labels[id]);
    button.onfocus = function () {
      if (!dialog.hidden) { document.querySelector('#dismiss').focus(); return; }
      if (menu) { if (options.children[optionIndex]) { options.children[optionIndex].focus(); } return; }
      if (editing && id >= services.length) { focusTile(selected); return; }
      if (id < services.length) { lastGridTile = id; }
      selected = id;
      if (selectionName) { selectionName.textContent = labels[id]; }
      if (!editing) { remember(id); }
    };
    button.onclick = function () {
      if (pendingLaunch || playing || menu || !dialog.hidden || (editing && id >= services.length)) { return; }
      focusTile(id);
      if (editing) {
        if (id < 8) { moving = !moving; if (quickMove) { quickMove = editing = false; } updateHint(); draw(); focusTile(id); }
      } else if (id >= 9) {
        menuOwner = id; showMenu(labels[id],0);
      } else { activate(id); }
      sound('SELECT');
    };
  });
  document.querySelector('#dismiss').onclick = function () { sound('BACK'); dismiss(); };
  colours.forEach(function (colour,slot) {
    try { tv.tvinputdevice.registerKey('ColorF'+slot+colour); } catch (ignored) {}
  });
  function runShortcut(slot) {
    var action = prefs.shortcuts[slot];
    if (action >= 11) { menuOwner = selected; showMenu(labels[action],0); return; }
    if (action === 10) {
      if (selected >= services.length) { message('Tile options','Highlight an app or the HDMI tile first.'); return; }
      menuOwner = selected; showMenu('Tile options',0); return;
    }
    if (action === 9) {
      var recent = library.recents();
      if (!recent.length) { message('Last used','Open an app or HDMI 1 from the dashboard first.'); return; }
      menuOwner = selected; launchEntry(recent[0]); return;
    }
    activate(action);
  }
  document.addEventListener('keydown',function (event) {
    var key = event.keyCode, back = key === 10009 || key === 27 || key === 8;
    if (menu === 'TV guide' && guide.key(event)) { return; }
    if (event.target === inputName && !inputName.hidden) {
      if ([40,27,10009,65376,65385].indexOf(key) >= 0) { event.preventDefault(); options.children[0].focus(); }
      return;
    }
    if (event.target === search && !search.hidden) {
      resetIdle();
      if (key === 10009 || key === 27 || key === 65376 || key === 65385 || key === 40) {
        event.preventDefault(); options.children[0].focus();
      }
      return;
    }
    if (key !== 13) { cancelEnter(); }
    if (ambientActive || key === wakeKey) {
      event.preventDefault(); wakeKey = key;
      if (ambientActive) { wakeDashboard(); }
      return;
    }
    if (key === 13 || back || (key >= 403 && key <= 406)) {
      event.preventDefault();
      if (event.repeat || heldAction === key) { return; }
      heldAction = key;
    }
    resetIdle();
    if (hiddenTile) {
      if (key === 13) { undoButton.click(); return; }
      dismissUndo();
      if (back) { return; }
    }
    if (pendingLaunch) {
      event.preventDefault();
      if (back) { unlockLaunch(true); restoreFocus(); sound('BACK'); }
      return;
    }
    if (!dialog.hidden) {
      if (back || key === 13) { sound('BACK'); dismiss(); }
      else if (key === 9 || (key >= 37 && key <= 40)) { event.preventDefault(); document.querySelector('#dismiss').focus(); }
      return;
    }
    if (playing) {
      if (back && !leavingHDMI) {
        leavingHDMI = true;
        var leftHDMI = function () {
          leavingHDMI = playing = false; document.body.classList.remove('playing'); focusTile(selected); resetIdle();
        };
        var failedHide = function () { leftHDMI(); message('HDMI','The TV could not close the input. Open Samsung Home → Source if you need to change the input.'); };
        try { tv.tvwindow.hide(leftHDMI,failedHide); } catch (error) { failedHide(); }
      }
      return;
    }
    if (menu) {
      if (back) { sound('BACK'); backMenu(); }
      else if (key === 13) { options.children[optionIndex].click(); }
      else if (key === 9) {
        event.preventDefault();
        var optionCount = options.children.length;
        options.children[(optionIndex + (event.shiftKey ? -1 : 1) + optionCount) % optionCount].focus();
      } else if (key >= 37 && key <= 40) {
        event.preventDefault();
        var columns = panel.classList.contains('shelf-panel') ? 3 : 1;
        var targetOption = optionIndex;
        if (key === 38 && optionIndex === 0 && menu === 'TV guide' && guide.focusField()) { return; }
        if (key === 38 && optionIndex === 0 && !inputName.hidden) { inputName.focus(); return; }
        if (key === 38 && optionIndex < columns && !search.hidden) {
          search.focus(); return;
        }
        if (key === 38) { targetOption -= columns; }
        if (key === 40 && optionIndex + columns - optionIndex % columns < options.children.length) {
          targetOption = Math.min(options.children.length-1,optionIndex+columns);
        }
        if (key === 37 && optionIndex % columns > 0) { targetOption--; }
        if (key === 39 && optionIndex % columns < columns-1) { targetOption++; }
        if (targetOption !== optionIndex && options.children[targetOption]) {
          options.children[targetOption].focus(); sound(arrowSounds[key-37]);
        }
      }
      return;
    }
    if (key >= 403 && key <= 406) {
      if (!editing) { runShortcut(key-403); sound('SELECT'); }
      return;
    }
    if (key === 13) {
      if (selected < services.length && !editing && (inputNumber(library.home(selected)) || !prefs.quickLaunch)) {
        enterTile = selected;
        enterTimer = setTimeout(function () {
          var tile = enterTile;
          cancelEnter();
          if (tile < 0 || selected !== tile || document.hidden || menu || !dialog.hidden) { return; }
          menuOwner = tile; sound('SELECT'); showMenu('Tile options',0);
        },550);
      } else { buttons[selected].click(); }
      return;
    }
    if (editing && back) {
      event.preventDefault(); sound('BACK'); var returnTo = quickMove ? selected : 9; quickMove = editing = moving = false; updateHint(); draw(); focusTile(returnTo); return;
    }
    if (back && selected >= 11) { sound('BACK'); focusTile(lastGridTile); return; }
    if (back && tv) { event.preventDefault(); flushFocus(); sound('BACK'); tv.application.getCurrentApplication().exit(); return; }
    if (key < 37 || key > 40) { return; }
    event.preventDefault();
    var list = visible(), pos = list.indexOf(selected), dest = pos, next = selected;
    var width = prefs.largeTiles ? 3 : 4;
    var topKeys = prefs.largeTiles ? [11,12,13] : [11,12,13,14];
    var bottomKeys = prefs.largeTiles ? [8,9,10] : [8,9,9,10];
    if (pos >= 0) {
      if (key === 37 && pos % width > 0) { dest--; }
      if (key === 39 && pos % width < width-1 && pos+1 < list.length) { dest++; }
      if (key === 38 && pos >= width) { dest -= width; }
      else if (key === 38 && !editing) { next = topKeys[pos]; topOrigin = {tile:selected,tab:next}; }
      if (key === 40) {
        if (pos+width < list.length) { dest += width; }
        else if (pos-pos%width+width < list.length) { dest = list.length-1; }
        else if (!editing) {
          next = bottomKeys[pos % width];
          footerOrigin = {tile:selected, utility:next};
        }
      }
      if (dest !== pos) {
        next = list[dest];
        if (moving) {
          var target = order.indexOf(next);
          order.splice(order.indexOf(selected),1);
          order.splice(target,0,selected);
          try { localStorage.setItem('dashboard.tileOrder',JSON.stringify(order)); } catch (ignored) {}
          next = selected; draw();
        }
      }
    } else if (selected >= 11) {
      if (key === 37) { next = Math.max(11,selected-1); }
      if (key === 39) { next = Math.min(14,selected+1); }
      if (key === 40) {
        next = topOrigin && topOrigin.tab === selected && list.indexOf(topOrigin.tile) >= 0 ?
          topOrigin.tile : list[Math.min(list.length-1,Math.min(selected-11,width-1))];
      }
    } else if (selected >= 8) {
      if (key === 37) { next = Math.max(8,selected-1); }
      if (key === 39) { next = Math.min(10,selected+1); }
      if (key === 38) {
        if (footerOrigin && footerOrigin.utility === selected && list.indexOf(footerOrigin.tile) >= 0) {
          next = footerOrigin.tile;
        } else {
          var column = bottomKeys.lastIndexOf(selected);
          next = list[Math.min(list.length-1,column+width*Math.max(0,Math.floor((list.length-1-column)/width)))];
        }
      }
    }
    if (next !== selected || dest !== pos) { focusTile(next); sound(arrowSounds[key-37]); }
  });
  document.addEventListener('visibilitychange',function () {
    resetIdle(); clock();
    refreshHDMIStatus();
    if (document.hidden) {
      cancelEnter(); heldAction = wakeKey = null;
      if (pendingLaunch && pendingLaunch.external) {
        // Samsung can acknowledge a launch seconds before our last visible frame.
        // Leave the cover on that frame and clear it when Dashboard returns.
        clearTimeout(launchTimeout);
        pendingLaunch.wasHidden = true;
      } else { unlockLaunch(); }
      dismissUndo(); flushFocus();
    }
    if (!document.hidden) {
      if (pendingLaunch && pendingLaunch.wasHidden) { unlockLaunch(); }
      restoreFocus();
    }
  });
  draw(); clock(); refreshHDMIStatus(); resetIdle();
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { document.body.classList.add('wallpaper-ready'); });
  });
  var first = prefs.fixed ? prefs.first : prefs.last;
  focusTile(visible().indexOf(first) >= 0 ? first : visible()[0]);
  if (tv && firstVisit) { menuOwner = first; showMenu('Welcome',0); }
}());
