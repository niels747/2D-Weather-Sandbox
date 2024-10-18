#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up


uniform sampler2D baseTex;
uniform isampler2D wallTex;
uniform sampler2D polarVortexTex;

uniform float dragMultiplier;

uniform float wind;

uniform vec2 texelSize;
uniform vec2 resolution; // not used
uniform float dryLapse;  // not used

uniform vec4 initial_Tv[126];

#include "common.glsl"

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

layout(location = 0) out vec4 base;
layout(location = 2) out ivec4 wall;
layout(location = 3) out float polarVortex;

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXpY0 = texture(baseTex, texCoordXpY0);
  vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

  wall = texture(wallTex, texCoord);


  vec2 polarVortexTexCoord = texCoord /* + vec2(-wind * 0.00001, 0)*/;
  vec2 polarVortexTexCoordXmY0 = polarVortexTexCoord + vec2(-texelSize.x, 0.);
  vec2 polarVortexTexCoordX0Ym = polarVortexTexCoord + vec2(0., -texelSize.y);
  vec2 polarVortexTexCoordXpY0 = polarVortexTexCoord + vec2(texelSize.x, 0.);
  vec2 polarVortexTexCoordX0Yp = polarVortexTexCoord + vec2(0., texelSize.y);

  polarVortex = texture(polarVortexTex, polarVortexTexCoord)[0];

  base[VX] += polarVortex * 0.00030; // substract acumulated velocity


  if (abs(wind) < 0.001)
    polarVortex -= base.x * 0.00020; // acumulate horizontal velocity


  polarVortex *= 1.0 + wind * 0.001;

  polarVortex = max(polarVortex, 0.);

  // base[VY] += sin(texCoord.x * PI + ) * 0.001;


  // if (texCoord.y < 0.99) {
  //   float polarVortexAvg = (texture(polarVortexTex, polarVortexTexCoordXmY0)[0] + texture(polarVortexTex, polarVortexTexCoordX0Ym)[0] + texture(polarVortexTex, polarVortexTexCoordXpY0)[0] + texture(polarVortexTex, polarVortexTexCoordX0Yp)[0]) / 4.;
  //   polarVortex -= (polarVortex - polarVortexAvg) * 0.01; // smooth texture
  // }


  // polarVortex *= 0.9999999; // decay


  if (wall[1] == 0) // is wall
  {
    base[0] = 0.0;  // velocities in wall are 0
    base[1] = 0.0;  // this will make a wall not let any pressure trough and
    // thereby reflect any pressure waves back
    polarVortex = 0.0;
  } else {

    // The velocity through the cell changes proportionally to the pressure
    // gradient across the cell. It's basically just newtons 2nd law.
    base[0] += base[2] - baseXpY0[2];
    base[1] += base[2] - baseX0Yp[2];

    // if(texCoord.y > 0.50){
    //   //base[0] *= 0.99995;
    //   base[1] *= 0.99995;
    // }

    base[0] *= 1. - dragMultiplier * 0.0002; // linear drag
    base[1] *= 1. - dragMultiplier * 0.0002;

    // quadratic drag
    // base[0] -= base[0] * base[0] * base[0] * base[0] * base[0] *
    // dragMultiplier; base[1] -= base[1] * base[1] * base[1] * base[1] *
    // base[1] * dragMultiplier;

    // base[0] += wind * 0.000001;
  }
}