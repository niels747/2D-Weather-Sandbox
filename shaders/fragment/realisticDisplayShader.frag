#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord; // pixel
in vec2 texCoord;  // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D forestTex;
uniform sampler2D forestFireTex;

uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float dryLapse;
uniform float sunAngle;

uniform float exposure;
uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include functions

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float light;

vec3 color;
float opacity = 1.0;

vec3 getSurfaceCol()
{
  //vec3 soilCol = mix(vec3(0.5, 0.2, 0.1), vec3(0.0, 0.7, 0.2), water[2] / 100.); // brown to green, dry earth to grass`
  vec3 soilCol = mix(vec3(0.5, 0.2, 0.1), vec3(0.0, 0.7, 0.2), float(wall[3]) / 100.); // brown to green, dry earth to grass
  return mix(soilCol, vec3(1.0), water[3] / 100.);                     // brown/green to white, snow cover
}

vec3 getWallColor(vec2 coord) {
  base = bilerpWallVis(baseTex, wallTex, coord / texelSize);
  wall = texture(wallTex, coord);
  water = bilerpWallVis(waterTex, wallTex, coord / texelSize);
  // light = texture(lightTex, coord)[0];

  //light /= max(1.0 - texCoord.y * 1500.0, 1.0); // fade light at the top

  //light = pow(light, 1. / 2.2); // gamma correction

  switch (wall[0]) { // wall type
  case 0:            // normal wall
    return vec3(0, 0, 0);
    break;
  case 3: // Fire wall
  case 1: // land wall

    vec3 groundCol;

    
    if (wall[2] == 0) { // surface
     // groundCol = mix(vec3(0.5, 0.2, 0.1), vec3(0.0, 0.7, 0.2), water[2] / 100.); // brown to green, dry earth to grass
     // groundCol = mix(groundCol, vec3(1.0), water[3] / 100.);                     // brown/green to white, snow cover
  groundCol = getSurfaceCol();

      return groundCol;

    }else{
       groundCol = vec3(0.10);                                               // not at surface  dark gray rock
       return vec3((groundCol + texture(noiseTex, vec2(texCoord.x, texCoord.y * (resolution.y / resolution.x)) * 0.2).rgb * 0.2));

    //  vec3 surfCol = getWallColor(vec2(coord.x, coord.y + float(-wall[2]) * texelSize.y ));
  //return surfCol;
    }
    
    
    break;
  case 2: // water wall
    return vec3(0, 0.5, 1.0);
    break;
  }
}



void main() {
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y));
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord*texelSize); // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  light = texture(lightTex, bndFragCoord*texelSize)[0];

  float shadowLight = 0.05;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[1];

  if (texCoord.y < 0.) { // < texelSize.y below simulation area

    vec3 groundCol = vec3((vec3(0.10) + texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb * 0.2));   // dark gray rock

    vec3 surfCol = getSurfaceCol();

  ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

  float depth = float(-wall[2]) -fragCoord.y - 1.0;

  color = mix(surfCol, groundCol, clamp(depth * 0.15, 0., 1.));

  light = texture(lightTex, vec2(texCoord.x, texelSize.y))[0];

  light /= 1. + max(-fragCoord.y, 0.)*0.70; // deeper is darker

  } else if (texCoord.y > 1.0) { // above simulation area
    color = vec3(0);
    opacity = 0.0; // completely transparent
  } else if (wall[1] == 0) { // is wall
    //color = getWallColor(texCoord);
 switch (wall[0]) { // wall type
  // case 0:            // normal wall
  //   color = vec3(0, 0, 0);
  //   break;
    case 3: // Fire wall
  case 1: // land wall

    vec3 groundCol;

    if (wall[2] == 0) {  // surface

      groundCol = getSurfaceCol();
      color = groundCol;

    }else{ // not surface
      groundCol = vec3((vec3(0.10) + texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb * 0.2));   // dark gray rock

      vec3 surfCol = getSurfaceCol();

  ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    float interpDepth = mix(mix(float(-wallXmY0[2]), float(-wall[2]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[2]), clamp(fract(fragCoord.x)-0.5, 0., 0.5));

    float depth = interpDepth - fract(fragCoord.y) -1.0;

  color = mix(surfCol, groundCol, clamp(depth * 0.15, 0., 1.));
    }
    
    break;
  case 2: // water wall
    color = vec3(0, 0.5, 1.0);
    break;
  }

  } else { // air

    vec3 cloudCol = vec3(1.0 / (cloudwater * 0.1 + 1.0)); // white to black
    float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);

    cloudOpacity += clamp(1. - (1. / (water[2] + 1.)), 0.0, 1.0); // precipitation

    vec3 smokeThinCol = vec3(0.8, 0.51, 0.26);
    vec3 smokeThickCol = vec3(0., 0., 0.);
    vec3 fireCol = vec3(1.0, 0.7, 0.0);

    float smokeOpacity = clamp(1. - (1. / (water[3] + 1.)), 0.0, 1.0);
    float fireIntensity = clamp((smokeOpacity -0.8) *25. , 0.0, 1.0);
    vec3 smokeCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

    shadowLight += fireIntensity;

    opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity);                                                // alpha blending
    color = (smokeCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending
    opacity = clamp(opacity, 0.0, 1.0);

    if(wall[1] == 1){// next to wall, create slopes
      float localX = mod(texCoord.x * resolution.x, 1.0);
      float localY = mod(texCoord.y * resolution.y, 1.0);

ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

if(wallX0Ym[1] == 0){ // wall  below

if(wallX0Ym[0] == 1 || wallX0Ym[0] == 3 ){ // land below

float treeTexCoordY = mod(-texCoord.y * resolution.y,1.) - 1. + float(wallX0Ym[3]-50)/77.0; // float(wallX0Ym[3]-100)/27.0)

vec4 texCol;
if(wallX0Ym[0] == 1)
   texCol = texture(forestTex, vec2(texCoord.x * resolution.x * 0.2, treeTexCoordY));
   else
  texCol = texture(forestFireTex, vec2(texCoord.x * resolution.x * 0.2, treeTexCoordY));

    if(texCol.a > 0.5){
    color = texCol.rgb;
    if(wallX0Ym[0] == 3)
      light = 1.0;
    }
    opacity = 1. - (1. - opacity) * (1. - texCol.a);                                                // alpha blending


      if(texture(wallTex, texCoordXmY0)[1] == 0 ){ // wall to the left and below
    if(localX + localY < 1.0){
    opacity = 1.0;
    color = getWallColor(texCoordX0Ym); //  - 1./resolution.y
        }
      } if(texture(wallTex, texCoordXpY0)[1] == 0 ){ // wall to the right and below
    if(localY - localX < 0.0){
    opacity = 1.0;
    color = getWallColor(texCoordX0Ym);
        }
      }
}
    } 
    }
  }

  float scatering = clamp((0.15 / max(cos(sunAngle), 0.) - 0.15) * (2.0 - texCoord.y * 0.99) * 0.5, 0., 1.); // how red the sunlight is
  light = pow(light, 1. / 2.2); // gamma correction
  vec3 lightCol = sunColor(scatering) * light;
  

  if (fract(cursor.w) > 0.5) { // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x;                             // aspect ratio correction to make it a circle
                                                                             // shadowLight += max(1. / (1.+length(vecFromMouse)*5.0),0.0); // point light
    shadowLight += max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0); // smooth flashlight
  }

  lightCol += vec3(shadowLight);

  fragmentColor = vec4(clamp(color * lightCol * exposure, 0., 1.), opacity);

  drawCursor(); // over everything else
}
