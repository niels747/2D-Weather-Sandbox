/*
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.
*/

(() => {
  'use strict';

  const TILE_SIZE = 256;
  const MAX_MERCATOR_LAT = 85.05112878;
  const EARTH_RADIUS_M = 6371008.8;
  const TERRARIUM_ENDPOINTS = [
    'https://elevation-tiles-prod-eu.s3.eu-central-1.amazonaws.com/terrarium/{z}/{x}/{y}.png',
    'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  ];

  window.realWorldTerrain = {
    enabled : false,
    elevations : null,
    distanceMeters : 0,
    baseAltitude : 0,
    seaLevel : 0,
    seaAsWater : true,
    start : null,
    end : null,
    zoom : null,
    source : 'Mapzen/Tilezen Terrain Tiles (AWS Open Data)',
  };

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  function toRad(deg) { return deg * Math.PI / 180; }

  function normalizeLongitude(lon)
  {
    return ((lon + 540) % 360) - 180;
  }

  function shortestLongitudeDelta(startLon, endLon)
  {
    return normalizeLongitude(endLon - startLon);
  }

  function haversineDistance(lat1, lon1, lat2, lon2)
  {
    const p1 = toRad(lat1);
    const p2 = toRad(lat2);
    const dp = toRad(lat2 - lat1);
    const dl = toRad(shortestLongitudeDelta(lon1, lon2));
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function interpolateCoordinate(start, end, t)
  {
    const lonDelta = shortestLongitudeDelta(start.lon, end.lon);
    return {
      lat : start.lat + (end.lat - start.lat) * t,
      lon : normalizeLongitude(start.lon + lonDelta * t),
    };
  }

  function lonLatToTilePixel(latIn, lonIn, zoom)
  {
    const lat = clamp(latIn, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
    const lon = normalizeLongitude(lonIn);
    const n = 2 ** zoom;
    const xFloat = ((lon + 180) / 360) * n;
    const latRad = toRad(lat);
    const yFloat = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) * 0.5 * n;
    const x = ((Math.floor(xFloat) % n) + n) % n;
    const y = clamp(Math.floor(yFloat), 0, n - 1);
    return {
      x,
      y,
      px : clamp(Math.floor((xFloat - Math.floor(xFloat)) * TILE_SIZE), 0, TILE_SIZE - 1),
      py : clamp(Math.floor((yFloat - Math.floor(yFloat)) * TILE_SIZE), 0, TILE_SIZE - 1),
    };
  }

  function metersPerPixel(latitude, zoom)
  {
    return 156543.03392804097 * Math.cos(toRad(latitude)) / (2 ** zoom);
  }

  function chooseZoom(meanLatitude, targetMeters)
  {
    let zoom = 0;
    for (let z = 0; z <= 14; z++) {
      zoom = z;
      if (metersPerPixel(meanLatitude, z) <= targetMeters * 0.8)
        break;
    }
    return clamp(zoom, 5, 14);
  }

  function decodeTerrarium(r, g, b)
  {
    return (r * 256 + g + b / 256) - 32768;
  }

  function tileUrl(template, z, x, y)
  {
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  }

  async function fetchTile(z, x, y)
  {
    let lastError = null;
    for (const endpoint of TERRARIUM_ENDPOINTS) {
      const url = tileUrl(endpoint, z, x, y);
      try {
        const response = await fetch(url, {mode : 'cors'});
        if (!response.ok)
          throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext('2d', {willReadFrequently : true});
        ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
        bitmap.close?.();
        return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Could not load terrain tile ${z}/${x}/${y}: ${lastError?.message || 'unknown error'}`);
  }

  function resampleLinear(values, outputLength)
  {
    if (!values || values.length === 0)
      return new Float32Array(outputLength);
    if (values.length === outputLength)
      return Float32Array.from(values);
    if (outputLength <= 1)
      return new Float32Array([ values[0] ]);

    const out = new Float32Array(outputLength);
    const maxIn = values.length - 1;
    for (let i = 0; i < outputLength; i++) {
      const pos = (i / (outputLength - 1)) * maxIn;
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, maxIn);
      const f = pos - lo;
      out[i] = values[lo] * (1 - f) + values[hi] * f;
    }
    return out;
  }

  window.getRealWorldTerrainProfile = function(outputLength)
  {
    const terrain = window.realWorldTerrain;
    if (!terrain?.enabled || !terrain.elevations)
      return null;
    return resampleLinear(terrain.elevations, outputLength);
  };

  function suggestedBaseAltitude(minElevation)
  {
    if (minElevation > 1000)
      return Math.max(0, Math.floor((minElevation - 500) / 100) * 100);
    return 0;
  }

  function formatDistance(m)
  {
    if (m >= 1000)
      return `${(m / 1000).toFixed(1)} km`;
    return `${m.toFixed(0)} m`;
  }

  function setStatus(text, isError = false)
  {
    const el = document.getElementById('terrainImportStatus');
    if (!el)
      return;
    el.textContent = text;
    el.style.color = isError ? '#ff8a8a' : '#d7e8ff';
  }

  function drawProfile(profile, baseAltitude, seaAsWater)
  {
    const canvas = document.getElementById('terrainProfilePreview');
    if (!canvas || !profile || profile.length < 2)
      return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(Math.floor(rect.width), 300);
    const cssHeight = 220;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    let min = Infinity;
    let max = -Infinity;
    for (const e of profile) {
      min = Math.min(min, e);
      max = Math.max(max, e);
    }

    const floor = Math.min(baseAltitude, seaAsWater ? Math.min(0, min) : min);
    const verticalSpan = Math.max(max - floor, 100);
    const top = max + verticalSpan * 0.12;
    const bottom = floor - verticalSpan * 0.05;
    const plotLeft = 48;
    const plotRight = cssWidth - 14;
    const plotTop = 15;
    const plotBottom = cssHeight - 32;

    const yOf = elev => plotBottom - ((elev - bottom) / (top - bottom)) * (plotBottom - plotTop);
    const xOf = i => plotLeft + (i / (profile.length - 1)) * (plotRight - plotLeft);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const seaY = yOf(0);
    if (seaY >= plotTop && seaY <= plotBottom) {
      ctx.strokeStyle = 'rgba(90, 175, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotLeft, seaY);
      ctx.lineTo(plotRight, seaY);
      ctx.stroke();
      ctx.fillStyle = '#8cc8ff';
      ctx.font = '12px Arial';
      ctx.fillText('0 m', 8, seaY + 4);
    }

    ctx.beginPath();
    ctx.moveTo(plotLeft, plotBottom);
    for (let i = 0; i < profile.length; i++)
      ctx.lineTo(xOf(i), yOf(Math.max(profile[i], seaAsWater ? 0 : -Infinity)));
    ctx.lineTo(plotRight, plotBottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(137, 102, 63, 0.72)';
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
      const x = xOf(i);
      const y = yOf(profile[i]);
      if (i === 0)
        ctx.moveTo(x, y);
      else
        ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f0d6a9';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText(`${Math.round(max)} m`, 6, plotTop + 12);
    ctx.fillText(`${Math.round(min)} m`, 6, plotBottom - 2);
    ctx.fillText('START', plotLeft, cssHeight - 10);
    const endText = 'END';
    ctx.fillText(endText, plotRight - ctx.measureText(endText).width, cssHeight - 10);
  }

  async function loadRealTerrain()
  {
    const getNumber = id => Number.parseFloat(document.getElementById(id).value);
    const start = {lat : getNumber('terrainStartLat'), lon : getNumber('terrainStartLon')};
    const end = {lat : getNumber('terrainEndLat'), lon : getNumber('terrainEndLon')};

    if (![ start.lat, start.lon, end.lat, end.lon ].every(Number.isFinite)) {
      setStatus('Enter valid numeric coordinates first.', true);
      return;
    }
    if (Math.abs(start.lat) > 90 || Math.abs(end.lat) > 90 || Math.abs(start.lon) > 180 || Math.abs(end.lon) > 180) {
      setStatus('Latitude must be -90…90 and longitude -180…180.', true);
      return;
    }

    const distanceMeters = haversineDistance(start.lat, start.lon, end.lat, end.lon);
    if (distanceMeters < 500) {
      setStatus('Transect is too short. Pick endpoints at least 500 m apart.', true);
      return;
    }

    const simHeight = Number.parseInt(document.getElementById('simHeightSel').value, 10);
    const simResY = Number.parseInt(document.getElementById('simResSelY').value, 10);
    const cellHeight = simHeight / simResY;
    const fitWidth = document.getElementById('terrainFitWidth').checked;

    if (fitWidth) {
      const desiredX = clamp(Math.round((distanceMeters / cellHeight) / 100) * 100, 100, 16000);
      document.getElementById('simResSelX').value = desiredX;
      updateSetupSliders();
    }

    const simResX = Number.parseInt(document.getElementById('simResSelX').value, 10);
    const sampleCount = clamp(Math.max(simResX, 512), 512, 16000);
    const meanLat = (start.lat + end.lat) * 0.5;
    const targetHorizontalMeters = Math.max(distanceMeters / Math.max(sampleCount - 1, 1), cellHeight * 0.5);
    const zoom = chooseZoom(meanLat, targetHorizontalMeters);

    const points = new Array(sampleCount);
    const tileKeys = new Map();
    for (let i = 0; i < sampleCount; i++) {
      const p = interpolateCoordinate(start, end, i / (sampleCount - 1));
      const tile = lonLatToTilePixel(p.lat, p.lon, zoom);
      points[i] = tile;
      tileKeys.set(`${tile.x}/${tile.y}`, tile);
    }

    setStatus(`Loading ${tileKeys.size} elevation tile${tileKeys.size === 1 ? '' : 's'} at zoom ${zoom}…`);

    try {
      const tiles = new Map();
      let loaded = 0;
      const entries = Array.from(tileKeys.entries());
      const concurrency = 8;
      let nextIndex = 0;

      async function worker()
      {
        while (nextIndex < entries.length) {
          const index = nextIndex++;
          const [ key, tile ] = entries[index];
          const data = await fetchTile(zoom, tile.x, tile.y);
          tiles.set(key, data);
          loaded++;
          setStatus(`Loading terrain… ${loaded}/${entries.length} tiles`);
        }
      }

      await Promise.all(Array.from({length : Math.min(concurrency, entries.length)}, () => worker()));

      const elevations = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        const p = points[i];
        const data = tiles.get(`${p.x}/${p.y}`);
        const pixelIndex = (p.py * TILE_SIZE + p.px) * 4;
        const alpha = data[pixelIndex + 3];
        let elevation = decodeTerrarium(data[pixelIndex], data[pixelIndex + 1], data[pixelIndex + 2]);
        if (alpha === 0 || elevation < -12000 || elevation > 10000)
          elevation = i > 0 ? elevations[i - 1] : 0;
        elevations[i] = elevation;
      }

      let min = Infinity;
      let max = -Infinity;
      for (const e of elevations) {
        min = Math.min(min, e);
        max = Math.max(max, e);
      }

      const autoBase = document.getElementById('terrainAutoBase').checked;
      const baseInput = document.getElementById('terrainBaseAltitude');
      if (autoBase)
        baseInput.value = suggestedBaseAltitude(min);
      const baseAltitude = Number.parseFloat(baseInput.value) || 0;
      const seaAsWater = document.getElementById('terrainSeaAsWater').checked;
      const seaLevel = Number.parseFloat(document.getElementById('terrainSeaLevel').value) || 0;

      window.realWorldTerrain = {
        enabled : true,
        elevations,
        distanceMeters,
        baseAltitude,
        seaLevel,
        seaAsWater,
        start,
        end,
        zoom,
        minElevation : min,
        maxElevation : max,
        source : 'Mapzen/Tilezen Terrain Tiles (AWS Open Data)',
      };

      document.getElementById('terrainEnable').checked = true;
      drawProfile(elevations, baseAltitude, seaAsWater);

      const actualCellWidth = (simHeight / simResY) * simResX;
      const widthWarning = Math.abs(actualCellWidth - distanceMeters) / distanceMeters > 0.08
        ? ` Simulation width is ${formatDistance(actualCellWidth)}, so the profile will be rescaled.`
        : '';
      const clipWarning = max - baseAltitude > simHeight * 0.96
        ? ' WARNING: the highest terrain is near/above the model top. Raise Simulation height or base altitude.'
        : '';
      setStatus(`Loaded ${formatDistance(distanceMeters)}. Elevation ${Math.round(min)}…${Math.round(max)} m. Base ${Math.round(baseAltitude)} m ASL.${widthWarning}${clipWarning}`);
    } catch (error) {
      console.error(error);
      setStatus(`Terrain download failed: ${error.message}`, true);
      window.realWorldTerrain.enabled = false;
    }
  }

  function createTerrainPanel()
  {
    const intro = document.getElementById('IntroScreen');
    const startForm = document.getElementById('startBtn');
    if (!intro || !startForm || document.getElementById('realTerrainPanel'))
      return;

    const style = document.createElement('style');
    style.textContent = `
      #realTerrainPanel { margin: 28px 0; padding: 20px; max-width: 1120px; background: rgba(12, 27, 45, 0.74); border: 1px solid rgba(140, 195, 255, 0.35); border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
      #realTerrainPanel h2 { margin: 0 0 8px; }
      #realTerrainPanel .terrain-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px 14px; align-items: end; }
      #realTerrainPanel label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
      #realTerrainPanel input[type='number'] { min-height: 36px; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25); background: rgba(0,0,0,.35); color: white; font-size: 16px; box-sizing: border-box; width: 100%; }
      #realTerrainPanel .terrain-options { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; margin: 14px 0; }
      #realTerrainPanel .terrain-options label { flex-direction: row; align-items: center; gap: 7px; }
      #terrainLoadButton, #terrainSwapButton { min-height: 40px; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); color: white; background: rgba(45, 112, 180, .75); cursor: pointer; font-size: 15px; }
      #terrainSwapButton { background: rgba(255,255,255,.10); }
      #terrainProfilePreview { display: block; width: 100%; max-width: 1050px; height: 220px; margin-top: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: rgba(0,0,0,.25); }
      #terrainImportStatus { margin: 10px 0 0; min-height: 20px; }
      #realTerrainPanel .terrain-attrib { opacity: .72; font-size: 12px; margin-top: 8px; }
      #realTerrainPanel .terrain-attrib a { color: #9fd0ff; }
      @media (max-width: 760px) { #realTerrainPanel .terrain-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); } }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'realTerrainPanel';
    panel.innerHTML = `
      <h2>🗺️ Real-world terrain cross-section</h2>
      <p>Pick two coordinates. The sandbox downloads a real bare-earth elevation profile between them and uses it as the model terrain.</p>
      <div class="terrain-grid">
        <label>Start latitude<input id="terrainStartLat" type="number" min="-90" max="90" step="0.0001" value="50.8503"></label>
        <label>Start longitude<input id="terrainStartLon" type="number" min="-180" max="180" step="0.0001" value="4.3517"></label>
        <label>End latitude<input id="terrainEndLat" type="number" min="-90" max="90" step="0.0001" value="50.4500"></label>
        <label>End longitude<input id="terrainEndLon" type="number" min="-180" max="180" step="0.0001" value="5.7500"></label>
      </div>
      <div class="terrain-options">
        <label><input id="terrainEnable" type="checkbox"> Use loaded terrain</label>
        <label><input id="terrainFitWidth" type="checkbox" checked> Fit simulation width to transect</label>
        <label><input id="terrainAutoBase" type="checkbox" checked> Auto base altitude</label>
        <label><input id="terrainSeaAsWater" type="checkbox" checked> Elevation ≤ sea level becomes water</label>
        <label>Base altitude (m ASL) <input id="terrainBaseAltitude" type="number" step="50" value="0" style="width:100px"></label>
        <label>Sea level (m ASL) <input id="terrainSeaLevel" type="number" step="1" value="0" style="width:90px"></label>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="terrainLoadButton" type="button">Load real terrain</button>
        <button id="terrainSwapButton" type="button">↔ Swap endpoints</button>
      </div>
      <p id="terrainImportStatus">No terrain loaded. Procedural terrain will be used.</p>
      <canvas id="terrainProfilePreview" aria-label="Real-world terrain elevation profile preview"></canvas>
      <div class="terrain-attrib">Elevation data: Mapzen/Tilezen Terrain Tiles via the AWS Open Data Registry. Bare-earth DEM assembled from sources including SRTM/GMTED/NED/ETOPO1.</div>
    `;

    intro.insertBefore(panel, startForm);

    document.getElementById('terrainLoadButton').addEventListener('click', loadRealTerrain);
    document.getElementById('terrainSwapButton').addEventListener('click', () => {
      const pairs = [ [ 'terrainStartLat', 'terrainEndLat' ], [ 'terrainStartLon', 'terrainEndLon' ] ];
      for (const [ a, b ] of pairs) {
        const aEl = document.getElementById(a);
        const bEl = document.getElementById(b);
        const temp = aEl.value;
        aEl.value = bEl.value;
        bEl.value = temp;
      }
    });
    document.getElementById('terrainEnable').addEventListener('change', event => {
      if (window.realWorldTerrain.elevations)
        window.realWorldTerrain.enabled = event.target.checked;
      else
        event.target.checked = false;
    });
    document.getElementById('terrainBaseAltitude').addEventListener('change', event => {
      if (window.realWorldTerrain.elevations) {
        window.realWorldTerrain.baseAltitude = Number.parseFloat(event.target.value) || 0;
        drawProfile(window.realWorldTerrain.elevations, window.realWorldTerrain.baseAltitude, window.realWorldTerrain.seaAsWater);
      }
    });
    document.getElementById('terrainSeaAsWater').addEventListener('change', event => {
      if (window.realWorldTerrain.elevations) {
        window.realWorldTerrain.seaAsWater = event.target.checked;
        drawProfile(window.realWorldTerrain.elevations, window.realWorldTerrain.baseAltitude, window.realWorldTerrain.seaAsWater);
      }
    });
    document.getElementById('terrainSeaLevel').addEventListener('change', event => {
      if (window.realWorldTerrain.elevations)
        window.realWorldTerrain.seaLevel = Number.parseFloat(event.target.value) || 0;
    });
  }

  document.addEventListener('DOMContentLoaded', createTerrainPanel);
})();
