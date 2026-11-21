/* App metadata comes from the TV's public application catalogue. */
function createDashboardLibrary(tv, defaultEntries) {
  'use strict';
  var key = 'dashboard.appLibrary.v1';
  var defaultInput = {id:'input:hdmi1',name:'HDMI 1',art:'input'};
  var guideTile = {id:'dashboard:guide',name:'TV guide'};
  var state = { pins: {}, recent: [] };
  var known = Object.create(null);
  defaultEntries.forEach(function (app) { known[app.id] = app; });

  function entry(value, allowInput) {
    if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') { return null; }
    if (allowInput && value.id === guideTile.id) { return guideTile; }
    if (known[value.id]) { return known[value.id]; }
    if (allowInput && /^input:hdmi[1-9]$/.test(value.id)) {
      return {id:value.id,name:value.name.trim().slice(0,32) || 'HDMI '+value.id.slice(-1),
        art:['controller','handheld','receiver'].indexOf(value.art) >= 0 ? value.art : 'input'};
    }
    if (!/^[A-Za-z0-9]{10}\.[A-Za-z0-9._-]+$/.test(value.id)) { return null; }
    var name = value.name.split(/\s+[–-]\s+/)[0].trim().slice(0,80);
    return name ? {id:value.id,name:name} : null;
  }
  try {
    var saved = JSON.parse(localStorage.getItem(key)) || {};
    defaultEntries.concat(defaultInput).forEach(function (_, i) {
      var pin = entry(saved.pins && saved.pins[i],true);
      if (pin && (i !== 7 || /^input:/.test(pin.id))) { state.pins[i] = pin; }
    });
    if (Array.isArray(saved.recent)) {
      saved.recent.forEach(function (item) {
        var app = entry(item,true);
        if (app && state.recent.length < 8 && !state.recent.some(function (x) { return x.id === app.id; })) {
          state.recent.push(app);
        }
      });
    }
  } catch (ignored) {}
  function save() {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch (ignored) {}
  }
  function remember(app) {
    app = entry(app,true);
    var last = state.recent[0];
    if (!app || (last && last.id === app.id && last.name === app.name && last.art === app.art)) { return; }
    state.recent = [app].concat(state.recent.filter(function (x) { return x.id !== app.id; })).slice(0,8);
    save();
  }
  function home(slot) {
    return state.pins[slot] || (slot === 7 ? defaultInput : defaultEntries[slot]);
  }
  function installed(done, failed) {
    if (!tv) { done(defaultEntries.slice()); return; }
    try {
      tv.application.getAppsInfo(function (apps) {
        var seen = Object.create(null);
        var found = [];
        apps.forEach(function (info) {
          if (!info || typeof info.name !== 'string' || info.id === 'AlpineDash.Dashboard') { return; }
          var app = entry(info,false);
          // This generation also reports background helpers and system settings as visible.
          if (!app || seen[app.id] || (!known[app.id] && (!info.show ||
              /service|preview|accelerator|privacychoices/i.test(info.id) ||
              /privacy settings|^eden$|^privacychoices$/i.test(info.name)))) { return; }
          seen[app.id] = true;
          found.push(app);
        });
        found.sort(function (a,b) { return a.name.localeCompare(b.name); });
        done(found);
      },failed);
    } catch (error) { failed(error); }
  }
  return {
    home:home, installed:installed, remember:remember, guideTile:guideTile,
    recents:function () { return state.recent.slice(); },
    customised:function (slot) { return !!state.pins[slot]; },
    pin:function (slot,app) {
      if (!defaultEntries[slot] && slot !== 7) { return; }
      if (!app || (defaultEntries[slot] && app.id === defaultEntries[slot].id)) { delete state.pins[slot]; }
      else {
        var valid = entry(app,true);
        if (!valid || (slot === 7 && !/^input:/.test(valid.id))) { return; }
        state.pins[slot] = valid;
      }
      save();
    }
  };
}
