#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;     // this
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform isampler2D wallTex;

uniform float dragMultiplier;

uniform float wind;

uniform vec2 texelSize;
// uniform vec2 resolution;

uniform vec4 initial_Tv[126];

float getInitialT(int y)
{
  int yc = clamp(y, 0, 503);
  return initial_Tv[yc >> 2][yc & 3];
}

layout(location = 0) out vec4 base;
layout(location = 2) out ivec4 wall;

float dryLapse; // NOT USED needs to be declared for common.glsl
vec2 resolution;
#include "common.glsl"

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXpY0 = texture(baseTex, texCoordXpY0);
  vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

  wall = texture(wallTex, texCoord);
  ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);


  // set boundaries: no flow in or out of wall cells
  if (wall[DISTANCE] == 0) // is wall
  {
    base[VX] = 0.0;        // velocities in wall are 0
    base[VY] = 0.0;        // reflect pressure waves cleanly at solid boundaries
  } else {
    float speed = length(base.xy);
    float totalDrag = dragMultiplier * (0.0002 + 0.0012 * speed); // linear + high-speed quadratic turbulent drag

    if (wallXpY0[DISTANCE] == 0) {
      base[VX] = 0.0;                                  // X velocity is defined on right cell face
    } else {
      base[VX] += base[PRESSURE] - baseXpY0[PRESSURE]; // Pressure-gradient force (Newton's 2nd law)
      base[VX] *= 1.0 - totalDrag;
      base[VX] += wind * 0.000001;
    }

    if (wallX0Yp[DISTANCE] == 0 || texCoord.y >= 1.0 - texelSize.y * 1.1) {
      base[VY] = 0.0; // No vertical penetration into ceiling walls or above domain top lid
    } else {
      base[VY] += base[PRESSURE] - baseX0Yp[PRESSURE];
      base[VY] *= 1.0 - totalDrag;

      // Upper-troposphere / stratospheric Rayleigh gravity-wave sponge to prevent lid reflections
      float lidSponge = smoothstep(0.93, 1.0, texCoord.y);
      base[VY] *= 1.0 - lidSponge * 0.012;
    }

    base.xy = clamp(base.xy, vec2(-0.85), vec2(0.85));
  }
}