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

out vec4 lightningLocation;

uniform float dryLapse;

#include "common.glsl"

void main()
{
  vec4 newLightningLocation = texture(precipFeedbackTex, vec2(0.0 + texelSize.x * 1., 0.0));

  if (newLightningLocation.z == 0.) {
    discard; // no new lightning strike, so no update
  }

  lightningLocation = newLightningLocation;

  // lightningLocation = vec4(0.03, 0.1997, 100., 0); // test
}
