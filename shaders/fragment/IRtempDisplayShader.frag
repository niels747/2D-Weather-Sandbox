#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D lightTex;
uniform isampler2D wallTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform int upOrDown; // 0 = down     1 = up

uniform vec3 view;    // Xpos  Ypos    Zoom
uniform vec4 cursor;  // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "common.glsl"

#include "commonDisplay.glsl"

void main()
{
  vec4 light = texture(lightTex, texCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float IRtemp = KtoC(IR_temp(light[upOrDown + 2])); // index 2 or 3

  if (wall[1] == 0) {                                // is wall
    switch (wall[0]) {                               // wall type
    case 0:
      fragmentColor = vec4(0, 0, 0, 1);
      break;
    case 1: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case 2: // water wall
      fragmentColor = vec4(0, 0.5, 0.99, 1);
      break;
    case 3: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    }
  } else {

    int palletteIndex;

    if (upOrDown == 1)
      palletteIndex = int(map_range(IRtemp, -26. - 2., 30., 0., 29.)); // up
    else
      palletteIndex = int(map_range(IRtemp, -60. - 2., 26., 0., 29.)); // down

    palletteIndex = clamp(palletteIndex, 0, 29);

    fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
  }
  drawCursor(cursor, view);
}