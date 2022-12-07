/*
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details. You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

var canvas;
var gl;

var SETUP_MODE = false;

var loadingBar;

const degToRad = 0.0174533;
const radToDeg = 57.2957795;

const saveFileVersionID =
    1939327491;  // Uint32 id to check if save file is compatible

const guiControls_default = {
  vorticity: 0.005,
  dragMultiplier: 0.01,  // 0.1
  wind: -0.0001,
  globalEffectsHeight: 5000,
  globalDrying: 0.00001,
  globalHeating: 0.0,
  sunIntensity: 1.0,
  waterTemperature: 25,  // only in degrees C, Sorry americans
  landEvaporation: 0.00005,
  waterEvaporation: 0.0001,
  evapHeat: 1.9,     // 1.9
  meltingHeat: 0.6,  // 0.281
  waterWeight: 0.5,  // 0.50
  inactiveDroplets: 0,
  aboveZeroThreshold: 1.0,  // PRECIPITATION Parameters
  subZeroThreshold: 0.01,   // 0.05
  spawnChance: 0.00002,     // 0.0005
  snowDensity: 0.3,
  fallSpeed: 0.0003,
  growthRate0C: 0.0001,   // 0.0005
  growthRate_30C: 0.001,  // 0.01
  freezingRate: 0.0035,
  meltingRate: 0.0035,
  evapRate: 0.0005,  // END OF PRECIPITATION
  displayMode: 'DISP_REAL',
  timeOfDay: 9.9,
  latitude: 45.0,
  month: 6.67,  // Nothern himisphere solstice
  sunAngle: 9.9,
  dayNightCycle: true,
  exposure: 1.0,
  greenhouseGases: 0.001,
  IR_rate: 1.0,
  tool: 'TOOL_NONE',
  brushSize: 20,
  wholeWidth: false,
  intensity: 0.01,
  showGraph: false,
  showDrops: false,
  paused: false,
  IterPerFrame: 10,
  auto_IterPerFrame: true,
  dryLapseRate: 10.0,    // 9.81 degrees / km
  simHeight: 12000,      // meters
  imperialUnits: false,  // only for display.  false = metric
};

var sunIsUp = true;

var saveFileName = '';

var guiControlsFromSaveFile = null;
var datGui;

var sim_res_x;
var sim_res_y;

var frameNum = 0;
var lastFrameNum = 0;

var IterNum = 0;

var viewXpos = 0.0;
var viewYpos = 0.0;
var viewZoom = 1.0001;

var NUM_DROPLETS;
const NUM_DROPLETS_DEVIDER = 25;  // number of droplets relative to resolution

function download(filename, data) {
  var url = URL.createObjectURL(data);
  const element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

// Universal Functions

function mod(a, b) {
  // proper modulo to handle negative numbers
  return ((a % b) + b) % b;
}

function map_range(value, low1, high1, low2, high2) {
  return low2 + ((high2 - low2) * (value - low1)) / (high1 - low1);
}

function max(num1, num2) {
  if (num1 > num2)
    return num1;
  else
    return num2;
}

function min(num1, num2) {
  if (num1 < num2)
    return num1;
  else
    return num2;
}

// Temperature Functions

function CtoK(c) {
  return c + 273.15;
}

function KtoC(k) {
  return k - 273.15;
}

function dT_saturated(dTdry, dTl) {
  // dTl = temperature difference because of latent heat
  // if (dTl == 0.0)
  //   return dTdry;
  //  else {
  var multiplier = dTdry / (dTdry - dTl);
  return dTdry * multiplier;
  // }
}

const IR_constant = 5.670374419;  // ×10−8

function IR_emitted(T) {
  return Math.pow(T * 0.01, 4) * IR_constant;  // Stefan–Boltzmann law
}

function IR_temp(IR) {
  // inversed Stefan–Boltzmann law
  return Math.pow(IR / IR_constant, 1.0 / 4.0) * 100.0;
}

////////////// Water Functions ///////////////
const wf_devider = 250.0;
const wf_pow = 17.0;

function maxWater(Td) {
  return Math.pow(
      Td / wf_devider,
      wf_pow);  // w = ((Td)/(250))^(18) // Td in Kelvin, w in grams per m^3
}

function dewpoint(W) {
  //  if (W < 0.00001) // can't remember why this was here...
  //    return 0.0;
  //  else
  return wf_devider * Math.pow(W, 1.0 / wf_pow);
}

function relativeHumd(T, W) {
  return (W / maxWater(T)) * 100.0;
}

async function loadData() {
  let file = document.getElementById('fileInput').files[0];

  if (file) {
    let versionBlob =
        file.slice(0, 4);  // extract first 4 bytes containing version id
    let versionBuf = await versionBlob.arrayBuffer();
    let version = new Uint32Array(versionBuf)[0];  // convert to Uint32

    if (version == saveFileVersionID) {
      // check version id, only proceed if file has the right version id
      let fileArrBuf =
          await file.slice(4).arrayBuffer();  // slice from behind version id to
      // the end of the file
      let fileUint8Arr =
          new Uint8Array(fileArrBuf);  // convert to Uint8Array for pako
      let decompressed = window.pako.inflate(fileUint8Arr);  // uncompress
      let dataBlob = new Blob([decompressed]);               // turn into blob

      let sliceStart = 0;
      let sliceEnd = 4;

      let resBlob = dataBlob.slice(
          sliceStart, sliceEnd);  // extract first 4 bytes containing resolution
      let resBuf = await resBlob.arrayBuffer();
      resArray = new Uint16Array(resBuf);
      sim_res_x = resArray[0];
      sim_res_y = resArray[1];

      NUM_DROPLETS = (sim_res_x * sim_res_y) / NUM_DROPLETS_DEVIDER;

      saveFileName = file.name;

      if (saveFileName.includes('.')) {
        saveFileName =
            saveFileName.split('.').slice(0, -1).join('.');  // remove extension
      }

      console.log('loading file: ' + saveFileName);
      5;
      console.log('File versionID: ' + version);
      console.log('sim_res_x: ' + sim_res_x);
      console.log('sim_res_y: ' + sim_res_y);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4;
      let baseTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let baseTexBuf = await baseTexBlob.arrayBuffer();
      let baseTexF32 = new Float32Array(baseTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4;  // 4 * float
      let waterTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let waterTexBuf = await waterTexBlob.arrayBuffer();
      let waterTexF32 = new Float32Array(waterTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 1;  // 4 * byte
      let wallTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let wallTexBuf = await wallTexBlob.arrayBuffer();
      let wallTexI8 = new Int8Array(wallTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += NUM_DROPLETS * Float32Array.BYTES_PER_ELEMENT * 5;
      let precipArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
      let precipArrayBuf = await precipArrayBlob.arrayBuffer();
      let precipArray = new Float32Array(precipArrayBuf);

      sliceStart = sliceEnd;
      let settingsArrayBlob = dataBlob.slice(sliceStart);  // until end of file

      guiControlsFromSaveFile = await settingsArrayBlob.text();

      mainScript(baseTexF32, waterTexF32, wallTexI8, precipArray);
    } else {
      // wrong id
      alert('Incompatible file!');
      document.getElementById('fileInput').value = '';  // clear file
    }
  } else {
    // no file, so create new simulation
    sim_res_x = parseInt(document.getElementById('simResSelX').value);
    sim_res_y = parseInt(document.getElementById('simResSelY').value);
    NUM_DROPLETS = (sim_res_x * sim_res_y) / NUM_DROPLETS_DEVIDER;
    SETUP_MODE = true;

    mainScript(null);  // run without initial textures
  }
  // match bottem of sim area to bottem of screen
  viewYpos = -0.5 + sim_res_y / sim_res_x;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

class LoadingBar {
  #loadingBar;
  #bar;
  #underBar;
  #percent;
  #description;

  constructor(percentIn) {
    if (percentIn == null)
      this.percent = 0;
    else
      this.percent = percentIn;

    // create html
    this.loadingBar = document.createElement('div');
    this.bar = document.createElement('div');
    this.loadingBar.appendChild(this.bar);

    this.underBar = document.createElement('div');
    this.loadingBar.appendChild(this.underBar);

    this.loadingBar.style.width = '100%';
    this.loadingBar.style.height = '100px';
    this.loadingBar.style.color = 'white';
    this.loadingBar.style.textAlign = 'center';
    this.loadingBar.style.lineHeight = '50px';
    this.loadingBar.style.backgroundColor = 'gray';
    this.loadingBar.style.marginTop = '400px';

    this.underBar.style.width = '100%';
    this.underBar.style.height = '50px';
    this.underBar.style.backgroundColor = 'black';

    this.bar.style.height = '50px';

    this.bar.style.backgroundColor = 'green';
    this.bar.style.fontSize = '20px';

    this.#update();

    document.body.appendChild(this.loadingBar);
  }

  async add(num, text) {
    this.percent += num;
    this.description = text;
    await this.#update();
  }

  async set(num, text) {
    this.percent = num;
    this.description = text;
    await this.#update();
  }

  #update() {
    return new Promise((resolve) => {
      this.bar.style.width = this.percent + '%';
      this.bar.innerHTML = this.percent + '%';
      this.underBar.innerHTML = this.description;
      let timeout;
      if (this.percent == 100)
        timeout = 5;
      else
        timeout = 5;  // 50 for nicer feel
      setTimeout(() => {
        resolve();
      }, timeout);
    });
  }

  remove() {
    this.loadingBar.parentNode.removeChild(this.loadingBar);
  }
}

function setLoadingBar() {
  return new Promise((resolve) => {
    var element = document.getElementById('IntroScreen');
    element.parentNode.removeChild(element);  // remove introscreen div

    document.body.style.backgroundColor = 'black';

    loadingBar = new LoadingBar(1);

    setTimeout(() => {
      resolve();
    }, 10);
  });
}

async function mainScript(
    initialBaseTex, initialWaterTex, initialWallTex, initialRainDrops) {
  await setLoadingBar();

  canvas = document.getElementById('mainCanvas');

  var contextAttributes = {
    alpha: false,
    desynchronized: false,
    antialias: false,
    depth: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,  // true
    preserveDrawingBuffer: false,
    stencil: false,
  };
  gl = canvas.getContext('webgl2', contextAttributes);
  // console.log(gl.getContextAttributes());

  if (!gl) {
    alert('Your browser does not support WebGL2, Download a new browser.');
    throw ' Error: Your browser does not support WebGL2';
  }

  // SETUP GUI
  var guiControls;

  if (guiControlsFromSaveFile == null) {
    setupDatGui(JSON.stringify(guiControls_default));  // use default settings
  } else {
    setupDatGui(guiControlsFromSaveFile);  // use settings from save file
  }

  function setGuiUniforms() {
    // set all uniforms to new values
    gl.useProgram(boundaryProgram);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'vorticity'),
        guiControls.vorticity);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'IR_rate'), guiControls.IR_rate);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
        CtoK(guiControls.waterTemperature));
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'landEvaporation'),
        guiControls.landEvaporation);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'waterEvaporation'),
        guiControls.waterEvaporation);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'evapHeat'),
        guiControls.evapHeat);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'waterWeight'),
        guiControls.waterWeight);
    gl.useProgram(velocityProgram);
    gl.uniform1f(
        gl.getUniformLocation(velocityProgram, 'dragMultiplier'),
        guiControls.dragMultiplier);
    gl.uniform1f(
        gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
    gl.useProgram(lightingProgram);
    gl.uniform1f(
        gl.getUniformLocation(lightingProgram, 'waterTemperature'),
        CtoK(guiControls.waterTemperature));
    gl.uniform1f(
        gl.getUniformLocation(lightingProgram, 'greenhouseGases'),
        guiControls.greenhouseGases);
    gl.useProgram(advectionProgram);
    gl.uniform1f(
        gl.getUniformLocation(advectionProgram, 'evapHeat'),
        guiControls.evapHeat);
    gl.uniform1f(
        gl.getUniformLocation(advectionProgram, 'meltingHeat'),
        guiControls.meltingHeat);
    gl.uniform1f(
        gl.getUniformLocation(advectionProgram, 'globalDrying'),
        guiControls.globalDrying);
    gl.uniform1f(
        gl.getUniformLocation(advectionProgram, 'globalHeating'),
        guiControls.globalHeating);
    gl.uniform1f(
        gl.getUniformLocation(advectionProgram, 'globalEffectsHeight'),
        guiControls.globalEffectsHeight / guiControls.simHeight);
    gl.useProgram(precipitationProgram);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'evapHeat'),
        guiControls.evapHeat);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'meltingHeat'),
        guiControls.meltingHeat);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'waterWeight'),
        guiControls.waterWeight);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'),
        guiControls.aboveZeroThreshold);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'),
        guiControls.subZeroThreshold);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'spawnChance'),
        guiControls.spawnChance);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'snowDensity'),
        guiControls.snowDensity);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'fallSpeed'),
        guiControls.fallSpeed);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'growthRate0C'),
        guiControls.growthRate0C);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'growthRate_30C'),
        guiControls.growthRate_30C);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'freezingRate'),
        guiControls.freezingRate);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'meltingRate'),
        guiControls.meltingRate);
    gl.uniform1f(
        gl.getUniformLocation(precipitationProgram, 'evapRate'),
        guiControls.evapRate);
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(
        gl.getUniformLocation(realisticDisplayProgram, 'exposure'),
        guiControls.exposure);
  }

  function setupDatGui(strGuiControls) {
    datGui = new dat.GUI();
    guiControls = JSON.parse(strGuiControls);  // load object

    if (frameNum == 0) {
      // only hide during initial setup. When resetting settings and
      // reinitializing datGui, H key no longer works to unhide it
      datGui.hide();
    }
    // add functions to guicontrols object
    guiControls.download = function() {
      prepareDownload();
    };

    guiControls.resetSettings = function() {
      if (confirm('Are you sure you want to reset all settings to default?')) {
        datGui.destroy();  // remove datGui completely
        setupDatGui(JSON.stringify(
            guiControls_default));  // generate new one with new settings
        setGuiUniforms();
        hideOrShowGraph();
        updateSunlight();
      }
    };

    var fluidParams_folder = datGui.addFolder('Fluid');

    fluidParams_folder.add(guiControls, 'vorticity', 0.0, 0.015, 0.001)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'vorticity'),
              guiControls.vorticity);
        })
        .name('Vorticity');

    fluidParams_folder.add(guiControls, 'dragMultiplier', 0.0, 1.0, 0.01)
        .onChange(function() {
          gl.useProgram(velocityProgram);
          gl.uniform1f(
              gl.getUniformLocation(velocityProgram, 'dragMultiplier'),
              guiControls.dragMultiplier);
        })
        .name('Drag');

    fluidParams_folder.add(guiControls, 'wind', -1.0, 1.0, 0.01)
        .onChange(function() {
          gl.useProgram(velocityProgram);
          gl.uniform1f(
              gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
        })
        .name('Wind');

    fluidParams_folder.add(guiControls, 'globalDrying', 0.0, 0.001, 0.00001)
        .onChange(function() {
          gl.useProgram(advectionProgram);
          gl.uniform1f(
              gl.getUniformLocation(advectionProgram, 'globalDrying'),
              guiControls.globalDrying);
        })
        .name('Global Drying');

    fluidParams_folder.add(guiControls, 'globalHeating', -0.002, 0.002, 0.0001)
        .onChange(function() {
          gl.useProgram(advectionProgram);
          gl.uniform1f(
              gl.getUniformLocation(advectionProgram, 'globalHeating'),
              guiControls.globalHeating);
        })
        .name('Global Heating');

    fluidParams_folder
        .add(guiControls, 'globalEffectsHeight', 0, guiControls.simHeight, 10)
        .onChange(function() {
          gl.useProgram(advectionProgram);
          gl.uniform1f(
              gl.getUniformLocation(advectionProgram, 'globalEffectsHeight'),
              guiControls.globalEffectsHeight / guiControls.simHeight);
        })
        .name('Starting Height');

    var UI_folder = datGui.addFolder('User Interaction');

    UI_folder
        .add(guiControls, 'tool', {
          'Flashlight': 'TOOL_NONE',
          'Temperature': 'TOOL_TEMPERATURE',
          'Water Vapor / Cloud': 'TOOL_WATER',
          'Land': 'TOOL_WALL_LAND',
          'Lake / Sea': 'TOOL_WALL_SEA',
          'Fire': 'TOOL_WALL_FIRE',
          'Smoke / Dust': 'TOOL_SMOKE',
          'Moisture': 'TOOL_WALL_MOIST',
          'Vegetation': 'TOOL_VEGETATION',
          'Snow': 'TOOL_WALL_SNOW',
          'wind': 'TOOL_WIND',
        })
        .name('Tool')
        .listen();
    UI_folder.add(guiControls, 'brushSize', 1, 200, 1)
        .name('Brush Diameter')
        .listen();
    UI_folder.add(guiControls, 'wholeWidth').name('Whole Width Brush').listen();
    UI_folder.add(guiControls, 'intensity', 0.005, 0.05, 0.001)
        .name('Brush Intensity');

    var radiation_folder = datGui.addFolder('Radiation');

    radiation_folder.add(guiControls, 'timeOfDay', 0.0, 23.9, 0.01)
        .onChange(function() {
          updateSunlight();
        })
        .name('Time of day')
        .listen();

    radiation_folder.add(guiControls, 'dayNightCycle')
        .name('Day/Night Cycle')
        .listen();

    radiation_folder.add(guiControls, 'latitude', -90.0, 90.0, 0.1)
        .onChange(function() {
          updateSunlight();
        })
        .name('Latitude')
        .listen();

    radiation_folder.add(guiControls, 'month', 1.0, 12.9, 0.1)
        .onChange(function() {
          updateSunlight();
        })
        .name('Month')
        .listen();

    radiation_folder.add(guiControls, 'sunAngle', -10.0, 190.0, 0.1)
        .onChange(function() {
          updateSunlight('MANUAL_ANGLE');
          guiControls.dayNightCycle = false;
        })
        .name('Sun Angle')
        .listen();

    radiation_folder.add(guiControls, 'sunIntensity', 0.0, 2.0, 0.01)
        .onChange(function() {
          updateSunlight('MANUAL_ANGLE');
        })
        .name('Sun Intensity');

    radiation_folder.add(guiControls, 'greenhouseGases', 0.0, 0.01, 0.0001)
        .onChange(function() {
          gl.useProgram(lightingProgram);
          gl.uniform1f(
              gl.getUniformLocation(lightingProgram, 'greenhouseGases'),
              guiControls.greenhouseGases);
        })
        .name('Greenhouse Gases');

    radiation_folder.add(guiControls, 'IR_rate', 0.0, 10.0, 0.1)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'IR_rate'),
              guiControls.IR_rate);
        })
        .name('IR Multiplier');

    var water_folder = datGui.addFolder('Water');

    water_folder.add(guiControls, 'waterTemperature', 0.0, 35.0, 0.1)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
              CtoK(guiControls.waterTemperature));
          gl.useProgram(lightingProgram);
          gl.uniform1f(
              gl.getUniformLocation(lightingProgram, 'waterTemperature'),
              CtoK(guiControls.waterTemperature));
        })
        .name('Lake / Sea Temp (°C)');
    water_folder.add(guiControls, 'landEvaporation', 0.0, 0.0002, 0.00001)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'landEvaporation'),
              guiControls.landEvaporation);
        })
        .name('Land Evaporation');
    water_folder.add(guiControls, 'waterEvaporation', 0.0, 0.0004, 0.00001)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'waterEvaporation'),
              guiControls.waterEvaporation);
        })
        .name('Lake / Sea Evaporation');
    water_folder.add(guiControls, 'evapHeat', 0.0, 5.0, 0.1)
        .onChange(function() {
          gl.useProgram(advectionProgram);
          gl.uniform1f(
              gl.getUniformLocation(advectionProgram, 'evapHeat'),
              guiControls.evapHeat);
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'evapHeat'),
              guiControls.evapHeat);
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'evapHeat'),
              guiControls.evapHeat);
        })
        .name('Evaporation Heat');
    water_folder.add(guiControls, 'meltingHeat', 0.0, 5.0, 0.1)
        .onChange(function() {
          gl.useProgram(advectionProgram);
          gl.uniform1f(
              gl.getUniformLocation(advectionProgram, 'meltingHeat'),
              guiControls.meltingHeat);
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'meltingHeat'),
              guiControls.meltingHeat);
        })
        .name('Melting Heat');
    water_folder.add(guiControls, 'waterWeight', 0.0, 2.0, 0.01)
        .onChange(function() {
          gl.useProgram(boundaryProgram);
          gl.uniform1f(
              gl.getUniformLocation(boundaryProgram, 'waterWeight'),
              guiControls.waterWeight);
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'waterWeight'),
              guiControls.waterWeight);
        })
        .name('Water Weight');

    var precipitation_folder = datGui.addFolder('Precipitation');

    precipitation_folder.add(guiControls, 'aboveZeroThreshold', 0.1, 2.0, 0.1)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'),
              guiControls.aboveZeroThreshold);
        })
        .name('Precipitation Threshhold +°C');

    precipitation_folder.add(guiControls, 'subZeroThreshold', 0.0, 2.0, 0.01)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'),
              guiControls.subZeroThreshold);
        })
        .name('Precipitation Threshhold -°C');

    precipitation_folder
        .add(guiControls, 'spawnChance', 0.00001, 0.0001, 0.00001)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'spawnChance'),
              guiControls.spawnChance);
        })
        .name('Spawn Rate');

    precipitation_folder.add(guiControls, 'snowDensity', 0.1, 1.0, 0.01)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'snowDensity'),
              guiControls.snowDensity);
        })
        .name('Snow Density');

    precipitation_folder.add(guiControls, 'fallSpeed', 0.0001, 0.001, 0.0001)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'fallSpeed'),
              guiControls.fallSpeed);
        })
        .name('Fall Speed');

    precipitation_folder.add(guiControls, 'growthRate0C', 0.0001, 0.005, 0.0001)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'growthRate0C'),
              guiControls.growthRate0C);
        })
        .name('Growth Rate 0°C');

    precipitation_folder
        .add(guiControls, 'growthRate_30C', 0.0001, 0.005, 0.0001)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'growthRate_30C'),
              guiControls.growthRate_30C);
        })
        .name('Growth Rate -30°C');

    precipitation_folder
        .add(guiControls, 'freezingRate', 0.0005, 0.01, 0.0001)  // 0.0035
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'freezingRate'),
              guiControls.freezingRate);
        })
        .name('Freezing Rate');

    precipitation_folder
        .add(guiControls, 'meltingRate', 0.0005, 0.01, 0.0001)  // 0.0035
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'meltingRate'),
              guiControls.meltingRate);
        })
        .name('Melting Rate');

    precipitation_folder.add(guiControls, 'evapRate', 0.0001, 0.005, 0.0001)
        .onChange(function() {
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'evapRate'),
              guiControls.evapRate);
        })
        .name('Evaporation Rate');

    precipitation_folder.add(guiControls, 'inactiveDroplets', 0, NUM_DROPLETS)
        .listen()
        .name('Inactive Droplets');
    precipitation_folder.add(guiControls, 'showDrops')
        .name('Show Droplets')
        .listen();

    datGui
        .add(guiControls, 'displayMode', {
          '1 Temperature -26°C to 30°C': 'DISP_TEMPERATURE',
          '2 Water Vapor': 'DISP_WATER',
          '3 Realistic': 'DISP_REAL',
          '4 Horizontal Velocity': 'DISP_HORIVEL',
          '5 Vertical Velocity': 'DISP_VERTVEL',
          '6 IR Heating / Cooling': 'DISP_IRHEATING',
          '7 IR Down -60°C to 26°C': 'DISP_IRDOWNTEMP',
          '8 IR Up -26°C to 30°C': 'DISP_IRUPTEMP',
        })
        .name('Display Mode')
        .listen();
    datGui.add(guiControls, 'exposure', 1.0, 10.0, 0.01)
        .onChange(function() {
          gl.useProgram(realisticDisplayProgram);
          gl.uniform1f(
              gl.getUniformLocation(realisticDisplayProgram, 'exposure'),
              guiControls.exposure);
        })
        .name('Exposure');

    var advanced_folder = datGui.addFolder('Advanced');

    advanced_folder.add(guiControls, 'IterPerFrame', 1, 50, 1)
        .name('Iterations / Frame')
        .listen();

    advanced_folder.add(guiControls, 'auto_IterPerFrame')
        .name('Auto Adjust')
        .listen();
    advanced_folder.add(guiControls, 'imperialUnits').name('Imperial Units');
    advanced_folder.add(guiControls, 'showGraph')
        .onChange(hideOrShowGraph)
        .name('Show Sounding Graph')
        .listen();
    advanced_folder.add(guiControls, 'resetSettings')
        .name('Reset all settings');

    datGui.add(guiControls, 'paused').name('Paused').listen();
    datGui.add(guiControls, 'download').name('Save Simulation to File');

    datGui.width = 400;
  }

  await loadingBar.set(3, 'Initializing Sounding Graph');
  // END OF GUI

  function startSimulation() {
    SETUP_MODE = false;
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(
        gl.getUniformLocation(realisticDisplayProgram, 'exposure'),
        guiControls.exposure);
    datGui.show();  // unhide
  }

  function printTemp(tempC) {
    if (guiControls.imperialUnits) {
      let tempF = tempC * 1.8 + 32.0;
      return tempF.toFixed(1) + '°F';
    } else
      return tempC.toFixed(1) + '°C';
  }

  function printAltitude(meters) {
    if (guiControls.imperialUnits) {
      let feet = meters * 3.281;
      return feet.toFixed() + ' ft';
    } else
      return meters.toFixed() + ' m';
  }

  var soundingGraph = {
    graphCanvas: null,
    ctx: null,
    init: function() {
      this.graphCanvas = document.getElementById('graphCanvas');
      this.graphCanvas.height = window.innerHeight;
      this.graphCanvas.width = this.graphCanvas.height;
      this.ctx = this.graphCanvas.getContext('2d');
      var style = this.graphCanvas.style;
      if (guiControls.showGraph)
        style.display = 'block';
      else
        style.display = 'none';
    },
    draw: function(simXpos, simYpos) {
      // draw graph
      // mouse positions in sim coordinates

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      var baseTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(
          simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT,
          baseTextureValues);  // read a vertical culumn of cells

      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      var waterTextureValues = new Float32Array(4 * sim_res_y);
      gl.readPixels(
          simXpos, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT,
          waterTextureValues);  // read a vertical culumn of cells

      const graphBottem = this.graphCanvas.height - 30;  // in pixels

      var c = this.ctx;

      c.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      c.fillStyle = '#00000055';
      c.fillRect(0, 0, graphCanvas.width, graphCanvas.height);

      drawIsotherms();

      var reachedAir = false;
      var surfaceLevel;

      // Draw temperature line
      c.beginPath();
      for (var y = 0; y < sim_res_y; y++) {
        var potentialTemp = baseTextureValues[4 * y + 3];

        var temp = potentialTemp -
            ((y / sim_res_y) * guiControls.simHeight *
             guiControls.dryLapseRate) /
                1000.0 -
            273.15;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.font = '15px Arial';
        c.fillStyle = 'white';

        if (temp < 599.0) {
          // not wall
          if (!reachedAir) {
            // first non wall cell
            reachedAir = true;
            surfaceLevel = y;

            if (simYpos < surfaceLevel) simYpos = surfaceLevel;
          }
          if (reachedAir && y == simYpos) {
            // c.fillText("" + Math.round(map_range(y-1, 0, sim_res_y, 0,
            // guiControls.simHeight)) + " m", 5, scrYpos + 5);
            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;
            c.strokeRect(
                T_to_Xpos(temp, scrYpos), scrYpos, 10,
                1);  // vertical position indicator
            c.fillText(
                '' + printTemp(temp), T_to_Xpos(temp, scrYpos) + 20,
                scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(temp, scrYpos), scrYpos);  // temperature
        }
      }
      c.lineWidth = 2.0;  // 3
      c.strokeStyle = '#FF0000';
      c.stroke();

      // Draw Dew point line
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {
        var dewPoint = dewpoint(waterTextureValues[4 * y]) - 273.15;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.font = '15px Arial';
        c.fillStyle = 'white';

        // c.fillText("Surface: " + y, 10, scrYpos);
        if (y == simYpos) {
          c.fillText(
              '' +
                  printAltitude(Math.round(map_range(
                      y - 1, 0, sim_res_y, 0, guiControls.simHeight))),
              5, scrYpos + 5);
          c.strokeStyle = '#FFF';
          c.lineWidth = 1.0;
          c.strokeRect(
              T_to_Xpos(dewPoint, scrYpos) - 10, scrYpos, 10,
              1);  // vertical position indicator
          c.fillText(
              '' + printTemp(dewPoint), T_to_Xpos(dewPoint, scrYpos) - 70,
              scrYpos + 5);
        }
        c.lineTo(T_to_Xpos(dewPoint, scrYpos), scrYpos);  // temperature
      }

      c.lineWidth = 2.0;  // 3
      c.strokeStyle = '#0055FF';
      c.stroke();

      // Draw rising parcel temperature line

      var water = waterTextureValues[4 * simYpos];
      var potentialTemp = baseTextureValues[4 * simYpos + 3];
      var initialTemperature = potentialTemp -
          ((simYpos / sim_res_y) * guiControls.simHeight *
           guiControls.dryLapseRate) /
              1000.0;
      var initialCloudWater = waterTextureValues[4 * simYpos + 1];
      // var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight *
      // guiControls.dryLapseRate) / 1000.0 - 273.15;
      var prevTemp = initialTemperature;
      var prevCloudWater = initialCloudWater;

      var drylapsePerCell = ((-1.0 / sim_res_y) * guiControls.simHeight *
                             guiControls.dryLapseRate) /
          1000.0;

      reachedSaturation = false;

      c.beginPath();
      var scrYpos = map_range(simYpos, sim_res_y, 0, 0, graphBottem);
      c.moveTo(T_to_Xpos(KtoC(initialTemperature), scrYpos), scrYpos);
      for (var y = simYpos + 1; y < sim_res_y; y++) {
        var dT = drylapsePerCell;

        var cloudWater =
            max(water - maxWater(prevTemp + dT),
                0.0);  // how much cloud water there would be after that
        // temperature change

        var dWt = (cloudWater - prevCloudWater) *
            guiControls.evapHeat;  // how much that water phase change would
        // change the temperature

        var actualTempChange = dT_saturated(dT, dWt);

        var T = prevTemp + actualTempChange;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.lineTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos);  // temperature

        prevTemp = T;
        prevCloudWater = max(water - maxWater(prevTemp), 0.0);

        if (!reachedSaturation && prevCloudWater > 0.0) {
          reachedSaturation = true;
          c.strokeStyle = '#008800';  // dark green for dry lapse rate
          c.stroke();

          if (y - simYpos > 5) {
            c.beginPath();
            c.moveTo(T_to_Xpos(KtoC(T), scrYpos) - 0, scrYpos);  // temperature
            c.lineTo(
                T_to_Xpos(KtoC(T), scrYpos) + 40,
                scrYpos);  // Horizontal ceiling line
            c.strokeStyle = '#FFFFFF';
            c.stroke();
            c.fillText(
                '' +
                    printAltitude(Math.round(map_range(
                        y - 1, 0, sim_res_y, 0, guiControls.simHeight))),
                T_to_Xpos(KtoC(T), scrYpos) + 50, scrYpos + 5);
          }

          c.beginPath();
          c.moveTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos);  // temperature
        }
      }

      c.lineWidth = 2.0;  // 3
      if (reachedSaturation) {
        c.strokeStyle = '#00FF00';  // light green for saturated lapse rate
      } else
        c.strokeStyle = '#008800';

      c.stroke();

      function T_to_Xpos(T, y) {
        // temperature to horizontal position

        // var normX = T * 0.013 + 1.34 - (y / graphBottem) * 0.9; // -30 to 40
        var normX = T * 0.0115 + 1.18 - (y / graphBottem) * 0.8;  // -30 to 50

        return normX *
            this.graphCanvas
                .width;  // T * 7.5 + 780.0 - 600.0 * (y / graphBottem);
      }

      function drawIsotherms() {
        c.strokeStyle = '#964B00';
        c.beginPath();
        c.fillStyle = 'white';

        for (var T = -80.0; T <= 50.0; T += 10.0) {
          c.moveTo(T_to_Xpos(T, graphBottem), graphBottem);
          c.lineTo(T_to_Xpos(T, 0), 0);

          if (T >= -30.0)
            c.fillText(
                printTemp(Math.round(T)), T_to_Xpos(T, graphBottem) - 20,
                this.graphCanvas.height - 5);
        }
        c.lineWidth = 1.0;
        c.stroke();
        // draw 0 degree line thicker
        c.beginPath();
        c.moveTo(T_to_Xpos(0, graphBottem), graphBottem);
        c.lineTo(T_to_Xpos(0, 0), 0);
        c.lineWidth = 3.0;
        c.stroke();
      }
    },  // end of draw()
  };
  soundingGraph.init();

  await loadingBar.set(6, 'Setting up eventlisteners');
  // END OF GRAPH

  const sim_aspect = sim_res_x / sim_res_y;

  var canvas_aspect;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  canvas_aspect = canvas.width / canvas.height;

  var mouseXinSim, mouseYinSim;
  var prevMouseXinSim, prevMouseYinSim;

  window.addEventListener('resize', function() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas_aspect = canvas.width / canvas.height;

    soundingGraph.graphCanvas.height = window.innerHeight;
    soundingGraph.graphCanvas.width = window.innerHeight;
  });

  function logSample() {
    // mouse position in sim coordinates
    var simXpos = Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x)));
    var simYpos = Math.floor(mouseYinSim * sim_res_y);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);  // basetexture
    var baseTextureValues = new Float32Array(4);
    gl.readPixels(
        simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT,
        baseTextureValues);  // read single cell

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);  // watertexture
    var waterTextureValues = new Float32Array(4);
    gl.readPixels(
        simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT,
        waterTextureValues);  // read single cell

    gl.readBuffer(gl.COLOR_ATTACHMENT2);  // walltexture
    var wallTextureValues = new Int8Array(4);
    gl.readPixels(
        simXpos, simYpos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);  // lighttexture_1
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(
        simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT,
        lightTextureValues);  // read single cell

    console.log('');
    console.log('');
    console.log('Sample at:      X: ' + simXpos, '  Y: ' + simYpos);
    console.log('BASE-----------------------------------------');
    console.log('[0] X-vel:', baseTextureValues[0]);
    console.log('[1] Y-vel:', baseTextureValues[1]);
    console.log('[2] Press:', baseTextureValues[2]);
    console.log(
        '[3] Temp :',
        KtoC(potentialToRealT(baseTextureValues[3], simYpos)).toFixed(2) +
            ' °C');

    //		console.log(simYpos);

    console.log('WATER-----------------------------------------');
    console.log('[0] water:     ', waterTextureValues[0]);
    console.log('[1] cloudwater:', waterTextureValues[1]);
    console.log('[2] rain:      ', waterTextureValues[2]);
    console.log('[3] Smoke/snow:', waterTextureValues[3]);

    console.log('WALL-----------------------------------------');
    console.log('[0] walltype :         ', wallTextureValues[0]);
    console.log('[1] distance:          ', wallTextureValues[1]);
    console.log('[2] Vertical distance :', wallTextureValues[2]);
    console.log('[3] Vegitation:        ', wallTextureValues[3]);

    console.log('LIGHT-----------------------------------------');
    console.log('[0] Sunlight:  ', lightTextureValues[0]);
    console.log('[1] IR cooling:', lightTextureValues[1]);  // net effect of ir
    console.log(
        '[2] IR down:   ', lightTextureValues[2].toFixed(2), 'W/m²',
        KtoC(IR_temp(lightTextureValues[2])).toFixed(2) + ' °C');
    console.log(
        '[3] IR up:     ', lightTextureValues[3].toFixed(2), 'W/m²',
        KtoC(IR_temp(lightTextureValues[3])).toFixed(2) + ' °C');
    console.log(
        'Net IR up:     ',
        (lightTextureValues[3] - lightTextureValues[2]).toFixed(2), 'W/m²');
  }

  var middleMousePressed = false;
  var leftMousePressed = false;
  var prevMouseX = 0;
  var prevMouseY = 0;
  var mouseX = 0;
  var mouseY = 0;
  var ctrlPressed = false;
  var bPressed = false;
  var leftPressed = false;
  var downPressed = false;
  var rightPressed = false;
  var upPressed = false;
  var plusPressed = false;
  var minusPressed = false;

  function changeViewZoom(mult) {
    viewZoom *= mult;

    let minZoom = 0.5;
    let maxZoom = 25.0 * sim_aspect;

    if (viewZoom > maxZoom) {
      viewZoom = maxZoom;
      return false;
    } else if (viewZoom < minZoom) {
      viewZoom = minZoom;
      return false;
    } else {
      return true;
    }
  }

  // EVENT LISTENERS

  window.addEventListener('wheel', function(event) {
    var delta = 0.1;
    if (event.deltaY > 0) delta *= -1;
    if (typeof lastWheel == 'undefined') lastWheel = 0;  // init static variable
    const now = new Date().getTime();

    if (bPressed) {
      guiControls.brushSize *= 1.0 + delta * 1.0;
      if (guiControls.brushSize < 1)
        guiControls.brushSize = 1;
      else if (guiControls.brushSize > 200)
        guiControls.brushSize = 200;
    } else {
      if (now - lastWheel > 20) {
        // change zoom
        lastWheel = now;

        if (changeViewZoom(1.0 + delta)) {
          // zoom center at mouse position
          var mousePositionZoomCorrectionX =
              (((mouseX - canvas.width / 2 + viewXpos) * delta) / viewZoom /
               canvas.width) *
              2.0;
          var mousePositionZoomCorrectionY =
              ((((mouseY - canvas.height / 2 + viewYpos) * delta) / viewZoom /
                canvas.height) *
               2.0) /
              canvas_aspect;
          viewXpos -= mousePositionZoomCorrectionX;
          viewYpos += mousePositionZoomCorrectionY;
        }
      }
    }
  });

  window.addEventListener('mousemove', function(event) {
    var rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;

    if (middleMousePressed) {
      // drag view position
      viewXpos = mod(
          viewXpos + ((mouseX - prevMouseX) / viewZoom / canvas.width) * 2.0,
          2.0);
      viewYpos -= ((mouseY - prevMouseY) / viewZoom / canvas.width) * 2.0;

      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  });

  canvas.addEventListener('mousedown', function(event) {
    if (event.button == 0) {
      leftMousePressed = true;
      if (SETUP_MODE) {
        startSimulation();
      }
    } else if (event.button == 1) {
      // middle mouse button
      middleMousePressed = true;
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  });

  window.addEventListener('mouseup', function(event) {
    if (event.button == 0) {
      leftMousePressed = false;
    } else if (event.button == 1) {
      // middle mouse button
      middleMousePressed = false;
    }
  });

  var lastBpressTime;

  document.addEventListener('keydown', (event) => {
    if (event.keyCode == 17 || event.keyCode == 91) {
      // ctrl or cmd on mac
      ctrlPressed = true;
    } else if (event.code == 'Space') {
      // space bar
      guiControls.paused = !guiControls.paused;
    } else if (event.code == 'KeyD') {
      // D
      guiControls.showDrops = !guiControls.showDrops;
    } else if (event.code == 'KeyB') {
      // B: scrolling to change brush size
      bPressed = true;
      if (new Date().getTime() - lastBpressTime < 300 &&
          guiControls.tool != 'TOOL_NONE')
        // double pressed B
        guiControls.wholeWidth =
            !guiControls.wholeWidth;  // toggle whole width brush

      // lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyV') {
      // V: reset view to full simulation area
      viewXpos = 0.0;
      viewYpos =
          -0.5 + sim_res_y / sim_res_x;  // match bottem to bottem of screen
      viewZoom = 1.0001;
    } else if (event.code == 'KeyG') {
      // G
      guiControls.showGraph = !guiControls.showGraph;
      hideOrShowGraph();
    } else if (event.code == 'KeyS') {
      // S: log sample at mouse location
      logSample();
      // number keys for displaymodes
    } else if (event.key == 1) {
      guiControls.displayMode = 'DISP_TEMPERATURE';
    } else if (event.key == 2) {
      guiControls.displayMode = 'DISP_WATER';
    } else if (event.key == 3) {
      guiControls.displayMode = 'DISP_REAL';
    } else if (event.key == 4) {
      guiControls.displayMode = 'DISP_HORIVEL';
    } else if (event.key == 5) {
      guiControls.displayMode = 'DISP_VERTVEL';
    } else if (event.key == 6) {
      guiControls.displayMode = 'DISP_IRHEATING';
    } else if (event.key == 7) {
      guiControls.displayMode = 'DISP_IRDOWNTEMP';
    } else if (event.key == 8) {
      guiControls.displayMode = 'DISP_IRUPTEMP';
    } else if (event.key == 'ArrowLeft') {
      leftPressed = true;  // <
    } else if (event.key == 'ArrowUp') {
      upPressed = true;  // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = true;  // >
    } else if (event.key == 'ArrowDown') {
      downPressed = true;  // v
    } else if (event.key == '=' || event.key == '+') {
      plusPressed = true;  // +
    } else if (event.key == '-') {
      minusPressed = true;  // -
    } else if (event.code == 'Backquote') {
      guiControls.tool = 'TOOL_NONE';
      guiControls.wholeWidth = false;  // flashlight can't be whole width
    } else if (event.code == 'KeyQ') {
      guiControls.tool = 'TOOL_TEMPERATURE';
    } else if (event.code == 'KeyW') {
      guiControls.tool = 'TOOL_WATER';
    } else if (event.code == 'KeyE') {
      guiControls.tool = 'TOOL_WALL_LAND';
    } else if (event.code == 'KeyR') {
      guiControls.tool = 'TOOL_WALL_SEA';
    } else if (event.code == 'KeyT') {
      guiControls.tool = 'TOOL_WALL_FIRE';
    } else if (event.code == 'KeyY') {
      guiControls.tool = 'TOOL_SMOKE';
    } else if (event.code == 'KeyU') {
      guiControls.tool = 'TOOL_WALL_MOIST';
    } else if (event.code == 'KeyI') {
      guiControls.tool = 'TOOL_VEGETATION';
    } else if (event.code == 'KeyO') {
      guiControls.tool = 'TOOL_WALL_SNOW';
    } else if (event.code == 'KeyP') {
      guiControls.tool = 'TOOL_WIND';
    } else if (event.key == 'PageUp') {
      adjIterPerFrame(1);
    } else if (event.code == 'PageDown') {
      adjIterPerFrame(-1);
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.keyCode == 17 || event.keyCode == 224) {
      ctrlPressed = false;
    } else if (event.code == 'KeyB') {
      bPressed = false;
      lastBpressTime = new Date().getTime();
    } else if (event.key == 'ArrowLeft') {
      leftPressed = false;  // <
    } else if (event.key == 'ArrowUp') {
      upPressed = false;  // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = false;  // >
    } else if (event.key == 'ArrowDown') {
      downPressed = false;  // v
    } else if (event.key == '=' || event.key == '+') {
      plusPressed = false;  // +
    } else if (event.key == '-') {
      minusPressed = false;  // -
    }
  });

  await loadingBar.set(9, 'Setting up WebGL');

  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  // gl.disable(gl.BLEND);
  // gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // load shaders
  var shaderFunctionsSource = loadSourceFile('shaders/shaderFunctions.glsl');
  var commonDisplaySource = loadSourceFile('shaders/commonDisplay.glsl');

  const simVertexShader = await loadShader('simShader.vert');
  const dispVertexShader = await loadShader('dispShader.vert');
  const realDispVertexShader = await loadShader('realDispShader.vert');
  const precipDisplayVertexShader =
      await loadShader('precipDisplayShader.vert');

  // const errorTest = loadShader("nonexisting.vert");

  const pressureShader = await loadShader('pressureShader.frag');
  const velocityShader = await loadShader('velocityShader.frag');
  const advectionShader = await loadShader('advectionShader.frag');
  const curlShader = await loadShader('curlShader.frag');
  const vorticityShader = await loadShader('vorticityShader.frag');
  const boundaryShader = await loadShader('boundaryShader.frag');

  const lightingShader = await loadShader('lightingShader.frag');

  const setupShader = await loadShader('setupShader.frag');

  const temperatureDisplayShader =
      await loadShader('temperatureDisplayShader.frag');
  const precipDisplayShader = await loadShader('precipDisplayShader.frag');
  const universalDisplayShader =
      await loadShader('universalDisplayShader.frag');
  const skyBackgroundDisplayShader =
      await loadShader('skyBackgroundDisplayShader.frag');
  const realisticDisplayShader =
      await loadShader('realisticDisplayShader.frag');
  const IRtempDisplayShader = await loadShader('IRtempDisplayShader.frag');

  // create programs
  const pressureProgram = createProgram(simVertexShader, pressureShader);
  const velocityProgram = createProgram(simVertexShader, velocityShader);
  const advectionProgram = createProgram(simVertexShader, advectionShader);
  const curlProgram = createProgram(simVertexShader, curlShader);
  const vorticityProgram = createProgram(simVertexShader, vorticityShader);
  const boundaryProgram = createProgram(simVertexShader, boundaryShader);

  const lightingProgram = createProgram(simVertexShader, lightingShader);

  const setupProgram = createProgram(simVertexShader, setupShader);

  const temperatureDisplayProgram =
      createProgram(dispVertexShader, temperatureDisplayShader);
  const precipDisplayProgram =
      createProgram(precipDisplayVertexShader, precipDisplayShader);
  const universalDisplayProgram =
      createProgram(dispVertexShader, universalDisplayShader);
  const skyBackgroundDisplayProgram =
      createProgram(realDispVertexShader, skyBackgroundDisplayShader);
  const realisticDisplayProgram =
      createProgram(realDispVertexShader, realisticDisplayShader);
  const IRtempDisplayProgram =
      createProgram(dispVertexShader, IRtempDisplayShader);

  await loadingBar.set(80, 'Setting up textures');

  // // quad that fills the screen, so fragment shader is run for every pixel //
  // X, Y,  U, V  (x4)

  // Don't ask me why, but the * 1.0000001 is nesesary to get exactly round half
  // ( x.5 ) fragcoordinates in the fragmentshaders I figured this out
  // experimentally. It took me days! Without it the linear interpolation would
  // get fucked up because of the tiny offsets
  const quadVertices = [
    // X, Y,  U, V
    1.0,
    -1.0,
    sim_res_x * 1.0000001,
    0.0,
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    sim_res_x * 1.0000001,
    sim_res_y * 1.0000001,
    -1.0,
    1.0,
    0.0,
    sim_res_y * 1.0000001,
  ];

  var fluidVao = gl.createVertexArray();  // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(fluidVao);
  var VertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, VertexBufferObject);
  gl.bufferData(
      gl.ARRAY_BUFFER, new Float32Array(quadVertices), gl.STATIC_DRAW);
  var positionAttribLocation = gl.getAttribLocation(
      pressureProgram,
      'vertPosition');  // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  var texCoordAttribLocation =
      gl.getAttribLocation(pressureProgram, 'vertTexCoord');  // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
      positionAttribLocation,  // Attribute location
      2,                       // Number of elements per attribute
      gl.FLOAT,                // Type of elements
      gl.FALSE,
      4 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      0  // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
      texCoordAttribLocation,  // Attribute location
      2,                       // Number of elements per attribute
      gl.FLOAT,                // Type of elements
      gl.FALSE,
      4 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT   // Offset from the beginning of a
                                           // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // Precipitation setup

  const precipitationVertexShader =
      await loadShader('precipitationShader.vert');
  const precipitationShader = await loadShader('precipitationShader.frag');
  const precipitationProgram = createProgram(
      precipitationVertexShader, precipitationShader,
      ['position_out', 'mass_out', 'density_out']);

  gl.useProgram(precipitationProgram);

  var dropPositionAttribLocation = 0;
  var massAttribLocation = 1;
  var densityAttribLocation = 2;

  var rainDrops = [];

  if (initialRainDrops) {
    rainDrops = initialRainDrops;
  } else {
    // generate droplets
    for (var i = 0; i < NUM_DROPLETS; i++) {
      // seperate push for each element is fastest
      rainDrops.push((Math.random() - 0.5) * 2.0);  // X
      rainDrops.push((Math.random() - 0.5) * 2.0);  // Y
      rainDrops.push(-10.0 + Math.random());        // water negative to disable
      rainDrops.push(Math.random());                // ice
      rainDrops.push(0.0);                          // density
    }
  }
  // console.log(NUM_DROPLETS);
  // console.log(rainDrops.length);
  // console.log(rainDrops);

  var precipitationVao_0 = gl.createVertexArray();
  gl.bindVertexArray(precipitationVao_0);
  var precipVertexBuffer_0 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(massAttribLocation);
  gl.enableVertexAttribArray(densityAttribLocation);
  gl.vertexAttribPointer(
      dropPositionAttribLocation,  // Attribute location
      2,                           // Number of elements per attribute
      gl.FLOAT,                    // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      0  // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
      massAttribLocation,  // Attribute location
      2,                   // Number of elements per attribute
      gl.FLOAT,            // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT   // Offset from the beginning of a
                                           // single vertex to this attribute
  );
  gl.vertexAttribPointer(
      densityAttribLocation,  // Attribute location
      1,                      // Number of elements per attribute
      gl.FLOAT,               // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT   // Offset from the beginning of a
                                           // single vertex to this attribute
  );
  const precipitationTF_0 = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_0);
  gl.bindBufferBase(
      gl.TRANSFORM_FEEDBACK_BUFFER, 0,
      precipVertexBuffer_0);  // this binds the default (id = 0)
  // TRANSFORM_FEEBACK buffer
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

  var precipitationVao_1 = gl.createVertexArray();
  gl.bindVertexArray(precipitationVao_1);
  var precipVertexBuffer_1 = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_1);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(massAttribLocation);
  gl.enableVertexAttribArray(densityAttribLocation);
  gl.vertexAttribPointer(
      dropPositionAttribLocation,  // Attribute location
      2,                           // Number of elements per attribute
      gl.FLOAT,                    // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      0  // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
      massAttribLocation,  // Attribute location
      2,                   // Number of elements per attribute
      gl.FLOAT,            // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT   // Offset from the beginning of a
                                           // single vertex to this attribute
  );
  gl.vertexAttribPointer(
      densityAttribLocation,  // Attribute location
      1,                      // Number of elements per attribute
      gl.FLOAT,               // Type of elements
      gl.FALSE,
      5 * Float32Array.BYTES_PER_ELEMENT,  // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT   // Offset from the beginning of a
                                           // single vertex to this attribute
  );
  const precipitationTF_1 = gl.createTransformFeedback();
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_1);
  gl.bindBufferBase(
      gl.TRANSFORM_FEEDBACK_BUFFER, 0,
      precipVertexBuffer_1);  // this binds the default (id = 0)
  // TRANSFORM_FEEBACK buffer
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);  // buffers are bound via VAO's

  var even = true;  // used to switch between precipitation buffers



  /*

  TEXTURE DESCRIPTIONS

  base texture:
  [0] = Horizontal velocity                              -1.0 to 1.0
  [1] = Vertical   velocity                              -1.0 to 1.0
  [2] = Pressure                                          >= 0
  [3] = Temperature in air, indicator in wall

  water texture:
  [0] = total water                                        >= 0
  [1] = cloud water                                        >= 0
  [2] = precipitation in air, moisture in surface          >= 0
  [3] = smoke/dust in air, snow in surface                 >= 0 for smoke/dust
  0 to 100 for snow

  wall texture:
  [0] walltype
  [1] manhattan distance to nearest wall                   0 to 127
  [2] height above/below ground. Surface = 0               -127 to 127
  [3] vegetation                                           0 to 100

  lighting texture:
  [0] sunlight                                             0 to 1.0
  [1] net heating effect of IR + sun absorbed by smoke
  [2] IR coming down                                       >= 0
  [3] IR going  up                                         >= 0

  */



  // Set up Textures

  const baseTexture_0 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      initialBaseTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const baseTexture_1 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      initialBaseTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const waterTexture_0 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      initialWaterTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const waterTexture_1 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      initialWaterTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const wallTexture_0 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER,
      gl.BYTE, initialWallTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  //  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const wallTexture_1 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER,
      gl.BYTE, initialWallTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Set up Framebuffers

  const frameBuff_0 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_0, 0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_0, 0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_0, 0);

  const frameBuff_1 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_1, 0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_1, 0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_1, 0);

  const curlTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, curlTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.R32F, sim_res_x, sim_res_y, 0, gl.RED, gl.FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const curlFrameBuff = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, curlTexture,
      0);  // attach the texture as the first color attachment

  const vortForceTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const vortForceFrameBuff = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vortForceTexture, 0);

  const lightTexture_0 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      null);  // HALF_FLOAT before, but problems with acuracy
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);  // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(
      gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
      gl.CLAMP_TO_EDGE);  // prevent light from shining trough at bottem or top
  const lightFrameBuff_0 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_0, 0);

  const lightTexture_1 = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);  // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(
      gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
      gl.CLAMP_TO_EDGE);  // prevent light from shing trough at bottem or top
  const lightFrameBuff_1 = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_1, 0);

  const precipitationFeedbackTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
      null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const precipitationFeedbackFrameBuff = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
  gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
      precipitationFeedbackTexture, 0);

  // load images
  imgElement = await loadImage('resources/noise_texture.jpg');
  const noiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,
  //     gl.REPEAT);  // default, so no need to set
  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
  //     gl.REPEAT);  // default, so no need to set

  imgElement = await loadImage('resources/forest.png');
  const forestTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, forestTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  imgElement = await loadImage('resources/forest_snow.png');
  const forestSnowTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, forestSnowTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  imgElement = await loadImage('resources/forestfire.png');
  const forestFireTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, forestFireTexture);
  gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var texelSizeX = 1.0 / sim_res_x;
  var texelSizeY = 1.0 / sim_res_y;

  var dryLapse = (guiControls.simHeight * guiControls.dryLapseRate) /
      1000.0;  // total lapse rate from bottem to top of atmosphere

  function CtoK(c) {
    return c + 273.15;
  }

  function realToPotentialT(realT, y) {
    return realT + (y / sim_res_y) * dryLapse;
  }

  function potentialToRealT(potentialT, y) {
    return potentialT - (y / sim_res_y) * dryLapse;
  }

  // generate Initial temperature profile

  var initial_T = new Float32Array(sim_res_y + 1);

  for (var y = 0; y < sim_res_y + 1; y++) {
    var realTemp = Math.max(
        map_range(y, 0, sim_res_y + 1, 15.0, -70.0),
        -60);  // almost standard atmosphere
    //	if (y < sim_res_y * 0.15) {
    //		realTemp = map_range(y, (sim_res_y + 1) * 0.15, 0, 4, 20);
    //	}

    // var realTemp = Math.max(map_range(y, 0, sim_res_y+1, 5.0, -65.0), -55.0);
    // // cold atmosphere if (y < sim_res_y * 0.45) { 	realTemp = map_range(y,
    // (sim_res_y+1) * 0.15, 0, -10, 5);
    // }

    // var realTemp = Math.max(map_range(y, 0, sim_res_y, 10.0, 10.0), 10.0);

    initial_T[y] =
        realToPotentialT(CtoK(realTemp), y);  // initial temperature profile
  }

  // Set uniforms
  gl.useProgram(setupProgram);
  gl.uniform2f(
      gl.getUniformLocation(setupProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(
      gl.getUniformLocation(setupProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'dryLapse'), dryLapse);
  gl.uniform1fv(gl.getUniformLocation(setupProgram, 'initial_T'), initial_T);

  gl.useProgram(advectionProgram);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wallTex'), 2);
  gl.uniform2f(
      gl.getUniformLocation(advectionProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform2f(
      gl.getUniformLocation(advectionProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform1fv(
      gl.getUniformLocation(advectionProgram, 'initial_T'), initial_T);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dryLapse'), dryLapse);

  gl.useProgram(pressureProgram);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'wallTex'), 1);
  gl.uniform2f(
      gl.getUniformLocation(pressureProgram, 'texelSize'), texelSizeX,
      texelSizeY);

  gl.useProgram(velocityProgram);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'wallTex'), 1);
  gl.uniform2f(
      gl.getUniformLocation(velocityProgram, 'texelSize'), texelSizeX,
      texelSizeY);

  gl.uniform1fv(gl.getUniformLocation(velocityProgram, 'initial_T'), initial_T);

  gl.useProgram(vorticityProgram);
  gl.uniform2f(
      gl.getUniformLocation(vorticityProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'curlTex'), 0);

  gl.useProgram(boundaryProgram);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'vortForceTex'), 2);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'wallTex'), 3);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'lightTex'), 4);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipFeedbackTex'), 5);
  gl.uniform2f(
      gl.getUniformLocation(boundaryProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(boundaryProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1f(
      gl.getUniformLocation(boundaryProgram, 'vorticity'),
      guiControls.vorticity);  // can be changed by GUI input
  gl.uniform1f(
      gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
      CtoK(guiControls.waterTemperature));  // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dryLapse'), dryLapse);
  gl.uniform1fv(gl.getUniformLocation(boundaryProgram, 'initial_T'), initial_T);

  gl.useProgram(curlProgram);
  gl.uniform2f(
      gl.getUniformLocation(curlProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(curlProgram, 'baseTex'), 0);

  gl.useProgram(lightingProgram);
  gl.uniform2f(
      gl.getUniformLocation(lightingProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(lightingProgram, 'texelSize'), texelSizeX,
      texelSizeY);

  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'lightTex'), 3);
  gl.uniform1f(gl.getUniformLocation(lightingProgram, 'dryLapse'), dryLapse);

  // Display programs:
  gl.useProgram(temperatureDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(temperatureDisplayProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(temperatureDisplayProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'wallTex'), 1);
  gl.uniform1f(
      gl.getUniformLocation(temperatureDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(precipDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(precipDisplayProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(precipDisplayProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'waterTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'wallTex'), 1);

  gl.useProgram(skyBackgroundDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(skyBackgroundDisplayProgram, 'resolution'),
      sim_res_x, sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(skyBackgroundDisplayProgram, 'texelSize'),
      texelSizeX, texelSizeY);

  gl.useProgram(universalDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(universalDisplayProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(universalDisplayProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'anyTex'), 0);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'wallTex'), 1);

  gl.useProgram(realisticDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(realisticDisplayProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(realisticDisplayProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'wallTex'), 1);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'waterTex'), 2);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'noiseTex'), 4);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'forestTex'), 5);
  gl.uniform1i(
      gl.getUniformLocation(realisticDisplayProgram, 'forestFireTex'), 6);
  gl.uniform1i(
      gl.getUniformLocation(realisticDisplayProgram, 'forestSnowTex'), 7);
  gl.uniform1f(
      gl.getUniformLocation(realisticDisplayProgram, 'dryLapse'), dryLapse);
  gl.useProgram(precipitationProgram);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'waterTex'), 1);
  gl.uniform2f(
      gl.getUniformLocation(precipitationProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(precipitationProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1f(
      gl.getUniformLocation(precipitationProgram, 'dryLapse'), dryLapse);
  gl.useProgram(IRtempDisplayProgram);
  gl.uniform2f(
      gl.getUniformLocation(IRtempDisplayProgram, 'resolution'), sim_res_x,
      sim_res_y);
  gl.uniform2f(
      gl.getUniformLocation(IRtempDisplayProgram, 'texelSize'), texelSizeX,
      texelSizeY);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'lightTex'), 0);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'wallTex'), 1);

  gl.useProgram(skyBackgroundDisplayProgram);
  gl.uniform1i(
      gl.getUniformLocation(skyBackgroundDisplayProgram, 'lightTex'), 3);

  // console.time('Set uniforms');
  setGuiUniforms();  // all uniforms changed by gui
                     // console.timeEnd('Set uniforms')

  gl.bindVertexArray(fluidVao);

  // if no save file was loaded
  // Use setup shader to set initial conditions
  if (initialWallTex == null) {
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.useProgram(setupProgram);
    // Render to both framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.drawBuffers(
        [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.drawBuffers(
        [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  updateSunlight('MANUAL_ANGLE');  // set angle from savefile

  if (!SETUP_MODE) {
    startSimulation();
  }

  await loadingBar.set(100, 'Loading complete');  // loading complete
  await loadingBar.remove();

  setInterval(calcFps, 1000);  // log fps

  requestAnimationFrame(draw);

  var srcVAO;
  var destVAO;
  var destTF;

  // preload uniform locations for tiny performance gain

  var uniformLocation_boundaryProgram_iterNum =
      gl.getUniformLocation(boundaryProgram, 'iterNum');

  function draw() {  // Runs for every frame
    if (leftPressed) {
      // <
      viewXpos = mod(viewXpos + 0.01 / viewZoom, 2.0);
    }
    if (upPressed) {
      // ^
      viewYpos -= 0.01 / viewZoom;
    }
    if (rightPressed) {
      // >
      viewXpos = mod(viewXpos - 0.01 / viewZoom, 2.0);
    }
    if (downPressed) {
      // v
      viewYpos += 0.01 / viewZoom;
    }
    if (plusPressed) {
      // +
      changeViewZoom(1.02);
    }
    if (minusPressed) {
      // -
      changeViewZoom(0.98);
    }

    prevMouseXinSim = mouseXinSim;
    prevMouseYinSim = mouseYinSim;

    var leftEdge = canvas.width / 2.0 - (canvas.width * viewZoom) / 2.0;
    var rightEdge = canvas.width / 2.0 + (canvas.width * viewZoom) / 2.0;
    mouseXinSim =
        map_range(mouseX, leftEdge, rightEdge, 0.0, 1.0) - viewXpos / 2.0;

    var topEdge =
        canvas.height / 2.0 - ((canvas.width / sim_aspect) * viewZoom) / 2.0;
    var bottemEdge =
        canvas.height / 2.0 + ((canvas.width / sim_aspect) * viewZoom) / 2.0;
    mouseYinSim = map_range(mouseY, bottemEdge, topEdge, 0.0, 1.0) -
        (viewYpos / 2.0) * sim_aspect;

    if (SETUP_MODE) {
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.useProgram(setupProgram);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'seed'), mouseXinSim);
      gl.uniform1f(
          gl.getUniformLocation(setupProgram, 'heightMult'),
          ((canvas.height - mouseY) / canvas.height) * 2.0);
      // Render to both framebuffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.drawBuffers(
          [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.drawBuffers(
          [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // NOT SETUP MODE:

      // gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(advectionProgram);

      var inputType = -1;
      if (leftMousePressed) {
        if (guiControls.tool == 'TOOL_NONE')
          inputType = 0;  // only flashlight on
        else if (guiControls.tool == 'TOOL_TEMPERATURE')
          inputType = 1;
        else if (guiControls.tool == 'TOOL_WATER')
          inputType = 2;
        else if (guiControls.tool == 'TOOL_SMOKE')
          inputType = 3;
        else if (guiControls.tool == 'TOOL_WIND')
          inputType = 4;
        else if (guiControls.tool == 'TOOL_WALL')
          inputType = 10;
        else if (guiControls.tool == 'TOOL_WALL_LAND')
          inputType = 11;
        else if (guiControls.tool == 'TOOL_WALL_SEA')
          inputType = 12;
        else if (guiControls.tool == 'TOOL_WALL_FIRE')
          inputType = 13;
        else if (guiControls.tool == 'TOOL_WALL_MOIST')
          inputType = 14;
        else if (guiControls.tool == 'TOOL_WALL_SNOW')
          inputType = 15;
        else if (guiControls.tool == 'TOOL_VEGETATION')
          inputType = 16;

        var intensity = guiControls.intensity;

        if (ctrlPressed) {
          intensity *= -1;
        }

        var posXinSim =
            mod(mouseXinSim, 1.0);  // wrap mouse position around borders

        if (guiControls.wholeWidth) {
          posXinSim = -1.0;
        }

        let moveX = mouseXinSim - prevMouseXinSim;
        let moveY = mouseYinSim - prevMouseYinSim;

        gl.uniform4f(
            gl.getUniformLocation(advectionProgram, 'userInputValues'),
            posXinSim, mouseYinSim, intensity, guiControls.brushSize * 0.5);
        gl.uniform2f(
            gl.getUniformLocation(advectionProgram, 'userInputMove'), moveX,
            moveY);
      }
      gl.uniform1i(
          gl.getUniformLocation(advectionProgram, 'userInputType'), inputType);

      if (!guiControls.paused) {  // Simulation part
        if (guiControls.dayNightCycle)
          updateSunlight(
              0.0001 *
              guiControls.IterPerFrame);  // increase solar time 0.00010

        gl.viewport(0, 0, sim_res_x, sim_res_y);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        for (var i = 0; i < guiControls.IterPerFrame; i++) {  // Simulation loop
          // calc and apply velocity
          gl.useProgram(velocityProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // calc curl
          gl.useProgram(curlProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
          gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // calculate vorticity
          gl.useProgram(vorticityProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curlTexture);
          gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // apply vorticity, boundary conditions and user input
          gl.useProgram(boundaryProgram);
          gl.uniform1f(uniformLocation_boundaryProgram_iterNum, IterNum);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
          gl.activeTexture(gl.TEXTURE3);
          gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
          gl.drawBuffers([
            gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2
          ]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // calc and apply advection
          gl.useProgram(advectionProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
          gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
          gl.drawBuffers([
            gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2
          ]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // calc and apply pressure
          gl.useProgram(pressureProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
          gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2]);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // calc light
          gl.useProgram(lightingProgram);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
          gl.activeTexture(gl.TEXTURE3);

          if (even) {
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);

            srcVAO = precipitationVao_0;
            destTF = precipitationTF_1;
            destVAO = precipitationVao_1;
          } else {
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);

            srcVAO = precipitationVao_1;
            destTF = precipitationTF_0;
            destVAO = precipitationVao_0;
          }
          even = !even;

          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);  // calc light
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          // move precipitation
          gl.useProgram(precipitationProgram);
          gl.uniform1f(
              gl.getUniformLocation(precipitationProgram, 'frameNum'), IterNum);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);  // add everything together
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.bindVertexArray(srcVAO);
          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, destTF);
          gl.beginTransformFeedback(gl.POINTS);
          gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
          gl.endTransformFeedback();

          // sample to count number of inactive droplets
          if (IterNum % 600 == 0) {
            gl.readBuffer(gl.COLOR_ATTACHMENT0);
            var sampleValues = new Float32Array(4);
            // console.time('cnt');
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sampleValues);
            // console.timeEnd('cnt')         // 1 - 100 ms huge variation
            // console.log(sampleValues[0]);  // number of inactive droplets
            guiControls.inactiveDroplets = sampleValues[0];
            gl.useProgram(precipitationProgram);
            gl.uniform1f(
                gl.getUniformLocation(precipitationProgram, 'inactiveDroplets'),
                sampleValues[0]);
          }



          gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
          gl.disable(gl.BLEND);
          gl.bindVertexArray(fluidVao);  // set screenfilling rect again
          IterNum++;
        }
      }  // end of simulation part

      if (guiControls.showGraph) {
        soundingGraph.draw(
            Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x))),
            Math.floor(mouseYinSim * sim_res_y));
      }
    }  // END OF NOT SETUP

    let cursorType = 1.0;  // normal circular brush
    if (guiControls.wholeWidth) {
      cursorType = 2.0;  // cursor whole width brush
    } else if (
        SETUP_MODE ||
        (inputType <= 0 && !bPressed && guiControls.tool == 'TOOL_NONE')) {
      cursorType = 0;  // cursor off sig
    }

    gl.useProgram(realisticDisplayProgram);

    if (cursorType != 0 && !sunIsUp) {
      // working at night
      gl.uniform1f(
          gl.getUniformLocation(realisticDisplayProgram, 'exposure'), 5.0);
    } else {
      gl.uniform1f(
          gl.getUniformLocation(realisticDisplayProgram, 'exposure'),
          guiControls.exposure);
    }

    if (inputType == 0) {
      // clicking while tool is set to flashlight(NONE)
      // enable flashlight
      cursorType += 0.55;
    }

    // render to canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);  // null is canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);  // background color
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);

    if (guiControls.displayMode == 'DISP_REAL') {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, forestTexture);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, forestFireTexture);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, forestSnowTexture);

      // draw background
      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(
          gl.getUniformLocation(skyBackgroundDisplayProgram, 'aspectRatios'),
          sim_aspect, canvas_aspect);
      gl.uniform3f(
          gl.getUniformLocation(skyBackgroundDisplayProgram, 'view'), viewXpos,
          viewYpos, viewZoom);
      // gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);  // draw to canvas

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // draw clouds
      gl.useProgram(realisticDisplayProgram);
      gl.uniform2f(
          gl.getUniformLocation(realisticDisplayProgram, 'aspectRatios'),
          sim_aspect, canvas_aspect);
      gl.uniform3f(
          gl.getUniformLocation(realisticDisplayProgram, 'view'), viewXpos,
          viewYpos, viewZoom);
      gl.uniform4f(
          gl.getUniformLocation(realisticDisplayProgram, 'cursor'), mouseXinSim,
          mouseYinSim, guiControls.brushSize * 0.5, cursorType);

      if (SETUP_MODE)
        gl.uniform1f(
            gl.getUniformLocation(realisticDisplayProgram, 'exposure'), 10.0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);  // draw to canvas

      if (guiControls.showDrops) {
        // draw drops over clouds
        // draw precipitation
        gl.useProgram(precipDisplayProgram);
        gl.uniform2f(
            gl.getUniformLocation(precipDisplayProgram, 'aspectRatios'),
            sim_aspect, canvas_aspect);
        gl.uniform3f(
            gl.getUniformLocation(precipDisplayProgram, 'view'), viewXpos,
            viewYpos, viewZoom);
        gl.bindVertexArray(destVAO);
        gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
        gl.bindVertexArray(fluidVao);  // set screenfilling rect again
      }
    } else {
      if (guiControls.displayMode == 'DISP_TEMPERATURE') {
        gl.useProgram(temperatureDisplayProgram);
        gl.uniform2f(
            gl.getUniformLocation(temperatureDisplayProgram, 'aspectRatios'),
            sim_aspect, canvas_aspect);
        gl.uniform3f(
            gl.getUniformLocation(temperatureDisplayProgram, 'view'), viewXpos,
            viewYpos, viewZoom);
        gl.uniform4f(
            gl.getUniformLocation(temperatureDisplayProgram, 'cursor'),
            mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
      } else if (guiControls.displayMode == 'DISP_IRDOWNTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(
            gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'),
            sim_aspect, canvas_aspect);
        gl.uniform3f(
            gl.getUniformLocation(IRtempDisplayProgram, 'view'), viewXpos,
            viewYpos, viewZoom);
        gl.uniform4f(
            gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim,
            mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(
            gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else if (guiControls.displayMode == 'DISP_IRUPTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(
            gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'),
            sim_aspect, canvas_aspect);
        gl.uniform3f(
            gl.getUniformLocation(IRtempDisplayProgram, 'view'), viewXpos,
            viewYpos, viewZoom);
        gl.uniform4f(
            gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim,
            mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(
            gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 1);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else {
        gl.useProgram(universalDisplayProgram);
        gl.uniform2f(
            gl.getUniformLocation(universalDisplayProgram, 'aspectRatios'),
            sim_aspect, canvas_aspect);
        gl.uniform3f(
            gl.getUniformLocation(universalDisplayProgram, 'view'), viewXpos,
            viewYpos, viewZoom);
        gl.uniform4f(
            gl.getUniformLocation(universalDisplayProgram, 'cursor'),
            mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);

        switch (guiControls.displayMode) {
          case 'DISP_HORIVEL':
            gl.uniform1i(
                gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'),
                0);
            gl.uniform1f(
                gl.getUniformLocation(
                    universalDisplayProgram, 'dispMultiplier'),
                10.0);  // 20.0
            break;
          case 'DISP_VERTVEL':
            gl.uniform1i(
                gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'),
                1);
            gl.uniform1f(
                gl.getUniformLocation(
                    universalDisplayProgram, 'dispMultiplier'),
                10.0);  // 20.0
            break;
          case 'DISP_WATER':
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.uniform1i(
                gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'),
                0);
            gl.uniform1f(
                gl.getUniformLocation(
                    universalDisplayProgram, 'dispMultiplier'),
                -0.06);  // negative number so positive amount is blue
            break;
          case 'DISP_IRHEATING':
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
            gl.uniform1i(
                gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'),
                1);
            gl.uniform1f(
                gl.getUniformLocation(
                    universalDisplayProgram, 'dispMultiplier'),
                50000.0);
            break;
        }
      }

      //	gl.bindTexture(gl.TEXTURE_2D, curlTexture);
      //	gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);  // draw to canvas
    }

    frameNum++;
    requestAnimationFrame(draw);
  }

  //////////////////////////////////////////////////////// functions:

  function hideOrShowGraph() {
    if (guiControls.showGraph) {
      soundingGraph.graphCanvas.style.display = 'block';
    } else {
      soundingGraph.graphCanvas.style.display = 'none';
    }
  }

  function updateSunlight(input) {
    if (input != 'MANUAL_ANGLE') {
      if (input != null) {
        guiControls.timeOfDay += input;  // day angle in degrees
        if (guiControls.timeOfDay >= 24.0) guiControls.timeOfDay = 0.0;
      }

      let timeOfDayRad =
          (guiControls.timeOfDay / 24.0) * 2.0 * Math.PI;  // convert to radians

      timeOfDayRad -= Math.PI / 2.0;

      let tiltDeg =
          Math.sin(guiControls.month * 0.5236 - 1.92) * 23.5;  // axis tilt
      let t = tiltDeg * degToRad;               // axis tilt in radians
      let l = guiControls.latitude * degToRad;  // latitude

      guiControls.sunAngle =
          Math.asin(
              Math.sin(t) * Math.sin(l) +
              Math.cos(t) * Math.cos(l) * Math.sin(timeOfDayRad)) *
          radToDeg;

      if (guiControls.latitude - tiltDeg < 0.0) {
        // If sun is to the north, flip angle
        guiControls.sunAngle = 180.0 - guiControls.sunAngle;
      }
    }
    let sunAngleForShaders = (guiControls.sunAngle - 90) *
        degToRad;  // Solar zenith angle centered around 0
    // Calculations visualized: https://www.desmos.com/calculator/kzr76zj5hq
    if (Math.abs(sunAngleForShaders) < 1.54) {
      sunIsUp = true;
    } else {
      sunIsUp = false;
    }

    //		console.log(sunAngleForShaders, sunIsUp);

    //	let sunIntensity = guiControls.sunIntensity *
    // Math.pow(Math.max(Math.sin((90.0 - Math.abs(guiControls.sunAngle)) *
    // degToRad) - 0.1, 0.0) * 1.111, 0.4);
    let sunIntensity = guiControls.sunIntensity *
        Math.pow(
            Math.max(Math.sin((180.0 - guiControls.sunAngle) * degToRad), 0.0),
            0.2);
    // console.log("sunIntensity: ", sunIntensity);

    gl.useProgram(boundaryProgram);
    gl.uniform1f(
        gl.getUniformLocation(boundaryProgram, 'sunAngle'), sunAngleForShaders);
    gl.useProgram(lightingProgram);
    gl.uniform1f(
        gl.getUniformLocation(lightingProgram, 'sunIntensity'), sunIntensity);
    gl.uniform1f(
        gl.getUniformLocation(lightingProgram, 'sunAngle'), sunAngleForShaders);
    gl.useProgram(realisticDisplayProgram);
    gl.uniform1f(
        gl.getUniformLocation(realisticDisplayProgram, 'sunAngle'),
        sunAngleForShaders);
  }

  async function prepareDownload() {
    var newFileName =
        prompt('Please enter a file name. Can not include \'.\'', saveFileName);

    if (newFileName != null) {
      if (newFileName != '' && !newFileName.includes('.')) {
        saveFileName = newFileName;

        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        let baseTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(
            0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, baseTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        let waterTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(
            0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT2);
        let wallTextureValues = new Int8Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(
            0, 0, sim_res_x, sim_res_y, gl.RGBA_INTEGER, gl.BYTE,
            wallTextureValues);

        let precipBufferValues =
            new ArrayBuffer(rainDrops.length * Float32Array.BYTES_PER_ELEMENT);
        gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
        gl.getBufferSubData(
            gl.ARRAY_BUFFER, 0, new Float32Array(precipBufferValues));
        gl.bindBuffer(gl.ARRAY_BUFFER, null);  // unbind again

        //	let settings = guiControls;

        let strGuiControls = JSON.stringify(guiControls);

        let saveDataArray = [
          Uint16Array.of(sim_res_x), Uint16Array.of(sim_res_y),
          baseTextureValues, waterTextureValues, wallTextureValues,
          precipBufferValues, strGuiControls
        ];
        let blob =
            new Blob(saveDataArray);  // combine everything into a single blob
        let arrBuff = await blob.arrayBuffer();  // turn into array
        let arr = new Uint8Array(arrBuff);
        let compressed = window.pako.deflate(arr);  // compress
        let compressedBlob =
            new Blob([Uint32Array.of(saveFileVersionID), compressed], {
              type: 'application/x-binary',
            });  // turn back into blob and add version id in front
        download(saveFileName + '.weathersandbox', compressedBlob);
      } else {
        alert('You didn\'t enter a valid file name!');
      }
    }
  }

  function createProgram(
      vertexShader, fragmentShader, transform_feedback_varyings) {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    if (transform_feedback_varyings != null)
      gl.transformFeedbackVaryings(
          program, transform_feedback_varyings, gl.INTERLEAVED_ATTRIBS);

    gl.linkProgram(program);
    gl.validateProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return program;  // linked succesfully
    } else {
      throw 'ERROR: ' + gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
    }
  }

  function loadSourceFile(fileName) {
    var request = new XMLHttpRequest();
    request.open('GET', fileName, false);
    request.send(null);
    if (request.status === 200)
      return request.responseText;
    else if (request.status === 404)
      throw 'File not found: ' + fileName;
    else
      throw 'File loading error' + request.status;
  }

  async function loadShader(nameIn) {
    const re = /(?:\.([^.]+))?$/;

    let extension = re.exec(nameIn)[1];  // extract file extension

    let shaderType;
    let type;

    if (extension == 'vert') {
      type = 'vertex';
      shaderType = gl.VERTEX_SHADER;
    } else if (extension == 'frag') {
      type = 'fragment';
      shaderType = gl.FRAGMENT_SHADER;
    } else {
      throw 'Invalid shadertype: ' + extension;
    }

    let filename = 'shaders/' + type + '/' + nameIn;

    var shaderSource = loadSourceFile(filename);
    if (shaderSource) {
      if (shaderSource.includes('#include functions')) {
        shaderSource =
            shaderSource.replace('#include functions', shaderFunctionsSource);
      }

      if (shaderSource.includes('#include "commonDisplay.glsl"')) {
        shaderSource = shaderSource.replace(
            '#include "commonDisplay.glsl"', commonDisplaySource);
      }

      const shader = gl.createShader(shaderType);
      gl.shaderSource(shader, shaderSource);
      // console.time('compileShader');
      gl.compileShader(shader);
      // console.timeEnd('compileShader')

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        // Compile error
        throw filename + ' COMPILATION ' + gl.getShaderInfoLog(shader);
      }
      return new Promise(async (resolve) => {
        await loadingBar.add(3, 'Loading shader: ' + nameIn);
        resolve(shader);
      });
    }
  }

  function adjIterPerFrame(adj) {
    guiControls.IterPerFrame =
        Math.round(Math.min(Math.max(guiControls.IterPerFrame + adj, 1), 50));
  }

  function isPageHidden() {
    return document.hidden || document.msHidden || document.webkitHidden ||
        document.mozHidden;
  }

  function calcFps() {
    if (!isPageHidden()) {
      var FPS = frameNum - lastFrameNum;
      lastFrameNum = frameNum;

      const fpsTarget = 60;

      if (guiControls.auto_IterPerFrame && !guiControls.paused) {
        console.log(
            FPS + ' FPS   ' + guiControls.IterPerFrame +
            ' Iterations / frame      ' + FPS * guiControls.IterPerFrame +
            ' Iterations / second');
        adjIterPerFrame(
            (FPS / fpsTarget - 1.0) * 5.0);  // example: ((30 / 60)-1.0) = -0.5

        if (FPS == fpsTarget) adjIterPerFrame(1);
      }
    }
  }
}  // end of mainscript
