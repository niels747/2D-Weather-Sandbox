#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D prevEnvTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;
uniform float iterNum;
uniform vec4 initial_Tv[126];

float getInitialT(int y)
{
  int yc = clamp(y, 0, 503);
  return initial_Tv[yc >> 2][yc & 3];
}

layout(location = 0) out vec4 envOut;

#include "common.glsl"

void main()
{
  int row = clamp(int(gl_FragCoord.y), 0, int(resolution.y) - 1);
  float uvY = (float(row) + 0.5) * texelSize.y;

  const int NUM_SAMPLES = 64;
  // Golden-ratio quasi-random horizontal phase samples every column smoothly over a few steps
  float phase = fract(iterNum * 0.61803398875);

  float sumThetaV = 0.0;
  float sumVapor = 0.0;
  float weightSum = 0.0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    float uvX = (float(i) + phase) / float(NUM_SAMPLES);
    vec2 uv = vec2(uvX, uvY);

    ivec4 wWall = texture(wallTex, uv);
    if (wWall[DISTANCE] > 0) {
      vec4 b = texture(baseTex, uv);
      vec4 w = texture(waterTex, uv);
      if (b[TEMPERATURE] < 500.0) {
        float vapor = max(w[TOTAL] - w[CLOUD], 0.0);
        float thetaV = b[TEMPERATURE] + vapor * 0.11;

        // Weight unsaturated ambient environment higher than narrow convective cores
        float ambWeight = (w[CLOUD] < 0.02) ? 1.0 : 0.20;
        sumThetaV += thetaV * ambWeight;
        sumVapor += vapor * ambWeight;
        weightSum += ambWeight;
      }
    }
  }

  float fallbackInitT = getInitialT(row);
  float refRealT = potentialToRealT(fallbackInitT, uvY);
  float fallbackVapor = maxWater(refRealT - 12.0);
  float fallbackThetaV = fallbackInitT + fallbackVapor * 0.11;

  float targetThetaV = (weightSum > 0.01) ? (sumThetaV / weightSum) : fallbackThetaV;
  float targetVapor = (weightSum > 0.01) ? (sumVapor / weightSum) : fallbackVapor;

  vec4 prev = texture(prevEnvTex, vec2(0.5, uvY));
  if (prev.w > 0.5 && iterNum > 2.0) {
    float alpha = 0.12;
    envOut = vec4(
      mix(prev.x, targetThetaV, alpha),
      mix(prev.y, targetVapor, alpha),
      fallbackThetaV,
      1.0
    );
  } else {
    envOut = vec4(targetThetaV, targetVapor, fallbackThetaV, 1.0);
  }
}
