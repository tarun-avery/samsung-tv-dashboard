// Local watchlist shared by the time picker and title editor.
function createWatchlist(storage) {
  'use strict';
  var key = 'dashboard.watchlist.v1';
  var state = {minutes:40, titles:[]};

  function integer(n, max) {
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
    var saved = JSON.parse(storage.getItem(key));
    if (saved && integer(saved.minutes,999)) { state.minutes = saved.minutes; }
    if (saved && Array.isArray(saved.titles)) { state.titles = saved.titles.filter(validTitle); }
  } catch (ignored) {}
  function write(minutes,titles) {
    var next = {minutes:minutes,titles:titles};
    storage.setItem(key,JSON.stringify(next));
    state = next;
  }
  function save(title) {
    if (!validTitle(title)) { throw new Error('Choose a title, running time and service.'); }
    var titles = state.titles.slice();
    var index = titles.map(function (item) { return item.id; }).indexOf(title.id);
    if (index < 0) { titles.push(title); } else { titles[index] = title; }
    write(state.minutes,titles);
  }
  return {
    titles:function () { return state.titles.slice(); },
    minutes:function () { return state.minutes; },
    setMinutes:function (value) {
      if (!integer(value,999)) { throw new Error('Choose a time from 1 to 999 minutes.'); }
      write(value,state.titles);
    },
    picks:function () {
      return state.titles.filter(function (item) { return !item.finished && item.minutes <= state.minutes; })
        .sort(function (a,b) { return b.minutes-a.minutes || a.title.localeCompare(b.title) || a.id.localeCompare(b.id); })
        .slice(0,3);
    },
    save:save,
    remove:function (id) {
      write(state.minutes,state.titles.filter(function (item) { return item.id !== id; }));
    }
  };
}
