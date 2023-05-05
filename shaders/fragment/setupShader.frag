#version 300 es
precision highp float;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float seed;
uniform float heightMult;

uniform vec4 initial_Tv[151];
uniform vec4 initial_Pv[151];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }
float getInitialP(int y) { return initial_Pv[y / 4][y % 4]; }

in vec2 texCoord;
in vec2 fragCoord;

#include "common.glsl"

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
// layout(location = 2) out vec4 light;
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

  base[2] = getInitialP(int(texCoord.y * (1.0 / texelSize.y))); // set pressure

  // WALL SETUP

  float height = 0.0;

  if (heightMult < 0.05) { // all sea

    height = 0.0;

  } else if (heightMult < 0.10) { // all land

    height = 0.005;

  } else { // generate mountains
    float var = fragCoord.x * 0.001;

    for (float i = 2.0; i < 1000.0; i *= 1.5) {
      height += noise(var * i + rand(seed + i) * 10.) * 0.5 / i;
    }

    height *= heightMult;
  }

  if (texCoord.y < texelSize.y || texCoord.y < height) { // set to wall
    wall[1] = 0;                                         // set to wall
    base[2] = getInitialP(int(resolution.y));            // set pressure in lowest wall layer equal to top layer


    if (height < texelSize.y) {
      wall[0] = 2;                                                                                   // set walltype to water
    } else {
      wall[0] = 1;                                                                                   // set walltype to land
      water[2] = 100.0;                                                                              // soil moisture

      wall[3] = int(110.0 - fragCoord.y * 2. + noise(fragCoord.x * 0.01 + rand(seed) * 10.) * 150.); // set vegitation

      if (height > 0.15 && height - texCoord.y < texelSize.y * 2.0)
        water[3] = 100.0;                                         // set snow
    }
  } else {                                                        // not wall
    wall[1] = 255;                                                // reset distance to wall
    base[3] = getInitialT(int(texCoord.y * (1.0 / texelSize.y))); // set temperature

    if (texCoord.y < 0.20)                                        // set dew point
      water[0] = maxWater(base[3] - 2.0);
    else
      water[0] = maxWater(base[3] - 20.0);

    water[1] = max(water[0] - maxWater(base[3]), 0.0); // calculate cloud water
  }
  wall[2] = 100;                                       // prevent water being deleted in boundaryshader ln 250*
}