#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

vec2 fragCoord;          // (in) not used just defined for commonDisplay.glsl
in vec2 texCoord;        // this
in vec2 texCoordXmY0;    // left
in vec2 texCoordX0Ym;    // down
in vec2 texCoordXpY0;    // right
in vec2 texCoordX0Yp;    // up

uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float exposure;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;
out vec4 fragmentColor;


#include "commonDisplay.glsl"

// Smooth C1 highlight shoulder above knee = 0.68:
// Preserves exact linear colors/brightness in [0, 0.68] while preventing harsh RGB clipping on sunlit cloud crowns & sunset glow
vec3 softHighlightShoulder(vec3 x)
{
  const float knee = 0.68;
  const float head = 1.0 - knee;
  vec3 over = max(x - vec3(knee), vec3(0.0));
  vec3 perChan = min(x, vec3(knee)) + head * (over / (over + vec3(head)));

  float peak = max(max(x.r, x.g), x.b);
  if (peak > knee) {
    float mappedPeak = knee + head * ((peak - knee) / ((peak - knee) + head));
    vec3 chromaPreserved = x * (mappedPeak / peak);
    return mix(perChan, chromaPreserved, 0.45);
  }
  return perChan;
}

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  vec3 bloom = texture(bloomTex, texCoord).rgb;

  outputCol += bloom * 0.990; // apply bloom

  outputCol = max(outputCol * exposure, vec3(0.0));

  outputCol = softHighlightShoulder(outputCol);

  outputCol = pow(outputCol, ONE_OVER_GAMMA); // gamma correction


  /*
    { // Gamma correction test: left without, right with gamma correction
      float modTexCoordx = mod(texCoord.x, 0.5);
      // outputCol = vec3(pow(texCoord.y, 2.)); // light input

      outputCol = vec3(pow(0.9, (1. - texCoord.y) * 50.)); // simulate light coming down and being absorbed by clouds

      if (texCoord.x > 0.5)
        outputCol = pow(outputCol, GAMMA);              // gamma correction

      if (abs(outputCol.r - modTexCoordx * 2.) < 0.001) // plot brightness
        outputCol = vec3(1.0, 0., 0.);
    }
  */

  fragmentColor = vec4(outputCol, 1.0);
}
