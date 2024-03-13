#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down

uniform sampler2D precipFeedbackTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float iterNum;

out vec4 lightningLocation;

uniform float dryLapse;

#include "common.glsl"

void main()
{
  // lightningLocation = vec4(0.5, 0.5, 150, 0); // test
  // return;

  vec4 newLightningLocation = texelFetch(precipFeedbackTex, ivec2(1, 0), 0);                  // read pixel 1, 0 where the lightning location was written to by a precipitation particle

  if (newLightningLocation.z < max(iterNum - 1.0, 1.0) || newLightningLocation.z > iterNum) { // No strike, or two strikes tried to generate during the same iteration
    discard;                                                                                  // no new lightning strike, so no update
  }

  lightningLocation = newLightningLocation;
}
