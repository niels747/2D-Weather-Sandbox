#version 300 es
precision highp float;

in vec2 vertPosition;
in vec2 vertTexCoord;

uniform vec2 texelSize;

uniform vec2 aspectRatios; // sim   canvas
uniform vec3 view;         // Xpos  Ypos    Zoom

out vec2 texCoord;  // normalized
out vec2 fragCoord; // non normalized fragment coordinate

out vec2 texCoordXmY0; // left
out vec2 texCoordXpY0; // right
out vec2 texCoordX0Yp; // up
out vec2 texCoordX0Ym; // down

const float Xmult = 3.0; // how often the simulation is repeated horizontally
const float Ymult = 5.;  // 4.0

void main()
{
  vec2 texCoordAdjusted = vertTexCoord;
  texCoordAdjusted.x *= Xmult;
  texCoordAdjusted.y *= Ymult;

  texCoordAdjusted.x -= (Xmult - 1.0) / (2. * texelSize.x); // make sure the position of texture coordinates stays constant on the screen
  texCoordAdjusted.y -= (Ymult - 1.0) / (2. * texelSize.y);

  // wrapped arround edge
  fragCoord = texCoordAdjusted;
  texCoord = texCoordAdjusted * texelSize; // normalize

  // single area, no wrapping
  // fragCoord = vertTexCoord;
  // texCoord = vertTexCoord * texelSize; // normalize

  texCoordXmY0 = texCoord + vec2(-texelSize.x, 0.0);
  texCoordXpY0 = texCoord + vec2(texelSize.x, 0.0);
  texCoordX0Yp = texCoord + vec2(0.0, texelSize.y);
  texCoordX0Ym = texCoord + vec2(0.0, -texelSize.y);

  vec2 outpos = vertPosition;

  outpos.x *= Xmult;
  outpos.y *= Ymult;

  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];

  outpos *= view[2]; // zoom

  outpos.y *= aspectRatios[1] / aspectRatios[0];

  gl_Position = vec4(outpos, 0.0, 1.0);
}