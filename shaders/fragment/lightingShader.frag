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
  reflectedLight = vec4(0.0, 0.0, 0.0, 1.0);
  if (fragCoord.y >= resolution.y - 1.)
    light = vec4(sunIntensity, 0, 0, 0); // at top: full sun, no IR
  else {

    float cellHeightCompensation = 300. / resolution.y; // 300 cells = 1.0     100 cells = 3.0

    // Sunlight ray propagation:
    // Step at least 1 full texel along the dominant axis so low sun angles (golden hour / sunset) never self-sample
    float sunlight = 0.0;
    float rayStepLen = 1.0;
    if (sunIntensity > 0.0001 && abs(sunAngle) < 90.0 * deg2rad) {
      vec2 rayDir = vec2(sin(sunAngle), max(cos(sunAngle), 0.04));
      vec2 stepCells = rayDir / max(abs(rayDir.x), abs(rayDir.y));
      rayStepLen = length(stepCells);
      vec2 sampleUV = vec2(
        texCoord.x + stepCells.x * texelSize.x,
        min(texCoord.y + stepCells.y * texelSize.y, 1.0 - texelSize.y * 0.5)
      );
      sunlight = texture(lightTex, sampleUV)[SUNLIGHT];
    }

    float realTemp = potentialToRealT(texture(baseTex, texCoord)[TEMPERATURE]);
    vec4 water = texture(waterTex, texCoord);
    ivec4 wall = texture(wallTex, texCoord);

    float scatering = clamp(map_range(abs(sunAngle), 68. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // atmospheric reddening toward sunset
    vec3 sunlightColor = sunColor(scatering);

    if (wall[DISTANCE] != 0) { // is fluid, not wall

      reflectedLight.rgb += sunlightColor * sunlight * (1. - texCoord.y) * 2.0 / standardSunBrightness; // Rayleigh/aerosol airlight

      float net_heating = 0.0;
      float iceFrac = cloudIceFraction(realTemp);
      float vapor = max(water[TOTAL] - water[CLOUD], 0.0);

      if (fragCoord.y < resolution.y - 2.) { // prevent shadow artifact at top lid
        float pathScale = cellHeightCompensation * rayStepLen;

        // Beer-Lambert shortwave scattering & absorption:
        // Warm liquid clouds have higher scattering optical depth; high ice clouds (cirrus/anvils) are more translucent
        float cloudScatter = pow(max(water[CLOUD], 0.0), 0.80) * mix(0.028, 0.015, iceFrac);
        float precipScatter = pow(max(water[PRECIPITATION], 0.0), 0.75) * 0.006;
        float tauScatter = (0.00022 + cloudScatter + precipScatter) * pathScale;

        float smokeMass = (water[SMOKE] < 3.5) ? water[SMOKE] : 0.25; // exclude glowing fire core
        float tauAbsorb = (smokeMass * 0.020 + water[CLOUD] * 0.00035) * pathScale;

        float tauTotal = tauScatter + tauAbsorb;
        float attenuated = sunlight * (1.0 - exp(-tauTotal));
        float scatterFrac = (tauTotal > 1e-6) ? (tauScatter / tauTotal) : 1.0;

        float lightReflected = attenuated * scatterFrac;
        float lightAbsorbed = attenuated * (1.0 - scatterFrac);

        sunlight = max(0.0, sunlight - attenuated);

        reflectedLight.rgb = sunlightColor * lightReflected / standardSunBrightness; // sunlight scattered by clouds and precipitation

        net_heating += lightAbsorbed * lightHeatingConst; // solar heating of smoke/aerosols & subtle near-IR cloud absorption
      }

      // longwave / IR calculation
      float IR_down = texture(lightTex, texCoordX0Yp)[IR_DOWN];
      float IR_up;

      if (wall[VERT_DISTANCE] == 1) { // 1 above surface

        switch (wall[TYPE]) {
        case WALLTYPE_RUNWAY:
        case WALLTYPE_URBAN:
        case WALLTYPE_INDUSTRIAL:
          if (abs(sunAngle) > 85. * deg2rad)
            reflectedLight.rgb += vec3(1.00, 0.97, 0.57) * 0.03; // Urban area emits light
                                                                 // NOBREAK
        case WALLTYPE_LAND:
          IR_up = IR_emitted(realTemp);                          // Ir emmited upwards from surface. emissivity of surface = 1.0 for simplicity
          net_heating += (IR_down - IR_up) * lightHeatingConst;
          break;
        case WALLTYPE_WATER:
          float waterTemperature = texture(baseTex, texCoordX0Ym)[TEMPERATURE]; // sample water temperature below
          IR_up = IR_emitted(waterTemperature);                                 // emissivity = 1.0
          net_heating += (IR_down - IR_up) * lightHeatingConst;
          break;
        case WALLTYPE_FIRE:
          IR_up = IR_emitted(realTemp + 100.); // fire emits heat
          net_heating = 0.0;
        }
      } else { // in air

        IR_up = texture(lightTex, texCoordX0Ym)[IR_UP];

        if (texture(wallTex, texCoordX0Yp)[DISTANCE] == 0) // wall above
        {
          IR_down = IR_emitted(realTemp);                  // Ir emmited downwars from surface above
          net_heating += (IR_up - IR_down) * lightHeatingConst;
        } else {

          // Beer-Lambert longwave IR emissivity (smooth transition at cloud tops, semi-transparent high cirrus)
          float tauIR = (
            greenhouseGases +
            vapor * waterGreenHouseEffect +
            water[CLOUD] * mix(1.6, 0.65, iceFrac) +
            water[PRECIPITATION] * 0.15
          ) * cellHeightCompensation;

          float emissivity = 1.0 - exp(-max(tauIR, 0.0));

          float absorbedDown = IR_down * emissivity;
          float absorbedUp = IR_up * emissivity;
          float emitted = IR_emitted(realTemp) * emissivity; // this amount is emitted both up and down

          net_heating += (absorbedDown + absorbedUp - emitted * 2.0) * lightHeatingConst;

          IR_down -= absorbedDown;
          IR_down += emitted;

          IR_up -= absorbedUp;
          IR_up += emitted;
        }
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
        reflectedLight.rgb += lightReflected / standardSunBrightness;
      }
    }
  }
}