#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform isampler2D wallTex;
uniform sampler2D colorScalesTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform float displayVectorField;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "common.glsl"
#include "commonDisplay.glsl"


void main()
{
  // vec4 base = texture(baseTex, texCoord);
  //  vec4 base = bilerp(baseTex, fragCoord);
  vec4 base = bilerpWall(baseTex, wallTex, fragCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float realTempC = KtoC(potentialToRealT(base[3]));

  if (wall[1] == 0) {  // is wall
    switch (wall[0]) { // wall type
    case 0:
      fragmentColor = vec4(0, 0, 0, 1);
      break;
    case 1: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case 2: // water wall
      // fragmentColor = vec4(0, 0.5, 0.99, 1);
      int palletteIndex = int(map_range(KtoC(base[3]), -26. - 2., 30., 0., 29.));
      palletteIndex = clamp(palletteIndex, 0, 29);
      fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
      break;
    case 3: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    default: // Urban / Runway / Industrial wall
      fragmentColor = vec4(vec3(0.20), 1.0);
      break;
    }
  } else { // fluid

    int palletteIndex = int(map_range(realTempC, -71.0, 59.0, 0., 130.));
    palletteIndex = clamp(palletteIndex, 0, 130);
    fragmentColor = texelFetch(colorScalesTex, ivec2(0, palletteIndex), 0);

    drawVectorField(base.xy, displayVectorField);
  }

  // drawDirLines(base.xy);
  // drawIsoLines(base[2]);
  drawCursor(cursor, view);
}