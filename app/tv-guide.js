// The guide shares the dashboard panel, remote focus, and installed-app launcher.
function createTVGuide(store,library,ui) {
  'use strict';
  var screen = 'home', origin = 'home', selected = null, draft = null;
  var field = null, generation = 0;
  var input = document.getElementById('guide-value');
  var pageTitle = document.getElementById('panel-title');
  var ranges = {minutes:'Running time',season:'Season',episode:'Next episode',budget:'Available minutes'};
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
    input.type = field === 'title' ? 'text' : 'number';
    input.setAttribute('aria-label',pageTitle.textContent);
    input.maxLength = field === 'title' ? 80 : 3;
    input.hidden = false;
    input.value = field === 'budget' ? store.minutes() : draft[field];
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
  function detail() {
    pageTitle.textContent = selected.title;
    ui.note(meta(selected));
    row('Open '+selected.service.name,function () { ui.launch(selected.service); });
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
  function back() {
    if (screen === 'home') { ui.close(); }
    else if (screen === 'detail') { go(origin); }
    else if (screen === 'edit') { go(selected ? 'detail' : origin); }
    else if (screen === 'services' || screen === 'field') { go(screen === 'field' && field === 'budget' ? 'budget' : 'edit'); }
    else if (screen === 'remove') { go('detail'); }
    else { go('home'); }
  }
  function render(position) {
    generation++;
    var ticket = generation;
    if (screen === 'home') {
      pageTitle.textContent = 'TV guide';
      row('I have '+store.minutes()+' minutes',function () { go('budget'); });
      var picks = store.picks();
      picks.forEach(function (item) {
        row(item.title,function () { openTitle(item,'home'); },meta(item));
      });
      if (!picks.length) {
        ui.note(store.titles().length ? 'No unwatched titles fit this time. Choose a longer window or add a title.' :
          'Add a title and its running time to see what fits.');
      }
      row('My watchlist · '+store.titles().length,function () { go('list'); });
      row('Add a title',addTitle);
    } else if (screen === 'budget') {
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
  }
  return {
    render:render,back:back,
    key:function (event) {
      if (event.target !== input || input.hidden) { return false; }
      var code = event.keyCode;
      if (code === 13 || code === 65376) { event.preventDefault(); finishField(); }
      else if (code === 27 || code === 10009 || code === 65385) { event.preventDefault(); back(); }
      else if (code === 40 || code === 9) { event.preventDefault(); ui.focus(0); }
      return true;
    },
    focusField:function () {
      if (input.hidden) { return false; }
      input.focus(); return true;
    }
  };
}
