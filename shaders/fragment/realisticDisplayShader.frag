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
uniform sampler2D lightningTex;
uniform sampler2D lightningLocationTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

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

vec3 emittedLight = vec3(0.); // pure light, like lightning

vec3 onLight;                 // extra light that lights up objects, just like sunlight and shadowlight


const vec3 bareEarthCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


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
  vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.)); // green to brown

  vec3 surfCol = mix(bareEarthCol, vegetationCol, min(float(wall[VEGETATION]) / 50., 1.));

  const vec3 groundCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, groundCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                   // add noise texture

  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}

const vec2 lightningTexRes = vec2(2500, 5000);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float iterNumMod = iterNum - startIterNum;
  return iterNumMod / 5.0; // 30.0    0. to 1. leader stage, 1. + Flash stage
}

float lightningIntensityOverTime(float T) { return max((1. / (0.05 + pow((T - 1.) * 2.0, 3.))) - 0.005, 0.); }

vec3 displayLightning(vec2 pos, float startIterNum)
{
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);

  lightningTexCoord.y -= pos.y;

  float scaleMult = 1. / pos.y; // 1.0 means lightning is as tall as the simheight


  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  lightningTexCoord.x += 0.5;                                                                                               // center lightning bolt

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec3(0);

  float pixVal = texture(lightningTex, lightningTexCoord).r;

  float lightningTime = calcLightningTime(startIterNum);

  const float branchShowFactor = 2.5;       // 1.5
  const float leaderBrightness = 100000.;   // 200.0
  const float mainBoltBrightness = 100000.; // 100000.

  float brightnessThreshold = 1. - lightningTime * branchShowFactor;
  brightnessThreshold += lightningTexCoord.y * branchShowFactor; // grow from the top to the bottem

  brightnessThreshold = clamp(brightnessThreshold, 0., 1.);

  float lightningIntensity = leaderBrightness;

  if (lightningTime > 1.0) { // main bolt
    brightnessThreshold = 0.95;
    lightningIntensity = lightningIntensityOverTime(lightningTime) * mainBoltBrightness;
  }

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= lightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}

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

    float cloudDensity = max(cloudwater * 13.6, 0.0);

    float totalDensity = cloudDensity + water[PRECIPITATION] * 0.8; // visualize precipitation

    // float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);
    float cloudOpacity = clamp(1.0 - (1.0 / (1. + totalDensity)), 0.0, 1.0);

    const vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
    const vec3 smokeThickCol = vec3(0., 0., 0.);


    float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
    float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);

    vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0

    vec3 smokeCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

    shadowLight += fireIntensity * 1.5;

    opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                // alpha blending
    color = (smokeCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending

    vec4 lightningLocation = texture(lightningLocationTex, vec2(0.5));
    vec2 lightningPos = lightningLocation.xy;
    float lightningStartIterNum = lightningLocation.z;

    emittedLight += displayLightning(lightningPos, lightningStartIterNum); // needs to be added as light

    emittedLight /= 1. + cloudDensity * 100.0;

#define lightningOnLightBrightness 0.002

    vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
    dist.x *= aspectRatios[0];
    float lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
    lightningOnLight *= lightningIntensityOverTime(calcLightningTime(lightningStartIterNum) - 0.1);
    onLight += vec3(lightningOnLight);

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
        if (texCol.a > 0.5) {                  // if not transparent

          if (nightTime) {                     // TODO: make dependent  on light level
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
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
            vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
            vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
            texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
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

  vec3 finalLight = sunColor(scatering) * light;


  if (fract(cursor.w) > 0.5) {                                               // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  finalLight += vec3(shadowLight) + onLight;

  opacity += length(emittedLight);
  opacity = clamp(opacity, 0.0, 1.0);
  fragmentColor = vec4(max(color * finalLight, 0.) + emittedLight, opacity);

  drawCursor(cursor, view); // over everything else
}
