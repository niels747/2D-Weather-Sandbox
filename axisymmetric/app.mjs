// SPDX-License-Identifier: GPL-3.0-or-later
import { PRESETS } from './solver.mjs';
const $=id=>document.getElementById(id),canvas=$('atmosphere'),ctx=canvas.getContext('2d');
const offscreen=document.createElement('canvas'),off=offscreen.getContext('2d');
const KEY='weather-sandbox-axisymmetric-v1';
let worker,frame,running=true,visible=true,parentActive=true,checkpoint=null,view='clouds',drawing=false,particles=[],lastTime=0,lastPaint=0,rateTime=performance.now(),rateSim=0,actualRate=0;
let bounds={x:40,y:25,width:600,height:400};
let syncedPreset;
const fmt=(v,d=1)=>Number(v).toFixed(d);
function message(text,error=false){$('message').textContent=text;$('message').hidden=false;$('message').classList.toggle('error',error);clearTimeout(message.timer);message.timer=setTimeout(()=>$('message').hidden=true,error?15000:4500);}
function post(m){worker?.postMessage(m);}
const UNITS={swirl:v=>`${v} m/s`,core:v=>`${v} m`,lift:v=>`${fmt(v,2)} m/s²`,humidity:v=>`${Math.round(v*100)}%`,drag:v=>`${fmt(v,3)} s⁻¹`};
for(const key of Object.keys(UNITS))$(key).addEventListener('input',()=>{const v=Number($(key).value);$(key+'-value').textContent=UNITS[key](v);post({type:'params',values:{[key]:v}});});
function syncControls(params){for(const key of Object.keys(UNITS)){if(document.activeElement!==$(key))$(key).value=params[key];$(key+'-value').textContent=UNITS[key](Number($(key).value));}}
function setRunning(value){running=value;$('pause').textContent=running?'Pause':'Resume';$('step').disabled=running;}
$('pause').onclick=()=>post({type:'run',running:!running});
$('step').onclick=()=>post({type:'step'});
$('reset').onclick=()=>{post({type:'reset',keepParams:true});particles=[];};
$('preset-load').onclick=()=>{post({type:'reset',preset:$('preset').value});particles=[];message('Loaded '+PRESETS[$('preset').value].label+'.');};
$('speed').onchange=()=>post({type:'speed',value:Number($('speed').value)});
$('back').onclick=()=>{if(window.parent!==window)parent.postMessage({type:'axis-return'},location.origin);else location.href='../index.html';};
$('save').onclick=()=>post({type:'save',purpose:'download'});
$('restore').onclick=()=>{if(checkpoint)post({type:'load',snapshot:checkpoint});};
$('load').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{if(file.size>14*1024*1024)throw new Error('This file is too large for an axisymmetric save.');post({type:'load',snapshot:JSON.parse(await file.text())});}
  catch(err){message(err.message,true);}finally{event.target.value='';}
};
function storeSnapshot(s){checkpoint=s;$('restore').disabled=false;try{localStorage.setItem(KEY,JSON.stringify(s));$('save-status').textContent='Automatic checkpoint saved on this device.';}catch{$('save-status').textContent='Checkpoint held in this tab. Export to keep a file.';}}
try{const saved=localStorage.getItem(KEY);if(saved){const s=JSON.parse(saved);if(s.format==='axisymmetric-weather'&&s.version===1){checkpoint=s;$('restore').disabled=false;$('save-status').textContent='A previous chamber checkpoint is available.';}}}catch{}
setInterval(()=>{if(frame&&visible&&running)post({type:'save',purpose:'checkpoint'});},30000);
function onVisibility(active){visible=active&&!document.hidden;post({type:'visible',active:visible});if(!active&&frame)post({type:'save',purpose:'checkpoint'});if(visible)lastTime=0;}
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='axis-visibility'){parentActive=!!event.data.active;onVisibility(parentActive);}});
document.addEventListener('visibilitychange',()=>onVisibility(parentActive));
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){event.preventDefault();post({type:'run',running:!running});}});
try{
  worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data:m})=>{
    if(m.type==='frame'){
      if(frame&&m.stats.time<frame.stats.time){particles=[];rateSim=0;rateTime=performance.now();}
      frame=m;$('startup').hidden=true;syncControls(m.params);
      if(syncedPreset!==m.preset){$('preset').value=m.preset;syncedPreset=m.preset;}
      const seconds=Math.floor(m.stats.time);$('clock').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
      $('max-swirl').textContent=fmt(m.stats.maxSwirl)+' m/s';$('max-updraft').textContent=fmt(m.stats.maxUpdraft)+' m/s';$('min-pressure').textContent=fmt(m.stats.minPressure,2)+' hPa';
      const now=performance.now();if(now-rateTime>1500){actualRate=(m.stats.time-rateSim)/((now-rateTime)/1000);rateTime=now;rateSim=m.stats.time;}$('rate').textContent=running?fmt(Math.max(0,actualRate))+'×':'Paused';
      $('diagnostics').textContent=`${m.nr} × ${m.nz} cells · ${fmt(m.radius/1000,1)} km radius · ${fmt(m.height/1000,1)} km high. Peak divergence ${m.stats.maxDiv.toExponential(1)} s⁻¹. Pressure solve: ${m.stats.iterations} iterations.`;
      updateParticles(m.stats.time);draw();
    }
    if(m.type==='running')setRunning(m.running);
    if(m.type==='error'){setRunning(false);$('startup').hidden=true;message(m.message,true);}
    if(m.type==='loaded'){particles=[];message('Save restored and paused. Resume when ready.');}
    if(m.type==='saved'){
      storeSnapshot(m.snapshot);
      if(m.purpose==='download'){const url=URL.createObjectURL(new Blob([JSON.stringify(m.snapshot)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='axisymmetric-'+Math.floor(m.snapshot.time)+'s.axisweather';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Axisymmetric save exported.');}
    }
  };
  worker.onerror=e=>{setRunning(false);$('startup').textContent='Could not start this mode. Normal 2D is still available.';message(e.message||'The axisymmetric worker could not start.',true);};
  post({type:'init'});setRunning(true);
}catch(err){$('startup').textContent='This browser could not start the chamber. Normal 2D is still available.';message(err.message,true);}
if(parent!==window)parent.postMessage({type:'axis-ready'},location.origin);
function sample(r,z,field){
  if(!frame)return 0;
  const x=Math.max(0,Math.min(frame.nr-1,r/frame.radius*frame.nr-0.5)),y=Math.max(0,Math.min(frame.nz-1,z/frame.height*frame.nz-0.5));
  const i=Math.floor(x),j=Math.floor(y),ip=Math.min(i+1,frame.nr-1),jp=Math.min(j+1,frame.nz-1),a=x-i,b=y-j,d=frame.data;
  return (1-b)*((1-a)*d[(j*frame.nr+i)*8+field]+a*d[(j*frame.nr+ip)*8+field])+b*((1-a)*d[(jp*frame.nr+i)*8+field]+a*d[(jp*frame.nr+ip)*8+field]);
}
function resize(){const rect=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);bounds={x:48,y:30,width:Math.max(10,rect.width-64),height:Math.max(10,rect.height-80)};draw();}
new ResizeObserver(resize).observe(canvas);
const MODES={
  clouds:['Clear air','Optically thick cloud','Condensate integrated through the revolved volume','#3b5a71','#e3edf4'],
  swirl:['−55 m/s','+55 m/s','Signed tangential speed · both halves share one radial field','#557fe6','#f7a762'],
  pressure:['−12 hPa','+12 hPa','Pressure perturbation relative to the background atmosphere','#7666ce','#ef9162'],
  vertical:['−35 m/s','+35 m/s','Blue: sinking · orange: rising','#619de9','#f7aa63'],
  cloudwater:['0 g/kg','3 g/kg','Cloud water on the radial slice, mirrored about the axis','#12233e','#e8f3ff'],
  humidity:['40%','100%','Relative humidity on the radial slice','#785c43','#79d9e0'],
  temperature:['−5°C','30°C','Temperature on the radial slice','#628adb','#f6b66e']
};
function updateLegend(){const m=MODES[view];$('legend-left').textContent=m[0];$('legend-right').textContent=m[1];$('view-note').textContent=m[2];$('legend-bar').style.background=`linear-gradient(90deg,${m[3]},${m[4]})`;}
$('display').onchange=()=>{view=$('display').value;updateLegend();draw();};$('vectors').onchange=draw;$('tracers').onchange=draw;updateLegend();
function lerp(a,b,t){return a+(b-a)*t;}
function diverging(v){const t=Math.max(-1,Math.min(1,v)),a=[22,35,55],b=t<0?[91,139,226]:[249,167,103];return a.map((c,i)=>lerp(c,b[i],Math.abs(t)));}
function draw(){
  if(!frame||!visible)return;
  const rect=canvas.getBoundingClientRect(),{nr,nz,data:d,radius,height}=frame,b=bounds;
  ctx.clearRect(0,0,rect.width,rect.height);ctx.fillStyle='#101e30';ctx.fillRect(0,0,rect.width,rect.height);
  offscreen.width=nr*2;offscreen.height=nz;const img=off.createImageData(nr*2,nz);
  for(let j=0;j<nz;j++)for(let i=0;i<nr;i++){
    const k=(j*nr+i)*8,z=(j+0.5)/nz;let color;
    if(view==='clouds'){
      // Line-of-sight integration through cylindrical rings, with path lengths in m.
      const x=(i+0.5)*radius/nr;let tau=0;
      for(let q=i;q<nr;q++){
        const ro=(q+1)*radius/nr,ri=q*radius/nr;
        const path=2*(Math.sqrt(Math.max(0,ro*ro-x*x))-Math.sqrt(Math.max(0,ri*ri-x*x)));
        tau+=Math.max(0,d[(j*nr+q)*8+5])*0.001*1.15*path*13;
      }
      const alpha=1-Math.exp(-tau),shade=lerp(120,230,Math.pow(z,0.55));
      const sky=[lerp(76,22,z),lerp(108,47,z),lerp(133,79,z)];
      color=sky.map((c,n)=>lerp(c,shade+n*5,alpha));
    }else if(view==='swirl')color=diverging(d[k+2]/55);
    else if(view==='pressure')color=diverging(d[k+3]/12);
    else if(view==='vertical')color=diverging(d[k+1]/35);
    else if(view==='cloudwater'){const t=Math.min(1,Math.max(0,d[k+5]/3));color=[18+212*t,35+209*t,62+193*t];}
    else if(view==='humidity'){const t=Math.min(1,Math.max(0,(d[k+6]-40)/60));color=[lerp(105,121,t),lerp(71,217,t),lerp(44,224,t)];}
    else {const t=Math.min(1,Math.max(0,(d[k+4]+5)/35));color=[lerp(98,246,t),lerp(138,182,t),lerp(219,110,t)];}
    for(const x of [nr+i,nr-1-i]){const p=((nz-1-j)*nr*2+x)*4;img.data[p]=color[0];img.data[p+1]=color[1];img.data[p+2]=color[2];img.data[p+3]=255;}
  }
  off.putImageData(img,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(offscreen,b.x,b.y,b.width,b.height);
  ctx.save();ctx.beginPath();ctx.rect(b.x,b.y,b.width,b.height);ctx.clip();
  ctx.strokeStyle='#c1d9ed19';ctx.lineWidth=1;
  for(let z=500;z<height;z+=500){const y=b.y+b.height*(1-z/height);ctx.beginPath();ctx.moveTo(b.x,y);ctx.lineTo(b.x+b.width,y);ctx.stroke();}
  if($('vectors').checked){
    for(let z=150;z<height;z+=240)for(let x=-radius+120;x<radius;x+=240){
      const u=sample(Math.abs(x),z,0)*Math.sign(x),w=sample(Math.abs(x),z,1),length=Math.hypot(u,w);if(length<0.3)continue;
      const p=screen(x,z),sc=Math.min(20,4+length*0.65)/length,dx=u*sc,dy=-w*sc;
      ctx.strokeStyle='#edf7ffe0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(p[0]-dx/2,p[1]-dy/2);ctx.lineTo(p[0]+dx/2,p[1]+dy/2);ctx.stroke();
      const angle=Math.atan2(dy,dx);ctx.beginPath();ctx.moveTo(p[0]+dx/2-4*Math.cos(angle-.5),p[1]+dy/2-4*Math.sin(angle-.5));ctx.lineTo(p[0]+dx/2,p[1]+dy/2);ctx.lineTo(p[0]+dx/2-4*Math.cos(angle+.5),p[1]+dy/2-4*Math.sin(angle+.5));ctx.stroke();
    }
  }
  if($('tracers').checked)for(const p of particles){const pos=screen(p.r*Math.cos(p.angle),p.z),depth=Math.sin(p.angle);ctx.fillStyle=`rgba(180,234,255,${0.25+0.55*(depth+1)/2})`;ctx.beginPath();ctx.arc(pos[0],pos[1],depth>0?1.6:1,0,Math.PI*2);ctx.fill();}
  ctx.setLineDash([5,6]);ctx.strokeStyle='#e0edff66';ctx.beginPath();ctx.moveTo(b.x+b.width/2,b.y);ctx.lineTo(b.x+b.width/2,b.y+b.height);ctx.stroke();ctx.restore();
  ctx.fillStyle='#cee0f0';ctx.font='12px system-ui';ctx.textAlign='right';
  for(let z=0;z<height;z+=500){const y=b.y+b.height*(1-z/height);ctx.fillText(fmt(z/1000,1),b.x-8,y+4);}ctx.textAlign='left';ctx.fillText('km',8,17);
  ctx.textAlign='center';ctx.fillText('Rotation axis',b.x+b.width/2,17);
  for(const f of [-1,-.5,0,.5,1]){ctx.textAlign=f===-1?'left':f===1?'right':'center';ctx.fillText(f===0?'r = 0':fmt(Math.abs(f)*radius/1000,1)+' km',b.x+b.width*(f+1)/2,b.y+b.height+20);}
}
function screen(x,z){return[bounds.x+(x/frame.radius+1)*bounds.width/2,bounds.y+(1-z/frame.height)*bounds.height];}
function updateParticles(time){
  const dt=lastTime?Math.min(2,Math.max(0,time-lastTime)):0;lastTime=time;
  while(particles.length<280)particles.push({r:40+Math.random()*frame.radius*0.65,z:20+Math.random()*frame.height,angle:Math.random()*Math.PI*2});
  for(const p of particles){const u=sample(p.r,p.z,0),w=sample(p.r,p.z,1),v=sample(p.r,p.z,2);p.r=Math.max(2,p.r+u*dt);p.z+=w*dt;p.angle+=v/Math.max(10,p.r)*dt;if(p.r>frame.radius||p.z>frame.height||p.z<0){p.r=frame.radius*(0.3+0.5*Math.random());p.z=30+Math.random()*200;p.angle=Math.random()*Math.PI*2;}}
}
function pointer(e){
  if(!frame)return;const rect=canvas.getBoundingClientRect();
  const x=((e.clientX-rect.left-bounds.x)/bounds.width*2-1)*frame.radius,z=(1-(e.clientY-rect.top-bounds.y)/bounds.height)*frame.height;
  if(Math.abs(x)>frame.radius||z<0||z>frame.height)return;
  const r=Math.abs(x);$('probe').textContent=`r ${Math.round(r)} m · z ${Math.round(z)} m | swirl ${fmt(sample(r,z,2))} m/s · up ${fmt(sample(r,z,1))} m/s · p′ ${fmt(sample(r,z,3),2)} hPa | ${fmt(sample(r,z,4))}°C · RH ${fmt(sample(r,z,6),0)}%`;
  if(drawing&&$('tool').value!=='inspect'&&performance.now()-lastPaint>45){post({type:'paint',r,z,tool:$('tool').value,amount:e.shiftKey?-1:1});lastPaint=performance.now();}
}
canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);pointer(e);});canvas.addEventListener('pointermove',pointer);canvas.addEventListener('pointerup',()=>drawing=false);canvas.addEventListener('pointercancel',()=>drawing=false);
