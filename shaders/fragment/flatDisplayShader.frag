#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // normalized UV

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas
uniform vec3 view;         // Xpos  Ypos    Zoom
uniform vec4 cursor;       // Xpos   Ypos  Size   type
uniform float displayVectorField;

out vec4 fragmentColor;

#include "common.glsl"
#include "commonDisplay.glsl"

void main()
{
  vec4 base  = texture(baseTex, texCoord);
  vec4 water = texture(waterTex, texCoord);
  ivec4 wall = texture(wallTex, texCoord);

  // 1. Sky Gradient: Sky Blue at horizon -> Deep Blue -> Space Black at top
  float heightUV = clamp(texCoord.y, 0.0, 1.0);
  vec3 skyHorizon = vec3(0.35, 0.62, 0.95);  // Horizon / Low atmosphere (Sky Blue)
  vec3 skyUpper   = vec3(0.08, 0.22, 0.52);  // Upper atmosphere (Deep Blue)
  vec3 skySpace   = vec3(0.00, 0.01, 0.03);  // High altitude / Space (Black)

  vec3 color;
  if (heightUV < 0.35) {
    color = mix(skyHorizon, skyUpper, heightUV / 0.35);
  } else {
    color = mix(skyUpper, skySpace, clamp((heightUV - 0.35) / 0.55, 0.0, 1.0));
  }

  float opacity = 1.0;

  // 2. Terrain / Wall Types (Solid Colors)
  if (wall[DISTANCE] == 0) { // Is wall / solid cell
    int wallType = wall[TYPE];
    if (wallType == WALLTYPE_WATER) {
      color = vec3(0.12, 0.42, 0.85); // Solid Blue Water
    } else if (wallType == WALLTYPE_FIRE) {
      color = vec3(0.92, 0.22, 0.12); // Solid Red Fire
    } else if (wallType == WALLTYPE_LAND) {
      color = vec3(0.20, 0.55, 0.25); // Solid Green Land
    } else if (wallType == WALLTYPE_URBAN) {
      color = vec3(0.45, 0.48, 0.52); // Solid Grey Urban
    } else if (wallType == WALLTYPE_INDUSTRIAL) {
      color = vec3(0.35, 0.38, 0.42); // Darker Grey Industrial
    } else {
      color = vec3(0.30, 0.35, 0.30); // Default Ground
    }
  }

  // 3. Cloud / Water Vapor (Solid White with Density Opacity)
  float cloudDensity = water[CLOUD];
  if (cloudDensity > 0.001) {
    float cloudAlpha = clamp(cloudDensity * 1.5, 0.0, 0.95);
    vec3 cloudColor = vec3(1.0, 1.0, 1.0); // Solid White Cloud
    color = mix(color, cloudColor, cloudAlpha);
  }

  // 4. Vector field overlay if enabled
  float arrow = vectorField(base.xy, displayVectorField);
  if (arrow > 0.5) {
    fragmentColor = vec4(1.0, 1.0, 0.0, 1.0);
    return;
  }

  fragmentColor = vec4(color, opacity);
  drawCursor(cursor, view); // Cursor overlay
}
