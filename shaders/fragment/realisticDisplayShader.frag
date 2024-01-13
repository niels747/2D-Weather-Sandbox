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
uniform sampler2D curlTex;

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float exposure;
uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;

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
#define numTextures 4.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 earthCol = vec3(0.5, 0.2, 0.1);
  vec3 grassCol = vec3(0.0, 0.7, 0.2);

  vec3 surfCol = mix(earthCol, grassCol, min(float(wall[VEGETATION]) / 50., 1.));

  const vec3 groundCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, groundCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                // add noise texture

  color = mix(color, vec3(1.0), clamp(min(water[3], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}


#define minShadowLight 0.10 // 0.15


void main()
{
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  light = texture(lightTex, bndFragCoord * texelSize)[0];

  bool nightTime = abs(sunAngle) > PI * 0.5 - 0.05; // false = day time

  float shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  if (texCoord.y < 0.) {         // < texelSize.y below simulation area

    vec3 groundCol = vec3(0.75); // gray rock

    // ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    // ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    light = texture(lightTex, vec2(texCoord.x, texelSize.y))[0]; // sample lowest part of sim area
    light *= pow(0.5, -fragCoord.y);                             // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                 // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;                  // completely transparent
  } else if (wall[DISTANCE] == 0) { // is wall
                                    // color = getWallColor(texCoord);
    switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_URBAN:
      // color = vec3(0.5); // grey
      // break;
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
      ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:
      color = vec3(0, 0.5, 1.0);
      break;
    }

  } else {                                                  // air

    vec3 cloudCol = vec3(1.0 / (cloudwater * 0.005 + 1.0)); // 0.10 white to black
                                                            // vec3 cloudCol = vec3(1.0); // white

    // float curl = bilerp(curlTex, fragCoord).x;
    //  float curl = texture(curlTex, texCoord).x;

    // fragmentColor = vec4(vec3(curl * 5.), 1.0);

    float vaporDensity = max(cloudwater * 13.6, 0.0);

    vaporDensity += water[PRECIPITATION] * 0.8; // visualize precipitation

    // float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
    float cloudOpacity = clamp(1.0 - (1.0 / (1. + vaporDensity)), 0.0, 1.0);

    const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
    const vec3 smokeThickCol = vec3(0., 0., 0.);
    const vec3 fireCol = vec3(1.0, 0.7, 0.0);

    float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
    float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);
    vec3 smokeCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

    shadowLight += fireIntensity;

    opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                // alpha blending
    color = (smokeCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending
    opacity = clamp(opacity, 0.0, 1.0);

    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

#define texAspect 1. / 2.      // height / width of tree texture
#define maxTreeHeight 40.      // height in meters when vegetation max = 127
#define maxBuildingHeight 400. // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol;
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          float snow = texture(waterTex, texCoordX0Ym)[SNOW];                      // snow on land below
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(1);                                                      // show white snow
          else
            texCol = mix(surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY)), surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
        }

        // draw 45° slopes
        if (texture(wallTex, texCoordXmY0)[DISTANCE] == 0) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(-0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        if (texture(wallTex, texCoordXpY0)[DISTANCE] == 0) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(-0.6);
            shadowLight = minShadowLight; // fire should not light ground
          }
        }
        //}
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


  // vec2 uv = vec2(texCoord.x * texelSize.y / texelSize.x, texCoord.y);
  // uv *= 10.;
  // fragmentColor = vec4(vec3(func2D(uv)), 1.0);


  drawCursor(); // over everything else
}
