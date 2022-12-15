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
uniform float waterTemperature;

uniform float sunIntensity;

uniform float greenhouseGases;

out vec4 light;

uniform float dryLapse;
#include functions

void main()
{
  if (fragCoord.y > resolution.y - 1.)
    light = vec4(sunIntensity, 0, 0, 0); // at top: full sun, no IR
  else {

    float cellHeightCompensation = 300. / resolution.y; // 300 cells = 1.0     100 cells = 3.0

    // sunlight calculation

    vec2 sunRay = vec2(sin(sunAngle) * texelSize.x, cos(sunAngle) * texelSize.y);
    float sunlight = texture(lightTex, texCoord + sunRay)[0];
    // float sunlight = bilerp(lightTex, fragCoord + vec2(sin(sunAngle) ,
    // cos(sunAngle)))[0];

    float realTemp = potentialToRealT(texture(baseTex, texCoord)[3]);
    vec4 water = texture(waterTex, texCoord);
    ivec4 wall = texture(wallTex, texCoord);

    if (wall[1] != 0) { // is not wall

      float net_heating = 0.0;

      // old lighting system:
      // float lightReflected = sunlight - (sunlight / (1. + water[1] * 0.025 + water[2] * 0.025)); // 0.025 cloud + 0.025 precipitation
      // float lightAbsorbed = sunlight - (sunlight / (1. + water[3] * 0.010));                     // 0.010 dust/smoke

      float lightReflected = sunlight * (water[1] * 0.040 + water[2] * 0.040) * cellHeightCompensation;
      float lightAbsorbed = sunlight * water[3] * 0.025 * cellHeightCompensation;

      sunlight -= lightReflected + lightAbsorbed;

      net_heating += lightAbsorbed * lightHeatingConst; // dust/smoke being heated

      // longwave / IR calculation
      float IR_down = texture(lightTex, texCoordX0Yp)[2];
      float IR_up;

      if (wall[2] == 1) { // 1 above surface

        if (wall[0] == 1) {             // if land, IR only affects land
          IR_up = IR_emitted(realTemp); // emissivity of surface = 1.0 for simplicity
          net_heating += (IR_down - IR_up) * IRHeatingConst;
          //  net_heating *= 0.5;
        } else if (wall[0] == 2) {              // if water surface
          IR_up = IR_emitted(waterTemperature); // emissivity = 1.0
        } else if (wall[0] == 3) {              // if fire
          IR_up = IR_emitted(realTemp);         // emissivity = 1.0
          net_heating = 0.0;
        }

      } else { // in air

        IR_up = texture(lightTex, texCoordX0Ym)[3];

        float emissivity;                // how opage it is too ir, the rest is let trough, no
                                         // reflection
        emissivity = greenhouseGases;    // 0.001 greenhouse gasses
        emissivity += water[0] * 0.0025; // water vapor
        emissivity += water[1] * 1.5;    // cloud water
        emissivity += water[3] * 0.0001; // 0.01 smoke Should be prettymuch transparent to ir

        emissivity *= cellHeightCompensation; // compensate for the height of the cell

        emissivity = min(emissivity, 1.0); // limit to 1.0

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
      if (wall[0] == 2)                         // water
        light = vec4(sunlight * 0.80, 0, 0, 0); // * 0.95 light absorbed by water
      else                                      // land
        light = vec4(sunlight * 0.5, 0, 0, 0);  // * 0.85 light absorbed by ground
    }
  }
}
