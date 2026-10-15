'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {POSTSEASON,entryUrl,cleanSettings,migrateSettings,visibleBounds,revealWindow,bridgeFailure}=require('../src/desktop-settings');
const primary={workArea:{x:0,y:0,width:1920,height:1040}},left={workArea:{x:-1280,y:0,width:1280,height:720}};
function fixture(t){
  const parent=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'baseball-settings-'));
  t.after(()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('baseball-settings-'));fs.rmSync(root,{recursive:true,force:true});});
  const old=path.join(root,'v05'),dest=path.join(root,'v06');fs.mkdirSync(old);return {old,dest};
}
test('settings retain a valid saved destination and remove session parameters and unknown fields',()=>{
  const settings=cleanSettings({pageUrl:'https://nol.yanolja.com/ticket/genre/sports/bears?session=secret#token',alwaysOnTop:false,cookie:'secret',token:'secret'});
  assert.equal(settings.pageUrl,'https://nol.yanolja.com/ticket/genre/sports/bears');assert.equal(settings.alwaysOnTop,false);assert.equal('token' in settings,false);assert.equal('cookie' in settings,false);
  assert.equal(cleanSettings().pageUrl,POSTSEASON);
  for(const value of ['https://user:pass@nol.yanolja.com/ticket','https://evil.test/ticket','https://nol.yanolja.com.evil.test/ticket','file:///tmp/page','https://tickets.interpark.com/onestop/seat'])assert.equal(entryUrl(value),null);
});
test('v0.5 migration copies only normalized preferences/settings and leaves sources untouched',t=>{
  const {old,dest}=fixture(t);const prefs=JSON.stringify({quantity:3,requireTogether:true,token:'private',tiers:[{name:'앞줄',minRow:1,maxRow:5,secret:'no'}]});
  fs.writeFileSync(path.join(old,'preferences.json'),prefs);fs.writeFileSync(path.join(old,'settings.json'),JSON.stringify({pageUrl:'https://tickets.interpark.com/goods/26005452?signature=secret',token:'private',alwaysOnTop:false}));fs.writeFileSync(path.join(old,'Cookies'),'private');
  assert.deepEqual(migrateSettings({destination:dest,sources:[old]}),['preferences.json','settings.json']);
  assert.deepEqual(fs.readdirSync(dest).sort(),['preferences.json','settings.json']);
  const p=JSON.parse(fs.readFileSync(path.join(dest,'preferences.json'),'utf8')),s=JSON.parse(fs.readFileSync(path.join(dest,'settings.json'),'utf8'));
  assert.equal(p.quantity,3);assert.equal(p.tiers[0].maxRow,5);assert.equal('token' in p,false);assert.equal('secret' in p.tiers[0],false);
  assert.equal(s.pageUrl,'https://tickets.interpark.com/goods/26005452');assert.equal('token' in s,false);assert.equal(s.alwaysOnTop,false);
  assert.equal(fs.readFileSync(path.join(old,'preferences.json'),'utf8'),prefs);
});
test('migration never overwrites current preferences and safely ignores malformed or oversized legacy files',t=>{
  const {old,dest}=fixture(t);fs.mkdirSync(dest);fs.writeFileSync(path.join(dest,'preferences.json'),'current-user-content');fs.writeFileSync(path.join(old,'preferences.json'),JSON.stringify({quantity:4}));fs.writeFileSync(path.join(old,'settings.json'),'{');
  assert.deepEqual(migrateSettings({destination:dest,sources:[old]}),[]);assert.equal(fs.readFileSync(path.join(dest,'preferences.json'),'utf8'),'current-user-content');
  fs.writeFileSync(path.join(old,'settings.json'),' '.repeat(256*1024+1));assert.deepEqual(migrateSettings({destination:dest,sources:[old]}),[]);
});

test('v0.7 venue migration preserves active profile and priorities without copying extra private fields',t=>{
  const {old,dest}=fixture(t);const name='venue-profiles.json';
  const legacy={version:1,activeId:'gangwon-fc',token:'private',profiles:[{id:'gangwon-fc',name:'spoofed',preferences:{quantity:3,areas:['본부석'],blocks:['W4'],tiers:[{name:'앞열',areas:['본부석'],maxRow:5}],cookie:'private'}}]};
  const original=JSON.stringify(legacy);fs.writeFileSync(path.join(old,name),original);
  assert.deepEqual(migrateSettings({destination:dest,sources:[old]}),[name]);
  const migrated=JSON.parse(fs.readFileSync(path.join(dest,name),'utf8')),profile=migrated.profiles.find(p=>p.id==='gangwon-fc');
  assert.equal(migrated.activeId,'gangwon-fc');assert.equal(profile.name,'강원 FC 경기 테스트');assert.equal(profile.preferences.quantity,3);assert.deepEqual(profile.preferences.blocks,['W4']);assert.equal(profile.preferences.tiers[0].maxRow,5);assert.equal(JSON.stringify(migrated).includes('private'),false);assert.equal(fs.readFileSync(path.join(old,name),'utf8'),original);
  assert.deepEqual(migrateSettings({destination:dest,sources:[old]}),[]);
});
test('offscreen or unreachable title bar restores to the primary monitor; existing second monitor position stays usable',()=>{
  assert.deepEqual(visibleBounds({x:3000,y:0,width:400,height:900},[primary],primary),{x:0,y:0,width:400,height:960});
  assert.deepEqual(visibleBounds({x:100,y:-200,width:400,height:900},[primary],primary),{x:0,y:0,width:400,height:960});
  assert.deepEqual(visibleBounds({x:-1200,y:20,width:400,height:650},[primary,left],primary),{x:-1200,y:20,width:400,height:650});
  assert.deepEqual(visibleBounds({x:-1200,y:20,width:400,height:900},[primary,left],primary),{x:-1200,y:0,width:400,height:720});
});
test('recovering a minimized panel restores first and explicitly shows and focuses it',()=>{
  const calls=[],win={isDestroyed:()=>false,isMinimized:()=>true,restore:()=>calls.push('restore'),isMaximized:()=>false,getBounds:()=>({x:8000,y:0,width:400,height:900}),setBounds:value=>calls.push(value),show:()=>calls.push('show'),focus:()=>calls.push('focus')};
  const screen={getAllDisplays:()=>[primary],getPrimaryDisplay:()=>primary};
  assert.equal(revealWindow(win,screen),true);assert.equal(calls[0],'restore');assert.equal(calls[1].x,0);assert.deepEqual(calls.slice(-2),['show','focus']);
  assert.equal(revealWindow({isDestroyed:()=>true},screen),false);
});
test('explicit location reset unmaximizes, restores default size, and keeps small screens usable',()=>{
  const calls=[],win={isDestroyed:()=>false,isMinimized:()=>false,isMaximized:()=>!calls.includes('unmaximize'),unmaximize:()=>calls.push('unmaximize'),getBounds:()=>({x:50,y:0,width:1000,height:1000}),setBounds:value=>calls.push(value),show(){},focus(){}};
  const small={workArea:{x:0,y:0,width:800,height:480}};revealWindow(win,{getAllDisplays:()=>[small],getPrimaryDisplay:()=>small},{reset:true});
  assert.equal(calls[0],'unmaximize');assert.deepEqual(calls[1],{x:0,y:0,width:400,height:480});
});
test('bridge conflicts explain the older helper to close instead of exposing raw socket failure',()=>{
  assert.match(bridgeFailure({code:'EADDRINUSE',message:'listen EADDRINUSE 127.0.0.1:43187'}),/이전 버전 도우미를 종료/);
  assert.doesNotMatch(bridgeFailure({code:'EADDRINUSE'}),/EADDRINUSE/);
});
