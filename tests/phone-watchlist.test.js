const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const item = {
  id:'21d393a4-6173-4539-b3b2-5c42444b2d4e',title:'Harbour Lights',
  kind:'series',minutes:32,season:2,episode:4,service:'Prime Video'
};
const installed = [{id:'evKhCgZelL.AmazonIgnitionLauncher2',name:'Amazon player'}];
const response = {
  tvToken:'local-test-token',phoneBaseUrl:'http://localhost:47831',phoneCode:'00123456',
  qrDataUrl:'data:image/png;base64,AA==',expiresAt:Math.floor(Date.now()/1000)+900
};

function fixture(host) {
  const entries = new Map(), pending = [], timers = new Map(), nodes = [], buttons = [];
  let serial = 0, open = true;
  function element(id) {
    const node = {id,children:[],focus(){},select(){},setAttribute(){},
      appendChild(child) { this.children.push(child); }};
    nodes.push(node);
    return node;
  }
  ['guide-value','panel-note','panel-title'].forEach(element);
  class XHR {
    open(method,url) { this.method=method; this.url=url; this.headers={}; }
    setRequestHeader(key,value) { this.headers[key]=value; }
    send(data) { this.payload=data && JSON.parse(data); pending.push(this); }
    abort() { this.aborted=true; }
  }
  const storage = {getItem:key => entries.get(key),setItem:(key,value) => entries.set(key,value)};
  const context = vm.createContext({
    document:{getElementById:id => nodes.findLast(n => n.id===id),createElement:() => element('')},
    window:{localStorage:storage},XMLHttpRequest:XHR,
    setTimeout(fn) { timers.set(++serial,fn); return serial; },
    clearTimeout(id) { timers.delete(id); }
  });
  function source(file) { return readFileSync(join(__dirname,'../app',file),'utf8'); }
  const store = vm.runInContext(source('watchlist.js')+'\ncreateWatchlist',context)(storage);
  const phone = vm.runInContext(source('phone-watchlist.js')+'\ncreatePhoneWatchlist',context)(store,
    {installed:success => success(installed)},{
      host,active:()=>open,clear(){buttons.length=0;},option(name,run){buttons.push({name,run});},
      done(){open=false;},focus(){},note(text){nodes.find(n=>n.id==='panel-note').textContent=text;}
    });
  function reply(url,status,body) {
    const req=pending.shift();
    assert.equal(new URL(req.url).pathname,url);
    req.status=status; req.responseText=JSON.stringify(body); req.onload();
    return req;
  }
  function tick() {
    assert.equal(timers.size,1);
    const [id,fn]=timers.entries().next().value;
    timers.delete(id); fn();
  }
  return {store,phone,storage,nodes,buttons,reply,tick,pending,timers};
}

test('pair with an offline QR and leading-zero code, map the installed ID and preserve progress on redelivery', () => {
  const f=fixture('localhost');
  f.phone.open();
  assert.equal(f.reply('/api/pair',201,response).url,'http://localhost:47831/api/pair');
  assert.equal(f.nodes.find(n=>n.className==='phone-pairing-code').textContent,'00123456');
  assert.equal(f.nodes.find(n=>n.className==='phone-pairing-qr').src,response.qrDataUrl);
  const read=f.reply('/api/queue',200,{items:[item]});
  assert.equal(read.headers.Authorization,'Bearer '+response.tvToken);
  const saved=f.store.titles()[0];
  assert.equal(saved.service.id,installed[0].id);
  assert.equal(saved.episode,4);
  assert.deepEqual(f.reply('/api/ack',503,{}).payload.ids,[item.id]);
  f.store.save({...saved,episode:5});
  f.tick(); f.reply('/api/queue',200,{items:[item]});
  assert.equal(f.store.titles().length,1);
  assert.equal(f.store.titles()[0].episode,5);
  f.reply('/api/ack',200,{ok:true});
  f.phone.close();
  assert.equal(f.timers.size,0);
});

test('an unknown service, invalid item, or failed TV save stays unacknowledged', () => {
  const f=fixture('localhost');
  f.phone.open(); f.reply('/api/pair',201,response);
  f.reply('/api/queue',200,{items:[{...item,service:'YouTube'},{...item,minutes:-1}]});
  assert.equal(f.store.titles().length,0); assert.equal(f.pending.length,0);
  f.tick();
  f.storage.setItem=()=>{throw new Error('disk full');};
  f.reply('/api/queue',200,{items:[item]});
  assert.equal(f.store.titles().length,0); assert.equal(f.pending.length,0);
});

test('an interrupted ACK and a user deletion do not resurrect a submission after reopening', () => {
  const f=fixture('localhost');
  f.phone.open(); f.reply('/api/pair',201,response); f.reply('/api/queue',200,{items:[item]});
  f.reply('/api/ack',503,{}); f.phone.close();
  f.store.remove('phone-'+item.id);
  f.phone.open();
  assert.equal(f.reply('/api/pair',201,response).headers.Authorization,'Bearer '+response.tvToken);
  f.reply('/api/queue',200,{items:[item]});
  assert.equal(f.store.titles().length,0);
  assert.deepEqual(f.reply('/api/ack',200,{ok:true}).payload.ids,[item.id]);
});

test('a late pairing reply after Back is ignored and no further request starts', () => {
  const f=fixture('localhost');
  f.phone.open(); f.phone.back(); f.reply('/api/pair',201,response);
  assert.equal(f.pending.length,0); assert.equal(f.timers.size,0);
  assert.equal(f.storage.getItem('dashboard.phonePair.v1'),undefined);
});

test('manual helper changes never forward the previous host’s TV bearer', () => {
  const f=fixture('');
  f.storage.setItem('dashboard.phonePair.v1',JSON.stringify({origin:'http://old.local:47831',tvToken:'old-tv'}));
  f.phone.open(); f.reply('/api/pair',503,{});
  f.buttons.find(b=>b.name==='Change Mac address').run();
  const field=f.nodes.find(n=>n.id==='guide-value');
  field.value='new.local';
  f.phone.key({target:field,keyCode:13,preventDefault(){}});
  assert.equal(f.pending[0].url,'http://new.local:47831/api/pair');
  assert.equal(f.pending[0].headers.Authorization,undefined);
});
