#version 300 es
precision highp float;

in vec2 vertPosition;
in vec2 vertTexCoord;

uniform vec2 texelSize;

out vec2 fragCoord; // non normalized fragment coordinate

// normalized texure positions. p = plus 1      m = minus 1
out vec2 texCoord; // this
out vec2 texCoordXmY0; // left
out vec2 texCoordXpY0; // right
out vec2 texCoordX0Yp; // up
out vec2 texCoordX0Ym; // down

out vec2 texCoordXmYp; // left up
out vec2 texCoordXpYm; // right down

void main()
{
  fragCoord = vertTexCoord;
  texCoord = vertTexCoord * texelSize; // normalize

  texCoordXmY0 = texCoord + vec2(-texelSize.x, 0.0);
  texCoordXpY0 = texCoord + vec2(texelSize.x, 0.0);
  texCoordX0Yp = texCoord + vec2(0.0, texelSize.y);
  texCoordX0Ym = texCoord + vec2(0.0, -texelSize.y);

  texCoordXmYp = texCoord + vec2(-texelSize.x, texelSize.y);
  texCoordXpYm = texCoord + vec2(texelSize.x, -texelSize.y);

    gl_Position = vec4(vertPosition, 0.0, 1.0);
}