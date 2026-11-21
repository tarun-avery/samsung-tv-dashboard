// Local watchlist shared by the time picker, title editor and return prompt.
function createWatchlist(storage) {
  'use strict';
  var key = 'dashboard.watchlist.v1';
  var state = {minutes:40, titles:[], finishAt:0, pending:null};
  var serviceNames = {
    'org.tizen.netflix-app':'netflix', 'rJyOSqC6Up.PPlusIntl':'paramountplus',
    'OGLLvqej7u.CrunchyrollWebApp':'crunchyroll', 'evKhCgZelL.AmazonIgnitionLauncher2':'primevideo',
    'Y6A54cEa22.AppleTV':'appletv', 'MCmYXNxgcu.DisneyPlus':'disneyplus'
  };
  var nameAliases = {
    'netflix':'netflix', 'paramount+':'paramountplus', 'paramount plus':'paramountplus',
    'crunchyroll':'crunchyroll', 'prime video':'primevideo', 'amazon prime video':'primevideo',
    'apple tv':'appletv', 'apple tv+':'appletv', 'apple tv plus':'appletv',
    'disney+':'disneyplus', 'disney plus':'disneyplus'
  };
  function provider(service) {
    var name = service.name.toLowerCase().trim().replace(/\s+/g,' ');
    if (!Object.prototype.hasOwnProperty.call(nameAliases,name)) { return ''; }
    var canonical = nameAliases[name];
    if (Object.prototype.hasOwnProperty.call(serviceNames,service.id)) {
      return serviceNames[service.id] === canonical ? canonical : '';
    }
    // Regional installs can have a different Tizen package ID with the same app name.
    if (service.id === '9Ur5IzDKqV.TizenYouTube' || !/^[A-Za-z0-9]{10}\.[A-Za-z0-9._-]+$/.test(service.id)) { return ''; }
    return canonical;
  }
  function integer(n,max) {
    return typeof n === 'number' && n >= 1 && n <= max && n === Math.floor(n);
  }
  function validTitle(entry) {
    return entry && typeof entry.id === 'string' && entry.id &&
      typeof entry.title === 'string' && entry.title.trim() && entry.title.length <= 80 &&
      entry.service && typeof entry.service.id === 'string' && entry.service.id &&
      typeof entry.service.name === 'string' && entry.service.name &&
      integer(entry.minutes,999) && (entry.kind === 'series' || entry.kind === 'film') &&
      integer(entry.season,999) && integer(entry.episode,999) && typeof entry.finished === 'boolean';
  }
  try {
    var saved = JSON.parse(storage.getItem(key)) || {};
    if (integer(saved.minutes,999)) { state.minutes = saved.minutes; }
    if (Array.isArray(saved.titles)) { state.titles = saved.titles.filter(validTitle); }
    if (integer(saved.finishAt,8640000000000000)) { state.finishAt = saved.finishAt; }
    if (saved.pending && typeof saved.pending.id === 'string' && integer(saved.pending.season,999) &&
        integer(saved.pending.episode,999)) { state.pending = saved.pending; }
  } catch (ignored) {}
  function write(change) {
    var next = {minutes:state.minutes,titles:state.titles,finishAt:state.finishAt,pending:state.pending};
    Object.keys(change).forEach(function (name) { next[name] = change[name]; });
    storage.setItem(key,JSON.stringify(next));
    state = next;
  }
  function byId(id) {
    for (var i=0; i<state.titles.length; i++) { if (state.titles[i].id === id) { return state.titles[i]; } }
    return null;
  }
  function replaceTitle(title) {
    var titles = state.titles.slice();
    var index = titles.map(function (item) { return item.id; }).indexOf(title.id);
    if (index < 0) { titles.push(title); } else { titles[index] = title; }
    return titles;
  }
  function sameEpisode(title,pending) {
    return title && pending && title.id === pending.id && !title.finished && title.kind === 'series' &&
      title.season === pending.season && title.episode === pending.episode && title.service.id === pending.service;
  }
  function save(title) {
    if (!validTitle(title)) { throw new Error('Choose a title, running time and service.'); }
    var change = {titles:replaceTitle(title)};
    if (state.pending && state.pending.id === title.id && !sameEpisode(title,state.pending)) { change.pending = null; }
    write(change);
  }
  function minutesLeft(now) {
    return state.finishAt ? Math.max(0,Math.floor((state.finishAt-now)/60000)) : state.minutes;
  }
  function movieNightTitles() {
    var seen = Object.create(null), ids = Object.create(null), candidates = [];
    var ideas = (typeof window !== 'undefined' && window.dashboardMovieNightIdeas) || [];
    function consider(item) {
      if (!validTitle(item)) { return; }
      var service = provider(item.service);
      var name = service+'|'+item.kind+'|'+item.title.trim().toLowerCase();
      if (ids[item.id] || seen[name] || !service) { return; }
      ids[item.id] = seen[name] = true;
      if (!item.finished) { candidates.push(item); }
    }
    state.titles.forEach(consider);
    if (Array.isArray(ideas)) { ideas.forEach(consider); }
    return candidates;
  }
  function pendingTitle() {
    var title = state.pending && byId(state.pending.id);
    return sameEpisode(title,state.pending) ? title : null;
  }
  return {
    titles:function () { return state.titles.slice(); },
    title:byId,
    provider:provider,
    minutes:function () { return state.minutes; },
    finishAt:function () { return state.finishAt; },
    remaining:function () { return minutesLeft(Date.now()); },
    setMinutes:function (value) {
      if (!integer(value,999)) { throw new Error('Choose a time from 1 to 999 minutes.'); }
      write({minutes:value,finishAt:0});
    },
    setFinishAt:function (when) {
      if (!integer(when,8640000000000000) || when <= Date.now()) { throw new Error('Choose a future finish time.'); }
      write({finishAt:when});
    },
    picks:function () {
      var minutes = minutesLeft(Date.now());
      return state.titles.filter(function (item) { return !item.finished && item.minutes <= minutes; })
        .sort(function (a,b) { return b.minutes-a.minutes || a.title.localeCompare(b.title) || a.id.localeCompare(b.id); })
        .slice(0,3);
    },
    movieNightTitles:movieNightTitles,
    beginEpisode:function (item) {
      var pending = {id:item.id,season:item.season,episode:item.episode,service:item.service.id};
      if (sameEpisode(byId(item.id),pending) && item.episode < 999) { write({pending:pending}); }
    },
    pendingTitle:pendingTitle,
    answerReturn:function (watched) {
      var title = pendingTitle();
      if (!title) { return null; }
      var change = {pending:null};
      if (watched) {
        var next = JSON.parse(JSON.stringify(title));
        next.episode++;
        change.titles = replaceTitle(next);
        title = next;
      }
      write(change);
      return title;
    },
    save:save,
    remove:function (id) {
      var change = {titles:state.titles.filter(function (item) { return item.id !== id; })};
      if (state.pending && state.pending.id === id) { change.pending = null; }
      write(change);
    }
  };
}
