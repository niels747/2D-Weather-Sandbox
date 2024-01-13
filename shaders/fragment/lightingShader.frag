#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

in vec2 texCoordX0Yp; // up
in vec2 texCoordX0Ym; // down

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float sunAngle;
// uniform float waterTemperature;

uniform float sunIntensity;

uniform float greenhouseGases;
uniform float waterGreenHouseEffect;

out vec4 light;

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

    if (wall[DISTANCE] != 0) { // is not wall

      float net_heating = 0.0;

      if (fragCoord.y < resolution.y - 2.) {                                                                        // prevent shadow bug above simulation area
        float reflection = min((water[CLOUD] * 0.020 + water[PRECIPITATION] * 0.010) * cellHeightCompensation, 1.); // 0.035 cloud + 0.35 precipitation
        float absorbtion = min(water[SMOKE] * 0.020 * cellHeightCompensation, 1.);                                  // 0.025 dust/smoke

        float lightReflected = sunlight * reflection;
        float lightAbsorbed = sunlight * absorbtion;

        sunlight = max(0., sunlight - lightReflected - lightAbsorbed);

        net_heating += lightAbsorbed * lightHeatingConst; // dust/smoke being heated
      }

      // longwave / IR calculation
      float IR_down = texture(lightTex, texCoordX0Yp)[IR_DOWN];
      float IR_up;

      if (wall[VERT_DISTANCE] == 1) { // 1 above surface

        switch (wall[TYPE]) {
        case WALLTYPE_URBAN:
        case WALLTYPE_LAND:
          IR_up = IR_emitted(realTemp); // Ir emmited upwards from surface. emissivity of surface = 1.0 for simplicity
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

      light = vec4(sunlight, net_heating, IR_down, IR_up);
      // light = vec4(1, 0, 0, 0);
    } else {                                    // is wall
      if (wall[TYPE] == WALLTYPE_WATER)         // water
        light = vec4(sunlight * 0.90, 0, 0, 0); // light absorbed by water
      else                                      // land
        light = vec4(sunlight * 0.5, 0, 0, 0);  // light absorbed by ground
    }
  }
}
