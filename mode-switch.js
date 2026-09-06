// SPDX-License-Identifier: GPL-3.0-or-later
// A lazy, same-origin chamber preserves the original WebGL simulation in memory.
const switcher = document.createElement('div');
switcher.id = 'weather-mode-switch';
switcher.setAttribute('role', 'group');
switcher.setAttribute('aria-label', 'Simulation mode');
const normal = document.createElement('button');
normal.textContent = 'Normal 2D';
normal.type = 'button';
const axis = document.createElement('button');
axis.textContent = 'Axisymmetric 2.5D';
axis.type = 'button';
switcher.append(normal, axis);
document.body.append(switcher);
let frame;
const origin = location.origin;
function notify() {
  frame?.contentWindow?.postMessage({ type: 'axis-visibility', active: !!window.weatherAxisymmetricActive }, origin);
}
function selectMode(active) {
  // Release held keys/mouse before the original simulation loses focus.
  if (active && !window.weatherAxisymmetricActive) {
    for (const code of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','ControlLeft','ControlRight','KeyB','KeyZ','Equal','Minus']) {
      document.dispatchEvent(new KeyboardEvent('keyup', {code, key: code}));
    }
    window.dispatchEvent(new MouseEvent('mouseup'));
  }
  window.weatherAxisymmetricActive = active;
  normal.setAttribute('aria-pressed', String(!active));
  axis.setAttribute('aria-pressed', String(active));
  if (active && !frame) {
    frame = document.createElement('iframe');
    frame.id = 'weather-axisymmetric-frame';
    frame.title = 'Axisymmetric atmosphere and vortex chamber';
    frame.src = 'axisymmetric/index.html';
    frame.addEventListener('load', notify);
    document.body.append(frame);
  }
  if (frame) frame.hidden = !active;
  notify();
  if (active) frame?.focus();
}
normal.addEventListener('click', () => selectMode(false));
axis.addEventListener('click', () => selectMode(true));
document.getElementById('open-axisymmetric')?.addEventListener('click', () => selectMode(true));
window.addEventListener('message', event => {
  if (event.origin !== origin || event.source !== frame?.contentWindow) return;
  if (event.data?.type === 'axis-ready') notify();
  if (event.data?.type === 'axis-return') { selectMode(false); normal.focus(); }
});
selectMode(false);
