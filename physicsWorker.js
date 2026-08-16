// physicsWorker.js — Parallel physics slice worker for 2D Weather Sandbox
// Uses SharedArrayBuffer & Atomics barrier synchronization

let workerId = -1;
let numWorkers = 4;
let sim_res_x = 503;
let sim_res_y = 503;
let startY = 0;
let endY = 0;

let sharedBuffer = null;
let controlBuffer = null; // Int32Array view for Atomics barrier & signals
let baseTexData = null;    // Float32Array view (4 * sim_res_x * sim_res_y)
let waterTexData = null;   // Float32Array view (4 * sim_res_x * sim_res_y)
let vortForceData = null;  // Float32Array view (4 * sim_res_x * sim_res_y)

// Control Indices in controlBuffer
const CTRL_FRAME_ITER = 0;  // Current physics iteration counter from main thread
const CTRL_RUNNING    = 1;  // 1 = active, 0 = stopped
const BARRIER_ARRIVE  = 2;  // Barrier arrival counter
const BARRIER_SENSE   = 3;  // Barrier generation sense bit

function barrierWait() {
  const currentSense = Atomics.load(controlBuffer, BARRIER_SENSE);
  const targetSense = 1 - currentSense;

  const arrived = Atomics.add(controlBuffer, BARRIER_ARRIVE, 1) + 1;

  if (arrived === numWorkers + 1) { // +1 includes Main Thread sync if participating
    Atomics.store(controlBuffer, BARRIER_ARRIVE, 0);
    Atomics.store(controlBuffer, BARRIER_SENSE, targetSense);
    Atomics.notify(controlBuffer, BARRIER_SENSE, numWorkers + 1);
  } else {
    while (Atomics.load(controlBuffer, BARRIER_SENSE) !== targetSense) {
      Atomics.wait(controlBuffer, BARRIER_SENSE, currentSense);
    }
  }
}

// Slice Physics Functions (Parallel computation per horizontal slice)
function computeVelocitySlice(dt) {
  // Process horizontal slice rows from startY to endY - 1
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < sim_res_x; x++) {
      const idx = 4 * (y * sim_res_x + x);
      // Temperature / Buoyancy force update
      const temp = baseTexData[idx + 0];
      const moisture = waterTexData[idx + 0];
      // Apply vertical buoyancy acceleration to v_vel
      const buoyancy = (temp * 0.05 + moisture * 0.02);
      baseTexData[idx + 3] += buoyancy * dt;
    }
  }
}

function computeAdvectionSlice(dt) {
  // Advect base components across assigned slice
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < sim_res_x; x++) {
      const idx = 4 * (y * sim_res_x + x);
      const u = baseTexData[idx + 2];
      const v = baseTexData[idx + 3];

      // Backtrack position
      let srcX = Math.round(x - u * dt);
      let srcY = Math.round(y - v * dt);

      // Clamp boundary conditions with ghost cell halo access
      srcX = Math.max(0, Math.min(sim_res_x - 1, srcX));
      srcY = Math.max(0, Math.min(sim_res_y - 1, srcY));

      const srcIdx = 4 * (srcY * sim_res_x + srcX);
      // Smooth update
      baseTexData[idx + 0] = baseTexData[srcIdx + 0];
      baseTexData[idx + 1] = baseTexData[srcIdx + 1];
    }
  }
}

function computePressureSlice() {
  // Pressure Poisson Jacobi iteration step over horizontal slice
  for (let y = startY; y < endY; y++) {
    const yTop = Math.min(sim_res_y - 1, y + 1);
    const yBot = Math.max(0, y - 1);

    for (let x = 0; x < sim_res_x; x++) {
      const xRight = Math.min(sim_res_x - 1, x + 1);
      const xLeft  = Math.max(0, x - 1);

      const idx = 4 * (y * sim_res_x + x);
      const pL = baseTexData[4 * (y * sim_res_x + xLeft) + 1];
      const pR = baseTexData[4 * (y * sim_res_x + xRight) + 1];
      const pB = baseTexData[4 * (yBot * sim_res_x + x) + 1];
      const pT = baseTexData[4 * (yTop * sim_res_x + x) + 1];

      const div = 0.5 * (baseTexData[4 * (y * sim_res_x + xRight) + 2] - baseTexData[4 * (y * sim_res_x + xLeft) + 2] +
                         baseTexData[4 * (yTop * sim_res_x + x) + 3] - baseTexData[4 * (yBot * sim_res_x + x) + 3]);

      // Jacobi relaxation update
      baseTexData[idx + 1] = (pL + pR + pB + pT - div) * 0.25;
    }
  }
}

// Worker message handling
self.onmessage = function(e) {
  const data = e.data;
  if (data.type === 'INIT') {
    workerId = data.id;
    numWorkers = data.numWorkers;
    sim_res_x = data.sim_res_x;
    sim_res_y = data.sim_res_y;
    startY = data.startY;
    endY = data.endY;

    sharedBuffer = data.sharedBuffer;
    controlBuffer = new Int32Array(sharedBuffer, 0, 16);

    const baseOffset = 64; // header byte offset
    const elementsPerGrid = sim_res_x * sim_res_y * 4;
    const bytesPerGrid = elementsPerGrid * 4;

    baseTexData  = new Float32Array(sharedBuffer, baseOffset, elementsPerGrid);
    waterTexData = new Float32Array(sharedBuffer, baseOffset + bytesPerGrid, elementsPerGrid);
    vortForceData= new Float32Array(sharedBuffer, baseOffset + bytesPerGrid * 2, elementsPerGrid);

    // Signal ready
    self.postMessage({ type: 'READY', id: workerId });
  } else if (data.type === 'STEP') {
    const dt = data.dt || 0.016;

    // Run physics slice steps with barrier sync between phases
    computeVelocitySlice(dt);
    barrierWait();

    computeAdvectionSlice(dt);
    barrierWait();

    computePressureSlice();
    barrierWait();

    self.postMessage({ type: 'STEP_COMPLETE', id: workerId });
  }
};
