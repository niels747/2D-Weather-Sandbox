#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform vec2 texelSize;

uniform sampler2D hdrTex;
uniform sampler2D bloomTex;
out vec4 fragmentColor;

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb * 0.9;

  outputCol += texture(bloomTex, texCoord).rgb * 1.00;

  fragmentColor = vec4(outputCol, 1.0);
}
