// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental, constant-reference-density axisymmetric Boussinesq model.
// Coordinates: radius r and height z; swirl carries specific angular momentum M=r*v.
// SI units throughout. MAC face velocities, annular finite volumes, pressure projection.
export const PRESETS = {
  chamber: { label: 'Vortex chamber', swirl: 26, core: 240, lift: 0.22, humidity: 0.92, drag: 0.035, viscosity: 18 },
  plume: { label: 'Rotating plume', swirl: 10, core: 440, lift: 0.12, humidity: 0.85, drag: 0.025, viscosity: 25 },
  calm: { label: 'Still atmosphere', swirl: 0, core: 300, lift: 0, humidity: 0.70, drag: 0.035, viscosity: 18 },
};
const LIMITS = {swirl:[-55,55],core:[100,700],lift:[0,0.6],humidity:[0.35,1],drag:[0,0.1],viscosity:[5,60]};
const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
const minmod = (a,b) => a*b <= 0 ? 0 : Math.sign(a)*Math.min(Math.abs(a),Math.abs(b));
const FIELDS = ['u','w','m','theta','water','p'];
export function saturationMixingRatio(tempK, pressurePa) {
  const c = clamp(tempK - 273.15, -70, 55);
  const e = 611.2 * Math.exp(17.67*c/(c+243.5));
  return 0.622 * e / Math.max(pressurePa-e, 10000);
}
export class AxisymmetricSolver {
  constructor({nr=80,nz=112,radius=2000,height=2800,preset='chamber'}={}) {
    if (!Number.isInteger(nr)||!Number.isInteger(nz)||nr<16||nr>160||nz<16||nz>192||
        !Number.isFinite(radius)||radius<1000||radius>5000||!Number.isFinite(height)||height<1000||height>5000) {
      throw new Error('Unsupported chamber grid.');
    }
    this.nr=nr;this.nz=nz;this.radius=radius;this.height=height;
    this.dr=radius/nr;this.dz=height/nz;this.n=nr*nz;
    this.u=new Float64Array((nr+1)*nz);this.w=new Float64Array(nr*(nz+1));
    for(const name of ['m','theta','water','p','cloud','temperature','rh']) this[name]=new Float64Array(this.n);
    this.tmpU=new Float64Array(this.u.length);this.tmpW=new Float64Array(this.w.length);
    this.tmp=new Float64Array(this.n);this.tmp2=new Float64Array(this.n);
    for(const name of ['rhs','res','dir','pre','Ad','diagonal']) this[name]=new Float64Array(this.n);
    this.buildMatrix();this.reset(preset);
  }
  setParams(values) {
    for(const [name,[a,b]] of Object.entries(LIMITS)) {
      if (name in values) {
        if(!Number.isFinite(values[name])) throw new Error('Invalid '+name);
        this.params[name]=clamp(values[name],a,b);
      }
    }
  }
  backgroundTheta(z) { return 300 + 0.003*z; }
  backgroundPressure(z) { return 100000*Math.exp(-z/8400); }
  backgroundWater(z) {
    const p=this.backgroundPressure(z),t=this.backgroundTheta(z)*Math.pow(p/100000,0.286);
    return this.params.humidity*saturationMixingRatio(t,p);
  }
  inletM(r,z) {
    const a=this.params.core*(1+0.8*z/this.height);
    return r*this.params.swirl*2*(r/a)/(1+(r/a)**2);
  }
  reset(preset='chamber', keepParams=false) {
    this.preset=PRESETS[preset]?preset:'chamber';
    if(!keepParams) this.params={...PRESETS[this.preset]};
    for(const name of [...FIELDS,'cloud','tmpU','tmpW']) this[name].fill(0);
    this.time=0;this.steps=0;this.lastIterations=0;this.lastResidual=0;this.failed=false;
    const {nr,nz,dr,dz}=this;
    const psi=(r,z)=>0.5*10*(this.params.lift/0.22)*r*r*Math.exp(-((r/430)**2))*Math.sin(Math.PI*z/this.height);
    for(let j=0;j<nz;j++) for(let i=0;i<nr;i++) {
      const k=j*nr+i,r=(i+0.5)*dr,z=(j+0.5)*dz;
      this.m[k]=this.inletM(r,z)*(1-0.40*Math.exp(-z/90));
      this.theta[k]=this.backgroundTheta(z)+2*(this.params.lift/0.22)*Math.exp(-((r/400)**2)-((z-700)/450)**2);
      this.water[k]=this.backgroundWater(z);
      // Moist reservoir, not an imposed funnel. Condensate is diagnosed from saturation.
      if(this.params.lift>0) this.water[k]+=0.0015*Math.exp(-((r/800)**2)-((z-1400)/500)**2);
    }
    for(let j=0;j<nz;j++) for(let i=1;i<nr;i++) this.u[j*(nr+1)+i]=-(psi(i*dr,(j+1)*dz)-psi(i*dr,j*dz))/(i*dr*dz);
    for(let j=1;j<nz;j++) for(let i=0;i<nr;i++) this.w[j*nr+i]=(psi((i+1)*dr,j*dz)-psi(i*dr,j*dz))/((i+0.5)*dr*dr);
    this.thermodynamics(0);this.project(1);this.diagnose();
  }
  buildMatrix() {
    const {nr,nz,dr,dz}=this, ar=1/(dr*dr),az=1/(dz*dz);
    for(let j=0;j<nz;j++) for(let i=0;i<nr;i++) {
      const l=i/(i+0.5)*ar,r=(i+1)/(i+0.5)*ar;
      this.diagonal[j*nr+i]=(i>0?l:0)+(i===nr-1?2*r:r)+(j>0?az:0)+(j<nz-1?az:0);
    }
  }
  applyMatrix(x,out) {
    const {nr,nz,dr,dz}=this,ar=1/(dr*dr),az=1/(dz*dz);
    for(let j=0;j<nz;j++) for(let i=0;i<nr;i++) {
      const k=j*nr+i;
      out[k]=this.diagonal[k]*x[k]-(i>0?i/(i+0.5)*ar*x[k-1]:0)-(i<nr-1?(i+1)/(i+0.5)*ar*x[k+1]:0)
        -(j>0?az*x[k-nr]:0)-(j<nz-1?az*x[k+nr]:0);
    }
  }
  weightedDot(a,b) {
    let s=0;for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {const k=j*this.nr+i;s+=(i+0.5)*a[k]*b[k];}return s;
  }
  divergence(out=this.rhs) {
    const {nr,nz,dr,dz,u,w}=this;
    for(let j=0;j<nz;j++)for(let i=0;i<nr;i++)out[j*nr+i]=((i+1)*u[j*(nr+1)+i+1]-i*u[j*(nr+1)+i])/((i+0.5)*dr)+(w[(j+1)*nr+i]-w[j*nr+i])/dz;
    return out;
  }
  project(dt) {
    const {nr,nz,p,rhs,res,dir,pre,Ad,diagonal}=this;
    this.divergence(rhs);for(let k=0;k<this.n;k++)rhs[k]=-rhs[k]/dt;
    this.applyMatrix(p,Ad);
    for(let k=0;k<this.n;k++){res[k]=rhs[k]-Ad[k];pre[k]=res[k]/diagonal[k];dir[k]=pre[k];}
    let rz=this.weightedDot(res,pre),rr=this.weightedDot(res,res),iterations=0;
    const norm=this.weightedDot(rhs,rhs),tol=Math.max(1e-16*this.nr*this.nr*this.nz, norm*1e-10);
    for(;iterations<240 && rr>tol;iterations++) {
      this.applyMatrix(dir,Ad);
      const den=this.weightedDot(dir,Ad);
      if(!(den>0)||!Number.isFinite(den))throw new Error('Pressure solve lost numerical stability.');
      const alpha=rz/den;
      for(let k=0;k<this.n;k++){p[k]+=alpha*dir[k];res[k]-=alpha*Ad[k];pre[k]=res[k]/diagonal[k];}
      const next=this.weightedDot(res,pre),beta=next/rz;
      for(let k=0;k<this.n;k++)dir[k]=pre[k]+beta*dir[k];
      rz=next;rr=this.weightedDot(res,res);
    }
    this.lastIterations=iterations;this.lastResidual=Math.sqrt(rr/(this.nr*this.nr*this.nz/2));
    for(let j=0;j<nz;j++) {
      this.u[j*(nr+1)]=0;
      for(let i=1;i<nr;i++)this.u[j*(nr+1)+i]-=dt*(p[j*nr+i]-p[j*nr+i-1])/this.dr;
      this.u[j*(nr+1)+nr]+=2*dt*p[j*nr+nr-1]/this.dr;
    }
    for(let i=0;i<nr;i++) {
      this.w[i]=0;
      for(let j=1;j<nz;j++)this.w[j*nr+i]-=dt*(p[j*nr+i]-p[(j-1)*nr+i])/this.dz;
      this.w[nz*nr+i]=0; // Free-slip rigid lid; dp/dz=0. Outer radius remains open.
    }
  }
  // Bilinear interpolation on staggered grids. The axis has even scalar/w parity,
  // odd radial velocity; no array ever evaluates 1/r at r=0.
  sample(a,r,z,kind='cell') {
    let sign=1;if(r<0){r=-r;if(kind==='u')sign=-1;}
    const nx=this.nr+(kind==='u'?1:0),ny=this.nz+(kind==='w'?1:0);
    const x=clamp(r/this.dr-(kind==='u'?0:0.5),0,nx-1),y=clamp(z/this.dz-(kind==='w'?0:0.5),0,ny-1);
    const i=Math.floor(x),j=Math.floor(y),ip=Math.min(i+1,nx-1),jp=Math.min(j+1,ny-1),a1=x-i,b1=y-j;
    return sign*((1-b1)*((1-a1)*a[j*nx+i]+a1*a[j*nx+ip])+b1*((1-a1)*a[jp*nx+i]+a1*a[jp*nx+ip]));
  }
  departure(r,z,dt) {
    const u=this.sample(this.u,r,z,'u'),w=this.sample(this.w,r,z,'w');
    const rm=r-0.5*dt*u,zm=z-0.5*dt*w;
    return [r-dt*this.sample(this.u,rm,zm,'u'),z-dt*this.sample(this.w,rm,zm,'w')];
  }
  advectVelocity(dt) {
    const {nr,nz,dr,dz}=this;
    for(let j=0;j<nz;j++)for(let i=1;i<=nr;i++) {
      const [r,z]=this.departure(i*dr,(j+0.5)*dz,dt);
      this.tmpU[j*(nr+1)+i]=this.sample(this.u,r,z,'u');
    }
    for(let j=1;j<nz;j++)for(let i=0;i<nr;i++) {
      const [r,z]=this.departure((i+0.5)*dr,j*dz,dt);
      this.tmpW[j*nr+i]=this.sample(this.w,r,z,'w');
    }
    this.u.set(this.tmpU);this.w.set(this.tmpW);
  }
  // Conservative MUSCL fluxes through annular faces. Specific angular momentum
  // is transported as M, rather than transporting swirl and multiplying arbitrarily.
  advectConserved(a,dt,inlet) {
    const {nr,nz,dr,dz,u,w,tmp}=this;
    tmp.set(a);
    const value=(i,j,di,dj,side)=>{
      const k=j*nr+i;
      if(i-di<0||i+di>=nr||j-dj<0||j+dj>=nz)return a[k];
      const off=dj*nr+di,slope=minmod(a[k]-a[k-off],a[k+off]-a[k]);
      return a[k]+side*0.5*slope;
    };
    for(let j=0;j<nz;j++)for(let i=1;i<=nr;i++) {
      const speed=u[j*(nr+1)+i];
      const f=speed*(speed>=0?value(i-1,j,1,0,1):(i===nr?inlet(i*dr,(j+0.5)*dz):value(i,j,1,0,-1)));
      tmp[j*nr+i-1]-=dt*i*f/((i-0.5)*dr);
      if(i<nr)tmp[j*nr+i]+=dt*i*f/((i+0.5)*dr);
    }
    for(let j=1;j<=nz;j++)for(let i=0;i<nr;i++) {
      const speed=w[j*nr+i];
      const f=speed*(speed>=0?value(i,j-1,0,1,1):(j===nz?inlet((i+0.5)*dr,j*dz):value(i,j,0,1,-1)));
      tmp[(j-1)*nr+i]-=dt*f/dz;if(j<nz)tmp[j*nr+i]+=dt*f/dz;
    }
    a.set(tmp);
  }
  advectThermal(dt) {
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const [r,z]=this.departure((i+0.5)*this.dr,(j+0.5)*this.dz,dt);
      this.tmp2[j*this.nr+i]=(r>this.radius||z>this.height)?this.backgroundTheta(clamp(z,0,this.height)):this.sample(this.theta,r,z);
    }
    this.theta.set(this.tmp2);
  }
  forces(dt) {
    const {nr,nz,dr,dz,params}=this,nu=params.viscosity;
    this.tmpU.set(this.u);this.tmpW.set(this.w);
    for(let j=0;j<nz;j++)for(let i=1;i<=nr;i++) {
      const k=j*(nr+1)+i,r=i*dr,z=(j+0.5)*dz;
      const v=i===nr?this.m[j*nr+i-1]/((i-0.5)*dr):0.5*(this.m[j*nr+i-1]/((i-0.5)*dr)+this.m[j*nr+i]/((i+0.5)*dr));
      const val=this.u[k],l=this.u[k-1],right=i<nr?this.u[k+1]:val;
      const down=j>0?this.u[k-nr-1]:val,up=j<nz-1?this.u[k+nr+1]:val;
      const lap=(right-2*val+l)/(dr*dr)+(right-l)/(2*r*dr)+(up-2*val+down)/(dz*dz)-val/(r*r);
      this.tmpU[k]=(val+dt*(v*v/r+nu*lap))*Math.exp(-params.drag*dt*Math.exp(-z/100));
    }
    for(let j=1;j<nz;j++)for(let i=0;i<nr;i++) {
      const k=j*nr+i,r=(i+0.5)*dr,z=j*dz,val=this.w[k];
      const left=i>0?this.w[k-1]:val,right=i<nr-1?this.w[k+1]:val;
      const lap=((i+1)*(right-val)-i*(val-left))/((i+0.5)*dr*dr)+(this.w[k+nr]-2*val+this.w[k-nr])/(dz*dz);
      let b=0;
      for(const c of [k,k-nr]) {
        const zc=(Math.floor(c/nr)+0.5)*dz;
        b+=9.81*((this.theta[c]-this.backgroundTheta(zc))/300+0.61*(this.water[c]-this.cloud[c]-this.backgroundWater(zc))-this.cloud[c])*0.5;
      }
      const drive=params.lift*Math.exp(-((r/(params.core*1.9))**2)-((z-1250)/650)**2);
      this.tmpW[k]=val+dt*(b+drive+nu*lap);
    }
    this.u.set(this.tmpU);this.w.set(this.tmpW);
    // Viscous torque: dM/dt = nu/r * d/dr(r^3*d(M/r^2)/dr) + nu*d2M/dz2.
    this.tmp.set(this.m);
    for(let j=0;j<nz;j++)for(let i=0;i<nr;i++) {
      const k=j*nr+i,r=(i+0.5)*dr,omega=this.m[k]/(r*r);
      const fl=i>0?(i*dr)**3*(omega-this.m[k-1]/((r-dr)**2))/dr:0;
      const fr=i<nr-1?((i+1)*dr)**3*(this.m[k+1]/((r+dr)**2)-omega)/dr:0;
      const zlap=((j>0?this.m[k-nr]:this.m[k])-2*this.m[k]+(j<nz-1?this.m[k+nr]:this.m[k]))/(dz*dz);
      const z=(j+0.5)*dz;
      this.tmp[k]=(this.m[k]+dt*nu*((fr-fl)/(r*dr)+zlap))*Math.exp(-params.drag*dt*Math.exp(-z/100));
      // Open outer reservoir supplies ambient rotating air, with a resolved sponge.
      const relax=1-Math.exp(-dt*0.08*Math.max(0,(r/this.radius-0.84)/0.16)**2);
      this.tmp[k]+=relax*(this.inletM(r,z)-this.tmp[k]);
      this.water[k]+=relax*(this.backgroundWater(z)-this.water[k]);
      this.theta[k]+=relax*(this.backgroundTheta(z)-this.theta[k]);
    }
    this.m.set(this.tmp);
  }
  thermodynamics(dt) {
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const k=j*this.nr+i,z=(j+0.5)*this.dz;
      const pressure=Math.max(30000,this.backgroundPressure(z)+1.15*this.p[k]);
      const exner=Math.pow(pressure/100000,0.286);
      const initialTheta=this.theta[k],oldCloud=this.cloud[k];
      let c=oldCloud;
      // Saturation adjustment with latent heating; relaxation avoids oscillation.
      for(let it=0;it<8;it++) {
        const t=(initialTheta+2490*(c-oldCloud)/exner)*exner;
        c=0.5*c+0.5*Math.max(0,this.water[k]-saturationMixingRatio(t,pressure));
      }
      this.theta[k]=initialTheta+2490*(c-oldCloud)/exner;
      this.cloud[k]=c;this.temperature[k]=this.theta[k]*exner;
      this.rh[k]=100*Math.max(0,this.water[k]-c)/saturationMixingRatio(this.temperature[k],pressure);
    }
  }
  timestep(maxDt=0.4) {
    let rate=0;
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const k=j*this.nr+i;
      const u=Math.max(Math.abs(this.u[j*(this.nr+1)+i]),Math.abs(this.u[j*(this.nr+1)+i+1]));
      const w=Math.max(Math.abs(this.w[k]),Math.abs(this.w[k+this.nr]));
      rate=Math.max(rate,3*u/this.dr+w/this.dz);
      rate=Math.max(rate,Math.abs(this.m[k])/(((i+0.5)*this.dr)**2));
    }
    return Math.min(maxDt,0.38/Math.max(rate,1e-9),0.10*Math.min(this.dr**2,this.dz**2)/this.params.viscosity);
  }
  step(maxDt=0.4) {
    if(this.failed)throw new Error('Simulation paused after numerical failure. Reset or load a checkpoint.');
    const dt=this.timestep(maxDt);
    if(!Number.isFinite(dt)||dt<0.0002){this.failed=true;throw new Error('Flow exceeded the stable range. Reduce forcing or reset the chamber.');}
    this.advectThermal(dt);
    this.advectConserved(this.m,dt,(r,z)=>this.inletM(r,z));
    this.advectConserved(this.water,dt,(_r,z)=>this.backgroundWater(z));
    // Move cloud with the same air before latent adjustment, avoiding spurious heat.
    this.advectConserved(this.cloud,dt,()=>0);
    this.advectVelocity(dt);this.forces(dt);this.project(dt);this.thermodynamics(dt);
    this.time+=dt;this.steps++;
    if(this.steps%10===0)this.diagnose();
    return dt;
  }
  paint(r,z,kind,amount=1) {
    const radius=120;
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const k=j*this.nr+i,rc=(i+0.5)*this.dr,zc=(j+0.5)*this.dz;
      const b=Math.exp(-((rc-r)**2+(zc-z)**2)/(radius*radius))*amount;
      if(kind==='heat')this.theta[k]=clamp(this.theta[k]+b,260,360);
      if(kind==='moisture')this.water[k]=clamp(this.water[k]+b*0.0004,0,0.035);
      if(kind==='swirl')this.m[k]+=b*rc*1.5*Math.min(1,rc/radius);
    }
    this.thermodynamics(0);
  }
  diagnose() {
    let maxSwirl=0,maxUpdraft=0,minPressure=0,maxWind=0,cloudMass=0,angularMomentum=0,maxDiv=0;
    this.divergence(this.rhs);
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const k=j*this.nr+i,r=(i+0.5)*this.dr;
      const v=this.m[k]/r,u=0.5*(this.u[j*(this.nr+1)+i]+this.u[j*(this.nr+1)+i+1]),w=0.5*(this.w[k]+this.w[k+this.nr]);
      if(!Number.isFinite(v+u+w+this.p[k]+this.theta[k]+this.water[k])||Math.abs(v)>350||Math.abs(u)>350||Math.abs(w)>350||this.water[k]<-0.0001||this.theta[k]<180||this.theta[k]>420){this.failed=true;throw new Error('Numerical limit reached. Pause retained; reset or load a checkpoint.');}
      maxSwirl=Math.max(maxSwirl,Math.abs(v));maxUpdraft=Math.max(maxUpdraft,w);minPressure=Math.min(minPressure,1.15*this.p[k]/100);
      maxWind=Math.max(maxWind,Math.hypot(v,u,w));cloudMass+=r*this.cloud[k];angularMomentum+=r*this.m[k];maxDiv=Math.max(maxDiv,Math.abs(this.rhs[k]));
    }
    this.stats={time:this.time,maxSwirl,maxUpdraft,minPressure,maxWind,cloudMass:cloudMass*2*Math.PI*this.dr*this.dz*1.15,angularMomentum:angularMomentum*2*Math.PI*this.dr*this.dz*1.15,maxDiv,iterations:this.lastIterations,residual:this.lastResidual};
    return this.stats;
  }
  frame() {
    const data=new Float32Array(this.n*8);
    for(let j=0;j<this.nz;j++)for(let i=0;i<this.nr;i++) {
      const k=j*this.nr+i,o=k*8;
      data[o]=(this.u[j*(this.nr+1)+i]+this.u[j*(this.nr+1)+i+1])*0.5;
      data[o+1]=(this.w[k]+this.w[k+this.nr])*0.5;data[o+2]=this.m[k]/((i+0.5)*this.dr);
      data[o+3]=1.15*this.p[k]/100;data[o+4]=this.temperature[k]-273.15;
      data[o+5]=this.cloud[k]*1000;data[o+6]=this.rh[k];data[o+7]=this.water[k]*1000;
    }
    return {type:'frame',data,nr:this.nr,nz:this.nz,radius:this.radius,height:this.height,stats:this.diagnose(),params:{...this.params},preset:this.preset};
  }
  snapshot() {
    return {format:'axisymmetric-weather',version:1,nr:this.nr,nz:this.nz,radius:this.radius,height:this.height,preset:this.preset,params:{...this.params},time:this.time,steps:this.steps,
      fields:Object.fromEntries([...FIELDS,'cloud'].map(n=>[n,Array.from(this[n])]))};
  }
  static restore(s) {
    if(!s||s.format!=='axisymmetric-weather'||s.version!==1)throw new Error('Choose an axisymmetric .axisweather save; normal 2D saves stay in Normal 2D.');
    const sim=new AxisymmetricSolver({nr:s.nr,nz:s.nz,radius:s.radius,height:s.height,preset:s.preset});
    if(!s.params||!Number.isFinite(s.time)||s.time<0||!Number.isInteger(s.steps)||s.steps<0)throw new Error('Invalid save settings.');
    sim.setParams(s.params);
    for(const n of [...FIELDS,'cloud']) {
      const a=s.fields?.[n];if(!Array.isArray(a)||a.length!==sim[n].length||a.some(v=>!Number.isFinite(v)||Math.abs(v)>1e8))throw new Error('Invalid '+n+' field in save.');
      sim[n].set(a);
    }
    sim.time=s.time;sim.steps=s.steps;
    // Enforce normal-flow boundary parity on imported data before projection.
    for(let j=0;j<sim.nz;j++)sim.u[j*(sim.nr+1)]=0;
    for(let i=0;i<sim.nr;i++){sim.w[i]=0;sim.w[sim.nz*sim.nr+i]=0;}
    sim.project(1);sim.thermodynamics(0);sim.diagnose();return sim;
  }
}
