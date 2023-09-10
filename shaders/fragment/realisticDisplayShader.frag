#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;

#define CITY 0
#define FOR_FIRE 1
#define FOR_SNOW 2
#define FOR_NORM 3


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight;

uniform float dryLapse;
uniform float sunAngle;

uniform float exposure;
uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

out vec4 fragmentColor;

#include "common.glsl"

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float light;

vec3 color;
float opacity = 1.0;


vec4 surfaceTexture(int index, vec2 pos)
{
  pos.y = clamp(pos.y, 0., 1.);

  pos = pos / 4.0;

  pos.y += float(index) * 0.25 + 0.001;

  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 earthCol = vec3(0.5, 0.2, 0.1);
  vec3 grassCol = vec3(0.0, 0.7, 0.2);

  vec3 surfCol = mix(earthCol, grassCol, min(float(wall[3]) / 50., 1.));

  const vec3 groundCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, groundCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

  // add snow at surface
  color = mix(color, vec3(1.0), clamp(water[3] / 100. - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}

#define minShadowLight 0.15 // 0.05


void main()
{
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  light = texture(lightTex, bndFragCoord * texelSize)[0];

  float shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[1];

  if (texCoord.y < 0.) {         // < texelSize.y below simulation area

    vec3 groundCol = vec3(0.75); // gray rock

    // ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    // ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    float depth = float(-wall[2]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    light = texture(lightTex, vec2(texCoord.x, texelSize.y))[0]; // sample lowest part of sim area
    light *= pow(0.5, -fragCoord.y);                             // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                 // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;           // completely transparent
  } else if (wall[1] == 0) { // is wall
                             // color = getWallColor(texCoord);
    switch (wall[0]) {       // wall type
                             // case 0:            // normal wall
                             //   color = vec3(0, 0, 0);
                             //   break;
    case 3:                  // Fire wall
    case 1:                  // land wall

      ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
      ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[2]), float(-wall[2]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[2]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case 2: // water wall
      color = vec3(0, 0.5, 1.0);
      break;
    }

  } else {                                                // air

    vec3 cloudCol = vec3(1.0 / (cloudwater * 0.1 + 1.0)); // white to black
    // vec3 cloudCol = vec3(1.0); // white

    float cloudOpacity = clamp(cloudwater * 4.0 /* + water[2] * 1.0*/, 0.0, 1.0);
    cloudOpacity += clamp(1. - (1. / (water[2] + 1.)), 0.0, 1.0); // precipitation

    const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
    const vec3 smokeThickCol = vec3(0., 0., 0.);
    const vec3 fireCol = vec3(1.0, 0.7, 0.0);

    float smokeOpacity = clamp(1. - (1. / (water[3] + 1.)), 0.0, 1.0);
    float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);
    vec3 smokeCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

    shadowLight += fireIntensity;

    opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                // alpha blending
    color = (smokeCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending
    opacity = clamp(opacity, 0.0, 1.0);

    if (wall[1] == 1) { // adjacent to wall cell
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);

      ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

      if (wallX0Ym[1] == 0 && (wallX0Ym[0] == 1 || wallX0Ym[0] == 3)) {        // land or fire wall below

#define maxTreeHeight 40.0                                                     // height in meters when vegetation max = 127
#define treeTexAspect 0.2855                                                   // height / width of tree texture

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                  // example: 40 / 120 = 0.333

        float localY = mod(fragCoord.y, 1.);                                   // bottem = 0 top = 1

        float treeTexCoordY = localY / treeTexHeightNorm;                      // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[3]), 127., 50., 0., 1.0);   // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * treeTexAspect / treeTexHeightNorm; // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol;
        if (wallX0Ym[0] == 1) {                            // if land
          float snow = texture(waterTex, texCoordX0Ym)[3]; // snow on land below
          texCol = mix(surfaceTexture(FOR_NORM, vec2(treeTexCoordX, treeTexCoordY)), surfaceTexture(FOR_SNOW, vec2(treeTexCoordX, treeTexCoordY)), snow / 100.);
        } else                                             // fire
          texCol = surfaceTexture(FOR_FIRE, vec2(treeTexCoordX, treeTexCoordY));

        if (texCol.a > 0.5) {   // if not transparent
          color = texCol.rgb;
          if (wallX0Ym[0] == 3) // if fire wall
            shadowLight = 1.0;
        }
        opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending

        // draw 45° slopes
        if (texture(wallTex, texCoordXmY0)[1] == 0) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(-0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (texture(wallTex, texCoordXpY0)[1] == 0) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(-0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }

    // color.rg += vec2(arrow);
    // color.b -= arrow;
    // opacity += arrow;
    // light += arrow;
  }
  /*
    light = min(light, 1.);
    opacity = min(opacity, 1.);
    color = min(color, vec3(1.));
  */
  // float scatering = clamp((0.15 / max(cos(sunAngle), 0.) - 0.15) * (2.0 - texCoord.y * 0.99) * 0.5, 0., 1.); // how red the sunlight is

  float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is

  light = pow(light, 1. / 2.2);                                                                    // gamma correction
  vec3 finalLight = sunColor(scatering) * light;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  finalLight += vec3(shadowLight);

  fragmentColor = vec4(clamp(color * finalLight * exposure, 0., 1.), opacity);


  drawCursor(); // over everything else
}
