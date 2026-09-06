// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { AxisymmetricSolver } from './solver.mjs';
const small=()=>new AxisymmetricSolver({nr:24,nz:32,preset:'calm'});
test('still, dry atmosphere remains still; no spontaneous swirl',()=>{
  const s=small();for(let i=0;i<100;i++)s.step();
  const d=s.diagnose();assert.ok(d.maxWind<1e-9);assert.equal(d.maxSwirl,0);assert.equal(d.cloudMass,0);
});
test('cylindrical projection removes weighted divergence and respects boundaries',()=>{
  const s=small();for(let j=0;j<s.nz;j++)for(let i=1;i<=s.nr;i++)s.u[j*(s.nr+1)+i]=Math.sin(i*.34+j*.15)*4;
  for(let j=1;j<s.nz;j++)for(let i=0;i<s.nr;i++)s.w[j*s.nr+i]=Math.cos(i*.2+j*.28)*3;
  const before=Math.max(...Array.from(s.divergence(),Math.abs));s.project(.2);
  const after=Math.max(...Array.from(s.divergence(),Math.abs));assert.ok(after<before*1e-4,`${before} -> ${after}`);
  for(let j=0;j<s.nz;j++)assert.equal(s.u[j*(s.nr+1)],0);
  for(let i=0;i<s.nr;i++){assert.equal(s.w[i],0);assert.equal(s.w[s.nz*s.nr+i],0);}
});
test('annular flux transport conserves total angular momentum in a closed flow',()=>{
  const s=small();const {nr,nz,dr,dz}=s;
  const psi=(r,z)=>r*r*Math.sin(Math.PI*r/s.radius)**2*Math.sin(Math.PI*z/s.height)*0.4;
  for(let j=0;j<nz;j++)for(let i=1;i<nr;i++)s.u[j*(nr+1)+i]=-(psi(i*dr,(j+1)*dz)-psi(i*dr,j*dz))/(i*dr*dz);
  for(let j=1;j<nz;j++)for(let i=0;i<nr;i++)s.w[j*nr+i]=(psi((i+1)*dr,j*dz)-psi(i*dr,j*dz))/((i+.5)*dr*dr);
  for(let j=0;j<nz;j++)for(let i=0;i<nr;i++)s.m[j*nr+i]=((i+.5)*dr)**2*.01;
  const total=()=>s.m.reduce((v,m,k)=>v+m*(k%nr+.5),0);const before=total();
  for(let n=0;n<80;n++)s.advectConserved(s.m,.05,()=>0);
  assert.ok(Math.abs(total()-before)/before<1e-12);
});
test('centrifugal force is balanced by an inward pressure gradient',()=>{
  const s=small();s.setParams({drag:0,lift:0,swirl:0});
  for(let j=0;j<s.nz;j++)for(let i=0;i<s.nr;i++)s.m[j*s.nr+i]=.01*((i+.5)*s.dr)**2;
  s.forces(.1);s.project(.1);
  assert.ok(s.p[0]<s.p[s.nr-1]);
  assert.ok(Math.max(...Array.from(s.u,Math.abs))<2e-4);
  assert.ok(Math.max(...Array.from(s.w,Math.abs))<2e-4);
});
test('zero swirl stays zero under updraft forcing',()=>{
  const s=small();s.setParams({lift:.2});for(let n=0;n<100;n++)s.step();assert.equal(s.diagnose().maxSwirl,0);assert.ok(s.stats.maxUpdraft>0);
});
test('cloud saturation adjustment conserves water and moist enthalpy',()=>{
  const s=small(),k=200;s.water[k]=.027;const initialWater=s.water[k];
  const z=(Math.floor(k/s.nr)+.5)*s.dz,exner=Math.pow(s.backgroundPressure(z)/100000,.286);
  const before=s.theta[k]*exner+2490*(s.water[k]-s.cloud[k]);
  s.thermodynamics(0);const after=s.theta[k]*exner+2490*(s.water[k]-s.cloud[k]);
  assert.ok(s.cloud[k]>0);assert.equal(s.water[k],initialWater);assert.ok(Math.abs(before-after)<1e-9);
});
test('save round trip is valid and malformed saves cannot replace a session',()=>{
  const s=new AxisymmetricSolver({nr:24,nz:32});for(let n=0;n<25;n++)s.step();const snap=s.snapshot(),t=AxisymmetricSolver.restore(snap);
  assert.equal(t.time,s.time);assert.deepEqual(Array.from(t.m),Array.from(s.m));assert.deepEqual(Array.from(t.water),Array.from(s.water));
  assert.throws(()=>AxisymmetricSolver.restore({...snap,nr:99999}));assert.throws(()=>AxisymmetricSolver.restore({...snap,format:'weathersandbox'}));
  snap.fields.m[0]=NaN;assert.throws(()=>AxisymmetricSolver.restore(snap));
  assert.equal(s.failed,false);
});
test('reset reproduces its seed, including cloud and scratch arrays',()=>{
  const s=new AxisymmetricSolver({nr:24,nz:32}),initial=s.snapshot();for(let n=0;n<60;n++)s.step();s.reset('chamber');assert.deepEqual(s.snapshot(),initial);
});
test('vortex survives a sustained integration with bounded divergence',()=>{
  const s=new AxisymmetricSolver({nr:40,nz:56});for(let n=0;n<1000;n++)s.step();const d=s.diagnose();
  assert.ok(d.time>200);assert.ok(d.maxSwirl>10&&d.maxWind<150);assert.ok(d.minPressure<-.1);assert.ok(d.maxDiv<1e-4);assert.ok(d.cloudMass>0);
});
