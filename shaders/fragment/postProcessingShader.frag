#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform vec2 texelSize;

uniform float exposure;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;
out vec4 fragmentColor;

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb * 0.9;

  vec3 bloom = texture(bloomTex, texCoord).rgb;

  bloom = pow(bloom, vec3(1. / 2.2)); // bloom gamma correction

  // outputCol *= 1. + bloom * 5.0;      // add bloom as light (experiment)

  outputCol += bloom * 0.990; // apply bloom

  fragmentColor = vec4(outputCol, 1.0);
}
