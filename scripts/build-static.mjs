// SPDX-License-Identifier: GPL-3.0-or-later
// Deterministic static packaging; the original source layout remains usable.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'dist');
await mkdir(out,{recursive:true});
for(const name of ['app.js','terrainImport.js','lightningGenerator.js','favicon.ico','mode-switch.js','mode-switch.css','resources','libraries','shaders','LICENSE'])await cp(resolve(root,name),resolve(out,name),{recursive:true});
await mkdir(resolve(out,'axisymmetric'),{recursive:true});
for(const name of ['index.html','style.css','app.mjs','worker.mjs','solver.mjs','README.md'])await cp(resolve(root,'axisymmetric',name),resolve(out,'axisymmetric',name));
const html=await readFile(resolve(root,'index.html'),'utf8');
const source='https://raw.githubusercontent.com/RononPros/2D-Weather-Sandbox/3c090a781a0f468c624ee7f16a80bd95c6b1691f/saves/';
await writeFile(resolve(out,'index.html'),html.replace(/href="\.\/saves\/([^"]+)"/g,(_match,name)=>`href="${source}${encodeURIComponent(name)}"`));
console.log('Prepared original 2D and axisymmetric entrypoints in dist.');
