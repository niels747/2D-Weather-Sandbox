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

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

layout(location = 0) out vec4 base;
layout(location = 2) out ivec4 wall;

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
    if (wall[TYPE] == WALLTYPE_WATER) { // water flow

      // base[VX] *= 1. - dragMultiplier * 0.0002;        // linear drag

      // base[VY] *= 1. - (dragMultiplier + 10.) * 0.0002;

      if (wall[VERT_DISTANCE] == 0) { // surface layer
        base[VY] = 0.0;               // stop vertical movement at water-air boundary
        //  base[VX] = 0.0;
        // base[VY] *= 0.5;
      } else {
        base[VY] += base[PRESSURE] - baseX0Yp[PRESSURE];
      }

      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER) { // is wall to the right
        base[VX] = 0.0;                                                  // Since X velocity is defined at the right of the cell, it has to be done in the cell to the left of the wall
      } else {
        base[VX] += base[PRESSURE] - baseXpY0[PRESSURE]; // The velocity through the cell changes proportionally to the pressure gradient across the cell. It's basically just newtons 2nd law.
      }

      base[VX] *= 0.999; // linear drag
      base[VY] *= 0.999; // linear drag

      // base[VX] = 0.0;
    } else {          // solid wall
      base[VX] = 0.0; // velocities in wall are 0
      base[VY] = 0.0; // this will make a wall not let any pressure trough and
                      // thereby reflect any pressure waves back
    }
  } else { // air

    if (wallXpY0[DISTANCE] == 0) { // is wall to the right
      base[VX] = 0.0;              // Since X velocity is defined at the right of the cell, it has to be done in the cell to the left of the wall
    } else {
      base[VX] += base[PRESSURE] - baseXpY0[PRESSURE]; // The velocity through the cell changes proportionally to the pressure gradient across the cell. It's basically just newtons 2nd law.
      base[VX] *= 1. - dragMultiplier * 0.0002;        // linear drag
    }

    base[VY] += base[PRESSURE] - baseX0Yp[PRESSURE];
    base[VY] *= 1. - (dragMultiplier + 10.) * 0.0002;
    // quadratic drag
    // base[VX] -= base[VX] * base[VX] * base[VX] * base[VX] * base[VX] *
    // dragMultiplier; base[VY] -= base[VY] * base[VY] * base[VY] * base[VY] *
    // base[VY] * dragMultiplier;

    base[VX] += wind * 0.000001;
  }
}