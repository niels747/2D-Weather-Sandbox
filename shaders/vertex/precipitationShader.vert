#version 300 es
precision highp float;

// Base texture:
#define PRES 2
#define TEMP 3

// Water texture:
#define TOTAL 0
#define CLOUD 1
#define RAIN 2
#define SNOW 3

// mass:
#define WATER 0
#define ICE 1

// feedback
#define MASS 0
#define HEAT 1
//#define RAIN 2
//#define SNOW 3


in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;

// to fragmentshader for feedback to fluid
// feedback[0] droplet mass / number of inactive droplets count
// feedback[1] heat exchange with fluid
// feedback[2] water exchange with fluid / rain accumulation on ground
// feedback[3] snow acumulation on ground
out vec4 feedback;

vec2 texCoord; // for functions

uniform sampler2D baseTex;
uniform sampler2D waterTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform float frameNum;         // used as seed for random function
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold;   // 0.50
uniform float spawnChanceMult;    // 0.00015 - 0.00050
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

void disableDroplet()
{
  gl_PointSize = 1.;
  newMass[WATER] = -2. - dropPosition.x; // disable droplet by making it negative and save position as seed for spawning
  newMass[ICE] = dropPosition.y;       // save position as seed for random function when spawning later
}

void main()
{
  newPos = dropPosition;
  newMass = mass;       // amount of water and ice carried
  newDensity = density; // determines fall speed

  if (mass[WATER] < 0.) { // inactive
                      /*
                      We have to generate a position before we know if the droplet is actually gonna spawn, seems ineffcient but there is no way arround it.
                      This is because spwan chance depends on the conditions at the location, we have to sample the textures for every inactive droplet. this is a huge performance bottleneck
                   */

    // generate random spawn position: x and y from 0. to 1.
    texCoord = vec2(random(mass[WATER] * frameNum * 2.4173), random(mass[ICE] * frameNum * 7.3916));

    // sample fluid at generated position
    vec4 base = texture(baseTex, texCoord);
    vec4 water = texture(waterTex, texCoord);

    // check if position is okay to spawn
    float realTemp = potentialToRealT(base[TEMP]); // in Kelvin

#define initalMass 0.05 // 0.05 initial droplet mass
    float thresHold;
    if (realTemp > CtoK(0.0))
      thresHold = aboveZeroThreshold; // in above freezing conditions coalescence only happens in really dense clouds
    else                              // the colder it gets, the faster ice starts to form
      //  treshHold = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), subZeroThreshold, initalMass), initalMass);
      thresHold = subZeroThreshold;

    if (water[CLOUD] > thresHold && base[TEMP] < 500.) { // if cloudwater above thresHold and not wall
                                                  // float spawnChance = (water[1] - thresHold) * 1000.0 / inactiveDroplets;
                                                  // if (spawnChance > rand2d(mass.xy)) {
      float spawnChance = (water[CLOUD] - thresHold) / inactiveDroplets * resolution.x * resolution.y * spawnChanceMult;

      float nrmRand = random(mass[WATER] * 0.3724 + frameNum + random(mass[ICE])); // normalized random value
      if (spawnChance > nrmRand) {                                           // spawn
        newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.);     // convert texture coordinate (0 to 1) to position (-1 to 1)

        if (realTemp < CtoK(0.0)) {                // freezing
          newMass[WATER] = 0.0;                        // enable
          newMass[ICE] = initalMass;                 // snow
          feedback[HEAT] += newMass[ICE] * meltingHeat; // add heat of freezing
          newDensity = snowDensity;
        } else {
          newMass[WATER] = initalMass; // rain
          newMass[ICE] = 0.0;
          newDensity = 1.0;
        }
        feedback[RAIN] -= initalMass;
      }
    }

    if (feedback[RAIN] < 0.0) { // is taking water from texture so has spawned
      gl_PointSize = 1.0;
      gl_Position = vec4(newPos, 0.0, 1.0);
    } else {                                                                    // still inactive
      feedback[MASS] = 1.0;                                                        // count 1 inactive droplet
      gl_Position = vec4(vec2(-1. + texelSize.x, -1. + texelSize.y), 0.0, 1.0); // render to bottem left corner (0, 0) to count inactive droplets
    }

  } else { // active
    texCoord = vec2(dropPosition.x / 2. + 0.5,
                    dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
    vec4 water = texture(waterTex, texCoord);
    vec4 base = texture(baseTex, texCoord);

    float realTemp = potentialToRealT(base[TEMP]); // in Kelvin

    float totalMass = newMass[WATER] + newMass[ICE];

    if (totalMass < 0.04) { // 0.00001   to small

      feedback[HEAT] = totalMass * evapHeat; // evaporation of residual droplet
      feedback[RAIN] = totalMass;            // evaporation of residual droplet

      disableDroplet();

    } else if (newPos.y < -1.0 || base[TEMP] > 500.) { // to low or wall

      if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[TEMP] > 500.) // if above cell was already wall. because of fast fall speed
        newPos.y += texelSize.y * 1.;                                             // *2. ? move position up so that the water/snow is correcty added to the ground

      //  feedback[2] = newMass[0]; // rain accumulation increased soil moisture. Not currently used because it causes bugs in some cases

      feedback[SNOW] = newMass[ICE]; // snow accumulation

      disableDroplet();
    } else { // update droplet

      //float surfaceArea = sqrt(totalMass); // As if droplet is a circle (2D)
      float surfaceArea = pow(totalMass, 1./3.); // As if droplet is a sphere (3D)

      float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the easier ice starts to form

      float growth = water[CLOUD] * growthRate * surfaceArea;
      feedback[RAIN] -= growth * 1.0;

      if (realTemp < CtoK(0.0)) { // freezing
        newMass[ICE] += growth;     // ice growth
        feedback[HEAT] += growth * meltingHeat;

        float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[WATER]); // rain freezing
        newMass[WATER] -= freezing;
        newMass[ICE] += freezing;
        feedback[HEAT] += freezing * meltingHeat;

      } else {                // melting
        newMass[WATER] += growth; // water growth

        float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea / newDensity, newMass[ICE]); // 0.0002 snow / hail melting
        newMass[ICE] -= melting;
        newMass[WATER] += melting;
        feedback[HEAT] -= melting * meltingHeat;

        newDensity = min(newDensity + (melting / totalMass) * 1.00,
                         1.0); // density increases upto 1.0
      }

      float dropletTemp = potentialToRealT(base[TEMP]); // should be wetbulb temperature...

      if (newMass[ICE] > 0.0)                        // if any ice
        dropletTemp = min(dropletTemp, CtoK(0.0)); // temp can not be more than 0 C

      float evapAndSubli = max((maxWater(dropletTemp) - water[TOTAL]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

      float evap = min(newMass[WATER], evapAndSubli);         // can only evaporate as much water as it contains
      float subli = min(newMass[ICE], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

      newMass[WATER] -= evap;  // water evaporation
      newMass[ICE] -= subli; // ice sublimation

      feedback[RAIN] += evap; // added to water vapor in air
      feedback[RAIN] += subli;
      feedback[HEAT] -= evap * evapHeat; // heat cost extracted from air
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

      newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around map edges

      feedback[MASS] = totalMass;

#define pntSize 16.                         // 8
      float pntSurface = pntSize * pntSize; // suface area

      feedback[MASS] /= pntSurface;
      feedback[HEAT] /= pntSurface;
      feedback[RAIN] /= pntSurface;

      gl_PointSize = pntSize;
    } // update

    gl_Position = vec4(newPos, 0.0, 1.0);
  } // active

  position_out = newPos;
  mass_out = newMass;
  density_out = max(newDensity, 0.);
}