/*
  Offline shader syntax check
  ==========================

  The shaders are compiled by the browser at runtime, so a mistake in a shader only shows up when the
  page is opened. This script expands the #include lines exactly like loadShader() in app.js does and
  then parses the result, which catches the two mistakes that are easy to make while editing shaders:

    - a syntax error
    - a function of common.glsl that is used above the '#include "common.glsl"' line. The include is
      expanded in place, so in GLSL (which has no forward declarations) that function is not known
      yet at that point, and the shader fails to compile.

  It needs a GLSL parser, which is not part of this project:

    npm install @shaderfrog/glsl-parser
    node tools/shaderCheck.js

  Without the parser installed the script does nothing and exits with code 0.
*/

'use strict';

const fs = require('fs');
const path = require('path');

let parser;
try {
  parser = require('@shaderfrog/glsl-parser').parser;
} catch (e) {
  console.log('the GLSL parser is not installed (npm install @shaderfrog/glsl-parser), skipping the syntax check');
  process.exit(0);
}

const REPO = path.join(__dirname, '..');
const SHADER_DIRS = [ 'shaders/fragment', 'shaders/vertex' ];
const COMMON = path.join(REPO, 'shaders/common.glsl');
const TYPE_WORDS = 'float|vec2|vec3|vec4|int|uint|bool|void|ivec2|uvec2|mat2|mat3';

function declaredFunctions(source)
{
  return [ ...source.matchAll(new RegExp(`^(?:${TYPE_WORDS})\\s+(\\w+)\\s*\\(`, 'gm')) ].map((m) => m[1]);
}

// loadShader() replaces the include line with the contents of the file, so this has to do the same
function expandIncludes(file, source)
{
  return source.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (match, name) => {
    // app.js loads the include with its own path (shaders/common.glsl), not relative to the shader
    const candidates = [ path.join(path.dirname(file), name), path.join(REPO, 'shaders', name) ];
    const included = candidates.find((c) => fs.existsSync(c));
    if (!included)
      throw new Error(`missing include "${name}" referenced by ${file}`);
    return fs.readFileSync(included, 'utf8');
  });
}

const commonSource = fs.readFileSync(COMMON, 'utf8');
const commonFunctions = declaredFunctions(commonSource);
const commonDefines = [ ...commonSource.matchAll(/^#define\s+(\w+)/gm) ].map((m) => m[1]);

// the defines of common.glsl are used all over the place, so only the function names are a reliable signal
function needsCommon(source)
{
  const own = new Set(declaredFunctions(source));
  return commonFunctions.some((fn) => !own.has(fn) && new RegExp(`[^\\w.]${fn}\\s*\\(`).test(source));
}
let failures = 0;
let checked = 0;

for (const dir of SHADER_DIRS) {
  const folder = path.join(REPO, dir);
  if (!fs.existsSync(folder))
    continue;

  for (const name of fs.readdirSync(folder).sort()) {
    if (!/\.(frag|vert)$/.test(name))
      continue;
    const file = path.join(folder, name);
    const original = fs.readFileSync(file, 'utf8');
    const expanded = expandIncludes(file, original);
    checked++;

    const problems = [];

    try {
      parser.parse(expanded, { quiet: true });
    } catch (err) {
      let message = String(err && err.message ? err.message : err).split('\n')[0];
      const offset = Number((message.match(/position (\d+)/) || [])[1]);
      if (Number.isFinite(offset))
        message += ` (line ${expanded.slice(0, offset).split('\n').length} of the expanded source)`;
      problems.push(`syntax error: ${message}`);
    }

    // everything above the include line can not see common.glsl yet, and a file that does not
    // include it at all can not use any of it
    const includeLine = original.indexOf('#include "common.glsl"');
    if (includeLine >= 0 || needsCommon(original)) {
      if (includeLine < 0) {
        problems.push('uses functions of common.glsl without including it');
      }
    }
    if (includeLine > 0) {
      const head = original.slice(0, includeLine);
      const ownFunctions = declaredFunctions(original);
      for (const fn of commonFunctions) {
        if (ownFunctions.includes(fn))
          continue; // the shader has its own function with that name
        const call = head.match(new RegExp(`[^\\w.](${fn})\\s*\\(`));
        if (call) {
          problems.push(`calls ${fn}() on line ${head.slice(0, call.index).split('\n').length}, above the '#include "common.glsl"' line`);
          break;
        }
      }
    }

    if (problems.length)
      failures++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${dir}/${name}${problems.length ? '  ' + problems.join('; ') : ''}`);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} of ${checked} shaders did not check out`);
  process.exit(1);
}
console.log(`all ${checked} shaders parsed cleanly`);

