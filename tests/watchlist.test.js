const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { join } = require('node:path');
const createWatchlist = vm.runInNewContext(fs.readFileSync(join(__dirname,'../app/watchlist.js'),'utf8') + '\ncreateWatchlist');
const makeTitle = (id,minutes) => ({id,title:id,minutes,kind:'series',season:1,episode:1,finished:false,service:{id:'movie-app',name:'Movie app'}});

test('rank three unfinished titles inside the budget and restore the exact next episode', () => {
  const memory = new Map();
  const storage = {getItem:key => memory.get(key),setItem:(key,value) => memory.set(key,value)};
  const guide = createWatchlist(storage);
  for (const [id,minutes] of [['A',42],['B',31],['C',35],['D',19],['E',5],['F',40]]) {
    guide.save({...makeTitle(id,minutes),finished:id==='F'});
  }
  assert.equal(Array.from(guide.picks(),x => x.id).join(','),'C,B,D');
  guide.setMinutes(32);
  guide.save({...makeTitle('B',31),episode:3});
  const reopened = createWatchlist(storage);
  assert.equal(reopened.minutes(),32);
  assert.equal(reopened.picks()[0].episode,3);
  reopened.remove('B');
  assert.equal(reopened.picks()[0].id,'D');
});

test('reject incomplete titles and keep prior state if local storage rejects a write', () => {
  const guide = createWatchlist({getItem:() => 'bad json',setItem:() => { throw new Error('Storage full'); }});
  assert.throws(() => guide.save({...makeTitle('A',12),title:' '}),/Choose a title/);
  assert.throws(() => guide.setMinutes(0),/Choose a time/);
  assert.throws(() => guide.setMinutes(15),/Storage full/);
  assert.equal(guide.minutes(),40);
});
