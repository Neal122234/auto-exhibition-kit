/* Exhibit kit — core (generalised from "艺术的演进 / Art in Motion").
   The exhibition itself is data: exhibit.json (inlined by build.py as window.EH_CONFIG: room order, timeline labels, palette, frames,
   ambience, UI wording); rooms/<id>/room.json (→ room.js → EH_ROOMS[id]). Transitions are modules (js/t-<id>.js → EH.transition('<id>', {...}))
   that draw the passage INTO a room as a pure function of progress p ∈ [0,1]. At p = 1 a transition must have drawn the room's wall colour and
   the work exactly at ctx.to.rect; the core then hands over to the hung work (DOM) without a visible change. Special exhibits are js/s-<type>.js
   (EH.special('<type>', fn)). See js/API.md. Nothing in this file is specific to one exhibition. */
(function(){
'use strict';
var EH=window.EH=window.EH||{};
var $=function(id){return document.getElementById(id);};
var CFG=window.EH_CONFIG||{};
// the plan: every room of the exhibition in order, built or not. The timeline shows one tick per planned room; rooms that ship
// (EH_ROOM_LIST, written by build.py for EH_UPTO) are clickable, the rest read "not open yet".
var PLAN=(CFG.rooms||[]).map(function(r){return typeof r==='string'?{id:r}:r;});
var ROOM_IDS=PLAN.map(function(r){return r.id;});
var ERAS=PLAN.map(function(r){return r.era||r.id;});           // timeline labels; a room without "era" gets its room.json zh in build()
var ERA_OF={};PLAN.forEach(function(r,k){ERA_OF[r.id]=k;});
var PAL=Object.assign({wall:'#161210',gate:'#050403',inkLight:'#efe6d6',inkDark:'#24211d'},CFG.palette||{});
// frame styles: CSS class .f-<name> (index.html or theme.css) + padding [narrow ≤560 px, wide] in px; 'none' and 'fade' have none
var FRAME_PAD=Object.assign({gilt:[12,24],white:[10,16],stone:[10,18]},CFG.frames||{});
var BED=CFG.beds||{};                                          // synthesised ambience per room: cave | sun | church | chapel
var HOLD=CFG.hold||11;                                         // seconds a room rests before the next transition
// every visitor-facing string of the core; exhibit.json "text" overrides any of them, a room's "text" overrides them for that room
var T=Object.assign({
  hint:'点击画作放大，按空格停下来读墙上的文字', hintTouch:'轻点画作放大；点「停下来读」看墙上的文字',
  soon:'{n} 秒后进入下一厅：{next}。想留在这里，关掉「自动播放」。', held:'停在本厅。看完点「自动播放」继续，或点时间线换一厅。',
  end:'展览到这里结束，谢谢观看。可以点时间线回到任一展厅。', partial:'展览暂到{room}为止，后面的展厅还在布置。可以点时间线回到任一展厅。',
  read:'停下来读', close:'合上文字', sound:'声音', mute:'静音',
  roomAria:'展厅：{zh}', gotoAria:'前往展厅：{era}', notOpen:'{era}（尚未开放）',
  hWork:'墙上这件作品', hLook:'在作品上看', view:'放大查看', lens:'放大镜', compareEra:'与{zh}对比',
  hPalette:'调色板', paletteNote:'从两件作品中自动提取的主色，色块宽度对应面积。',
  hOrigin:'这个时代从哪里来', hTraits:'他们改变了什么', hSpecial:'本厅特别展项：{title}', hWorks:'同一展厅的其他作品', hChain:'之前与之后',
  sources:'来源（{n} 条）', imageCredit:'图片：', musicCredit:'本厅音乐：', soundCredit:'声音素材：', soundRest:'；其余为公有领域录音或本展合成。',
  recording:'录音', compareSpecial:'在作品上对比',
  auto:'自动播放', replay:'重看转场', skip:'跳过开场', fit:'适合屏幕', closeView:'关闭', viewHint:'滚轮或双指缩放 · 拖动平移 · 双击放大',
  viewAria:'放大查看作品', artAria:'当前展出的作品', splitAria:'对比分界线', gateAria:'进入展览',
  gate:'点亮火光，进入展厅', gateSub:'click to light the lamp', gateKeys:'空格 停下来读 · ← → 直接换展厅'
},CFG.text||{});
function tt(k,r,v){var s=(r&&r.text&&r.text[k]!=null)?r.text[k]:T[k];return String(s==null?'':s).replace(/\{(\w+)\}/g,function(m,x){return v&&v[x]!=null?v[x]:m;});}
var PANEL=Object.assign({palette:true,lens:true,compare:true},CFG.panel||{});   // optional tools of the reading panel
function panelOn(k,r){return (r&&r.panel&&r.panel[k]!=null)?!!r.panel[k]:!!PANEL[k];}   // a room's "panel" overrides them for that room
var HINT=matchMedia('(hover:none)').matches?T.hintTouch:T.hint;
EH.config=CFG;
var ROOMS=[];
var MODS={},SPECIALS={};
EH.transition=function(id,m){MODS[id]=m;};
EH.special=function(type,fn){SPECIALS[type]=fn;};

// ================================================================== images
var cache={};
function img(url){if(!cache[url]){var i=new Image();i.decoding='async';i.src=url;cache[url]=i;}return cache[url];}
function ready(i){return i.complete&&i.naturalWidth>0;}
// an image counts as loaded only once it is decoded, so the first frame that draws it doesn't stall
function whenLoaded(urls,cb){var n=urls.length;if(!n){cb();return;}var done=function(){--n||cb();};
  urls.forEach(function(u){var i=img(u),dec=function(){if(i.decode&&!i._dec){i._dec=i.decode().catch(function(){});}if(i._dec)i._dec.then(done);else done();};
    if(ready(i))dec();else if(i.complete){console.warn('missing asset',u);done();}
    else{i.addEventListener('load',dec,{once:true});i.addEventListener('error',function(){console.warn('missing asset',u);done();},{once:true});}});}
function roomPath(r,f){return 'rooms/'+r.id+'/'+f;}
function drawCover(c,im,w,h){var iw=im.naturalWidth||im.width,ih=im.naturalHeight||im.height,ca=w/h,sw,sh,sx,sy;
  if(iw/ih>ca){sh=ih;sw=sh*ca;sx=(iw-sw)/2;sy=0;}else{sw=iw;sh=sw/ca;sx=0;sy=(ih-sh)/2;}c.drawImage(im,sx,sy,sw,sh,0,0,w,h);}

// ================================================================== geometry: where each room hangs its work
function frameStyle(r){return r.frame||'none';}   // per-room presentation lives in rooms/<id>/overlay.json (merged over room.json by build.py)
function fpFor(r){var s=innerWidth<=560,d=FRAME_PAD[frameStyle(r)];return d?(s?d[0]:d[1]):0;}
// every area is measured from the furniture around it (title column, label, controls), never from constants, so text and work can't collide
function isLand(){return innerWidth<=980&&innerHeight<520&&innerWidth>innerHeight;}
function box(el){return el?el.getBoundingClientRect():null;}
function footTop(){var f=document.querySelector('.foot');return f?f.getBoundingClientRect().top:innerHeight-80;}
function areaFor(mode,i){var Wv=innerWidth,Hv=innerHeight,wide=Wv>1180,mid=Wv>980,sm=Wv<=560,g=sm?16:36,
    eb=box($('era'+i)),lab=$('lab'+i),lw=lab?lab.offsetWidth:256,lh=lab?lab.offsetHeight:180,eraR=eb&&eb.width?eb.right+32:266;
  if(mode==='read')return mid?{l:36,r:Wv-Math.min(Wv*.5,640)-48,t:70,b:Hv-150}:null;
  if(wide)return{l:Math.max(230,eraR),r:Wv-lw-34-36,t:64,b:Hv-150};
  if(mid)return{l:Math.max(230,eraR),r:Wv-56,t:64,b:footTop()-lh-40};
  if(isLand())return{l:g,r:Math.round(Wv*.58),t:48,b:footTop()-14};
  var t=eb&&eb.height?eb.bottom+16:(sm?112:120);return{l:g,r:Wv-g,t:t,b:Math.max(t+120,footTop()-lh-36)};}
function rectFor(i,mode){var r=ROOMS[i],a=areaFor(mode||'hang',i);if(!a)return null;var fp=fpFor(r),asp=r.art.w/r.art.h,aw=a.r-a.l,ah=a.b-a.t;
  var w=Math.max(40,Math.min(aw-2*fp,(ah-2*fp)*asp,1500)),h=w/asp;return{x:a.l+(aw-w-2*fp)/2+fp,y:a.t+(ah-h-2*fp)/2+fp,w:w,h:h,fp:fp};}
EH.rectFor=rectFor;

// ================================================================== room furniture from data
// keep a short 《title》 or （note） on one line, so a label never breaks as "…祭坛 / 画）"
function keep(t,all){var re=all?/(《[^》]{1,16}》|（[^）]{1,14}）|“[^”]{1,8}”)[，。、；：]?/g:/《[^》]{1,16}》[，。、；：]?/g;   // trailing punctuation stays with the group (避头)
  return String(t).replace(re,function(m){return '<span class="nw">'+m+'</span>';});}
// numbers stay glued to their units and neighbours: "1994 年" / "约 87 像素" / "Inv. 1890" never break at the space
function nb(t){return String(t==null?'':t).replace(/([\u3400-\u9fff）》”]) (?=[0-9A-Za-z])/g,'$1\u00a0').replace(/([0-9A-Za-z.%°]) (?=[\u3400-\u9fff（《“])/g,'$1\u00a0').replace(/(Inv\.|n\.|No\.|MS|INV) (?=\d)/g,'$1\u00a0');}
function tx(t){return keep(nb(t),true);}
// a one-liner breaks only after ，or ；
function oneHTML(t){return String(t).split(/(?<=[，；])/).map(function(c){return '<span class="nw">'+nb(c)+'</span>';}).join('');}
function shortTitle(r){return r.art.short||r.art.title;}
function labelHTML(a){return '<p class="who">'+nb(a.who)+'<span>'+a.whoLat+'</span></p><p class="what">'+tx(a.title)+'</p><p class="meta">'+(a.meta||[]).map(function(m){return '<span>'+tx(m)+'</span>';}).join('')+'</p>';}
// the vertical room title shrinks on short windows so it never runs into the caption under it
function fitTitles(){var mx=Math.min(84,Math.max(60,innerWidth*.034));ROOMS.forEach(function(r,i){var e=$('era'+i);if(!e)return;if(innerWidth<=980){e.style.removeProperty('--tfs');return;}
  var cap=e.querySelector('.cap'),room=e.clientHeight-(cap?cap.offsetHeight:0)-40,n=Array.from(r.zh).length;
  e.style.setProperty('--tfs',Math.max(28,Math.min(mx,room/(n*1.34))).toFixed(1)+'px');});}
// the page furniture that is the same in every room: exhibition mark, gate, control labels (all from exhibit.json)
function chromeText(){var set=function(id,v){var e=$(id);if(e&&v!=null)e.textContent=v;},attr=function(id,a,v){var e=$(id);if(e)e.setAttribute(a,v);};
  var mk=$('mark');if(mk){mk.textContent=CFG.title||'';if(CFG.titleLat){var i=document.createElement('i');i.textContent=CFG.titleLat;mk.appendChild(i);}}
  var G=CFG.gate||{};set('gtext',T.gate);set('gsub',T.gateSub);set('gkeys',T.gateKeys);
  var gm=$('gmark');if(gm){if(G.markHTML!=null)gm.innerHTML=G.markHTML;else if(G.mark==='none')gm.innerHTML='';}   // default: the flame
  set('pause',T.read);set('auto',T.auto);set('replay',T.replay);set('sound',T.sound);set('skip',T.skip);set('vfit',T.fit);set('vclose',T.closeView);
  var vh=document.querySelector('.vhint');if(vh)vh.textContent=T.viewHint;
  attr('view','aria-label',T.viewAria);attr('art','aria-label',T.artAria);attr('split','aria-label',T.splitAria);attr('gate','aria-label',T.gateAria);}
function build(){
  chromeText();
  ROOMS=(window.EH_ROOM_LIST||ROOM_IDS).map(function(id){var r=(window.EH_ROOMS||{})[id];if(!r)console.error('room data missing:',id);return r;}).filter(Boolean);
  PLAN.forEach(function(p,k){if(!p.era){var r=(window.EH_ROOMS||{})[p.id];if(r&&r.zh)ERAS[k]=r.zh;}});
  $('eras').innerHTML=ROOMS.map(function(r,i){return '<section class="era" id="era'+i+'" aria-label="'+tt('roomAria',r,{zh:r.zh})+'"><h1>'+r.zh+'</h1><div class="cap"><p class="one">'+oneHTML(r.one)+'</p><p class="lat">'+r.lat+'</p><p class="yrs">'+nb(r.yrs)+'</p></div></section>';}).join('');
  $('labels').innerHTML=ROOMS.map(function(r,i){return '<div class="label" id="lab'+i+'">'+labelHTML(r.art)+'</div>';}).join('');
  var l=$('line');ERAS.forEach(function(e,k){var idx=ROOMS.findIndex(function(r){return ERA_OF[r.id]===k;}),t=document.createElement(idx>=0?'button':'span');
    t.className='tick'+(idx>=0?' built':'');t.dataset.k=k;if(idx>=0){t.type='button';t.dataset.i=idx;t.setAttribute('aria-label',tt('gotoAria',null,{era:e}));t.addEventListener('click',function(){jump(idx);});}
    else t.title=tt('notOpen',null,{era:e});l.appendChild(t);});layoutTicks();
  // preload the first rooms' images
  ROOMS.forEach(function(r,i){if(i<2)img(roomPath(r,r.art.img));});
}

// ================================================================== sound: a few synthesised voices, no files
var AC=null,master=null,soundOn=true,beds={},curBed=null;
function audio(){if(AC)return AC;try{AC=new (window.AudioContext||window.webkitAudioContext)();master=AC.createGain();master.gain.value=.8;master.connect(AC.destination);}catch(e){AC=null;}return AC;}
function noiseBuf(sec){var b=AC.createBuffer(1,Math.ceil(AC.sampleRate*sec),AC.sampleRate),d=b.getChannelData(0),l=0;for(var i=0;i<d.length;i++){var w=Math.random()*2-1;l=(l+.02*w)/1.02;d[i]=w*.5+l*3;}return b;}
var sfx={
  on:function(){return !!AC&&soundOn&&AC.state==='running';},
  now:function(){return AC?AC.currentTime:0;},
  env:function(node,t0,a,peak,rel){var g=AC.createGain();g.gain.setValueAtTime(.0001,t0);g.gain.exponentialRampToValueAtTime(peak,t0+a);g.gain.exponentialRampToValueAtTime(.0001,t0+a+rel);node.connect(g);g.connect(master);return g;},
  drip:function(v){if(!sfx.on())return;var t=AC.currentTime,o=AC.createOscillator();o.type='sine';var f=900+Math.random()*700;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*2.2,t+.05);sfx.env(o,t,.003,(v||.12),.12);o.start(t);o.stop(t+.2);},
  bell:function(f,v){if(!sfx.on())return;var t=AC.currentTime;[1,2.01,2.76,4.07,5.43].forEach(function(k,i){var o=AC.createOscillator();o.type='sine';o.frequency.value=f*k;sfx.env(o,t,.004,(v||.14)/(i+1),3.5/(1+i*.6));o.start(t);o.stop(t+4.2);});},
  thud:function(v){if(!sfx.on())return;var t=AC.currentTime,o=AC.createOscillator();o.type='sine';o.frequency.setValueAtTime(110,t);o.frequency.exponentialRampToValueAtTime(40,t+.25);sfx.env(o,t,.005,(v||.35),.35);o.start(t);o.stop(t+.45);},
  puff:function(v,dur){if(!sfx.on())return;var t=AC.currentTime,s=AC.createBufferSource();s.buffer=noiseBuf(dur||.6);var f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=1800;f.Q.value=.6;s.connect(f);sfx.env(f,t,.02,(v||.2),(dur||.6));s.start(t);},
  tick:function(v){if(!sfx.on())return;var t=AC.currentTime,o=AC.createOscillator();o.type='triangle';o.frequency.value=2400;sfx.env(o,t,.001,(v||.06),.05);o.start(t);o.stop(t+.08);},
  whoosh:function(v,dur){if(!sfx.on())return;var t=AC.currentTime,d=dur||1.2,s=AC.createBufferSource();s.buffer=noiseBuf(d);var f=AC.createBiquadFilter();f.type='bandpass';f.Q.value=1.2;f.frequency.setValueAtTime(300,t);f.frequency.exponentialRampToValueAtTime(2400,t+d*.7);s.connect(f);sfx.env(f,t,d*.4,(v||.18),d*.6);s.start(t);},
  bed:function(name){if(!AC)return;if(curBed===name)return;var t=AC.currentTime;if(curBed&&beds[curBed]){var ob=beds[curBed];delete beds[curBed];ob.g.gain.setTargetAtTime(.0001,t,.8);ob.src.forEach(function(s){try{s.stop(t+5);}catch(e){}});}curBed=name;if(!name)return;
    if(!beds[name])beds[name]=makeBed(name);beds[name].g.gain.setTargetAtTime(beds[name].level,t,1.2);}
};
// recorded sounds. audio/manifest.json (inlined by build.py as window.EH_AUDIO) lists
//   sfx:   { name: {files:[...], gain:dB, loop:bool, room:'<roomId>'|'ui'} }   — play with sfx.play(name,{v,rate,pan,delay,duck})
//   music: { roomId: {file, gain:dB, loopStart, loopEnd, title, credit, bed:false?} }
var AUD={buf:{},pend:{},loops:[],mus:null,musRoom:null},musicBus=null,sfxBus=null,duckG=null;
function man(){return window.EH_AUDIO||{sfx:{},music:{}};}
function buses(){if(!AC)return false;if(!musicBus){duckG=AC.createGain();duckG.connect(master);musicBus=AC.createGain();musicBus.gain.value=.55;musicBus.connect(duckG);sfxBus=AC.createGain();sfxBus.connect(master);}return true;}
function loadBuf(file,cb){if(!AC){cb&&cb(null);return;}if(AUD.buf[file]){cb&&cb(AUD.buf[file]);return;}if(AUD.pend[file]){if(cb)AUD.pend[file].push(cb);return;}AUD.pend[file]=cb?[cb]:[];
  var x=new XMLHttpRequest();x.open('GET','audio/'+file);x.responseType='arraybuffer';
  var fin=function(b){AUD.buf[file]=b;var q=AUD.pend[file];delete AUD.pend[file];q.forEach(function(f){f(b);});};
  x.onload=function(){if(x.status&&x.status!==200){fin(null);return;}AC.decodeAudioData(x.response,function(b){fin(b);},function(){fin(null);});};x.onerror=function(){fin(null);};try{x.send();}catch(e){fin(null);}}
function fileOf(f){return typeof f==='string'?f:f.sprite;}   // a manifest file is a path, or {sprite, o, d} inside a packed sprite
function preloadRoomSounds(id){var S=man().sfx;Object.keys(S).forEach(function(k){if(S[k].room===id||S[k].room==='ui')(S[k].files||[]).forEach(function(f){loadBuf(fileOf(f));});});var m=man().music[id];if(m)loadBuf(m.file);}
function dB(x){return Math.pow(10,(x||0)/20);}
sfx.play=function(name,o){o=o||{};var e=man().sfx[name];if(!e||!buses()||!(sfx.on()||((o.loop||e.loop)&&AC.state==='running')))return null;var fs=e.files||[],f=fs[Math.floor(Math.random()*fs.length)];if(!f)return null;
  var b=AUD.buf[fileOf(f)];if(!b){loadBuf(fileOf(f));return null;}var seg=typeof f==='string'?null:f;
  var s=AC.createBufferSource();s.buffer=b;s.playbackRate.value=(o.rate||1)*(e.jitter?1+(Math.random()*2-1)*e.jitter:1);s.loop=!!(o.loop||e.loop);
  var g=AC.createGain();g.gain.value=dB(e.gain)*(o.v==null?1:o.v);var n=s;if(o.pan&&AC.createStereoPanner){var p=AC.createStereoPanner();p.pan.value=o.pan;s.connect(p);n=p;}n.connect(g);g.connect(sfxBus);
  var t=AC.currentTime+(o.delay||0);if(o.fade){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(dB(e.gain)*(o.v==null?1:o.v),t+o.fade);}
  if(seg&&!s.loop)s.start(t,Math.max(0,seg.o-.004),seg.d+.012);else s.start(t);
  if(o.duck)sfx.duck(o.duck,(seg?seg.d:b.duration)/s.playbackRate.value);
  var h={src:s,gain:g,room:st.idx,stop:function(fade){h.dead=true;try{var t2=AC.currentTime;g.gain.cancelScheduledValues(t2);g.gain.setValueAtTime(g.gain.value,t2);g.gain.linearRampToValueAtTime(0,t2+(fade||.4));s.stop(t2+(fade||.4)+.05);}catch(e){}}};
  if(s.loop)AUD.loops.push(h);return h;};
sfx.loop=function(name,o){o=Object.assign({},o||{});o.loop=true;if(o.fade==null)o.fade=1.2;return sfx.play(name,o);};   // copy: cue objects are reused on every visit
// hush(true) silences everything (music, loops, effects) until hush(false) (e.g. a figure in the work raising a finger to its lips)
sfx.hush=function(on){if(!AC||!master)return;var t=AC.currentTime;master.gain.cancelScheduledValues(t);master.gain.setValueAtTime(master.gain.value,t);master.gain.linearRampToValueAtTime(on?0:(soundOn?.8:0),t+(on?.35:.8));};
sfx.duck=function(amount,dur){if(!buses())return;var t=AC.currentTime,g=duckG.gain;g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);g.linearRampToValueAtTime(1-amount,t+.15);g.setTargetAtTime(1,t+.15+(dur||1)*.7,.6);};
function stopRoomLoops(keep){AUD.loops=AUD.loops.filter(function(h){if(h.room===keep)return true;h.stop(1.2);return false;});}
// special exhibits build their own WebAudio voices on the core's context: EH.audio.out() is a gain on the effects bus (so the 声音 toggle and
// hush apply), EH.audio.keep(source) registers a source. Both are stopped when the reading panel closes and when another room is entered.
var OWN=[];
function stopOwn(){var L=OWN;OWN=[];if(!AC)return;var t=AC.currentTime;L.forEach(function(n){try{if(n.gain){n.gain.cancelScheduledValues(t);n.gain.setValueAtTime(n.gain.value,t);
  n.gain.linearRampToValueAtTime(0,t+.15);setTimeout(function(){try{n.disconnect();}catch(e){}},260);}else n.stop(t+.2);}catch(e){}});}
EH.audio={ctx:function(){return buses()?AC:null;},on:function(){return sfx.on();},
  out:function(){if(!buses())return null;var g=AC.createGain();g.gain.value=1.25;g.connect(sfxBus);OWN.push(g);return g;},   // 1.25 × master .8 = the level they had on their own context
  keep:function(src){if(!src)return src;OWN.push(src);try{src.addEventListener('ended',function(){var k=OWN.indexOf(src);if(k>=0)OWN.splice(k,1);});}catch(e){}return src;}};
// music: one track per room, crossfaded; a transition may call ctx.music.start() itself, otherwise it fades in at module.musicAt (default .62)
var music={start:function(id,fadeIn,xfade){id=id||ROOMS[st.idx].id;if(!buses()||AUD.musRoom===id)return;var m=man().music[id];music.stop(xfade?(fadeIn||2):3);AUD.musRoom=id;if(!m)return;
    loadBuf(m.file,function(b){if(!b||AUD.musRoom!==id)return;var s=AC.createBufferSource();s.buffer=b;s.loop=true;if(m.loopEnd){s.loopStart=m.loopStart||0;s.loopEnd=m.loopEnd;}
      var g=AC.createGain(),t=AC.currentTime;g.gain.setValueAtTime(.0001,t);if(xfade)g.gain.linearRampToValueAtTime(dB(m.gain),t+(fadeIn||2));else g.gain.exponentialRampToValueAtTime(dB(m.gain),t+(fadeIn||4));s.connect(g);g.connect(musicBus);s.start(t);AUD.mus={src:s,gain:g,id:id};});},
  stop:function(fade){var h=AUD.mus;AUD.mus=null;AUD.musRoom=null;if(!h)return;try{var t=AC.currentTime;h.gain.gain.cancelScheduledValues(t);h.gain.gain.setValueAtTime(h.gain.gain.value,t);h.gain.gain.linearRampToValueAtTime(0,t+(fade||3));h.src.stop(t+(fade||3)+.1);}catch(e){}},
  duck:function(a,d){sfx.duck(a,d);},
  info:function(id){return man().music[id]||null;}};
EH.music=music;
EH.sfx=sfx;
function makeBed(name){var g=AC.createGain();g.gain.value=.0001;g.connect(master);var level=.12,src=[];
  function loopNoise(freq,q,type,amp){var s=AC.createBufferSource();src.push(s);s.buffer=noiseBuf(4);s.loop=true;var f=AC.createBiquadFilter();f.type=type||'lowpass';f.frequency.value=freq;f.Q.value=q||.7;var a=AC.createGain();a.gain.value=amp;s.connect(f);f.connect(a);a.connect(g);s.start();return a;}
  if(name==='cave'){loopNoise(180,.5,'lowpass',.6);level=.16;}
  else if(name==='sun'){loopNoise(420,.4,'lowpass',.35);var c=loopNoise(5200,6,'bandpass',.18);var lfo=AC.createOscillator(),lg=AC.createGain();src.push(lfo);lfo.frequency.value=13;lg.gain.value=.12;lfo.connect(lg);lg.connect(c.gain);lfo.start();level=.14;}
  else if(name==='church'){[65.4,98,130.8].forEach(function(f,i){var o=AC.createOscillator();src.push(o);o.type=i?'sine':'triangle';o.frequency.value=f;var a=AC.createGain();a.gain.value=.12/(i+1);o.connect(a);a.connect(g);o.start();});loopNoise(300,.5,'lowpass',.15);level=.13;}
  else if(name==='chapel'){loopNoise(240,.5,'lowpass',.25);level=.1;}
  return{g:g,level:level,src:src};}
var dripTimer=0;
function ambientTick(dt){if(curBed==='cave'&&sfx.on()){dripTimer-=dt;if(dripTimer<=0){sfx.drip(.05+Math.random()*.08);dripTimer=1.2+Math.random()*3.5;}}}

// ================================================================== state and timeline
var st={idx:0,phase:'gate',t:0,playing:false,reading:false,started:false,auto:true};
var stage=$('stage'),sg=stage.getContext('2d'),fx=$('fx'),fg=fx.getContext('2d'),artC=$('art'),ag=artC.getContext('2d');
var W=0,H=0,DPR=1;
var pointer={x:-1,y:-1,active:false,down:false,moved:0};
addEventListener('pointermove',function(e){pointer.x=e.clientX;pointer.y=e.clientY;pointer.active=true;pointer.moved=performance.now();});
addEventListener('pointerdown',function(e){pointer.down=true;pointer.x=e.clientX;pointer.y=e.clientY;});
addEventListener('pointerup',function(){pointer.down=false;});
function phoneLine(){return innerWidth<=560;}
function tickPos(k,i){return phoneLine()?(i==null?-1:i/(Math.max(1,ROOMS.length-1))):k/(ERAS.length-1);}
function layoutTicks(){Array.prototype.forEach.call(document.querySelectorAll('#line .tick'),function(t){var p=tickPos(+t.dataset.k,t.dataset.i==null?null:+t.dataset.i);
  t.style.display=p<0?'none':'';if(p>=0)t.style.left=(p*100)+'%';});}
function resize(){DPR=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;[stage,fx].forEach(function(c){c.width=Math.round(W*DPR);c.height=Math.round(H*DPR);});
  Object.keys(LAYERS).forEach(function(k){sizeLayer(LAYERS[k]);});fitTitles();layoutTicks();if(st.started){hang(st.idx,true);if(st.phase==='rest')paintArt(st.idx);}
  if(V.open){vc.classList.remove('anim');fit();}if(activeTool==='era'||activeTool==='special')drawCmp();}
addEventListener('resize',function(){clearTimeout(resize.t);resize.t=setTimeout(resize,150);});

function rgbOf(c){var m=String(c).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);if(!m)return null;var h=m[1];if(h.length===3)h=h.replace(/./g,'$&$&');return[0,2,4].map(function(k){return parseInt(h.substr(k,2),16);});}
function lum(c){var a=c.map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);});return .2126*a[0]+.7152*a[1]+.0722*a[2];}
function contrast(a,b){var x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function tone(ink,wall,target){var a=rgbOf(ink),b=rgbOf(wall);if(!a||!b)return ink;var best=a;
  for(var t=.02;t<=.9;t+=.02){var c=a.map(function(v,k){return Math.round(v+(b[k]-v)*t);});if(contrast(c,b)>=target)best=c;else break;}return 'rgb('+best.join(',')+')';}
var curWall=PAL.wall,curInk='light';
function setInks(){var ink=curInk==='dark'?PAL.inkDark:PAL.inkLight,R=$('room');R.style.setProperty('--ink-2',tone(ink,curWall,7));R.style.setProperty('--ink-3',tone(ink,curWall,4.6));}
EH.contrast=function(a,b){return contrast(rgbOf(a),rgbOf(b));};
function ui(){return{
  wall:function(c){$('room').style.setProperty('--wall',c);curWall=c;setInks();},
  ink:function(k){$('room').style.setProperty('--ink',k==='dark'?'var(--ink-dark)':'var(--ink-light)');$('room').classList.toggle('light',k==='dark');curInk=k==='dark'?'dark':'light';setInks();},
  chrome:function(on){$('room').classList.toggle('nochrome',!on);},
  title:function(i,on,spray){var e=$('era'+i);if(!e)return;e.classList.toggle('on',!!on);e.classList.toggle('spray',spray!=null);if(spray!=null)e.style.setProperty('--m',(spray*100).toFixed(1)+'%');},
  label:function(i,on){var e=$('lab'+i);if(e)e.classList.toggle('on',!!on);},
  deco:function(v){$('frame').style.setProperty('--deco',v);}
};}
var UI=ui();

// ================================================================== overlay layers (above the wall text and controls)
// ctx.layer(name,{z,blend}) → a full-screen <canvas> owned by the room (2d or webgl, your choice; pointer-events none; resized with the window).
// A room's layers stay visible through its transition and rest and into the NEXT room's transition (so p=0 can continue them); they are hidden
// when that next room hands over, or when any other room is entered.
var LAYERS={};
function layer(roomId,name,o){o=o||{};var k=roomId+':'+name,L=LAYERS[k];
  if(!L){var c=document.createElement('canvas');c.className='ovl';c.setAttribute('aria-hidden','true');$('room').appendChild(c);L=LAYERS[k]={el:c,room:roomId};sizeLayer(L);}
  L.el.style.zIndex=o.z||8;L.el.style.mixBlendMode=o.blend||'normal';L.el.style.display='';return L.el;}
function sizeLayer(L){L.el.width=Math.round(W*DPR);L.el.height=Math.round(H*DPR);}
function showLayers(keep){Object.keys(LAYERS).forEach(function(k){var L=LAYERS[k],on=keep.indexOf(L.room)>=0;if(!on&&L.el.style.display!=='none'){L.el.style.display='none';
  var g=L.el.getContext&&L.el.__g;if(g&&g.clearRect)g.clearRect(0,0,L.el.width,L.el.height);}});}
function makeCtx(i){var to=ROOMS[i],from=i>0?ROOMS[i-1]:null,m=MODS[to.id]||{};
  var ctx={g:sg,W:W,H:H,dpr:DPR,pointer:pointer,sfx:sfx,ui:UI,
    to:{room:to,idx:i,rect:rectFor(i),image:img(roomPath(to,to.art.img)),wall:to.wall,ink:to.ink,frame:frameStyle(to)},
    from:from?{room:from,idx:i-1,rect:rectFor(i-1),image:img(roomPath(from,from.art.img)),wall:from.wall,ink:from.ink,frame:frameStyle(from)}:null,
    music:music,
    layer:function(name,o){var c=layer(to.id,name,o);if(!c.__g&&(!o||o.type!=='webgl'))c.__g=c.getContext('2d');return c;},
    fromLayer:function(name){var L=from&&LAYERS[from.id+':'+name];return L?L.el:null;},
    asset:function(name){return img(roomPath(to,name));},
    fromAsset:function(name){return from?img(roomPath(from,name)):null;},
    rect:rectFor,state:{},p:0,lastP:null,
    u:U,
    // fire fn once when forward playback crosses progress `at` (never while scrubbing backwards or paused)
    cue:function(at,fn){if(ctx.playing&&ctx.lastP!=null&&ctx.lastP<at&&ctx.p>=at){try{fn();}catch(e){console.error(e);}}}};
  return ctx;}
var U={clamp:function(x,a,b){a=a==null?0:a;b=b==null?1:b;return x<a?a:x>b?b:x;},
  seg:function(p,a,b){return U.clamp((p-a)/(b-a));},lerp:function(a,b,t){return a+(b-a)*t;},
  ease:function(x){x=U.clamp(x);return x*x*(3-2*x);},eo:function(x){x=U.clamp(x);return 1-Math.pow(1-x,3);},
  ei:function(x){x=U.clamp(x);return x*x*x;},eio:function(x){x=U.clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;},
  rng:function(seed){var s=seed>>>0||1;return function(){s=(s+0x6D2B79F5)|0;var t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};},
  cover:drawCover};
EH.util=U;
function assetsFor(i){var r=ROOMS[i],m=MODS[r.id]||{},list=[roomPath(r,r.art.img)];(m.assets||[]).forEach(function(a){list.push(roomPath(r,a));});
  if(i>0)list.push(roomPath(ROOMS[i-1],ROOMS[i-1].art.img));(m.fromAssets||[]).forEach(function(a){if(i>0)list.push(roomPath(ROOMS[i-1],a));});return list;}

var ctx=null,loading=false;
var PRE={};   // room index → ctx already built and init()ed during the previous room's rest
function preinit(i){if(i>=ROOMS.length||PRE[i]||PRE[i]===0)return;PRE[i]=0;whenLoaded(assetsFor(i),function(){if(st.idx===i&&st.phase==='enter')return;var c=makeCtx(i),m=MODS[ROOMS[i].id];
  if(m&&m.init)try{m.init(c);}catch(e){console.error(e);}PRE[i]=c;});}
function enter(i,fast){st.idx=i;st.phase='enter';st.t=0;st.keepTitle=st.keepLabel=false;ctx=null;loading=true;closeRead();setTool(null);if(i>0||st.opened)UI.chrome(true);
  showLayers([ROOMS[i].id].concat(i>0?[ROOMS[i-1].id]:[]));
  if(PRE[i]){ctx=PRE[i];delete PRE[i];ctx.lastP=null;ctx.state=ctx.state||{};loading=false;}
  $('frame').classList.add('hidden');stage.classList.add('on');ROOMS.forEach(function(r,k){UI.title(k,false);UI.label(k,false);});$('hint').classList.remove('on');
  if(!loading){if(i+1<ROOMS.length)whenLoaded(assetsFor(i+1),function(){});}else whenLoaded(assetsFor(i),function(){if(st.idx!==i||st.phase!=='enter')return;ctx=makeCtx(i);var m=MODS[ROOMS[i].id];if(m&&m.init)try{m.init(ctx);}catch(e){console.error(e);}loading=false;
    if(i+1<ROOMS.length)whenLoaded(assetsFor(i+1),function(){});});
  var mi=man().music[ROOMS[i].id];sfx.bed(mi&&mi.bed===false?null:(BED[ROOMS[i].id]||null));
  if(AC){preloadRoomSounds(ROOMS[i].id);if(i+1<ROOMS.length)preloadRoomSounds(ROOMS[i+1].id);stopRoomLoops(i);stopOwn();if(fast){music.start(ROOMS[i].id,2,true);restCues(ROOMS[i].id);}else if(AUD.musRoom&&AUD.musRoom!==ROOMS[i].id)music.stop(4);}}
function go(i){if(i<0||i>=ROOMS.length)return;if(V.open)closeView();enter(i);st.playing=true;}
// jump(i): open room i at rest without its transition (timeline, ←/→) and stop the tour there, so the visitor can read and try the exhibit
function jump(i){if(i<0||i>=ROOMS.length)return;if(V.open)closeView();enter(i,true);st.jumping=true;setAuto(false);
  var f=function(){if(st.idx!==i||st.phase!=='enter')return;if(loading){setTimeout(f,40);return;}st.t=duration(i);st.playing=true;};f();}
function setAuto(on){st.auto=!!on;var b=$('auto');if(b){b.setAttribute('aria-pressed',st.auto?'true':'false');}
  if(st.auto&&st.phase==='rest'&&st.t>HOLD-2.5)st.t=HOLD-2.5;}
function duration(i){var m=MODS[ROOMS[i].id];return m&&m.duration?m.duration:3;}
function drawTransition(i,p){var m=MODS[ROOMS[i].id];DPRset(sg);sg.clearRect(0,0,W,H);ctx.p=p;
  if(m&&m.draw){try{m.draw(p,ctx);}catch(e){console.error(e);fallback(p);}}else fallback(p);
  if(st.playing&&!st.jumping)runCues(ROOMS[i].id,ctx.lastP==null?(p<.02?-1:null):ctx.lastP,p);ctx.lastP=p;}
// cue sheets (audio/cues/<room>.json): {"cues":[{at:p, sfx:name, v, rate, pan, duck, delay} | {at, loop:name, id, v, fade} | {at, stop:id, fade}],
//   "rest":[{loop:name, v, fade}]} — fired once when forward playback crosses `at`; rest loops start at the hand-over and end with the room
var CUELOOPS={};
function runCues(id,a,b){if(a==null||!AC)return;var C=(man().cues||{})[id];if(!C||!C.cues)return;
  C.cues.forEach(function(c){if(!(a<c.at&&c.at<=b))return;
    if(c.sfx)sfx.play(c.sfx,c);
    else if(c.loop){var k=c.id||c.loop;if(live(k))return;var h=sfx.loop(c.loop,c);if(h)CUELOOPS[k]=h;}
    else if(c.stop){var h2=CUELOOPS[c.stop];if(h2){h2.stop(c.fade||1);delete CUELOOPS[c.stop];}}});}
function live(k){var h=CUELOOPS[k];return !!(h&&!h.dead&&h.room===st.idx);}
function restCues(id){var C=(man().cues||{})[id];if(!C||!C.rest||!AC)return;var i=st.idx;C.rest.forEach(function(c){var k=c.id||c.loop,e=man().sfx[c.loop];if(live(k)||!e)return;
  var fs=(e.files||[]).map(fileOf),n=fs.length,start=function(){if(st.idx!==i||live(k))return;var h=sfx.loop(c.loop,c);if(h)CUELOOPS[k]=h;};
  fs.forEach(function(f){loadBuf(f,function(){if(--n===0)start();});});});}
function DPRset(g){g.setTransform(DPR,0,0,DPR,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';}
function fallback(p){var r=ctx.to.rect;sg.fillStyle=ctx.to.wall;sg.fillRect(0,0,W,H);sg.globalAlpha=Math.min(1,p*1.5);sg.drawImage(ctx.to.image,r.x,r.y,r.w,r.h);sg.globalAlpha=1;
  if(ctx.from&&p<.5){sg.globalAlpha=1-p*2;sg.fillStyle=ctx.from.wall;sg.fillRect(0,0,W,H);sg.drawImage(ctx.from.image,ctx.from.rect.x,ctx.from.rect.y,ctx.from.rect.w,ctx.from.rect.h);sg.globalAlpha=1;}}

// hand-over: the stage showed wall + painting at the rest rectangle; now the DOM takes over and the stage clears
function handover(i){var r=ROOMS[i];$('room').classList.add('snap');UI.wall(r.wall);UI.ink(r.ink);void $('room').offsetWidth;$('room').classList.remove('snap');
  hang(i,true);paintArt(i);var fr=$('frame');fr.classList.add('still');fr.classList.remove('hidden');void fr.offsetWidth;fr.classList.remove('still');   // same frame as the stage leaves: no fade dip
  stage.classList.remove('on');DPRset(sg);sg.clearRect(0,0,W,H);
  if(st.jumping){st.jumping=false;$('era'+i).classList.add('on');}
  st.keepTitle=$('era'+i)&&$('era'+i).classList.contains('on');st.keepLabel=$('lab'+i)&&$('lab'+i).classList.contains('on');
  showLayers([r.id]);st.phase='rest';st.t=0;if(st.pendingRead){st.pendingRead=false;setTimeout(openRead,60);}UI.chrome(true);UI.deco(1);if(i===0)st.opened=true;if(AUD.musRoom!==r.id)music.start(r.id,4);restCues(r.id);
  var m=MODS[r.id];if(m&&m.done)try{m.done(ctx);}catch(e){console.error(e);}}
function hang(i,instant){var r=ROOMS[i],fr=$('frame'),R=rectFor(i,st.reading?'read':'hang');
  fr.className='frame f-'+frameStyle(r)+(st.phase==='rest'||st.reading?'':' hidden');
  if(instant)fr.classList.add('still');
  if(!R){fr.classList.add('hidden');}else{fr.style.setProperty('--fp',R.fp+'px');fr.style.left=(R.x-R.fp)+'px';fr.style.top=(R.y-R.fp)+'px';
    ['art','cmpA','cmpB'].forEach(function(id){var c=$(id);c.style.width=R.w+'px';c.style.height=R.h+'px';});
    document.documentElement.style.setProperty('--sx',((R.x+R.w/2)/innerWidth*100).toFixed(1)+'%');document.documentElement.style.setProperty('--sy',((R.y+R.h/2)/innerHeight*100).toFixed(1)+'%');}
  if(instant){void fr.offsetWidth;fr.classList.remove('still');}}
function paintArt(i){var r=ROOMS[i],R=rectFor(i),im=img(roomPath(r,r.art.img));if(!R)return;var w=Math.min(Math.round(R.w*DPR),2600),h=Math.round(w*r.art.h/r.art.w);artC.width=w;artC.height=h;
  if(ready(im))ag.drawImage(im,0,0,w,h);else im.addEventListener('load',function(){ag.drawImage(im,0,0,w,h);},{once:true});}
function hangLabels(){var i=st.idx,l=$('lab'+i);if(!l)return;var f=$('frame').getBoundingClientRect(),wide=innerWidth>1180,h=l.offsetHeight,w=l.offsetWidth,g=innerWidth<=560?16:36;
  if(wide){l.style.left=Math.round(f.right+34)+'px';l.style.top=Math.round(Math.max(64,Math.min(f.bottom-h,footTop()-24-h)))+'px';}
  else if(isLand()){var eb=box($('era'+i));l.style.left=Math.round(innerWidth*.58+24)+'px';l.style.top=Math.round((eb?eb.bottom:40)+14)+'px';}
  else{l.style.left=Math.round(Math.min(Math.max(f.left,g),innerWidth-g-w))+'px';l.style.top=Math.round(f.bottom+16)+'px';}}

// ================================================================== the loop
var last=0;
function frame(now){requestAnimationFrame(frame);var dt=last?Math.min((now-last)/1000,1/24):0;last=now;if(!st.started)return;
  ambientTick(dt);
  var i=st.idx,m=MODS[ROOMS[i].id];
  if(st.phase==='enter'){
    if(!loading&&ctx){if(st.playing&&!V.open)st.t+=dt;var D=duration(i),p=Math.min(st.t/D,1);ctx.W=W;ctx.H=H;ctx.dpr=DPR;ctx.to.rect=rectFor(i);if(ctx.from)ctx.from.rect=rectFor(i-1);ctx.dt=dt;ctx.playing=st.playing;
      drawTransition(i,p);var ma=(m&&m.musicAt!=null)?m.musicAt:.62;if(st.playing&&p>=ma&&AUD.musRoom!==ROOMS[i].id&&!(m&&m.musicManual))music.start(ROOMS[i].id,5);
      if(p>=1)handover(i);}
  }else if(st.phase==='rest'){
    if(st.playing&&!st.reading&&!V.open){st.t+=dt;}
    UI.title(i,st.t>.2||st.keepTitle);UI.label(i,st.t>.8||st.keepLabel);var endCard=i+1>=ROOMS.length&&st.t>HOLD-1;
    var nxt=i+1<ROOMS.length?ROOMS[i+1].zh:null,left=Math.ceil(HOLD-st.t),soon=st.auto&&nxt&&left<=4&&left>0,held=!st.auto&&nxt&&st.t>1.2&&st.t<9;
    // the last planned room shipped → the exhibition ends; otherwise it stops early (EH_UPTO) and says the rest is being set up
    $('hint').textContent=endCard?(ROOMS.length>=PLAN.length?tt('end',ROOMS[i]):tt('partial',ROOMS[i],{room:ROOMS[i].zh})):
      soon?tt('soon',ROOMS[i],{n:left,next:nxt}):held?tt('held',ROOMS[i]):(ROOMS[i].text&&ROOMS[i].text.hint?ROOMS[i].text.hint:HINT);
    $('hint').classList.toggle('on',((st.t>2&&st.t<HOLD-1)||soon||held||endCard)&&!st.reading);$('hint').classList.toggle('end',endCard||soon||held);
    DPRset(fg);fg.clearRect(0,0,W,H);
    // rest hooks: ctx.reading (panel open), ctx.readRect (panel box), ctx.tool (null | lens | era | special: never paint over ctx.to.rect while a
    // compare is on), ctx.hidden (the hung work is hidden behind the panel on narrow screens: rest is not called at all then)
    var hid=st.reading&&!rectFor(i,'read');
    // while the reading panel is open the hung work belongs to the tools and the special exhibit (many draw on it): rest() keeps off it
    if(m&&m.rest&&ctx&&!hid){ctx.g=fg;ctx.W=W;ctx.H=H;ctx.dt=dt;ctx.reading=st.reading;ctx.tool=activeTool||(st.reading?'special':null);ctx.hidden=false;
      var rp=st.reading?$('read').getBoundingClientRect():null;ctx.readRect=rp?{x:rp.left,y:rp.top,w:rp.width,h:rp.height}:null;
      ctx.to.rect=$('frame').classList.contains('hidden')?rectFor(i):liveRect();try{m.rest(ctx);}catch(e){console.error(e);}ctx.g=sg;}
    if(st.t>1.5&&i+1<ROOMS.length)preinit(i+1);
    if(st.t>=HOLD&&i+1<ROOMS.length&&st.playing&&st.auto)enter(i+1);
    hangLabels();placeCmpLabels();
  }
  if(st.phase!=='rest'){DPRset(fg);fg.clearRect(0,0,W,H);}
  var f=st.phase==='enter'?Math.min(st.t/duration(i),1):1,x=phoneLine()?Math.max(0,i-1+f)/Math.max(1,ROOMS.length-1)*100:Math.max(0,ERA_OF[ROOMS[i].id]-1+f)/(ERAS.length-1)*100;
  $('dot').style.left=x+'%';var nw=$('now');if(nw.textContent!==ROOMS[i].zh)nw.textContent=ROOMS[i].zh;
  var lw=$('line').clientWidth,hw=nw.offsetWidth/2;nw.style.left=Math.round(Math.min(Math.max(x/100*lw,hw),lw-hw))+'px';
  $('skip').classList.toggle('on',st.phase==='enter'&&i===0&&st.t>1.5&&st.t<duration(0)-2.5&&performance.now()-pointer.moved<2600);
  $('pause').textContent=st.reading?T.close:T.read;
}
function liveRect(){var c=$('art').getBoundingClientRect();return{x:c.left,y:c.top,w:c.width,h:c.height,fp:0};}

// ================================================================== wall text: the same sections, same order, every room
function palette(im,k){var c=document.createElement('canvas'),w=160,h=Math.round(160*im.naturalHeight/im.naturalWidth);c.width=w;c.height=h;
  var g=c.getContext('2d');g.drawImage(im,0,0,w,h);var d;try{d=g.getImageData(0,0,w,h).data;}catch(e){return null;}var P=[];for(var i=0;i<d.length;i+=12)if(d[i+3]>200)P.push([d[i],d[i+1],d[i+2]]);if(P.length<64)return null;
  P.sort(function(a,b){return(a[0]*.3+a[1]*.59+a[2]*.11)-(b[0]*.3+b[1]*.59+b[2]*.11);});
  var C=[];for(var j=0;j<k;j++)C.push(P[Math.floor((j+.5)/k*P.length)].slice());var A=new Array(P.length);
  for(var it=0;it<12;it++){var S=C.map(function(){return[0,0,0,0];});
    for(var q=0;q<P.length;q++){var best=0,bd=1e9;for(j=0;j<k;j++){var dr=P[q][0]-C[j][0],dg=P[q][1]-C[j][1],db=P[q][2]-C[j][2],dd=dr*dr+dg*dg+db*db;if(dd<bd){bd=dd;best=j;}}A[q]=best;S[best][0]+=P[q][0];S[best][1]+=P[q][1];S[best][2]+=P[q][2];S[best][3]++;}
    for(j=0;j<k;j++)if(S[j][3])C[j]=[S[j][0]/S[j][3],S[j][1]/S[j][3],S[j][2]/S[j][3]];}
  var cnt=C.map(function(){return 0;});A.forEach(function(a){cnt[a]++;});
  return C.map(function(c,i){return{c:'rgb('+c.map(Math.round).join(',')+')',n:cnt[i]/P.length,l:c[0]*.3+c[1]*.59+c[2]*.11};}).sort(function(a,b){return a.l-b.l;});}
var PALS={};function pal(r){var u=roomPath(r,r.art.img);if(!(u in PALS))PALS[u]=palette(img(u),7);return PALS[u];}
function palRow(r){var p=pal(r);if(!p)return '';return '<div>'+tx(shortTitle(r))+'</div><div class="bar">'+p.map(function(x){return '<i style="background:'+x.c+';--g:'+Math.max(x.n,.02).toFixed(3)+'"></i>';}).join('')+'</div>';}
function adjacent(i){return i===0?1:i-1;}
function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
// every section is optional: it is left out when its field is empty (a map room has no palette, a history room may have no quote…).
// Headings come from T (exhibit.json "text", or the room's own "text"), so a history or religion exhibition renames them without code.
function readHTML(i){var r=ROOMS[i],o=ROOMS.length>1?ROOMS[adjacent(i)]:null,first=o&&i>adjacent(i)?o:r,second=o&&i>adjacent(i)?r:o;
  var H=function(k,v){return '<h3>'+tx(tt(k,r,v))+'</h3>';};
  var ws=(r.works||[]).map(function(w,j){return '<button type="button" class="work" data-w="'+j+'"><img src="'+roomPath(r,w.img)+'" alt="'+esc(w.title)+'" loading="lazy"><b>'+tx(w.title)+'</b><span>'+tx(esc(w.who||''))+'</span></button>';}).join('');
  var q=r.quote&&r.quote.length?'<div class="q"><p>'+tx(r.quote[0])+'</p><small>'+tx(r.quote[1]||'')+'</small></div>':'';
  var S=r.sources||[],src=S.length?'<details class="src"><summary>'+tt('sources',r,{n:S.length})+'</summary><ol>'+S.map(function(s){return '<li><a href="'+esc(s.url)+'" target="_blank" rel="noopener" title="'+esc(s.claim||'')+'">'+nb(esc(s.label||s.claim||s.url))+'</a></li>';}).join('')+'</ol></details>':'';
  var lensOk=panelOn('lens',r)&&matchMedia('(hover:hover)').matches&&!!rectFor(i,'read'),cmpOk=panelOn('compare',r)&&!!o;
  var pals=panelOn('palette',r)?palRow(first)+(second?palRow(second):''):'';
  var traits=(r.traits||[]).filter(function(t){return t&&(t[0]||t[1]);});
  return '<h2>'+r.zh+'</h2><p class="lat">'+r.lat+(r.yrs?', '+nb(r.yrs):'')+'</p>'+(r.lede?'<p class="lede">'+tx(r.lede)+'</p>':'')+
    (r.work?H('hWork')+'<p>'+tx(r.work)+'</p>':'')+q+
    H('hLook')+'<div class="acts"><button type="button" class="act" data-tool="view">'+tt('view',r)+'</button>'+(lensOk?'<button type="button" class="act" data-tool="lens" aria-pressed="false">'+tt('lens',r)+'</button>':'')+(cmpOk?'<button type="button" class="act" data-tool="era" aria-pressed="false">'+tx(tt('compareEra',r,{zh:o.zh}))+'</button>':'')+'</div><div class="plate" id="plate" hidden></div>'+
    (pals?H('hPalette')+'<div class="pal">'+pals+'</div><p class="small">'+tx(tt('paletteNote',r))+'</p>':'')+
    (r.origin?H('hOrigin')+'<p>'+tx(r.origin)+'</p>':'')+
    (traits.length?H('hTraits')+'<dl>'+traits.map(function(t){return '<dt>'+tx(t[0])+'</dt><dd>'+tx(t[1])+'</dd>';}).join('')+'</dl>':'')+
    (r.special&&r.special.title?H('hSpecial',{title:r.special.title})+'<div class="special" id="special">'+(r.special.text?'<p>'+tx(r.special.text)+'</p>':'')+'</div>':'')+
    (ws?H('hWorks')+'<div class="works">'+ws+'</div>':'')+
    (r.chain?H('hChain')+'<p>'+tx(r.chain)+'</p>':'')+
    '<p class="foot-note">'+(r.art.credit?tt('imageCredit',r)+nb(esc(String(r.art.credit).replace(/[。.．]\s*$/,'')))+'。':'')+(function(){var m=man().music[r.id];var c=(man().credits||{})[r.id]||[];return (m&&m.title?'<br>'+tt('musicCredit',r)+tx(esc(m.title))+(m.credit?'（'+nb(esc(String(m.credit).replace(/[。.．]\s*$/,'')))+'）':'')+'。':'')+
      (c.length?'<br>'+tt('soundCredit',r)+c.map(function(x){return '<a href="'+esc(x.url)+'" target="_blank" rel="noopener">'+esc(x.title||tt('recording',r))+'</a>（'+esc(x.author)+'，'+esc(x.lic)+'）';}).join('；')+tt('soundRest',r):'');})()+'</p>'+src;}
function openRead(){if(st.reading||!st.started)return;if(st.phase==='enter'){if(!loading){st.pendingRead=true;st.jumping=true;st.t=duration(st.idx);st.playing=true;}return;}setTool(null);st.reading=true;sfx.play('ui-open');var i=st.idx;$('read').innerHTML=readHTML(i);$('read').scrollTop=0;$('room').classList.add('reading');hang(i,false);wireRead(i);}
function closeRead(){if(!st.reading)return;st.reading=false;sfx.play('ui-close');setTool(null);$('room').classList.remove('reading');hang(st.idx,false);var sp=$('special');if(sp&&sp._dispose)sp._dispose();stopOwn();}
function wireRead(i){var r=ROOMS[i];
  Array.prototype.forEach.call(document.querySelectorAll('.act'),function(b){b.addEventListener('click',function(){var t=b.getAttribute('data-tool');if(t==='view'){openCurrent();return;}setTool(activeTool===t?null:t);});});
  Array.prototype.forEach.call(document.querySelectorAll('.work'),function(b){b.addEventListener('click',function(){var w=r.works[+b.getAttribute('data-w')];openView({image:img(roomPath(r,w.img)),art:w,from:b.querySelector('img').getBoundingClientRect()});});});
  var host=$('special'),fn=r.special&&SPECIALS[r.special.type];
  if(host&&fn){try{fn(host,r,specialApi(i));}catch(e){console.error(e);}}else if(r.special&&r.special.type&&r.special.type!=='none'&&!fn)console.error('special type not registered:',r.special.type);}
function specialApi(i){var r=ROOMS[i];return{img:function(f){return img(roomPath(r,f));},path:function(f){return roomPath(r,f);},room:r,sfx:sfx,
  compare:function(withFile,labelA,labelB){cmpSpec={a:roomPath(r,r.art.img),b:roomPath(r,withFile),la:labelA,lb:labelB};setTool(activeTool==='special'?null:'special');return activeTool==='special';},
  artRect:function(){return $('art').getBoundingClientRect();}};}

// generic special: split-compare the room's work with another image
EH.special('compare',function(host,r,api){var b=document.createElement('div');b.className='acts';b.innerHTML='<button type="button" class="act" aria-pressed="false">'+tt('compareSpecial',r)+'</button>';host.appendChild(b);
  var btn=b.firstChild;btn.addEventListener('click',function(){var on=api.compare(r.special.with,r.special.a||r.art.title,r.special.b||'');btn.setAttribute('aria-pressed',on?'true':'false');});});

// ================================================================== tools shared by every room
var activeTool=null,splitX=.5,cmpSpec=null;
function drawFit(g,im,w,h){var iw=im.naturalWidth||1,ih=im.naturalHeight||1,a=iw/ih,b=w/h;if(Math.abs(a/b-1)<.12){drawCover(g,im,w,h);return;}
  var s=Math.min(w/iw,h/ih),dw=iw*s,dh=ih*s;g.drawImage(im,(w-dw)/2,(h-dh)/2,dw,dh);}
function drawCmp(){var R=rectFor(st.idx,st.reading?'read':'hang');if(!R||!cmpSpec)return;var w=Math.round(R.w*DPR),h=Math.round(R.h*DPR),wall=ROOMS[st.idx].wall;
  whenLoaded([cmpSpec.a,cmpSpec.b],function(){[['cmpA',cmpSpec.a],['cmpB',cmpSpec.b]].forEach(function(x){var c=$(x[0]);c.width=w;c.height=h;var g=c.getContext('2d');g.fillStyle=wall;g.fillRect(0,0,w,h);drawFit(g,img(x[1]),w,h);});});
  var stack=R.w<380;$('cmpl').classList.toggle('stack',stack);   // a narrow frame can't hold two labels side by side: stack them, say which side
  $('sA').innerHTML=(stack?'左：':'')+tx(cmpSpec.la||'');$('sB').innerHTML=(stack?'右：':'')+tx(cmpSpec.lb||'');placeCmpLabels();}
// the compare labels sit on the wall under the frame, above the room effects; they follow the frame while it moves
function placeCmpLabels(){var a=$('sA'),b=$('sB');if(!a.classList.contains('on'))return;var f=$('cw').getBoundingClientRect(),stack=$('cmpl').classList.contains('stack'),y=$('frame').getBoundingClientRect().bottom+10;   // below the frame moulding, not the canvas
  a.style.left=f.left+'px';a.style.top=y+'px';a.style.maxWidth=stack?'none':(f.width/2-8)+'px';
  if(stack){b.style.left=f.left+'px';b.style.right='auto';b.style.top=(y+a.offsetHeight+2)+'px';b.style.maxWidth='none';}
  else{b.style.left='auto';b.style.right=(innerWidth-f.right)+'px';b.style.top=y+'px';b.style.maxWidth=(f.width/2-8)+'px';}}
function aspect(r){return r.art.w/r.art.h;}
function plate(on){var p=$('plate');if(!p)return;if(!on||!cmpSpec){p.hidden=true;p.innerHTML='';return;}
  p.innerHTML=[[cmpSpec.a,cmpSpec.la],[cmpSpec.b,cmpSpec.lb]].map(function(x){return '<figure><img src="'+x[0]+'" alt=""><figcaption>'+tx(x[1]||'')+'</figcaption></figure>';}).join('');p.hidden=false;}
function setTool(t){activeTool=t;Array.prototype.forEach.call(document.querySelectorAll('.act[aria-pressed]'),function(b){var bt=b.getAttribute('data-tool');if(bt)b.setAttribute('aria-pressed',bt===t?'true':'false');});
  if(t==='era'&&ROOMS.length<2)t=activeTool=null;
  if(t==='era'){var i=st.idx,o=adjacent(i),a=Math.min(i,o),b=Math.max(i,o);cmpSpec={a:roomPath(ROOMS[a],ROOMS[a].art.img),b:roomPath(ROOMS[b],ROOMS[b].art.img),la:ROOMS[a].zh+' · '+shortTitle(ROOMS[a]),lb:ROOMS[b].zh+' · '+shortTitle(ROOMS[b])};}
  // works of very different shape (a cave wall and a statue, a panel and a ceiling) are shown side by side in the panel, not split
  var hiddenWork=st.reading&&!rectFor(st.idx,'read'),side=false;
  if(t==='era'){var ra=aspect(ROOMS[Math.min(st.idx,adjacent(st.idx))]),rb=aspect(ROOMS[Math.max(st.idx,adjacent(st.idx))]);side=Math.max(ra,rb)/Math.min(ra,rb)>1.6;}
  plate(t==='era'&&(hiddenWork||side));
  var cmp=(t==='era'&&!side||t==='special')&&!hiddenWork;if(cmp)drawCmp();
  ['cmpA','cmpB','split','sA','sB'].forEach(function(id){$(id).classList.toggle('on',cmp);});placeCmpLabels();
  $('cmpA').style.clipPath='inset(0 '+((1-splitX)*100).toFixed(2)+'% 0 0)';$('split').style.left=(splitX*100)+'%';
  if(t!=='lens')lens.style.display='none';}
(function(){var sp=$('split'),drag=false;function mv(e){var r=$('cw').getBoundingClientRect();splitX=Math.min(.98,Math.max(.02,(e.clientX-r.left)/r.width));$('cmpA').style.clipPath='inset(0 '+((1-splitX)*100).toFixed(2)+'% 0 0)';sp.style.left=(splitX*100)+'%';sp.setAttribute('aria-valuenow',Math.round(splitX*100));}
  sp.addEventListener('pointerdown',function(e){drag=true;sp.setPointerCapture(e.pointerId);mv(e);e.stopPropagation();});sp.addEventListener('pointermove',function(e){if(drag)mv(e);});sp.addEventListener('pointerup',function(e){drag=false;e.stopPropagation();});
  sp.addEventListener('click',function(e){e.stopPropagation();});
  sp.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){splitX=Math.min(.98,Math.max(.02,splitX+(e.key==='ArrowLeft'?-.03:.03)));setTool(activeTool);e.preventDefault();}});})();
var lens=$('lens'),lensc=$('lensc'),lctx=lensc.getContext('2d');
$('cw').addEventListener('pointermove',function(e){if(activeTool!=='lens'){lens.style.display='none';return;}
  var rr=$('art').getBoundingClientRect(),u=(e.clientX-rr.left)/rr.width,v=(e.clientY-rr.top)/rr.height,r=ROOMS[st.idx],im=img(roomPath(r,r.art.img));
  var d=Math.min(window.devicePixelRatio||1,2),S=200*d;lensc.width=S;lensc.height=S;lctx.imageSmoothingQuality='high';var iw=im.naturalWidth,ih=im.naturalHeight,sw=S/3.2*(iw/(rr.width*d));
  lctx.fillStyle='#111';lctx.fillRect(0,0,S,S);lctx.drawImage(im,u*iw-sw/2,v*ih-sw/2,sw,sw,0,0,S,S);lens.style.display='block';lens.style.left=(e.clientX-100)+'px';lens.style.top=(e.clientY-100)+'px';});
$('cw').addEventListener('pointerleave',function(){lens.style.display='none';});
$('cw').addEventListener('click',function(){if(activeTool)return;openCurrent();});

// ================================================================== the viewer
var vc=$('vc'),vg=vc.getContext('2d'),V={s:1,x:0,y:0,s0:1,iw:1,ih:1,open:false,from:null,wasPlaying:false};
function openCurrent(){var r=ROOMS[st.idx];openView({image:img(roomPath(r,r.art.img)),art:r.art,from:$('art').getBoundingClientRect()});}
function openView(o){var src=o.image,iw=src.naturalWidth,ih=src.naturalHeight;if(!iw)return;
  vc.width=iw;vc.height=ih;vg.drawImage(src,0,0,iw,ih);V.iw=iw;V.ih=ih;
  $('vlab').innerHTML=labelHTML(o.art)+(o.art.note?'<p class="note">'+tx(o.art.note)+'</p>':'')+(o.art.credit?'<p class="credit">'+nb(esc(String(o.art.credit).replace(/[。.．]\s*$/,'')))+'</p>':'');
  vc.classList.toggle('cut',!!o.art.cut||/_cut\./.test(o.art.img||''));   // cut-outs (alpha) get no rectangular shadow
  var fr=o.from;V.from=fr;vc.classList.remove('anim');setT(fr.width/iw,fr.left,fr.top);
  $('view').classList.add('on');$('view').setAttribute('aria-hidden','false');V.open=true;sfx.play('ui-view');lens.style.display='none';void vc.offsetWidth;vc.classList.add('anim');fit();}
// the caption never covers the work at fit: either the work clears the caption column, or the caption's measured height is reserved below
function fit(){var sm=innerWidth<=560,top=sm?64:70,lab=$('vlab'),lb=lab.getBoundingClientRect(),mw=innerWidth-(sm?32:120);
  var s=Math.min(mw/V.iw,(innerHeight-top-60)/V.ih),x0=(innerWidth-V.iw*s)/2;
  if(sm||x0<lb.right+24){var bot=lab.offsetHeight+(sm?36:52);s=Math.min(mw/V.iw,(innerHeight-top-bot)/V.ih);var mh=innerHeight-top-bot;V.s0=s;setT(s,(innerWidth-V.iw*s)/2,top+(mh-V.ih*s)/2);return;}
  V.s0=s;setT(s,x0,top+(innerHeight-top-60-V.ih*s)/2);}
function setT(s,x,y){V.s=s;V.x=x;V.y=y;vc.style.transform='translate('+x+'px,'+y+'px) scale('+s+')';$('view').classList.toggle('zoomed',s>V.s0*1.04);}
function closeView(){if(!V.open)return;V.open=false;vc.classList.add('anim');var fr=V.from;if(fr)setT(fr.width/V.iw,fr.left,fr.top);$('view').classList.remove('on');$('view').setAttribute('aria-hidden','true');}
function zoomAt(k,cx,cy){var s=Math.min(Math.max(V.s*k,V.s0),V.s0*6);var f=s/V.s;setT(s,cx-(cx-V.x)*f,cy-(cy-V.y)*f);}
$('vclose').addEventListener('click',closeView);$('vfit').addEventListener('click',function(){vc.classList.add('anim');fit();});
$('view').addEventListener('wheel',function(e){e.preventDefault();vc.classList.remove('anim');zoomAt(Math.exp(-e.deltaY*(e.ctrlKey?.01:.0018)),e.clientX,e.clientY);},{passive:false});
(function(){var pts=new Map(),start=null;
  vc.addEventListener('pointerdown',function(e){vc.setPointerCapture(e.pointerId);pts.set(e.pointerId,[e.clientX,e.clientY]);vc.classList.remove('anim');start=pts.size===2?{d:dist(),s:V.s}:{x:e.clientX,y:e.clientY,vx:V.x,vy:V.y};});
  vc.addEventListener('pointermove',function(e){if(!pts.has(e.pointerId))return;pts.set(e.pointerId,[e.clientX,e.clientY]);
    if(pts.size===2&&start&&start.d){var c=center();zoomAt(start.s*dist()/start.d/V.s,c[0],c[1]);}else if(pts.size===1&&start&&start.x!==undefined){setT(V.s,start.vx+e.clientX-start.x,start.vy+e.clientY-start.y);}});
  function up(e){pts.delete(e.pointerId);if(pts.size===1){var p=Array.from(pts.values())[0];start={x:p[0],y:p[1],vx:V.x,vy:V.y};}else if(!pts.size)start=null;}
  vc.addEventListener('pointerup',up);vc.addEventListener('pointercancel',up);
  vc.addEventListener('dblclick',function(e){vc.classList.add('anim');if(V.s>V.s0*1.4)fit();else zoomAt(2.5,e.clientX,e.clientY);});
  $('view').addEventListener('click',function(e){if(e.target===$('view'))closeView();});
  function dist(){var a=Array.from(pts.values());return Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1]);}
  function center(){var a=Array.from(pts.values());return[(a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2];}})();

// ================================================================== controls
function begin(){if(st.started)return;if(!ROOMS.length){console.error('no rooms: check exhibit.json and run build.py');return;}st.started=true;audio();if(AC&&AC.state==='suspended')AC.resume();buses();preloadRoomSounds('ui');$('gate').classList.add('off');UI.wall(PAL.gate);resize();enter(0);st.playing=true;$('sound').setAttribute('aria-pressed','false');}
$('gate').addEventListener('click',begin);$('gate').addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();begin();}});
$('pause').addEventListener('click',function(){if(st.reading)closeRead();else openRead();});
$('skip').addEventListener('click',function(){if(st.phase==='enter'&&st.idx===0){st.t=duration(0);st.playing=true;}});
document.querySelector('.foot').addEventListener('click',function(e){var b=e.target.closest('button');if(b&&e.detail>0)b.blur();});
$('replay').addEventListener('click',function(){go(st.idx);});
$('auto').addEventListener('click',function(){setAuto(!st.auto);});
$('sound').addEventListener('click',function(){soundOn=!soundOn;if(master)master.gain.setTargetAtTime(soundOn?.8:0,AC.currentTime,.2);this.setAttribute('aria-pressed',soundOn?'false':'true');this.textContent=soundOn?T.sound:T.mute;});
addEventListener('keydown',function(e){if(!st.started){if(e.key==='Enter'||e.key===' '){e.preventDefault();begin();}return;}
  if(e.key==='Escape'){if(V.open)closeView();else closeRead();return;}
  var tg=e.target,chromeBtn=tg.closest&&tg.closest('.foot button,#skip');
  if(tg.tagName==='INPUT'||tg.tagName==='TEXTAREA'||(tg.getAttribute&&tg.getAttribute('role')==='slider')||(tg.tagName==='BUTTON'&&!chromeBtn)||(tg.closest&&tg.closest('#view')))return;
  if(chromeBtn&&(e.key===' '||e.key==='ArrowLeft'||e.key==='ArrowRight'))e.preventDefault();
  if(e.key===' '){e.preventDefault();if(V.open)return;if(st.reading)closeRead();else openRead();}
  if(e.key==='ArrowRight')jump(st.idx+1);if(e.key==='ArrowLeft')jump(st.idx-1);});

// test hooks
EH.debug={state:st,go:go,jump:jump,auto:setAuto,seek:function(i,p){if(st.idx!==i||st.phase!=='enter')enter(i);st.playing=false;var f=function(){if(loading){setTimeout(f,50);return;}st.t=p*duration(i);};f();},
  rest:function(i){enter(i);st.playing=false;var f=function(){if(loading){setTimeout(f,50);return;}st.t=duration(i);st.playing=true;};f();},
  begin:begin,open:openRead,close:closeRead,tool:setTool,get loading(){return loading;},rooms:function(){return ROOMS;},view:openCurrent,closeView:closeView,
  // motion(i,fps): draws the transition at every frame step and returns the mean abs change between consecutive frames (0–255), downsampled to 192 px wide.
  // Spikes against the neighbours are pops/cuts; flat zeros are dead holds. Result lands in window.__motion = {i, fps, d:[…], worst:[[p,d],…]}.
  motion:function(i,fps){fps=fps||60;window.__motion=null;EH.debug.seek(i,0);var f=function(){if(loading||!ctx){setTimeout(f,50);return;}
      var D=duration(i),n=Math.round(D*fps),w=192,h=Math.round(192*H/W),c=document.createElement('canvas');c.width=w;c.height=h;var g=c.getContext('2d',{willReadFrequently:true}),prev=null,d=[],k=0;
      (function step(){var t0=performance.now();while(k<=n&&performance.now()-t0<40){var p=k/n;drawTransition(i,p);g.drawImage(stage,0,0,w,h);var px=g.getImageData(0,0,w,h).data;
          if(prev){var s=0;for(var q=0;q<px.length;q+=4)s+=Math.abs(px[q]-prev[q])+Math.abs(px[q+1]-prev[q+1])+Math.abs(px[q+2]-prev[q+2]);d.push(+(s/(px.length*.75)).toFixed(3));}prev=px;k++;}
        if(k<=n){setTimeout(step,0);return;}
        var worst=d.map(function(v,j){var a=d.slice(Math.max(0,j-6),j+7).sort(function(x,y){return x-y;}),med=a[a.length>>1]||0;return[+(((j+1)/n)).toFixed(4),v,+(v/(med+.05)).toFixed(1)];}).sort(function(a,b){return b[2]-a[2];}).slice(0,12);
        window.__motion={i:i,fps:fps,n:n,d:d,worst:worst};})();};f();},
  // cost(i,n): median / p95 / max milliseconds of one draw() at the current size and dpr, and the p of the slowest frames
  cost:function(i,n){n=n||120;var out=[];for(var k=0;k<=n;k++){var p=k/n,t0=performance.now();drawTransition(i,p);out.push([performance.now()-t0,p]);}
    var ms=out.map(function(x){return x[0];}).sort(function(a,b){return a-b;});return{median:+ms[ms.length>>1].toFixed(2),p95:+ms[Math.floor(ms.length*.95)].toFixed(2),max:+ms[ms.length-1].toFixed(2),
      slowest:out.sort(function(a,b){return b[0]-a[0];}).slice(0,6).map(function(x){return[+x[1].toFixed(3),+x[0].toFixed(1)];})};}};
EH.start=function(){build();resize();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitTitles);requestAnimationFrame(frame);window.__ready=true;};
})();
