#version 300 es
precision highp float;


in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

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
uniform sampler2D lightningLocationTex;

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

    texCoord = vec2(random2d(vec2(mass[WATER], dropPosition.x + iterNum * 0.3754)), random2d(vec2(mass[ICE], dropPosition.x + iterNum * 0.073162)));


    // sample fluid at generated position
    base = texture(baseTex, texCoord);
    water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    realTemp = potentialToRealT(base[TEMPERATURE]); // in Kelvin

#define initalMass 0.15                             // 0.05 initial droplet mass
    float threshold;                                // minimal cloudwater before precipitation develops
    if (realTemp > CtoK(0.0))
      threshold = aboveZeroThreshold;               // in above freezing conditions coalescence only happens in really dense clouds
    else                                            // the colder it gets, the faster ice starts to form
      //  treshHold = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), subZeroThreshold, initalMass), initalMass);
      threshold = subZeroThreshold;

    if (water[CLOUD] > threshold && base[TEMPERATURE] < 500.) {                                                                     // if cloudwater above threshold and not wall
                                                                                                                                    // float spawnChance = (water[1] - threshold) * 1000.0 / inactiveDroplets;
                                                                                                                                    // if (spawnChance > rand2d(mass.xy)) {
                                                                                                                                    //  float spawnChance = (water[CLOUD] - threshold) / inactiveDroplets * resolution.x * resolution.y * spawnChanceMult;

      float spawnChance = ((water[CLOUD] - threshold) / (inactiveDroplets + 10.0)) * resolution.x * resolution.y * spawnChanceMult; // 20.0  50.0

      //    float nrmRand = random2d(vec2(mass[WATER] * 0.2324, iterNum * 0.1783 + random(mass[ICE]))); // normalized random value

      float nrmRand = fract(pow(water[CLOUD] * 10.0, 2.0));

      if (spawnChance > nrmRand) {                                       // spawn
        spawned = true;
        newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)

        if (realTemp < CtoK(0.0)) {                                      // below 0 C
          newMass[WATER] = 0.0;                                          // enable
          newMass[ICE] = initalMass;                                     // snow
          feedback[HEAT] += newMass[ICE] * meltingHeat;                  // add heat of freezing
          newDensity = snowDensity;

          vec4 lightningLocation = texture(lightningLocationTex, vec2(0.5)); // data from last lightning bolt

          float lightningSpawnChance = 0.01;

          const float lightningCloudDensityThreshold = 3.0; // 2.5
          const float lightningChanceMultiplier = 0.0011;   // 0.0010

          float cloudDensity = water[CLOUD] + water[PRECIPITATION];

          lightningSpawnChance = max((cloudDensity - lightningCloudDensityThreshold) * lightningChanceMultiplier, 0.);

          const float minIterationsSinceLastLightningBolt = 50.;

          if (lightningLocation.z < iterNum - minIterationsSinceLastLightningBolt && random2d(vec2(base[TEMPERATURE] * 0.2324, water[TOTAL] * 7.7)) < lightningSpawnChance) { // Spawn lightning
            lightningSpawned = true;
            isActive = false;
            gl_PointSize = 1.0;
            feedback.xy = texCoord;
            feedback.z = iterNum;
            gl_Position = vec4(vec2(-1. + texelSize.x * 3., -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (1, 0)
          }
        } else {
          newMass[WATER] = initalMass; // rain
          newMass[ICE] = 0.0;
          newDensity = 1.0;
        }
        feedback[VAPOR] -= initalMass;
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

      // float surfaceArea = sqrt(totalMass); // As if droplet is a circle (2D)
      float surfaceArea = pow(totalMass, 1. / 3.); // As if droplet is a sphere (3D)

                                                   // float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the faster ice forms
      float growthRate = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C); // the colder it gets the faster ice forms

      // growthRate = 0.0;                                                                                                                  // for debug

      float growth = water[CLOUD] * growthRate * surfaceArea;

      // Hail growth enhancement:
      if (realTemp < CtoK(0.0) && density == 1.0) {            // below freezing
        growth += surfaceArea * water[PRECIPITATION] * 0.0030; // rain freezing onto hail
      }

      feedback[VAPOR] -= growth * 1.0; // takes water from the air


      if (realTemp < CtoK(0.0)) { // below freezing

        newMass[ICE] += growth;   // ice growth
        feedback[HEAT] += growth * meltingHeat;

        float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        feedback[HEAT] += freezing * meltingHeat;

      } else {                                                                                                    // above freezing
        newMass[WATER] += growth;                                                                                 // water growth

        float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea /* / newDensity */, newMass[ICE]); // 0.0002 snow / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases upto 1.0 as snow melts
      }

      float dropletTemp = potentialToRealT(base[TEMPERATURE]);                                       // should be wetbulb temperature...

      if (newMass[ICE] > 0.0)                                                                        // if any ice
        dropletTemp = min(dropletTemp, CtoK(0.0));                                                   // temp can not be more than 0 C

      float evapAndSubli = max((maxWater(dropletTemp) - water[TOTAL]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

      // evapAndSubli = 0.0000;                                                                         // remove quickly for DEBUG

      float evap = min(newMass[WATER], evapAndSubli);       // can only evaporate as much water as it contains
      float subli = min(newMass[ICE], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

      newMass[WATER] -= evap;                               // water evaporation
      newMass[ICE] -= subli;                                // ice sublimation

      feedback[VAPOR] += evap;                              // added to water vapor in air
      feedback[VAPOR] += subli;
      feedback[HEAT] -= evap * evapHeat;                    // heat cost extracted from air
      feedback[HEAT] -= subli * evapHeat;
      feedback[HEAT] -= subli * meltingHeat;

      // Update position
      // move with air    * 2. because droplet position goes from -1. to 1
      newPos += base.xy / resolution * 2.;
      newPos.y -= fallSpeed * newDensity * sqrt(totalMass / surfaceArea); // fall speed relative to air
                                                                          /*
                                                                           // falling at fixed speed:
                                                                          float cellHeight = texelSize.y * 12000.0; // in meters
                                                                          float realSecPerIter = 0.288;
                                                                          float metersPerSec = 6.0;
                                                                          float cellsPerSec = metersPerSec / cellHeight;
                                                                          float cellsPerIter = cellsPerSec * realSecPerIter;
                                                                          newPos.y -= cellsPerIter * 2. * texelSize.y;
                                                                          */

      newPos.x = mod(newPos.x + 1., 2.) - 1.;                             // wrap horizontal position around map edges

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