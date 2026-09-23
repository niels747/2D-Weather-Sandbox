#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
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
  vec4 base = bilerpWall(baseTex, wallTex, fragCoord);
  vec4 water = bilerpWall(waterTex, wallTex, fragCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  if (wall[DISTANCE] == 0) {
    switch (wall[TYPE]) {
    case WALLTYPE_INERT:
      fragmentColor = vec4(0, 0, 0, 1.);
      break;
    case WALLTYPE_LAND:
      fragmentColor = vec4(vec3(0.10), 1.);
      break;
    case WALLTYPE_WATER:
      int palletteIndex = int(map_range(KtoC(base[3]), -26. - 2., 30., 0., 29.));
      palletteIndex = clamp(palletteIndex, 0, 29);
      // fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
      break;
    case WALLTYPE_FIRE:
      fragmentColor = vec4(1.0, 0.5, 0.0, 1.);
      break;
    }
  } else { // fluid

    float relativeHumidity = relativeHumd(realTemp, water[TOTAL]);

    if (relativeHumidity < 1.0) {

      float pallettePos = map_range(relativeHumidity, 0.0, 1.0, 0., 10. / 131.);

      fragmentColor = texture(colorScalesTex, vec2(2. / 4. + (1. / 8.), pallettePos)); // sample 3rd column (2)
    } else {
      // float cloudDens = relativeHumidity;
      float cloudDens = water[CLOUD];
      fragmentColor = texture(colorScalesTex, vec2(1.0, map_range(cloudDens, 0.0, 10.0, 0.5 / 131., 15. / 131.)));
      //   fragmentColor = vec4(vec3(1.-cloudDens* 0.20), 1.); // simple grayscale
    }

    drawVectorField(base.xy, displayVectorField);
  }

  drawCursor(cursor, view);
}