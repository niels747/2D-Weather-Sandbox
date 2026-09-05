/*
  Vapor explosion regression test
  ===============================

  A headless replica of the parts of the simulation that can make the water vapor explode, so the
  fixes can be checked without a GPU. It is a hand port of the water / latent heat / longwave loop
  of these files:

    shaders/common.glsl                          maxWater, dewpoint, relativeHumd, IR_emitted
    shaders/fragment/lightingShader.frag         net longwave heating of the air near a surface
    shaders/fragment/boundaryShader.frag         land and lake evaporation, precipitation feedback
    shaders/fragment/advectionShader.frag        condensation, latent heat, wall handling

  Two variants are simulated: "before" is the shader code as it was before the fixes on this
  branch, "after" is the code as it is now. Every scenario has to keep the "after" variant inside
  the physical range; the "before" variant is shown for comparison and is expected to blow up.

  The second half of the test checks the shader sources directly, because the limits live there:
  if one of them is removed, the numbers of this model become meaningless.

  Run:  node tools/vaporExplosionTest.js         (exit code 0 when everything passes)
        node tools/vaporExplosionTest.js -v      (print the evolution of every scenario)
*/

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');

let failures = 0;
function check(ok, message)
{
  if (!ok)
    failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
}
function fmt(v)
{
  if (!Number.isFinite(v))
    return 'NaN';
  if (Math.abs(v) >= 1e5)
    return v.toExponential(2);
  return v.toFixed(3);
}

const CtoK = (c) => c + 273.15;

// ─────────────────────────── constants shared with the shaders ───────────────────────────

const lightHeatingConst = 0.000002; // degrees kelvin per watt per meter squared
const waterHeatExchangeRate = 0.0002;
const IR_constant = 5.670374419;
const W_F_DEVIDER = 250.0;
const W_F_POW = 17.0;
const maxWaterTemp = 40.0;

// channels of base[] (index 2 is pressure, which is not simulated here)
const TEMPERATURE = 3;
// channels of water[]
const TOTAL = 0, CLOUD = 1, PRECIP = 2, SMOKE = 3;
// channels of wall[]
const TYPE = 0, DISTANCE = 1, VERT = 2, VEG = 3;

const WALLTYPE_AIR = 0, WALLTYPE_LAND = 1, WALLTYPE_WATER = 2, WALLTYPE_FIRE = 3;

const phys = { minTemp: 173.15, maxTemp: 333.15, waterCap: 200.0, fluxCapFrac: 0.02, maxDT: 0.5 };

// GLSL pow(x, y) is undefined for x < 0, and returns NaN on the GPUs this project targets
function glslPow(x, y)
{
  if (Number.isNaN(x) || x < 0.0)
    return NaN;
  return Math.pow(x, y);
}

const IR_emitted = (T) => glslPow(T * 0.01, 4.0) * IR_constant;

const safeClamp = (v, lo, hi) => (!(v >= lo) ? lo : (v > hi ? hi : v)); // NaN aware

// ─────────────────────────── common.glsl, before and after ───────────────────────────

const common = {
  before: {
    safeClamp: (v, lo, hi) => Math.min(Math.max(v, lo), hi), // Math.min/max propagate NaN
    maxWater: (T) => glslPow(T / W_F_DEVIDER, W_F_POW),
    // the unfixed version divides by the saturation amount at 1000 Kelvin, a constant of 1.7e10
    dewpoint: (W) => Math.log(Math.max(W, 1e-20) / glslPow(1000.0 / W_F_DEVIDER, W_F_POW)) * W_F_POW / (W_F_POW - 1.0) * 10000.0,
    relativeHumd: (T, W) => W / glslPow(T / W_F_DEVIDER, W_F_POW),
    cleanWater: (W) => W,
    capFlux: (f) => f,
    capDT: (d) => d,
  },
  after: {
    safeClamp: safeClamp,
    maxWater: (T) => Math.min(glslPow(safeClamp(T, phys.minTemp, phys.maxTemp) / W_F_DEVIDER, W_F_POW), phys.waterCap),
    dewpoint: (W) => {
      const maxW = common.after.maxWater(CtoK(maxWaterTemp));
      if (!(W > maxW))
        return CtoK(maxWaterTemp);
      return Math.log(W / maxW) * W_F_POW / (W_F_POW - 1.0) * 10000.0 + CtoK(maxWaterTemp);
    },
    relativeHumd: (T, W) => safeClamp(W, 0.0, phys.waterCap) / Math.max(common.after.maxWater(T), 0.0001),
    cleanWater: (W) => safeClamp(W, 0.0, phys.waterCap),
    capFlux: (flux, maxW) => {
      if (Number.isNaN(flux))
        return 0.0;
      const cap = maxW * phys.fluxCapFrac;
      return Math.min(Math.max(flux, -cap), cap);
    },
    capDT: (dT) => (Number.isNaN(dT) ? 0.0 : Math.min(Math.max(dT, -phys.maxDT), phys.maxDT)),
  },
};

// ─────────────────────────── unit checks of the ported formulas ───────────────────────────

console.log('=== the formulas that produced the runaway ===\n');

check(common.before.maxWater(1000.0) > 1e9,
  `before: maxWater() of a cell holding the 1000.0 melt indicator = ${fmt(common.before.maxWater(1000.0))} g/m³ of vapor`);
check(common.before.maxWater(CtoK(120.0)) > 1e3,
  `before: a cell painted with 120 °C asks for ${fmt(common.before.maxWater(CtoK(120.0)))} g/m³ of vapor`);
check(common.before.maxWater(-5.0) === undefined || Number.isNaN(common.before.maxWater(-5.0)),
  `before: a cell that was radiated below 0 Kelvin returns ${fmt(common.before.maxWater(-5.0))} instead of a number`);
check(common.after.maxWater(1000.0) === common.after.maxWater(phys.maxTemp) && common.after.maxWater(1000.0) <= phys.waterCap,
  `after:  the same cells ask for at most ${fmt(common.after.maxWater(phys.maxTemp))} g/m³, saturation at ${phys.maxTemp} K`);
check(Number.isFinite(common.after.maxWater(NaN)) && Number.isFinite(common.after.maxWater(-1e6)),
  `after:  maxWater() of NaN or of a frozen cell returns ${fmt(common.after.maxWater(NaN))} instead of NaN`);
check(Number.isNaN(common.before.relativeHumd(-5.0, 0.0)),
  `before: relative humidity of a cell that was radiated below 0 K = ${fmt(common.before.relativeHumd(-5.0, 0.0))}`);
check(common.after.relativeHumd(-5.0, 0.0) === 0.0,
  'after:  the same cell reports 0 % humidity, so droplets evaporate away instead of growing');
check(Number.isNaN(common.before.safeClamp(NaN, 0.0, 1.0)),
  'before: clamp(NaN) stays NaN and spreads through the whole simulation');
check(common.after.safeClamp(NaN, phys.minTemp, phys.maxTemp) === phys.minTemp,
  'after:  clamp(NaN) returns the limit, which repairs the cell');
check(IR_emitted(1000.0) > 5e4 && IR_emitted(phys.maxTemp) < 1000.0,
  `a land wall radiated ${fmt(IR_emitted(1000.0))} W/m² instead of at most ${fmt(IR_emitted(phys.maxTemp))} W/m²`);
check(common.after.capFlux(1e10, 100.0) === 2.0 && common.after.capDT(-1e9) === -phys.maxDT,
  'after:  per iteration fluxes and latent heat steps are capped');
check(common.before.dewpoint(0.0) < -4e5,
  `before: the dew point of unsaturated air was computed as ${fmt(common.before.dewpoint(0.0))} K, which the graphs plotted off scale`);
check(common.after.dewpoint(0.0) === CtoK(maxWaterTemp),
  'after:  the same cell returns the temperature at which air becomes saturated');

// ─────────────────────────── the model ───────────────────────────

function makeModel(variant, cfg)
{
  const cm = common[variant];
  const after = variant === 'after';
  const {nx, ny, ground, waterBody} = cfg;
  const idx = (x, y) => x + y * nx;
  const potentialToReal = (p, y) => p - (y / (ny - 1)) * cfg.lapseTotal;

  const base = [], water = [], wall = [];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = idx(x, y);
      const isGround = y <= ground;
      const isWater = isGround && x >= waterBody;
      wall[i] = [ isGround ? (isWater ? WALLTYPE_WATER : WALLTYPE_LAND) : WALLTYPE_AIR, isGround ? 0 : 255, isGround ? 0 : y - ground, cfg.vegetation ];
      const realT = CtoK(cfg.startTemp - (y / ny) * cfg.lapseTotal);
      base[i] = [ 0, 0, 0, isGround ? (cfg.corruptWaterTemp ? 1000.0 : CtoK(cfg.waterTemp)) : realT + (y / ny) * cfg.lapseTotal ];
      if (isGround && cfg.corruptWaterTemp)
        base[i][TEMPERATURE] = 1000.0; // an old save file, where the lake cells had no stored temperature
      const vapor = isGround ? (isWater ? 1002.0 : 1001.0) : cm.maxWater(realT - (y < ny * 0.2 ? 2.0 : 20.0)) * (after ? 1.0 : 0.5);
      let cloud = Math.max(vapor - cm.maxWater(realT), 0.0);
      if (!isGround && cfg.initialCloud > 0.0 && y <= ground + 2)
        cloud = cfg.initialCloud;
      water[i] = [ vapor + cloud, cloud, 0, 0 ];
      if (isGround && !isWater)
        water[i][PRECIP] = cfg.soilMoisture; // moisture stored in the soil
    }
  }

  // the light texture of the lighting shader survives between iterations
  const IRdown = new Float64Array(nx * ny);
  const IRup = new Float64Array(nx * ny);
  const netHeat = new Float64Array(nx * ny);

  // what the temperature tool paints on a single cell
  if (cfg.paintTemp !== undefined)
    base[idx(cfg.paintCol, cfg.paintRow)][TEMPERATURE] = cfg.paintTemp;

  function surfaceEmission(x, yWall)
  {
    const below = idx(x, yWall);
    if (!after)
      return IR_emitted(base[below][TEMPERATURE] + (wall[below][TYPE] === WALLTYPE_FIRE ? 100.0 : 0.0));

    let T;
    if (wall[below][TYPE] === WALLTYPE_WATER) {
      let wt = base[below][TEMPERATURE];
      if (!(wt > 100.0) || wt > 500.0)
        wt = CtoK(cfg.waterTemp);
      T = safeClamp(wt, phys.minTemp, phys.maxTemp);
    } else {
      const airY = Math.min(yWall + 1, ny - 1);
      T = safeClamp(potentialToReal(base[idx(x, airY)][TEMPERATURE], airY), phys.minTemp, phys.maxTemp);
      if (wall[below][TYPE] === WALLTYPE_FIRE)
        T = safeClamp(T + 100.0, phys.minTemp, phys.maxTemp);
    }
    return IR_emitted(T);
  }

  function step()
  {
    const IR_STEP = 8;

    // ── lighting shader ──
    const newDown = new Float64Array(nx * ny);
    const newUp = new Float64Array(nx * ny);
    const newNet = new Float64Array(nx * ny);
    for (let y = ground + 1; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y);
        const realTemp = potentialToReal(base[i][TEMPERATURE], y);
        const eAir = Math.min((cfg.greenhouse + water[i][TOTAL] * cfg.ghWater + Math.max(water[i][CLOUD], 0.0) * 5.0) * (300.0 / ny), 1.0);

        const yUp = Math.min(y + IR_STEP, ny - 1);
        const yUpMid = Math.min(y + IR_STEP / 2, ny - 1);
        const yDn = Math.max(y - IR_STEP, 0);
        const yDnMid = Math.max(y - IR_STEP / 2, 0);

        let IR_down;
        if (y >= ny - 1)
          IR_down = 0.0; // top of the atmosphere, only sunlight comes in
        else if (wall[idx(x, yUp)][DISTANCE] === 0)
          IR_down = surfaceEmission(x, yUp);
        else {
          const tau = 1.0 - Math.pow(Math.max(1.0 - eAir, 0.0), IR_STEP);
          IR_down = (1.0 - tau) * IRdown[idx(x, yUp)] + tau * IR_emitted(safeClamp(potentialToReal(base[idx(x, yUpMid)][TEMPERATURE], yUpMid), phys.minTemp, phys.maxTemp));
        }

        let IR_up;
        if (wall[idx(x, yDn)][DISTANCE] === 0) {
          const cells = Math.min(Math.max(wall[i][VERT] - 1, 0), IR_STEP);
          const tau = 1.0 - Math.pow(Math.max(1.0 - eAir, 0.0), cells);
          IR_up = (1.0 - tau) * surfaceEmission(x, yDn) + tau * IR_emitted(safeClamp(realTemp, phys.minTemp, phys.maxTemp));
        } else {
          const tau = 1.0 - Math.pow(Math.max(1.0 - eAir, 0.0), IR_STEP);
          IR_up = (1.0 - tau) * IRup[idx(x, yDn)] + tau * IR_emitted(safeClamp(potentialToReal(base[idx(x, yDnMid)][TEMPERATURE], yDnMid), phys.minTemp, phys.maxTemp));
        }

        let net;
        if (wall[i][VERT] === 1)
          net = (IR_down - IR_up) * lightHeatingConst;
        else if (wall[idx(x, Math.min(y + 1, ny - 1))][DISTANCE] === 0)
          net = (IR_up - IR_down) * lightHeatingConst;
        else
          net = ((IR_down + IR_up) * Math.min(eAir, 1.0) - IR_emitted(safeClamp(realTemp, phys.minTemp, phys.maxTemp)) * 2.0) * Math.min(eAir, 1.0) * lightHeatingConst;

        // the sunlight absorbed by the surface, which the boundary shader gives to the air above it
        if (wall[i][VERT] === 1)
          net += Math.max(cfg.sun, 0.0) * 0.7 * lightHeatingConst;

        newDown[i] = IR_down;
        newUp[i] = IR_up;
        newNet[i] = after ? common.after.capDT(net) : net;
      }
    }
    for (let i = 0; i < nx * ny; i++) {
      IRdown[i] = newDown[i];
      IRup[i] = newUp[i];
      netHeat[i] = newNet[i];
    }

    // ── boundary shader ──
    for (let y = ground + 1; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y);
        const cell = base[i], w = water[i];
        cell[TEMPERATURE] += netHeat[i];
        let realTemp = potentialToReal(cell[TEMPERATURE], y);

        if (wall[i][VERT] !== 1)
          continue; // wallVerticalInfluence

        const below = idx(x, y - 1);
        const soil = water[below];

        if (wall[below][TYPE] === WALLTYPE_WATER) {
          let localWaterTemp = base[below][TEMPERATURE];
          if (after) {
            if (!(localWaterTemp > 100.0) || localWaterTemp > 500.0)
              localWaterTemp = CtoK(cfg.waterTemp);
            localWaterTemp = Math.min(Math.max(localWaterTemp, CtoK(-5.0)), CtoK(maxWaterTemp));
          }
          cell[TEMPERATURE] += (localWaterTemp - realTemp - 1.0) * waterHeatExchangeRate;
          let evap = Math.max((cm.maxWater(localWaterTemp) - (after ? cm.cleanWater(w[TOTAL]) : w[TOTAL])) * cfg.waterEvap / 100.0, 0.0);
          if (after)
            evap = Math.min(evap, cm.maxWater(localWaterTemp) * phys.fluxCapFrac);
          w[TOTAL] = after ? cm.cleanWater(w[TOTAL] + evap) : w[TOTAL] + evap;
        } else if (wall[below][TYPE] === WALLTYPE_LAND || wall[below][TYPE] === WALLTYPE_FIRE) {
          const maxW = cm.maxWater(realTemp);
          const veg = wall[below][VEG] / 127.0 + 0.1;
          const moist = after ? Math.min(Math.max(soil[PRECIP] / 50.0 + 0.1, 0.0), 1.1) : soil[PRECIP] / 50.0 + 0.1;
          let evap;
          if (after) {
            evap = Math.max(maxW - cm.cleanWater(w[TOTAL]), 0.0) * cfg.landEvap * veg * moist / 100.0;
            evap = Math.min(evap, maxW * phys.fluxCapFrac);
            if (!(evap > 0.0))
              evap = 0.0;
            evap = Math.min(evap, Math.max(soil[PRECIP] * 0.1, 0.0));
            soil[PRECIP] = safeClamp(soil[PRECIP] - evap * 0.1, 0.0, 1000.0);
          } else {
            evap = maxW * (Math.max(maxW - w[TOTAL], 0.0) / maxW) * cfg.landEvap * veg * moist / 100.0;
            soil[PRECIP] -= Math.max(maxW * cfg.landEvap, 0.0); // the advection shader drained the soil a second time and destroyed the vapor
            evap += maxW * cfg.landEvap; // vapor injected into the air cell above the ground
          }
          w[TOTAL] = w[TOTAL] + evap;
          cell[TEMPERATURE] -= after ? common.after.capDT(evap * cfg.evapHeat * 0.5) : evap * cfg.evapHeat * 0.5;
        }
      }
    }

    // ── feedback of the precipitation shader, with the overdraw the unfixed growth loop produced ──
    if (cfg.precipOverdraw) {
      for (let y = ground + 1; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = idx(x, y);
          const w = water[i];
          const cloud = w[CLOUD];
          if (!(cloud > 1.0))
            continue;
          const wanted = cloud * 1.3 + 5.0;
          const take = after ? Math.min(Math.max(wanted, 0.0), Math.max(cloud, 0.0)) : wanted;
          if (after)
            w[CLOUD] = Math.max(cloud - take, 0.0);
          else
            w[CLOUD] = cloud - take;
          w[TOTAL] = after ? Math.max(w[TOTAL] - take, 0.0) : w[TOTAL] - take;
        }
      }
    }

    // the water vapor tool of the user interface
    if (cfg.paintVapor) {
      const i = idx(cfg.paintCol, cfg.paintRow);
      water[i][TOTAL] += cfg.paintVapor;
      if (water[i][CLOUD] > 0)
        water[i][CLOUD] += cfg.paintVapor;
    }

    // ── advection shader ──
    for (let y = ground + 1; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y);
        const cell = base[i], w = water[i];

        if (after) {
          w[TOTAL] = cm.cleanWater(w[TOTAL]);
          w[CLOUD] = cm.cleanWater(w[CLOUD]);
          if (w[CLOUD] > w[TOTAL])
            w[CLOUD] = w[TOTAL];
        } else {
          w[TOTAL] = Math.max(w[TOTAL], 0.0);
        }

        let realTemp = potentialToReal(cell[TEMPERATURE], y);
        const maxW = cm.maxWater(realTemp);
        const overSaturation = (w[TOTAL] - maxW) - w[CLOUD];
        let cond = overSaturation < 0.0 ? overSaturation * 0.20 : overSaturation * cfg.condRate;
        cond = Math.max(cond, -w[CLOUD]);
        if (after)
          cond = common.after.capFlux(cond, cm.maxWater(realTemp));

        const dT = after ? common.after.capDT(cond * cfg.evapHeat) : cond * cfg.evapHeat;
        if (dT > 0.0)
          w[SMOKE] = Math.min(w[SMOKE] + dT, 10.0); // the heat that is released, not part of the stability test

        const preTotal = w[TOTAL], preCloud = w[CLOUD];
        cell[TEMPERATURE] += dT;
        if (!after)
          w[TOTAL] -= cond; // the double counting that removed vapor as well
        w[CLOUD] += cond;
        leak += w[TOTAL] - preTotal; // the total water of the cell must not change when vapor turns into cloud water
        condensation += Math.abs(cond);

        if (after) {
          w[TOTAL] = cm.cleanWater(w[TOTAL]);
          w[CLOUD] = cm.cleanWater(w[CLOUD]);
          if (w[CLOUD] > w[TOTAL])
            w[CLOUD] = w[TOTAL];
          const rowLapse = (y / (ny - 1)) * cfg.lapseTotal;
          cell[TEMPERATURE] = safeClamp(cell[TEMPERATURE] - rowLapse, phys.minTemp, phys.maxTemp) + rowLapse;
        }
      }
    }

    // ── transport: a cheap diffusion, standing in for the advection of neighbouring cells ──
    if (cfg.diffusion > 0.0) {
      const d = cfg.diffusion;
      const newBase = new Array(nx * ny), newWater = new Array(nx * ny);
      for (let y = ground + 1; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const i = idx(x, y);
          if (wall[i][DISTANCE] === 0)
            continue;
          let sumT = 0, sumW = 0, sumC = 0, n = 0;
          for (const [ox, oy] of [ [ 1, 0 ], [ -1, 0 ], [ 0, 1 ], [ 0, -1 ] ]) {
            const px = (x + ox + nx) % nx, py = y + oy;
            if (py <= ground || py >= ny)
              continue;
            const p = idx(px, py);
            if (wall[p][DISTANCE] === 0)
              continue;
            sumT += base[p][TEMPERATURE];
            sumW += water[p][TOTAL];
            sumC += water[p][CLOUD];
            n++;
          }
          if (n === 0)
            continue;
          newBase[i] = [ 0, 0, 0, cell_mix(base[i][TEMPERATURE], sumT / n, d) ];
          newWater[i] = [ cell_mix(water[i][TOTAL], sumW / n, d), cell_mix(water[i][CLOUD], sumC / n, d), water[i][PRECIP], water[i][SMOKE] ];
        }
      }
      function cell_mix(v, avg, mix) { return v * (1.0 - mix) + avg * mix; }
      for (let i = 0; i < nx * ny; i++) {
        if (newBase[i] !== undefined)
          base[i] = newBase[i];
        if (newWater[i] !== undefined)
          water[i] = newWater[i];
      }
    }
  }

  // water that the condensation / evaporation step of the advection shader creates or destroys
  // instead of moving from vapor to cloud water: the double counting of the phase change
  let leak = 0.0;
  let condensation = 0.0;

  function measure()
  {
    let maxVapor = 0, maxCloud = 0, minCloud = Infinity, minT = Infinity, maxT = -Infinity, nan = 0, broken = 0, minSoil = Infinity;
    for (let y = ground + 1; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = idx(x, y);
        const w = water[i];
        const T = potentialToReal(base[i][TEMPERATURE], y);
        if (!Number.isFinite(w[TOTAL]) || !Number.isFinite(w[CLOUD]) || !Number.isFinite(T)) {
          nan++;
          continue;
        }
        maxVapor = Math.max(maxVapor, w[TOTAL]);
        maxCloud = Math.max(maxCloud, w[CLOUD]);
        minCloud = Math.min(minCloud, w[CLOUD]);
        minT = Math.min(minT, T);
        maxT = Math.max(maxT, T);
        if (w[TOTAL] > phys.waterCap || w[CLOUD] > w[TOTAL] || T < phys.minTemp || T > phys.maxTemp + 20.0)
          broken++;
      }
    }
    for (let y = 0; y <= ground; y++)
      for (let x = 0; x < nx; x++)
        minSoil = Math.min(minSoil, water[idx(x, y)][PRECIP]);
    return { maxVapor, maxCloud, minCloud, minT, maxT, nan, broken, minSoil, leak, leakRatio: Math.abs(leak) / Math.max(condensation, 1e-9) };
  }

  return { step, measure };
}

// ─────────────────────────── scenarios ───────────────────────────

const baseCfg = {
  nx: 24,
  ny: 48,
  ground: 6,
  waterBody: 16, // everything at x >= 16 is a lake
  lapseTotal: 120.0,
  startTemp: 28.0,
  greenhouse: 0.001,
  ghWater: 0.0023,
  landEvap: 0.0005,
  waterEvap: 0.001,
  evapHeat: 2.9,
  condRate: 0.005,
  waterTemp: 25.0,
  sun: 1300.0,
  vegetation: 90.0,
  soilMoisture: 25.0,
  diffusion: 0.05,
};

const scenarios = [
  {
    name: 'one frozen air cell (the temperature tool set the air to 0 K)',
    cfg: { paintTemp: 0.0, paintRow: 12, paintCol: 5 },
    iters: 300,
    why: 'pow(negative, 17.) is NaN, and one NaN cell is enough to destroy the whole simulation',
  },
  {
    name: 'one cell painted with 120 °C by the temperature tool',
    cfg: { paintTemp: CtoK(120.0), paintRow: 12, paintCol: 5 },
    iters: 300,
    why: 'maxWater() grows with the 17th power of the temperature, so the air asked for impossible amounts of vapor',
  },
  {
    name: 'lake whose stored water temperature is the 1000.0 snow indicator',
    cfg: { corruptWaterTemp: true },
    iters: 300,
    why: 'lake evaporation used maxWater(1000.0), and the advection shader trusted that marker to be a temperature',
  },
  {
    name: 'rain that takes more cloud water than the cell has',
    cfg: { precipOverdraw: true, startTemp: 30.0, initialCloud: 40.0 },
    iters: 300,
    why: 'the growth of the droplets was not limited to the water in the cell, negative cloud water released a latent heat spike',
  },
  {
    name: 'water vapor tool on an already saturated cell',
    cfg: { paintVapor: 60.0, paintRow: 12, paintCol: 5 },
    iters: 300,
    why: 'nothing limited the total water of a cell, so the value grew for as long as the button was held down',
  },
  {
    name: 'dry soil, with the evaporation rate of the last commit',
    cfg: { soilMoisture: 0.0, landEvap: 0.0005 },
    iters: 300,
    why: 'unlimited evaporation ran the soil moisture counter negative, which inverted the evaporation factor',
  },
];

console.log('\n=== scenarios, simulated with both variants ===\n');

for (const scenario of scenarios) {
  const cfg = Object.assign({}, baseCfg, scenario.cfg);
  const results = {};

  for (const variant of [ 'before', 'after' ]) {
    const model = makeModel(variant, cfg);
    for (let i = 0; i < scenario.iters; i++) {
      model.step();
      if (verbose && i % 50 === 0) {
        const m = model.measure();
        console.log(`   ${variant.padEnd(6)} iter ${String(i).padStart(4)}  vapor ${fmt(m.maxVapor)}  cloud ${fmt(m.maxCloud)}  T ${fmt(m.minT)}..${fmt(m.maxT)}  NaN ${m.nan}  illegal ${m.broken}`);
      }
    }
    results[variant] = model.measure();
  }

  // every one of these is a vapor explosion or the start of one: a cell that leaves the physical
  // range, NaN, water that appears or disappears out of nothing, moisture below zero
  const exploded = (r) => r.nan > 0 || r.broken > 0 || !Number.isFinite(r.maxVapor) || r.minSoil < -0.001 ||
    r.minCloud < -0.001 || r.leakRatio > 0.05;
  const bad = exploded(results.before);
  const fixed = !exploded(results.after);

  console.log(`${fixed ? 'PASS' : 'FAIL'}  ${scenario.name}`);
  console.log(`      before: vapor ${fmt(results.before.maxVapor)}  T ${fmt(results.before.minT)}..${fmt(results.before.maxT)}  NaN cells ${results.before.nan}  cloud water destroyed ${fmt(Math.min(results.before.minCloud, 0))}  water destroyed by condensation ${fmt(results.before.leakRatio * 100)} %${exploded(results.before) ? '  ← exploded' : ''}`);
  console.log(`      after : vapor ${fmt(results.after.maxVapor)}  T ${fmt(results.after.minT)}..${fmt(results.after.maxT)}  NaN cells ${results.after.nan}  cloud water destroyed ${fmt(Math.min(results.after.minCloud, 0))}  water destroyed by condensation ${fmt(results.after.leakRatio * 100)} %`);
  console.log(`      cause : ${scenario.why}`);
  check(fixed, `after: ${scenario.name} stays inside the physical range`);
  if (!bad)
    console.log('      note  : the model does not reproduce the problem for this scenario');
  else
    check(exploded(results.before), `before: the same scenario blows up (regression covered)`);
}

// ─────────────────────────── source checks ───────────────────────────
// The limits live in the shaders; this keeps this test honest if a shader is edited later on.

console.log('\n=== the fixes are still in the shader sources ===\n');

const shaderChecks = [
  [ 'shaders/common.glsl', /float maxWater\(float T\)\s*\{[^}]*maxWaterCap/, 'the saturation curve is capped' ],
  [ 'shaders/common.glsl', /float safeClamp/, 'a NaN aware clamp helper exists' ],
  [ 'shaders/common.glsl', /float cleanWater/, 'a NaN aware water channel sanitizer exists' ],
  [ 'shaders/common.glsl', /float capWaterFlux/, 'water fluxes can be limited per iteration' ],
  [ 'shaders/common.glsl', /float capTempFlux/, 'latent heat steps can be limited per iteration' ],
  [ 'shaders/fragment/advectionShader.frag', /water\[TOTAL\] = cleanWater\(water\[TOTAL\]\);/, 'condensation limits the vapor and cloud water' ],
  [ 'shaders/fragment/advectionShader.frag', /capTempFlux\(condensation/, 'condensation can not change the temperature beyond the cap' ],
  [ 'shaders/fragment/advectionShader.frag', /1001\./, 'the land wall vapor indicator is kept' ],
  [ 'shaders/fragment/advectionShader.frag', /limitProfileT/, 'temperature profiles can not inject unbounded heat' ],
  [ 'shaders/fragment/boundaryShader.frag', /if \(!\(base\[TEMPERATURE\] > 100\.0\) \|\| base\[TEMPERATURE\] > 500\.0\)\s*\n\s*base\[TEMPERATURE\] = waterTemperature;/, 'a water cell without a stored temperature gets one before it is used' ],
  [ 'shaders/fragment/boundaryShader.frag', /precipCoalescence = min/, 'rain out is limited to the available cloud water' ],
  [ 'shaders/fragment/boundaryShader.frag', /evaporation = min\(evaporation, maxWater\(LocalWaterTemperature\) \* maxWaterCapPerIter\)/, 'the evaporation of a lake is limited per iteration' ],
  [ 'shaders/fragment/boundaryShader.frag', /min\(deficit \* landEvaporation \* vegFactor \* moistureFactor, maxW \* maxWaterCapPerIter\)/, 'the evaporation of land is limited per iteration' ],
  [ 'shaders/fragment/boundaryShader.frag', /water\[SOIL_MOISTURE\] = safeClamp\(/, 'soil moisture can not become negative' ],
  [ 'shaders/fragment/boundaryShader.frag', /float getInitialT\(int y\)\s*\{\s*float lapse =/, 'the initial profile adds the lapse rate before clamping' ],
  [ 'shaders/fragment/lightingShader.frag', /surfaceSkinTemp/, 'wall cells never radiate their snow melt indicator' ],
  [ 'shaders/vertex/precipitationShader.vert', /growth = clamp\(growth/, 'droplet growth is limited to the water in the cell' ],
  [ 'shaders/vertex/precipitationShader.vert', /clamp\(newMass\[WATER\], 0\.0, maxDropMass\)/, 'a droplet can not grow beyond its maximum size' ],
  [ 'shaders/vertex/precipitationShader.vert', /relativeHumidity = safeClamp/, 'the humidity of a droplet can not become negative or NaN' ],
];

for (const [ file, re, description ] of shaderChecks) {
  const src = fs.readFileSync(path.join(REPO, file), 'utf8');
  check(re.test(src), `${description}  (${file})`);
}

console.log('\n=== the fixes are still in app.js ===\n');

const appjs = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
const jsChecks = [
  [ /const maxWaterCap = 200\.0/, 'the JavaScript copy of the saturation curve is capped too (the display and graphs use it)' ],
  [ /function sanitizeLoadedState\(/, 'a loaded save file is repaired before the simulation starts' ],
  [ /clamp\(v, minPhysTemp \+ lapse, maxPhysTemp \+ lapse\)/, 'temperatures of a loaded state are limited to the physical range' ],
  [ /precipArray\[i \+ 2\] > 50\.0/, 'droplets of an exploded save file are reset' ],
  [ /repairProfile\(initial_T,/, 'the initial temperature profile is checked for NaN' ],
  [ /repairProfile\(realWorldSounding_W,/, 'the scraped sounding is checked for NaN' ],
  [ /const guiControls_range = \{/, 'settings loaded from a save file can not exceed the range of their slider' ],
];
for (const [ re, description ] of jsChecks)
  check(re.test(appjs), `${description}  (app.js)`);

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
