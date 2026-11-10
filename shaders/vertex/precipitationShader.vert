#version 300 es
precision highp float;


layout(location = 0) in vec2 dropPosition;
layout(location = 1) in vec2 mass; //[0] water   [1] ice
layout(location = 2) in float density;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;

// via fragmentshader to feedback framebuffers for feedback to fluid
out vec4 feedback;
out vec2 deposition; // for rain and snow accumulation on surface

vec2 texCoord;
vec4 water;
vec4 base;
float realTemp;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D lightningDataTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform float iterNum;          // used as seed for random function
uniform float numDroplets;      // total number of droplets
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold;   // 0.0
uniform float spawnChanceMult;    //
uniform float snowDensity;        // 0.2 - 0.5
uniform float fallSpeed;          // 0.0003
uniform float growthRate0C;       // 0.0005
uniform float growthRate_30C;     // 0.01
uniform float freezingRate;       // 0.0002
uniform float meltingRate;        // 0.0015
uniform float evapRate;           // 0.0005

#include "common.glsl"

vec2 newPos;
vec2 newMass;
float newDensity;

bool isActive = true;
bool spawned = false; // spawned in this iteration
bool lightningSpawned = false;

void disableDroplet()
{
  newMass[WATER] = -2. - dropPosition.x; // disable droplet by making it negative and save position as seed for respawning
  newMass[ICE] = dropPosition.y;         // save position as seed for random function when respawning later
}

void main()
{
  feedback = vec4(0.0);
  deposition = vec2(0.0);
  newPos = dropPosition;
  newMass = mass;         // amount of water and ice carried
  newDensity = density;   // determines fall speed

  if (mass[WATER] < 0.) { // inactive
                          /*
                          We have to generate a random position before we know if the droplet is actually gonna spawn, seems ineffcient but there is no way arround it.
                          This is because spawn chance depends on the conditions at the spawn position, we have to sample the textures for every inactive droplet. this is a huge performance bottleneck
                       */

                          // generate random spawn position: x and y from 0. to 1.
    // texCoord = vec2(random(mass[WATER] + iterNum), random(mass[ICE] + iterNum)); func2D
    // texCoord = vec2(func2D(vec2(mass[WATER], dropPosition.x), iterNum * 0.3754), func2D(vec2(mass[ICE], dropPosition.x), iterNum * 0.073162));

    texCoord = vec2(
      random2d(vec2(mass[WATER] + float(gl_VertexID) * 0.00073, dropPosition.x + iterNum * 0.3754)),
      random2d(vec2(mass[ICE] + float(gl_VertexID) * 0.00119, dropPosition.x + iterNum * 0.073162))
    );

    // sample fluid at generated position
    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

#define initalMass 0.15                             // initial hydrometeor parcel mass
    // Smooth ice-nucleation threshold transition from warm collision-coalescence (> -2 C) to heterogeneous ice activation (< -22 C)
    float iceNucFactor = smoothstep(CtoK(-2.0), CtoK(-22.0), realTemp);
    float threshold = mix(aboveZeroThreshold, subZeroThreshold, iceNucFactor);

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 500.) { // if cloudwater above threshold and not wall

      float spawnChance = ((water[CLOUD] - threshold) / (inactiveDroplets + 10.0)) * resolution.x * resolution.y * spawnChanceMult;

      // Decorrelated per-particle, per-iteration random draw (fixes synchronous contour-band rain bursts)
      float nrmRand = random2d(vec2(mass[WATER] * 0.2324 + float(gl_VertexID) * 0.00137, iterNum * 0.1783 + mass[ICE] * 0.713));

      if (spawnChance > nrmRand) {                                       // spawn precipitation particle
        spawned = true;
        newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)

        if (realTemp < CtoK(0.0)) {                                      // below 0 C
          newMass[WATER] = 0.0;                                          // enable
          newMass[ICE] = initalMass;                                     // ice crystal / snow aggregate
          feedback[HEAT] += newMass[ICE] * meltingHeat;                  // latent heat of freezing
          newDensity = snowDensity;

          vec4 lightningData = texture(lightningDataTex, vec2(0.5)); // data from last lightning bolt

          const float lightningCloudDensityThreshold = 2.4;
          const float lightningChanceMultiplier = 0.0035;

          // Non-inductive graupel-ice charging peaks in the mixed-phase updraft zone (-5 C to -35 C)
          float mixedPhaseZone = smoothstep(CtoK(-1.0), CtoK(-7.0), realTemp) * smoothstep(CtoK(-44.0), CtoK(-28.0), realTemp);
          float updraftFactor = 1.0 + min(abs(base[VY]) * 8.0, 2.5);
          float cloudPlusPrecipDensity = water[CLOUD] + water[PRECIPITATION];

          float lightningSpawnChance = max((cloudPlusPrecipDensity - lightningCloudDensityThreshold) * lightningChanceMultiplier, 0.) * mixedPhaseZone * updraftFactor;

          const float minIterationsSinceLastLightningBolt = 30.;

          float lightningRand = random2d(vec2(float(gl_VertexID) * 0.0173 + base[TEMPERATURE] * 0.2324, iterNum * 0.317 + water[TOTAL] * 7.7));
          if (lightningData[START_ITERNUM] < iterNum - minIterationsSinceLastLightningBolt &&
              lightningRand < lightningSpawnChance) { // Spawn lightning
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;
            feedback.xy = texCoord;
            feedback[START_ITERNUM] = iterNum;
            feedback[INTENSITY] = clamp(cloudPlusPrecipDensity / 10.0 + (random2d(texCoord + vec2(iterNum * 0.01)) - 0.5), 0.05, 4.0);
            gl_Position = vec4(vec2(-1. + texelSize.x * 3., -1. + texelSize.y), 0.0, 1.0); // render to bottom-left corner (1, 0)
          }
        } else {
          newMass[WATER] = initalMass; // warm-cloud raindrop
          newMass[ICE] = 0.0;
          newDensity = 1.0;
        }
        if (!lightningSpawned) {
          feedback[VAPOR] -= initalMass;
        }
      }
    }

    if (spawned) {
      if (!lightningSpawned) {
        gl_PointSize = 1.0;
        gl_Position = vec4(newPos, 0.0, 1.0);
      }
    } else { // still inactive
      isActive = false;
      gl_PointSize = 1.0;
      feedback[MASS] = 1.0;                                                     // count 1 inactive droplet
      gl_Position = vec4(vec2(-1. + texelSize.x, -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (0, 0) to count inactive droplets
                                                                                // return;
    }
  }

  if (isActive) {
    if (!spawned) {                               // these values are already set if the droplet just spawned
      texCoord = vec2(dropPosition.x / 2. + 0.5,
                      dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
      water = texture(waterTex, texCoord);
      base = texture(baseTex, texCoord);
      realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin
    }

    float relativeHumidity = relativeHumd(realTemp, water[TOTAL]);

    float totalMass = newMass[WATER] + newMass[ICE];

    if (totalMass < 0.04) { // to small
                            // evaporation of residual droplet
      feedback[HEAT] = -(totalMass * evapHeat);
      feedback[VAPOR] = totalMass;

      disableDroplet();

    } else if (newPos.y < -1.0 /* || base[TEMPERATURE] > 500. */ || water[TOTAL] > 1000.) { // water[TOTAL] > 1000.     base[TEMPERATURE] < 500.      to low or wall

      if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[TEMPERATURE] > 500.) // if above cell was already wall. because of fast fall speed
        newPos.y += texelSize.y * 1.;                                                       // *2. ? move position up so that the water/snow is correcty added to the ground

      deposition[RAIN_DEPOSITION] = newMass[WATER];                                         // rain accumulation
      deposition[SNOW_DEPOSITION] = newMass[ICE];                                           // snow accumulation

      disableDroplet();

    } else { // update droplet

      float surfaceArea = pow(totalMass, 1. / 3.); // 3D spherical/equivalent-volume cross-section

      float tempC = KtoC(realTemp);
      float growthRate = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C);

      // Bergeron-Findeisen dendritic crystal growth peak around -15 C (-12 C to -18 C)
      float dendriticPeak = 1.0 + 0.40 * exp(-pow((tempC + 15.0) / 5.5, 2.0));
      if (realTemp < CtoK(0.0)) {
        growthRate *= dendriticPeak;
      }

      float growth = water[CLOUD] * growthRate * surfaceArea;

      growth += max(relativeHumidity - 1.0, 0.) * max(-30.0 - tempC, 0.) * 0.0001; // homogeneous ice deposition below -30 C

      // Riming & Graupel / Hail growth in supercooled liquid updrafts:
      // Snow aggregates encountering supercooled droplets rime into denser graupel and eventually solid hailstones
      float supercooledLiquid = water[CLOUD] * (1.0 - cloudIceFraction(realTemp));
      if (realTemp < CtoK(0.0) && supercooledLiquid > 0.25) {
        float rimeDensification = (supercooledLiquid - 0.25) * 0.0022 * surfaceArea;
        newDensity = min(newDensity + rimeDensification, 1.0);
        if (newDensity > 0.65) {
          growth += surfaceArea * (supercooledLiquid * 0.0010 + water[PRECIPITATION] * 0.0022);
        }
      }

      growth = min(growth, max(water[CLOUD] * 0.45, 0.0)); // never deplete more than local available cloud condensate

      feedback[VAPOR] -= growth; // accretes cloud water


      if (realTemp < CtoK(0.0)) { // below freezing

        newMass[ICE] += growth;   // ice growth
        feedback[HEAT] += growth * meltingHeat;

        float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // supercooled rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        if (freezing > 0.0) {
          newDensity = mix(newDensity, 0.92, clamp(freezing / max(totalMass, 0.05), 0.0, 1.0)); // frozen raindrops form dense sleet/hail embryos
        }
        feedback[HEAT] += freezing * meltingHeat;

      } else {                                                                                   // above freezing
        newMass[WATER] += growth;                                                                // warm collision-coalescence growth

        float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea, newMass[ICE]);   // snow / graupel / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases toward liquid water (1.0) as snow melts
      }

      float dropletTemp = realTemp;

      if (newMass[ICE] > 0.0)                      // melting ice surface stays pinned at 0 C
        dropletTemp = min(dropletTemp, CtoK(0.0));

      // Sub-cloud evaporation & sublimation with Beard-Pruppacher fall-ventilation enhancement (produces virga & cold-pool downdrafts)
      float ambientVapor = max(water[TOTAL] - water[CLOUD], 0.0);
      float satAtDrop = (newMass[ICE] > newMass[WATER]) ? maxWaterMixed(dropletTemp) : maxWater(dropletTemp);
      float ventilation = 1.0 + 0.30 * pow(totalMass, 0.25) * newDensity;
      float evapAndSubli = max((satAtDrop - ambientVapor) * surfaceArea * evapRate * ventilation, 0.);

      float evap = min(newMass[WATER], evapAndSubli);       // evaporate liquid coat first
      float subli = min(newMass[ICE], (evapAndSubli - evap) * 0.65); // ice sublimates slightly slower due to higher latent heat

      newMass[WATER] -= evap;
      newMass[ICE] -= subli;

      feedback[VAPOR] += evap + subli;
      feedback[HEAT] -= evap * evapHeat;
      feedback[HEAT] -= subli * (evapHeat + meltingHeat);

      // Update position with smooth bilinear wind interpolation and physical terminal-velocity asymptotes
      vec2 smoothWind = bilerp(baseTex, texCoord * resolution).xy;
      newPos += smoothWind / resolution * 2.;

      // Liquid raindrops flatten aerodynamically and asymptote around ~9 m/s; solid hailstones continue accelerating with sqrt(D)
      float rawSizeSpeed = sqrt(max(totalMass, 0.01) / max(surfaceArea, 0.01));
      float iceMassRatio = newMass[ICE] / max(newMass[WATER] + newMass[ICE], 0.001);
      float maxTermFactor = mix(1.45, 2.35, iceMassRatio);
      float termFactor = min(rawSizeSpeed, maxTermFactor);

      newPos.y -= fallSpeed * newDensity * termFactor;
      /*
       // falling at fixed speed:
      float cellHeight = texelSize.y * 12000.0; // in meters
      float realSecPerIter = 0.288;
      float metersPerSec = 6.0;
      float cellsPerSec = metersPerSec / cellHeight;
      float cellsPerIter = cellsPerSec * realSecPerIter;
      newPos.y -= cellsPerIter * 2. * texelSize.y;
      */

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      feedback[MASS] = totalMass;

    }               // update

#define pntSize 12. // 16.
    const float pntSurface = pntSize * pntSize;
    // devide by suface area to keep total amount constant
    feedback[MASS] /= pntSurface;
    feedback[HEAT] /= pntSurface;
    feedback[VAPOR] /= pntSurface;

    deposition[RAIN_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer
    deposition[SNOW_DEPOSITION] /= pntSize; // only width matters because it's only applied at surface layer

    gl_PointSize = pntSize;

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
}