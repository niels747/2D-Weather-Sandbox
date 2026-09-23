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
uniform float displayVectorField;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "common.glsl"
#include "commonDisplay.glsl"


void main()
{
  // vec4 base = texture(baseTex, texCoord);
  // vec4 base = bilerp(baseTex, fragCoord);
  vec4 base = bilerpWall(baseTex, wallTex, fragCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;


  float realTemp = potentialToRealT(base[TEMPERATURE]);
  // float realTempC = KtoC(potentialToRealT(base[TEMPERATURE]));

  if (wall[DISTANCE] == 0) { // is wall
    switch (wall[TYPE]) {    // wall type
    // case 0:
    //   fragmentColor = vec4(0, 0, 0, 1);
    //   break;
    case WALLTYPE_LAND: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case WALLTYPE_WATER: // water wall
      base = bilerpWallWater(baseTex, wallTex, fragCoord);
      // fragmentColor = vec4(0, 0.5, 0.99, 1);
      // int palletteIndex = int(map_range(KtoC(base[TEMPERATURE]), -26. - 2., 30., 0., 29.));
      // palletteIndex = clamp(palletteIndex, 0, 29);
      // fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
      // fragmentColor = texelFetch(colorScalesTex, ivec2(0, palletteIndex), 0);

      // fragmentColor = texture(colorScalesTex, vec2(0.1, map_range(KtoC(base[TEMPERATURE]), -70., 60., 0., 1.)));

      fragmentColor = tempToColor(base[TEMPERATURE], colorScalesTex);

      drawVectorField(base.xy * 10., displayVectorField);
      break;
    case WALLTYPE_FIRE: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    }
  } else { // fluid

    // int palletteIndex = int(map_range(realTempC, -71.0, 59.0, 0., 130.));
    // palletteIndex = clamp(palletteIndex, 0, 130);
    // fragmentColor = texelFetch(colorScalesTex, ivec2(0, palletteIndex), 0);

    fragmentColor = tempToColor(realTemp, colorScalesTex);

    drawVectorField(base.xy, displayVectorField);
  }

  // drawDirLines(base.xy);
  // drawIsoLines(base[2]);
  drawCursor(cursor, view);
}