#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D hdrTex;
out vec3 fragmentColor;

void main()
{
  vec3 outputCol = texture(hdrTex, texCoord).rgb;

  //  outputCol = pow(outputCol, vec3(4.0)); // only keep bright parts


  // outputCol = max(outputCol - vec3(0.9), 0.0); // only keep bright parts

  outputCol *= 0.02;

  fragmentColor = vec3(outputCol);
}
