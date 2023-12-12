#version 300 es
precision mediump float;
precision mediump sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

out vec4 fragmentColor;

uniform sampler2D bloomTexture;

void main()
{
  vec4 sum = vec4(0.0);
  sum += texture(bloomTexture, texCoordXmY0);
  sum += texture(bloomTexture, texCoordX0Ym);
  sum += texture(bloomTexture, texCoordXpY0);
  sum += texture(bloomTexture, texCoordX0Yp);
  sum *= 0.25;
  fragmentColor = sum;
}