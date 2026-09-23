#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float simHeight;

uniform float seed;
uniform float heightMult;

uniform vec4 initial_Tv[126];
uniform vec4 realWorldSounding_Tv[126];
uniform vec4 realWorldSounding_Wv[126];
uniform vec4 realWorldSounding_Velv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }
float getRealWorldSounding_T(int y) { return (realWorldSounding_Tv[y / 4][y % 4] + realWorldSounding_Tv[(y - 1) / 4][(y - 1) % 4]) / 2.; }
float getRealWorldSounding_W(int y) { return (realWorldSounding_Wv[y / 4][y % 4] + realWorldSounding_Wv[(y - 1) / 4][(y - 1) % 4]) / 2.; }
float getRealWorldSounding_Vel(int y) { return (realWorldSounding_Velv[y / 4][y % 4] + realWorldSounding_Velv[(y - 1) / 4][(y - 1) % 4]) / 2.; }

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
    wall[DISTANCE] = 255;                                                                                     // reset distance to wall
    // base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));                                   // set temperature
    //  float realTemp = potentialToRealT(base[TEMPERATURE]);
    // if (texCoord.y < 0.20) // set dew point
    //   water[TOTAL] = maxWater(realTemp - 2.0);
    // else
    //   water[TOTAL] = maxWater(realTemp - 20.0);


    int soundingArrayindex = int(texCoord.y * (1.0 / texelSize.y));
    base[TEMPERATURE] = getRealWorldSounding_T(soundingArrayindex);

    float realTemp = potentialToRealT(base[TEMPERATURE]);

    water[TOTAL] = getRealWorldSounding_W(soundingArrayindex);

    base.x = getRealWorldSounding_Vel(soundingArrayindex);

    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // calculate cloud water
  }
  wall[VERT_DISTANCE] = 100;                                    // preset height above ground to prevent water being deleted in boundaryshader ln 250*`
}