#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;     // this
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

uniform float dragMultiplier;

uniform float wind;

uniform vec2 texelSize;
// uniform vec2 resolution;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

#define VX 0
#define VY 1
#define P 2
#define T 3

float calcDensity(float _P, float _T)
{                           // pressure in hPa, temperature in K, density in kg/m3
  const float _R = 2.87058; // J/(kg·K)
                            //  const float _R = 0.01; // J/(kg·K)
  return _P / (_R * _T);
}

const float dT = 0.00050; // 0.00050

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXpY0 = texture(baseTex, texCoordXpY0);
  vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

  water = texture(waterTex, texCoord);

  wall = texture(wallTex, texCoord);

  if (wall[1] == 0) // is wall
  {
    base[0] = 0.0;  // velocities in wall are 0
    base[1] = 0.0;  // this will make a wall not let any pressure trough and
                    // thereby reflect any pressure waves back
  } else {

    // The velocity through the cell changes proportionally to the pressure
    // gradient across the cell. It's basically just newtons 2nd law.

    //  const float mult = 0.49;
    // const float mult = 1.00;
    // base[0] += (base[2] - baseXpY0[2]) * mult;
    // base[1] += (base[2] - baseX0Yp[2]) * mult;

    float density = calcDensity(base[P], base[T]);


    float densVX = (density + calcDensity(baseXpY0[P], baseXpY0[T])) / 2.0; // density at VX location
    base[VX] += (base[P] - baseXpY0[P]) / densVX * dT;

    //  float densVY = max((cell[P] + cellX0Yp[P]), 0.) / 2.0 + 0.1;                           // density at VX location
    // float densVY = max((density + calcDensity(cellX0Yp[P], cellX0Yp[T])), 0.) / 2.0 + 0.1; // density at VX location
    float densVY = (density + calcDensity(baseX0Yp[P], baseX0Yp[T])) / 2.0; // density at VX location
    base[VY] += (base[P] - baseX0Yp[P]) / densVY * dT;                      // delta V is proportional to pressure gradient


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

    base[0] += wind * 0.000001;
  }
}