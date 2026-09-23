#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform isampler2D wallTex;

uniform sampler2D densTex;

layout(location = 0) out float dens;

uniform vec2 resolution;

vec2 texelSize;
#include "common.glsl"

void main()
{
  ivec2 center = ivec2(fragCoord);

  ivec2 iRes = ivec2(resolution);

  float totalTemp = 0.;

  float fluidCells = 0.;

  for (int x = 0; x < iRes.x; x++) {

    float curTemp = texelFetch(baseTex, ivec2(x, center.y), 0)[TEMPERATURE];
    // if (curTemp < 999.) // not wall
    if (texelFetch(wallTex, ivec2(x, center.y), 0)[DISTANCE] != 0) { // not wall
      totalTemp += curTemp;
      fluidCells += 1.;
    }
  }

  float prevDens = texture(densTex, texCoord)[0];
  float newDens = dens = totalTemp / fluidCells; // calc average

                                                 // if (prevDens == 0.0)
  dens = newDens;
  // else
  //  dens = mix(prevDens, newDens, 0.1);
}
