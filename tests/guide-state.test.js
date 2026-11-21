const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const {join} = require('node:path');
const source = fs.readFileSync(join(__dirname,'../app/watchlist.js'),'utf8');
const netflix = {id:'org.tizen.netflix-app',name:'Netflix'};
function fixture(ideas) {
  let now = new Date(2026,1,1,23,35,0).getTime();
  const clock = {now:() => now};
  const data = new Map();
  const open = () => vm.runInNewContext(source+'\ncreateWatchlist',{Date:clock,window:{dashboardMovieNightIdeas:ideas}})(
    {getItem:key=>data.get(key),setItem:(key,text)=>data.set(key,text)});
  return {open,now:()=>now,advance:minutes=>{now+=minutes*60000;}};
}
function item(id,minutes=25) {
  return {id,title:id,kind:'series',season:1,episode:1,minutes,service:netflix,finished:false};
}
test('finish-by budget falls across midnight, survives restart and expires until replaced', () => {
  const world=fixture([]);
  const store=world.open();
  store.save(item('A',30));store.save(item('B',20));store.setFinishAt(world.now()+30*60000);
  assert.equal(store.picks()[0].title,'A');
  world.advance(9);
  assert.equal(world.open().picks()[0].title,'B');
  world.advance(22);
  assert.equal(store.picks().length,0);
  store.setMinutes(30);
  assert.equal(store.finishAt(),0);
  assert.equal(world.open().picks()[0].title,'A');
});
test('episode return survives reload, accepts a single response, and rejects stale episode updates', () => {
  const world=fixture([]);
  let store=world.open(), ep=item('A');store.save(ep);store.beginEpisode(ep);
  store=world.open();assert.equal(store.pendingTitle().id,'A');
  assert.equal(store.answerReturn(false).episode,1);assert.equal(store.pendingTitle(),null);
  store.beginEpisode(ep);assert.equal(store.answerReturn(true).episode,2);assert.equal(store.answerReturn(true),null);
  store.beginEpisode(ep);assert.equal(store.pendingTitle(),null);
  store.beginEpisode(store.title('A'));store.save({...store.title('A'),season:2,episode:1});
  assert.equal(world.open().pendingTitle(),null);
  store.beginEpisode(store.title('A'));store.remove('A');assert.equal(store.pendingTitle(),null);
});
test('Movie Night admits six exact providers, respects saved progress, excludes completed series and leaves the watchlist alone', () => {
  const providers=[
    netflix,{id:'rJyOSqC6Up.PPlusIntl',name:'Paramount+'},
    {id:'OGLLvqej7u.CrunchyrollWebApp',name:'Crunchyroll'},{id:'evKhCgZelL.AmazonIgnitionLauncher2',name:'Prime Video'},
    {id:'Y6A54cEa22.AppleTV',name:'Apple TV'},{id:'MCmYXNxgcu.DisneyPlus',name:'Disney+'}
  ];
  const ideas=providers.map((service,i)=>({...item(String(i)),service}));
  const world=fixture([...ideas,{...item('short'),service:{id:'abcdefghij.test',name:'Netflix Shorts'}},
    {...item('youtube'),service:{id:'9Ur5IzDKqV.TizenYouTube',name:'Netflix'}},
    {...item('not-a-match'),service:{id:'Y6A54cEa22.AppleTV',name:'Disney+'}}]);
  const store=world.open();
  assert.equal(store.movieNightTitles().length,6);assert.equal(store.titles().length,0);
  store.save({...ideas[0],id:'local',episode:7});store.save({...ideas[1],finished:true});
  const picks=store.movieNightTitles();
  assert.equal(picks.length,5);assert.equal(picks[0].id,'local');assert.equal(picks[0].episode,7);
});
