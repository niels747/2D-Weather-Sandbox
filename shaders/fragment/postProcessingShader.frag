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
uniform sampler2D brightPartsTex;
out vec4 fragmentColor;

void main()
{
  // vec3 hdrCol = texture(hdrTex, texCoord).rgb;

  vec3 outputCol = texture(hdrTex, texCoord).rgb * 1.;

  // add bloom
  // for (float depth = 0.0; depth < 12.0; depth += 1.0) {
  //   outputCol += texture(brightPartsTex, texCoord, depth).rgb * 0.2;
  // }

  const float bloomMult = 0.25;

  for (float depth = 0.0; depth < 8.0; depth += 1.0) {

    // float depth = 8.0;
    vec2 texelSizeAtDepth = texelSize * pow(2., depth) * 0.5;
    outputCol += texture(brightPartsTex, vec2(texCoord.x - texelSizeAtDepth.x, texCoord.y - texelSizeAtDepth.y), depth).rgb * bloomMult;
    outputCol += texture(brightPartsTex, vec2(texCoord.x + texelSizeAtDepth.x, texCoord.y - texelSizeAtDepth.y), depth).rgb * bloomMult;
    outputCol += texture(brightPartsTex, vec2(texCoord.x - texelSizeAtDepth.x, texCoord.y + texelSizeAtDepth.y), depth).rgb * bloomMult;
    outputCol += texture(brightPartsTex, vec2(texCoord.x + texelSizeAtDepth.x, texCoord.y + texelSizeAtDepth.y), depth).rgb * bloomMult;
  }


  // outputCol = pow(outputCol, vec3(3.0)); // only keep bright parts

  //   outputCol += texture(hdrTex, texCoordXmY0).rgb * 0.5;
  //   outputCol += texture(hdrTex, texCoordX0Ym).rgb * 0.5;
  //   outputCol += texture(hdrTex, texCoordXpY0).rgb * 0.5;
  //   outputCol += texture(hdrTex, texCoordX0Yp).rgb * 0.5;

  //   outputCol /= 2.0;

  fragmentColor = vec4(outputCol, 1.0);
}
