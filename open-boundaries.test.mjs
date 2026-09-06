// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('open flow is an opt-in H-menu control with save compatibility', async() => {
  const app = await read('app.js');

  assert.match(app, /openBoundaries\s*:\s*false/);
  assert.match(app, /advanced_folder\.add\(guiControls, 'openBoundaries'\)/);
  assert.match(app, /\.name\('Open Flow-through Boundaries'\)/);
  assert.match(app, /typeof guiControls\.openBoundaries !== 'boolean'/);
  assert.match(app, /guiControls\.wrapHorizontally = !guiControls\.openBoundaries/);
});

test('all solver-facing horizontal textures switch between clamp and repeat', async() => {
  const app = await read('app.js');
  const requiredTextures = [
    'baseTexture_0', 'baseTexture_1', 'waterTexture_0', 'waterTexture_1',
    'wallTexture_0', 'wallTexture_1', 'curlTexture', 'vortForceTexture',
    'lightTexture_0', 'lightTexture_1', 'precipitationFeedbackTexture',
    'precipitationDepositionTexture',
  ];

  const start = app.indexOf('function setHorizontalBoundaryTextureMode()');
  const end = app.indexOf('frameBuff_0 = gl.createFramebuffer()', start);
  const modeFunction = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(modeFunction, /guiControls\.openBoundaries \? gl\.CLAMP_TO_EDGE : gl\.REPEAT/);
  for (const texture of requiredTextures)
    assert.match(modeFunction, new RegExp(`\\b${texture}\\b`));
  assert.match(modeFunction, /\.\.\.ambientLightFBOs\.map\(fbo => fbo\.texture\)/);
  assert.match(app, /setHorizontalBoundaryTextureMode\(\)/);
});

test('the shader classifies inflow independently by side', async() => {
  const shader = await read('shaders/fragment/advectionShader.frag');

  assert.match(shader, /float outwardVelocity = leftEdge \? -base\[VX\] : base\[VX\]/);
  assert.match(shader, /float inflow = 1\.0 - step\(0\.0, outwardVelocity\)/);
  assert.match(shader, /float washoutRate = inflow \* mix\(0\.08, 0\.24, inflowSpeed\) \* edgeWeight2/);
});

test('open inflow preserves balanced thermodynamics and momentum', async() => {
  const shader = await read('shaders/fragment/advectionShader.frag');
  const start = shader.indexOf('void applyOpenBoundaryTracerWashout()');
  const end = shader.indexOf('\nvoid main()', start);
  const boundaryFunction = shader.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(boundaryFunction, /base\[(?:TEMPERATURE|PRESSURE|VX|VY)\]\s*=/);
  assert.doesNotMatch(boundaryFunction, /water\[TOTAL\]\s*=\s*mix/);
  assert.doesNotMatch(shader, /useRealSoundingAtOpenBoundaries|getBoundarySounding/);
});

test('cloud washout removes matching total water to avoid latent heating', async() => {
  const shader = await read('shaders/fragment/advectionShader.frag');

  assert.match(shader, /float removedCloud = water\[CLOUD\] \* washoutRate/);
  assert.match(shader, /water\[CLOUD\] -= removedCloud/);
  assert.match(shader, /water\[TOTAL\] = max\(water\[TOTAL\] - removedCloud, 0\.0\)/);
});

test('open-edge precipitation exits while periodic precipitation still wraps', async() => {
  const shader = await read('shaders/vertex/precipitationShader.vert');

  assert.match(shader, /uniform bool openBoundaries/);
  assert.match(shader, /openBoundaries && \(newPos\.x < -1\.0 \|\| newPos\.x > 1\.0\)/);
  assert.match(shader, /disableDroplet\(\)/);
  assert.match(shader, /if \(!openBoundaries\)\s+newPos\.x = mod\(newPos\.x \+ 1\., 2\.\) - 1\./);
});

test('the side-normal convention has the intended four flow cases', () => {
  const isInflow = (side, velocityX) => (side === 'left' ? -velocityX : velocityX) < 0;

  assert.equal(isInflow('left', 0.2), true);
  assert.equal(isInflow('left', -0.2), false);
  assert.equal(isInflow('right', -0.2), true);
  assert.equal(isInflow('right', 0.2), false);
});
