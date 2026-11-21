// Guide subpage. The Mac resolves series and checks regional episode evidence.
function createEpisodeShelf(store,ui) {
  'use strict';
  var page = 'feed', generation = 0, xhr = null, loading = false, demo = false;
  var series = [], records = [], issues = [], chosen, matches, activeRow;
  var heading = document.getElementById('panel-title');
  var providerNames = {netflix:'Netflix',paramountplus:'Paramount+',crunchyroll:'Crunchyroll',
    appletv:'Apple TV',primevideo:'Prime Video',disneyplus:'Disney+'};
  var sample = {title:'Yellowjackets',kind:'series',season:1,episode:1,
    service:{id:'rJyOSqC6Up.PPlusIntl',name:'Paramount+'}};
  function label(item) { return providerNames[store.provider(item.service)]; }
  function host() {
    if (window.dashboardPhoneOrigin) { return window.dashboardPhoneOrigin; }
    try { return (JSON.parse(localStorage.getItem('dashboard.phonePair.v1')) || {}).origin || ''; }
    catch (ignored) { return ''; }
  }
  function mappingKey(item) { return 'dashboard.episodeSeries.'+label(item)+'|'+item.title.trim().toLowerCase(); }
  function mapped(item) {
    try { return Number(localStorage.getItem(mappingKey(item))) || null; } catch (ignored) { return null; }
  }
  function stop() {
    generation++;
    if (xhr) { xhr.abort(); xhr = null; }
    loading = false;
  }
  function dayText(iso) {
    var bits = iso.split('-');
    return Number(bits[2])+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(bits[1])-1]+' '+bits[0];
  }
  function add(labelText, fn, detail) {
    var b = ui.option(labelText,fn);
    if (detail) {
      b.className = 'guide-pick';
      var small = document.createElement('small');
      small.textContent = detail; b.appendChild(small);
    }
  }
  function back() {
    if (page === 'feed') { stop(); ui.done(); return; }
    page = page === 'details' ? activeRow.from : 'feed';
    draw();
  }
  function eligible(item, episode) {
    return episode.season > item.season || (episode.season === item.season && episode.episode >= item.episode);
  }
  function showEpisode(entry, from) {
    activeRow = {record:entry,from:from}; page = 'details'; draw();
  }
  function list(entries,from) {
    entries.forEach(function (entry) {
      var e = entry.episode, item = entry.item;
      add(item.title+' · S'+e.season+' E'+e.episode,function () { showEpisode(entry,from); },
        label(item)+' · '+dayText(e.date)+(entry.stale ? ' · Cached' : ''));
    });
  }
  function openMatch(issue) { chosen = issue.item; matches = issue.matches; page = 'match'; draw(); }
  function draw() {
    if (!ui.active()) { return; }
    ui.clear(); ui.note('');
    heading.textContent = 'New episodes on my services';
    if (page === 'details') {
      var entry = activeRow.record, e = entry.episode;
      heading.textContent = entry.item.title;
      var status = e.evidence === 'uk-release' ? 'UK release' :
        e.evidence === 'uk-catalogue' ? 'Listed on the UK subscription. Original air date' : 'Original air date · UK availability unconfirmed';
      ui.note('S'+e.season+' E'+e.episode+(e.name ? ' · '+e.name : '')+' · '+status+' · '+dayText(e.date)+
        '. Source: '+e.source+'. Checked '+dayText(entry.checked.slice(0,10))+'.');
      add('Open '+label(entry.item),function () {
        var same = !demo && e.season === entry.item.season && e.episode === entry.item.episode;
        ui.launch(entry.item.service,same ? function () { store.beginEpisode(entry.item); } : null);
      });
    } else if (page === 'match') {
      heading.textContent = 'Which series is '+chosen.title+'?';
      matches.forEach(function (candidate) {
        add(candidate.name,function () {
          try { localStorage.setItem(mappingKey(chosen),String(candidate.id)); }
          catch (ignored) { ui.note('Could not save the series selection.'); return; }
          load(demo);
        },[candidate.year,candidate.channel].filter(Boolean).join(' · '));
      });
    } else if (page === 'sources') {
      heading.textContent = 'Episode guide sources';
      ui.note('Episode names and original schedules: TVmaze.com (CC BY-SA 4.0). UK releases need a matching UK streaming schedule or a dated regional provider announcement. When a Watchmode key is configured on the Mac, episode-level UK subscription listings are checked too. Coverage varies by show. The list covers the last 30 days and the next 14 days.');
    } else if (page === 'calendar') {
      heading.textContent = 'Other episode dates';
      ui.note('TVmaze lists original premieres. UK availability on your selected streaming service is unconfirmed unless an entry shows a UK source. Future dates can change.');
      list(records.filter(function (r) { return r.episode.upcoming || r.episode.evidence === 'airdate'; }),page);
    } else {
      var confirmed = records.filter(function (r) { return !r.episode.upcoming && r.episode.evidence !== 'airdate'; });
      var others = records.length - confirmed.length;
      var notes = [];
      if (demo) { notes.push('Example using current listings. Your watchlist stays as it is.'); }
      if (loading) { notes.push('Checking '+loading+' of '+series.length+' series…'); }
      else if (!series.length) { notes.push('Add an unfinished series from one of your six services to see its new episodes here.'); }
      else if (!confirmed.length) { notes.push('No new UK episodes confirmed for these series in the last 30 days.'); }
      else { notes.push('Recent UK episodes at or beyond your saved episode.'); }
      if (records.some(function (r) { return r.stale; })) { notes.push('Some listings are cached from an earlier check.'); }
      var notices = issues.filter(function (r) { return !r.matches; });
      if (notices.length) { notes.push(notices.map(function (r) { return r.item.title+' — '+r.message; }).join(' ')); }
      ui.note(notes.join(' '));
      list(confirmed,page);
      if (others) { add('Other episode dates · '+others,function () { page='calendar'; draw(); }); }
      issues.filter(function (r) { return r.matches; }).forEach(function (r) {
        add('Choose series · '+r.item.title,function () { openMatch(r); });
      });
      if (!loading && series.length) { add('Refresh listings',function () { load(demo); }); }
      if (!series.length && !demo) { add('Preview a live listing · Yellowjackets',function () { load(true); }); }
      if (demo) { add('My series',function () { load(false); }); }
      if (!loading && !demo) {
        series.forEach(function (item) {
          if (mapped(item)) { add('Change series match · '+item.title,function () {
            try { localStorage.removeItem(mappingKey(item)); } catch (ignored) {}
            load(false);
          }); }
        });
      }
      add('Sources and coverage',function () { page='sources'; draw(); });
    }
    add('Back',back); ui.focus(0);
  }
  function load(example) {
    stop(); page='feed'; demo=example; records=[]; issues=[];
    series = example ? [sample] : store.titles().filter(function (item) {
      return item.kind === 'series' && !item.finished && !!label(item);
    });
    var run = generation, base = host();
    function read(index) {
      if (generation !== run || !ui.active()) { return; }
      if (index >= series.length) {
        loading = false;
        records.sort(function (a,b) { return b.episode.date.localeCompare(a.episode.date) ||
          a.item.title.localeCompare(b.item.title) || a.episode.season-b.episode.season || a.episode.episode-b.episode.episode; });
        if (page === 'feed') { draw(); }
        return;
      }
      var item = series[index];
      loading = index+1;
      if (page === 'feed') { draw(); }
      var req = new XMLHttpRequest(); xhr = req;
      function finish(data) {
        if (xhr !== req || generation !== run || !ui.active()) { return; }
        xhr = null;
        if (data && Array.isArray(data.episodes)) {
          data.episodes.forEach(function (e) {
            if (eligible(item,e)) { records.push({episode:e,item:item,checked:data.checked,stale:data.stale}); }
          });
          if (data.note) { issues.push({item:item,message:data.note}); }
        } else if (data && Array.isArray(data.matches) && data.matches.length) {
          issues.push({item:item,matches:data.matches});
        } else {
          issues.push({item:item,message:data && Array.isArray(data.matches) ? 'No series match found.' :
            'Listings unavailable. Check the Mac companion and internet connection.'});
        }
        read(index+1);
      }
      try {
        req.open('POST',base+'/api/episodes',true); req.timeout=30000;
        req.setRequestHeader('Content-Type','application/json');
        req.onload = function () {
          var data = null;
          if (req.status === 200) { try { data=JSON.parse(req.responseText); } catch (ignored) {} }
          finish(data);
        };
        req.onerror=req.ontimeout=function () { finish(null); };
        req.send(JSON.stringify({title:item.title,service:label(item),seriesId:demo ? 36672 : mapped(item)}));
      } catch (ignored) { finish(null); }
    }
    if (!base && series.length) {
      issues.push({item:series[0],message:'Set the Mac companion address in Add from phone.'});
      draw(); return;
    }
    read(0);
  }
  return {open:function () { load(false); }, render:draw, back:back, close:stop};
}
