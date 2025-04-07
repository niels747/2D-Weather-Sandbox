#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down
in vec2 texCoordXmY0; // left
in vec2 texCoordXpY0; // right

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float sunAngle;

uniform float sunIntensity;

uniform float IR_rate;

uniform float greenhouseGases;
uniform float waterGreenHouseEffect;

layout(location = 0) out vec4 light;
layout(location = 1) out vec4 reflectedLight;

uniform float dryLapse;

#include "common.glsl"

void main()
{
  if (fragCoord.y >= resolution.y - 1.)
    light = vec4(sunIntensity, 0, 0, 0); // at top: full sun, no IR
  else {

    float cellHeightCompensation = 300. / resolution.y; // 300 cells = 1.0     100 cells = 3.0

    // sunlight calculation

    vec2 sunRay = vec2(sin(sunAngle) * texelSize.x, cos(sunAngle) * texelSize.y);
    float sunlight = texture(lightTex, texCoord + sunRay)[SUNLIGHT];
    // float sunlight = bilerp(lightTex, fragCoord + vec2(sin(sunAngle) ,

    float realTemp = potentialToRealT(texture(baseTex, texCoord)[TEMPERATURE]);
    vec4 water = texture(waterTex, texCoord);
    ivec4 wall = texture(wallTex, texCoord);

    float scatering = clamp(map_range(abs(sunAngle), 75. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // how red the sunlight is
    vec3 sunlightColor = sunColor(scatering);

    if (wall[DISTANCE] != 0) {                                                  // is not wall

      reflectedLight.rgb += sunlightColor * sunlight * (1. - texCoord.y) * 2.0; // scatering in air

      float net_heating = 0.0;

      if (fragCoord.y < resolution.y - 2.) {                                                                       // prevent shadow bug above simulation area
        float reflection = min((water[CLOUD] * 0.20 + water[PRECIPITATION] * 0.010) * cellHeightCompensation, 1.); // 0.035 cloud + 0.35 precipitation
        float absorbtion = min(water[SMOKE] * 0.020 * cellHeightCompensation, 1.);                                 // 0.025 dust/smoke

        float lightReflected = sunlight * reflection;
        float lightAbsorbed = sunlight * absorbtion;

        sunlight = max(0., sunlight - lightReflected - lightAbsorbed);


        // vec3 finalLight = sunColor(scatering)

        reflectedLight.rgb = sunlightColor * lightReflected; // sunlight reflected by clouds and precipitation


        // float avgSunlight = (texture(lightTex, texCoordX0Ym)[SUNLIGHT] + texture(lightTex, texCoordX0Yp)[SUNLIGHT] + texture(lightTex, texCoordXmY0)[SUNLIGHT] + texture(lightTex, texCoordXpY0)[SUNLIGHT]) / 4.0;

        // sunlight -= (sunlight - avgSunlight) * 0.8; // smooth

        net_heating += lightAbsorbed * lightHeatingConst; // dust/smoke being heated
      }

      // longwave / IR calculation
      float IR_down = texture(lightTex, texCoordX0Yp)[IR_DOWN];
      float IR_up;

      if (wall[VERT_DISTANCE] == 1) { // 1 above surface

        switch (wall[TYPE]) {
        case WALLTYPE_RUNWAY:
          // if (abs(sunAngle) > 85. * deg2rad)
          //   reflectedLight.rgb += vec3(1.00, 0.97, 0.57) * 0.03; // Urban area emits light
          // NOBREAK
        case WALLTYPE_URBAN:
        case WALLTYPE_INDUSTRIAL:
          if (abs(sunAngle) > 85. * deg2rad)
            reflectedLight.rgb += vec3(1.00, 0.97, 0.57) * 0.03; // Urban area emits light
                                                                 // NOBREAK
        case WALLTYPE_LAND:
          IR_up = IR_emitted(realTemp);                          // Ir emmited upwards from surface. emissivity of surface = 1.0 for simplicity
          net_heating += (IR_down - IR_up) * IRHeatingConst;
          break;
        case WALLTYPE_WATER:
          float waterTemperature = texture(baseTex, texCoordX0Ym)[TEMPERATURE]; // sample water temperature below
          IR_up = IR_emitted(waterTemperature);                                 // emissivity = 1.0
          break;
        case WALLTYPE_FIRE:
          IR_up = IR_emitted(realTemp + 100.); // fire emits heat
          net_heating = 0.0;
        }
      } else { // in air

        IR_up = texture(lightTex, texCoordX0Ym)[IR_UP];

        float emissivity;                                   // how opage it is too ir, the rest is let trough, no
                                                            // reflection
        emissivity = greenhouseGases;                       // greenhouse gasses
        emissivity += water[TOTAL] * waterGreenHouseEffect; // water vapor
        emissivity += water[CLOUD] * 5.0;                   // cloud water blocks all IR
                                                            // emissivity += water[SMOKE] * 0.0001;                // 0.0001 smoke Should be prettymuch transparent to IR

        emissivity *= cellHeightCompensation;               // compensate for the height of the cell

        emissivity = min(emissivity, 1.0);                  // limit to 1.0

        float absorbedDown = IR_down * emissivity;
        float absorbedUp = IR_up * emissivity;
        float emitted = IR_emitted(realTemp) * emissivity; // this amount is emitted both up and down

        net_heating += (absorbedDown + absorbedUp - emitted * 2.0) * IRHeatingConst;

        IR_down -= absorbedDown;
        IR_down += emitted;

        IR_up -= absorbedUp;
        IR_up += emitted;
      }

      float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
      float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);
      vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0)) * 1.0; // 1.0, 0.7, 0.0
      vec3 FinalFireCol = mix(vec3(0), fireCol, fireIntensity);

      reflectedLight.rgb += FinalFireCol * 0.1;

      net_heating *= IR_rate;

      light = vec4(sunlight, net_heating, IR_down, IR_up);
      // light = vec4(1, 0, 0, 0);
    } else {                                    // is wall
      if (wall[TYPE] == WALLTYPE_WATER)         // water
        light = vec4(sunlight * 0.90, 0, 0, 0); // light absorbed by water
      else {                                    // land

        const vec3 groundCol = vec3(0.60, 0.5, 0.4);

        vec3 lightReflected = vec3(sunlight) * groundCol;
        vec3 lightAbsorbed = vec3(sunlight) - lightReflected;

        light = vec4(0.0, 0, 0, 0); // all light absorbed by ground
        reflectedLight.rgb += lightReflected;
      }
    }
  }
}