// The guide shares the dashboard panel, remote focus, and installed-app launcher.
function createTVGuide(store,library,ui) {
  'use strict';
  var screen = 'home', origin = 'home', selected = null, draft = null;
  var field = null, generation = 0;
  var timer = null, night = null;
  var phone = typeof createPhoneWatchlist === 'function' ? createPhoneWatchlist(store,library,{
    option:ui.option, note:ui.note, focus:ui.focus, clear:ui.clear, host:window.dashboardPhoneOrigin,
    active:function () { return ui.active() && screen === 'phone'; },
    done:function () { go('home'); }
  }) : null;
  var input = document.getElementById('guide-value');
  var pageTitle = document.getElementById('panel-title');
  var ranges = {minutes:'Running time',season:'Season',episode:'Next episode',budget:'Available minutes',finish:'Finish by (24-hour time)'};
  function go(page,position) {
    screen = page;
    ui.refresh(position || 0);
  }
  function copy(item) {
    return JSON.parse(JSON.stringify(item));
  }
  function protection(action) {
    try { action(); return true; }
    catch (error) {
      ui.note('Could not save the change. Check the available storage and try again.');
      return false;
    }
  }
  function meta(item) {
    var part = item.kind === 'film' ? 'Film' : 'S'+item.season+' · E'+item.episode;
    return (item.finished ? 'Watched · ' : '') + part+'  ·  '+item.minutes+' min  ·  '+item.service.name;
  }
  function row(label,action,detail) {
    var button = ui.option(label,action);
    if (detail) {
      button.className = 'guide-pick';
      var small = document.createElement('small');
      small.textContent = detail;
      button.appendChild(small);
    }
    return button;
  }
  function openTitle(item,from) {
    selected = item;
    origin = from;
    go('detail');
  }
  function addTitle() {
    selected = null;
    draft = {id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),title:'',
      kind:'series',minutes:30,season:1,episode:1,finished:false,service:null};
    origin = screen;
    go('edit');
  }
  function editField(name) { field = name; go('field'); }
  function finishField() {
    var value = input.value.trim();
    if (field === 'finish') {
      var match = /^(\d{1,2}):?(\d{2})$/.exec(value);
      if (!match || Number(match[1])>23 || Number(match[2])>59) {
        ui.note('Enter a time such as 21:30.'); input.focus(); return;
      }
      var target = new Date();
      target.setHours(Number(match[1]),Number(match[2]),0,0);
      if (target.getTime() <= Date.now()) { target.setDate(target.getDate()+1); }
      if (protection(function () { store.setFinishAt(target.getTime()); })) { go('home'); }
      return;
    }
    if (field === 'title') {
      if (!value) { ui.note('Enter a title to continue.'); input.focus(); return; }
      draft.title = value;
    } else {
      if (!/^\d{1,3}$/.test(value) || Number(value) < 1) {
        ui.note('Enter a whole number from 1 to 999.'); input.focus(); return;
      }
      if (field === 'budget') {
        if (protection(function () { store.setMinutes(Number(value)); })) { go('home'); }
        return;
      }
      draft[field] = Number(value);
    }
    go('edit');
  }
  function showField() {
    pageTitle.textContent = field === 'title' ? 'Title name' : ranges[field];
    input.type = field === 'title' || field === 'finish' ? 'text' : 'number';
    input.setAttribute('aria-label',pageTitle.textContent);
    input.maxLength = field === 'title' ? 80 : field === 'finish' ? 5 : 3;
    input.hidden = false;
    if (field === 'finish') {
      input.value = clockTime(store.finishAt() > Date.now() ? store.finishAt() : Date.now()+3600000);
      ui.note('Use 24-hour time. An earlier time today means tomorrow.');
    } else { input.value = field === 'budget' ? store.minutes() : draft[field]; }
    row('Apply',finishField);
  }
  function editor() {
    pageTitle.textContent = selected ? 'Edit title' : 'Add a title';
    row('Title · '+(draft.title || 'Enter a name'),function () { editField('title'); });
    row('Service · '+(draft.service ? draft.service.name : 'Choose an app'),function () { go('services'); });
    row('Type · '+(draft.kind === 'film' ? 'Film' : 'Series'),function () {
      draft.kind = draft.kind === 'film' ? 'series' : 'film'; go('edit',2);
    });
    row('Running time · '+draft.minutes+' min',function () { editField('minutes'); });
    if (draft.kind === 'series') {
      row('Season · '+draft.season,function () { editField('season'); });
      row('Next episode · '+draft.episode,function () { editField('episode'); });
    }
    row('Save title',function () {
      if (!draft.title || !draft.service) { ui.note('Enter a name and choose a streaming service.'); return; }
      if (protection(function () { store.save(draft); })) { selected = draft; go('detail'); }
    });
  }
  function updateProgress(next) {
    if (protection(function () { store.save(next); })) { selected = next; go('detail'); }
  }
  function clockTime(when) {
    var date = new Date(when);
    return ('0'+date.getHours()).slice(-2)+':'+('0'+date.getMinutes()).slice(-2);
  }
  function finishLabel(when) {
    var date = new Date(when);
    var suffix = date.toDateString() === new Date().toDateString() ? '' : ' · '+date.toLocaleDateString();
    return clockTime(when)+suffix;
  }
  function refreshDeadline() {
    if (!store.finishAt() || store.finishAt() <= Date.now()) { return; }
    timer = setTimeout(function () {
      if (screen === 'home' && ui.active()) {
        var position = Array.prototype.indexOf.call(document.getElementById('options').children,document.activeElement);
        go('home',Math.max(0,position));
      }
    },(store.finishAt()-Date.now())%60000+100);
  }
  function finishBy() {
    pageTitle.textContent = 'Finish by';
    var now = new Date(), first = new Date(now.getTime());
    first.setSeconds(0,0);
    first.setMinutes(first.getMinutes()-first.getMinutes()%30+30);
    [0,30,60,90].forEach(function (offset) {
      var when = first.getTime()+offset*60000;
      row(finishLabel(when),function () {
        if (when <= Date.now()) { go('finish'); return; }
        if (protection(function () { store.setFinishAt(when); })) { go('home'); }
      });
    });
    row('Enter a finish time',function () { editField('finish'); });
  }
  function afterReturn(watched) {
    var next;
    if (protection(function () { next = store.answerReturn(watched); })) {
      if (next) { selected = next; go('detail'); }
      else { go('home'); }
    }
  }
  function onReturn() {
    var pending = store.pendingTitle();
    if (!pending) { return false; }
    if (screen !== 'return' || !ui.active()) {
      if (phone && screen === 'phone') { phone.close(); }
      night = null; selected = pending; origin = 'home'; go('return');
    }
    return true;
  }
  function openService() {
    var title = selected;
    if (!store.title(title.id) && !protection(function () { store.save(title); })) { return; }
    var episode = title.kind === 'series' && !title.finished && title.episode < 999;
    ui.launch(title.service,episode ? function () {
      protection(function () { store.beginEpisode(title); });
    } : null);
  }
  function detail() {
    pageTitle.textContent = selected.title;
    ui.note(meta(selected));
    var saved = store.title(selected.id);
    row((saved ? 'Open ' : 'Save and open ')+selected.service.name,openService);
    if (!saved) {
      row('Add to my watchlist',function () {
        if (protection(function () { store.save(selected); })) { go('detail'); }
      });
      return;
    }
    if (selected.kind === 'series' && !selected.finished && selected.episode < 999) {
      row('Mark episode '+selected.episode+' watched',function () {
        var next = copy(selected); next.episode++; updateProgress(next);
      });
    }
    row(selected.finished ? 'Return to watchlist' : 'Mark '+(selected.kind === 'series' ? 'series' : 'film')+' finished',function () {
      var next = copy(selected); next.finished = !next.finished; updateProgress(next);
    });
    row('Edit title',function () { draft = copy(selected); go('edit'); });
    row('Remove from watchlist',function () { go('remove'); });
  }
  function startNight() {
    night = {player:0,votes:[Object.create(null),Object.create(null)],titles:store.movieNightTitles()};
    go('nightReady');
  }
  function vote(item,index) {
    var choices = night.votes[night.player];
    choices[item.id] = !choices[item.id];
    go('nightVote',index);
  }
  function movieNight() {
    if (screen === 'nightReady') {
      pageTitle.textContent = 'Movie Night';
      if (!night.titles.length) {
        ui.note('Add a film or series from Paramount+, Netflix, Crunchyroll, Apple TV, Prime Video or Disney+ to play.');
        return;
      }
      var person = night.player+1;
      ui.note('Pass the remote to viewer '+person+'. The other viewer should look away during this ballot.');
      row('Start viewer '+person+'’s ballot',function () { go('nightVote'); });
    } else if (screen === 'nightVote') {
      pageTitle.textContent = 'Viewer '+(night.player+1)+' · Your picks';
      ui.note('Select any films or shows you would watch, then finish your ballot.');
      row('Finish ballot',function () {
        if (night.player === 0) { night.player = 1; go('nightReady'); }
        else { go('nightResults'); }
      });
      night.titles.forEach(function (item,index) {
        var checked = !!night.votes[night.player][item.id];
        var button = row((checked ? '✓ ' : '')+item.title,function () { vote(item,index+1); },meta(item));
        button.setAttribute('aria-pressed',String(checked));
      });
    } else {
      pageTitle.textContent = 'Shared picks';
      var matches = night.titles.filter(function (item) {
        return night.votes[0][item.id] && night.votes[1][item.id];
      });
      if (!matches.length) { ui.note('No shared picks this round. Try another ballot together.'); }
      else {
        row('Pick one at random',function () {
          openTitle(matches[Math.floor(Math.random()*matches.length)],'nightResults');
        });
        matches.forEach(function (item) {
          row(item.title,function () { openTitle(item,'nightResults'); },meta(item));
        });
      }
      row('Start a new round',startNight);
    }
  }
  function back() {
    if (screen === 'phone') { phone.back(); }
    else if (screen === 'home') { ui.close(); }
    else if (screen === 'return') { afterReturn(false); }
    else if (screen === 'nightVote') { go('nightReady'); }
    else if (screen === 'nightReady' || screen === 'nightResults') { night = null; go('home'); }
    else if (screen === 'detail') { go(origin); }
    else if (screen === 'edit') { go(selected ? 'detail' : origin); }
    else if (screen === 'services' || screen === 'field') { go(screen === 'field' && field === 'finish' ? 'finish' : screen === 'field' && field === 'budget' ? 'budget' : 'edit'); }
    else if (screen === 'remove') { go('detail'); }
    else { go('home'); }
  }
  function render(position) {
    clearTimeout(timer);
    if (screen === 'phone') { phone.render(position); return; }
    generation++;
    var ticket = generation;
    if (screen === 'home') {
      pageTitle.textContent = 'TV guide';
      row(store.finishAt() ? 'Choose a duration' : 'I have '+store.minutes()+' minutes',function () { go('budget'); });
      row(store.finishAt() ? 'Finish by '+finishLabel(store.finishAt()) : 'Finish by…',function () { go('finish'); });
      var picks = store.picks();
      picks.forEach(function (item) {
        row(item.title,function () {
          if (store.finishAt() && item.minutes > store.remaining()) { go('home'); return; }
          openTitle(item,'home');
        },meta(item));
      });
      if (store.finishAt() && !store.remaining()) { ui.note('Finish time reached. Choose a new time to see more picks.'); }
      else if (store.finishAt() && picks.length) { ui.note(store.remaining()+' minutes until your finish time.'); }
      else if (!picks.length) {
        ui.note(store.titles().length ? 'No unwatched titles fit this time. Choose a longer window or add a title.' :
          'Add a title and its running time to see what fits.');
      }
      row('Movie Night · Two viewers',startNight);
      row('My watchlist · '+store.titles().length,function () { go('list'); });
      row('Add a title',addTitle);
      if (phone) { row('Add from phone',function () { clearTimeout(timer); screen = 'phone'; phone.open(); }); }
    } else if (screen === 'finish') { finishBy(); }
    else if (screen === 'return') {
      pageTitle.textContent = selected.title;
      ui.note('Did you finish season '+selected.season+', episode '+selected.episode+'?');
      row('Still watching',function () { afterReturn(false); });
      row('Mark episode watched',function () { afterReturn(true); });
    } else if (screen === 'nightReady' || screen === 'nightVote' || screen === 'nightResults') { movieNight(); }
    else if (screen === 'budget') {
      pageTitle.textContent = 'How much time?';
      [15,25,40,60,90,120].forEach(function (minutes) {
        row(minutes+' minutes',function () { if (protection(function () { store.setMinutes(minutes); })) { go('home'); } });
      });
      row('Enter another time',function () { editField('budget'); });
    } else if (screen === 'list') {
      pageTitle.textContent = 'My watchlist';
      store.titles().forEach(function (item) { row(item.title,function () { openTitle(item,'list'); },meta(item)); });
      row('Add a title',addTitle);
    } else if (screen === 'edit') { editor(); }
    else if (screen === 'field') { showField(); }
    else if (screen === 'services') {
      pageTitle.textContent = 'Choose streaming service';
      ui.note('Reading installed apps…');
      row('Back',back);
      ui.focus(0);
      library.installed(function (apps) {
        if (generation !== ticket || !ui.active()) { return; }
        ui.clear();
        ui.note(apps.length ? '' : 'No apps were listed by the TV.');
        apps.forEach(function (app) {
          row(app.name,function () { draft.service = {id:app.id,name:app.name}; go('edit',1); });
        });
        row('Back',back); ui.focus(0);
      },function () {
        if (generation === ticket && ui.active()) { ui.note('Could not read installed apps. Press Back and try again.'); }
      });
      return;
    } else if (screen === 'detail') { detail(); }
    else if (screen === 'remove') {
      pageTitle.textContent = 'Remove '+selected.title+'?';
      row('Keep title',back);
      row('Remove title',function () {
        if (protection(function () { store.remove(selected.id); })) { go(origin); }
      });
    }
    row('Back',back);
    ui.focus(position);
    if (screen === 'field') { input.focus(); input.select(); }
    if (screen === 'home') { refreshDeadline(); }
  }
  return {
    render:render,back:back,onReturn:onReturn,
    close:function () {
      clearTimeout(timer);
      if (phone && screen === 'phone') { phone.close(); }
      screen = 'home'; night = null;
    },
    key:function (event) {
      if (screen === 'phone') { return phone.key(event); }
      if (event.target !== input || input.hidden) { return false; }
      var code = event.keyCode;
      if (code === 13 || code === 65376) { event.preventDefault(); finishField(); }
      else if (code === 27 || code === 10009 || code === 65385) { event.preventDefault(); back(); }
      else if (code === 40 || code === 9) { event.preventDefault(); ui.focus(0); }
      return true;
    },
    focusField:function () {
      if (screen === 'phone') { return phone.focusField(); }
      if (input.hidden) { return false; }
      input.focus(); return true;
    }
  };
}
