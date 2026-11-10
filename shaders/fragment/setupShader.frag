#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float simHeight;

uniform float seed;
uniform float heightMult;

uniform vec4 initial_Tv[126];

float getInitialT(int y)
{
  int yc = clamp(y, 0, 503);
  return initial_Tv[yc >> 2][yc & 3];
}

in vec2 texCoord;
in vec2 fragCoord;

#include "common.glsl"

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

float rand(float n) { return fract(sin(n) * 43758.5453123); }

float noise(float p)
{
  float fl = floor(p);
  float fc = fract(p);
  return mix(rand(fl), rand(fl + 1.), fc) - 0.5;
}

void main()
{
  base = vec4(0.0);
  water = vec4(0.0);

  // WALL SETUP

  float height = 0.0;
  float height_m = 0.0;

  if (heightMult < 0.05) { // all sea

    height = 0.0;

  } else if (heightMult < 0.10) { // all land

    height = 0.005;

  } else { // generate hills / mountains
    float var = fragCoord.x * 0.001;

    for (float i = 2.0; i < 1000.0; i *= 1.5) { // add multiple frequencies of noise together
      height += noise(var * i + rand(seed + i) * 10.) * 0.5 / i;
    }

    height *= heightMult;
    height_m = height * simHeight; // sim height
  }

  if (texCoord.y < texelSize.y || texCoord.y < height) {                                                      // set to wall
    wall[DISTANCE] = 0;                                                                                       // set to wall
    if (height < texelSize.y) {
      wall[TYPE] = WALLTYPE_WATER;                                                                            // set walltype to water
      base[TEMPERATURE] = CtoK(25.0);                                                                         // set water temperature to 25 C
    } else {
      wall[TYPE] = WALLTYPE_LAND;                                                                             // set walltype to land
      water[SOIL_MOISTURE] = 25.0;                                                                            // soil moisture in mm

      wall[VEGETATION] = int(110.0 - fragCoord.y * 2. + noise(fragCoord.x * 0.01 + rand(seed) * 10.) * 150.); // set vegitation

      water[SNOW] = max(map_rangeC(height_m, 2000.0, 5000.0, 0.0, 100.0), 0.);                                // set snow
    }
  } else {                                                                                                    // air, not wall
    wall[DISTANCE] = 127;                                                                                     // reset distance to wall
    base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));                                   // set base potential temperature

    // Realistic Convective Boundary Layer (CBL) initial perturbations:
    // Gentle multi-scale mesoscale moisture & thermal eddies prevent uniform slab boiling and organize natural cumulus streets
    float pblMask = 1.0 - smoothstep(0.12, 0.24, texCoord.y);
    float eddyWave = (
      noise(fragCoord.x * 0.018 + seed * 3.1) * 0.55 +
      noise(fragCoord.x * 0.047 + texCoord.y * 6.0 + seed * 7.3) * 0.30 +
      noise(fragCoord.x * 0.11 - texCoord.y * 11.0 + seed * 13.7) * 0.15
    );
    base[TEMPERATURE] += eddyWave * 0.45 * pblMask;

    float realTemp = potentialToRealT(base[TEMPERATURE]);

    // Smooth boundary-layer moisture profile with natural entrainment transition zone around 1.8 - 2.6 km
    float pblTop = 0.18 + noise(fragCoord.x * 0.012 + seed * 5.7) * 0.035;
    float freeTropBlend = smoothstep(pblTop - 0.035, pblTop + 0.045, texCoord.y);
    float dewDepression = mix(2.2 - eddyWave * 1.4, 18.0 - noise(fragCoord.x * 0.01 + texCoord.y * 8.0) * 4.0, freeTropBlend);
    water[TOTAL] = maxWater(max(realTemp - max(dewDepression, 0.3), 150.0));

    water[CLOUD] = max(water[TOTAL] - maxWaterMixed(realTemp), 0.0); // calculate initial cloud water
  }
  wall[VERT_DISTANCE] = 100;                                    // preset height above ground to prevent water being deleted in boundaryshader ln 250*`
}