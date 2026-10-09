// wkprobe script: play one room's entrance transition live (from the previous room's rest) and report every rAF gap.
// room id from the page URL: local.html?wkroom=<id>   (optional &rest=<seconds of rest before go>, default 3)
const q=new URLSearchParams(location.search),ROOM=q.get('wkroom'),REST=+(q.get('rest')||3);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let k=0;k<150&&!window.__ready;k++)await sleep(100);
EH.debug.begin();await sleep(600);
const R=EH.debug.rooms(),i=R.findIndex(r=>r.id===ROOM),st=EH.debug.state;if(i<1)return JSON.stringify({error:'room '+ROOM+' not found or first'});
EH.debug.rest(i-1);for(let k=0;k<150&&EH.debug.loading;k++)await sleep(100);await sleep(REST*1000);
let n=0,t0=performance.now();await new Promise(r=>{(function f(){n++;if(performance.now()-t0<1000)requestAnimationFrame(f);else r();})()});
EH.debug.go(i);for(let k=0;k<300&&EH.debug.loading;k++)await sleep(20);
const fr=[];let last=performance.now(),t1=last;
await new Promise(res=>{(function f(now){fr.push([+(now-last).toFixed(1),+st.t.toFixed(3)]);last=now;if(st.idx!==i||st.phase!=='enter'||fr.length>4000)return res();requestAnimationFrame(f);})(performance.now())});
const wall=(last-t1)/1000,tEnd=Math.max(...fr.map(x=>x[1])),d=fr.slice(1).map(x=>x[0]).sort((a,b)=>a-b),qq=p=>d[Math.floor(p*(d.length-1))];
return JSON.stringify({room:ROOM,idleRafPerSec:n,frames:fr.length,transitionSec:tEnd,wallSec:+wall.toFixed(2),p50:qq(.5),p90:qq(.9),p99:qq(.99),max:d[d.length-1],
  over45:fr.filter(x=>x[0]>45).length,over100:fr.filter(x=>x[0]>100).map(x=>x[1]+'s:'+x[0]+'ms'),long:fr.filter(x=>x[0]>45).map(x=>x[1]+'s:'+x[0]+'ms').slice(0,40),errs:window.__errs});
