// SPDX-License-Identifier: GPL-3.0-or-later
import { AxisymmetricSolver } from './solver.mjs';
let sim,active=true,running=true,speed=12,last=performance.now(),budget=0,timer,lastFrame=0;
function sendFrame(){const f=sim.frame();postMessage(f,[f.data.buffer]);lastFrame=performance.now();}
function error(err){running=false;postMessage({type:'error',message:err.message||String(err)});}
function tick(){
  timer=null;
  if(!sim||!active||!running)return;
  const now=performance.now();budget=Math.min(2,budget+Math.min(0.1,(now-last)/1000)*speed);last=now;
  try {
    const until=performance.now()+24;
    while(budget>0.005&&performance.now()<until){const dt=sim.step(Math.min(0.4,budget));budget-=dt;}
    if(performance.now()-lastFrame>65)sendFrame();
  }catch(err){error(err);}
  if(active&&running)timer=setTimeout(tick,8);
}
function schedule(){if(timer!==undefined&&timer!==null)clearTimeout(timer);timer=null;last=performance.now();budget=0;if(active&&running)timer=setTimeout(tick,0);}
onmessage=({data:m})=>{
  try {
    switch(m.type){
      case 'init': sim=new AxisymmetricSolver();sendFrame();schedule();break;
      case 'run': running=!!m.running;postMessage({type:'running',running});schedule();break;
      case 'visible': active=!!m.active;schedule();break;
      case 'speed': speed=Math.min(30,Math.max(1,Number(m.value)||1));break;
      case 'params': sim.setParams(m.values);if(!running)sendFrame();break;
      case 'reset': sim.reset(m.preset??sim.preset,!!m.keepParams);sendFrame();running=true;postMessage({type:'running',running});schedule();break;
      case 'step': if(!running){sim.step();sendFrame();}break;
      case 'paint': if(Number.isFinite(m.r)&&Number.isFinite(m.z)&&Math.abs(m.r)<=sim.radius&&m.z>=0&&m.z<=sim.height){sim.paint(Math.abs(m.r),m.z,m.tool,m.amount===-1?-1:1);if(!running)sendFrame();}break;
      case 'save':postMessage({type:'saved',snapshot:sim.snapshot(),purpose:m.purpose});break;
      case 'load': {const restored=AxisymmetricSolver.restore(m.snapshot);sim=restored;running=false;sendFrame();postMessage({type:'running',running});postMessage({type:'loaded'});schedule();break;}
    }
  }catch(err){error(err);}
};
