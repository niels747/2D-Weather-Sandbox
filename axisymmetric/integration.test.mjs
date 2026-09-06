// SPDX-License-Identifier: GPL-3.0-or-later
// Non-browser contract tests for the reversible parent/worker integration.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {AxisymmetricSolver} from './solver.mjs';
const root=new URL('../',import.meta.url);
test('mode is lazy, returns to Normal 2D, and reuses the exact chamber frame',async()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.messages=[];this.contentWindow={postMessage:(...args)=>this.messages.push(args)};}
    setAttribute(k,v){this.attrs[k]=v;}append(...elements){this.children.push(...elements);}
    addEventListener(k,f){this.events[k]=f;}focus(){this.focused=true;}
  }
  const body=new Element('body'),entry=new Element('button'),listeners={},released=[];
  const document={body,createElement:tag=>new Element(tag),getElementById:()=>entry,dispatchEvent:e=>released.push(e)};
  const window={addEventListener:(k,f)=>listeners[k]=f,dispatchEvent:e=>released.push(e)};
  const context={document,window,location:{origin:'https://example.test'},KeyboardEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},MouseEvent:class{constructor(type){this.type=type;}}};
  vm.runInNewContext(await readFile(new URL('mode-switch.js',root),'utf8'),context);
  const [switcher]=body.children,[normal,axis]=switcher.children;
  assert.equal(body.children.length,1);assert.equal(normal.attrs['aria-pressed'],'true');assert.equal(window.weatherAxisymmetricActive,false);
  axis.events.click();const chamber=body.children[1];assert.equal(chamber.tag,'iframe');assert.equal(chamber.hidden,false);assert.equal(window.weatherAxisymmetricActive,true);assert.ok(released.length>=10);
  normal.events.click();assert.equal(chamber.hidden,true);assert.equal(window.weatherAxisymmetricActive,false);assert.equal(chamber.messages.at(-1)[0].active,false);
  axis.events.click();assert.equal(body.children.length,2);assert.equal(body.children[1],chamber);assert.equal(chamber.messages.at(-1)[0].active,true);
  listeners.message({origin:'https://other.test',source:chamber.contentWindow,data:{type:'axis-return'}});assert.equal(window.weatherAxisymmetricActive,true);
  listeners.message({origin:'https://example.test',source:chamber.contentWindow,data:{type:'axis-return'}});assert.equal(window.weatherAxisymmetricActive,false);
});
test('worker pauses while hidden, resumes, saves, and rejects bad imports',async()=>{
  const messages=[],timers=new Map();let tid=0;
  const context={Solver:AxisymmetricSolver,performance,postMessage:m=>messages.push(m),onmessage:null,
    setTimeout:f=>{timers.set(++tid,f);return tid;},clearTimeout:id=>timers.delete(id)};
  const code=(await readFile(new URL('worker.mjs',import.meta.url),'utf8')).replace("import { AxisymmetricSolver } from './solver.mjs';","const AxisymmetricSolver=Solver;");
  vm.runInNewContext(code,context);
  const send=data=>context.onmessage({data});
  send({type:'init'});assert.equal(messages.at(-1).type,'frame');assert.equal(timers.size,1);
  send({type:'visible',active:false});assert.equal(timers.size,0);
  send({type:'save',purpose:'checkpoint'});const checkpoint=messages.at(-1).snapshot;assert.equal(checkpoint.time,0);
  send({type:'visible',active:true});assert.equal(timers.size,1);
  send({type:'run',running:false});assert.equal(timers.size,0);
  send({type:'step'});assert.ok(messages.at(-1).stats.time>0);
  send({type:'load',snapshot:checkpoint});assert.equal(messages.at(-1).type,'loaded');assert.equal(timers.size,0);
  send({type:'load',snapshot:{bad:true}});assert.equal(messages.at(-1).type,'error');
  send({type:'save',purpose:'checkpoint'});assert.equal(messages.at(-1).snapshot.time,0);
});
