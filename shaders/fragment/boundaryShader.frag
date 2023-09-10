#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform sampler2D vortForceTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D precipFeedbackTex; // [0] droplet weight force,  [1] heating and cooling of
                                     // fluid,  [2] evaporation and taking water from cloud

uniform float dryLapse;
uniform float evapHeat;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float vorticity;
uniform float waterEvaporation;
uniform float landEvaporation;
uniform float waterWeight;
uniform vec4 initial_Tv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

uniform float IR_rate;
uniform float sunAngle;

uniform float iterNum; // used as seed for random function

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

#include "common.glsl"

#define minimalFireVegitation 10

#define wallVerticalInfluence 1 // 2 How many cells above the wall surface effects like heating and evaporation are applied
/*
#define wallManhattanInfluence 0 // 2 How many cells from the nearest wall effects like smoothing and drag are applied
#define exchangeRate 0.001       // Rate of smoothing near surface



void exchangeWith(vec2 texCoord) // exchange temperature and water
{
  base[3] -= (base[3] - texture(baseTex, texCoord)[3]) * exchangeRate;
  water[0] -= (water[0] - texture(waterTex, texCoord)[0]) * exchangeRate;
}
*/
void main()
{
  base = texture(baseTex, texCoord);
  water = texture(waterTex, texCoord);

  vec4 precipFeedback = texture(precipFeedbackTex, texCoord);

  float realTemp = potentialToRealT(base[3]);

  wall = texture(wallTex, texCoord);
  ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);
  ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);
  ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

  vec4 light = texture(lightTex, texCoord);

  bool nextToWall = false;

  wall[2] = wallX0Ym[2] + 1;       // height above ground is counted

  if (wall[1] != 0) {              // is fluid, not wall

    base[3] += light[1] * IR_rate; // IR effect

    base[3] += precipFeedback[1];  // rain cools air
    water[0] += precipFeedback[2]; // rain adds water to air
    // recalculate cloud water after changing total water
    water[1] = max(water[0] - maxWater(realTemp), 0.0);
    // 0.004 for rain visualisation
    water[2] = max(water[2] * 0.998 - 0.00005 + precipFeedback[0] * 0.008, 0.0);

    // rain removes smoke from air
    water[3] /= 1. + max(-precipFeedback[2] * 0.3, 0.0) + precipFeedback[0] * 0.003; // rain formation in clouds removes smoke
                                                                                     // quickly , falling rain slower
    water[3] -= precipFeedback[0] * 0.0002;                                          // falling rain slowly removes smoke
                                                                                     // linearly to remove last little bit

    water[3] -= max((water[3] - 4.0) * 0.01, 0.);                                    // dissipate fire color to smoke

    water[3] = max(water[3], 0.0);                                                   // snow and smoke can't go below 0

    // GRAVITY
    // temperature is calculated for Vy location
    vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

#define gravMult 0.0001 // 0.0001 0.0005

    // gravity for convection interpolated between this and above cell to fix wierd waves
    // Because vertical velocity is defined at the top of the cell while temperature is defined in it's center.
    float gravityForce = ((base[3] + baseX0Yp[3]) * 0.5 - (getInitialT(int(fragCoord.y)) + getInitialT(int(fragCoord.y) + 1)) * 0.5) * gravMult;

    // float gravityForce = (base[3] - initial_T[int(fragCoord.y)]) * gravMult;

    gravityForce -= water[1] * gravMult * waterWeight;          // cloud water weight added to gravity force

    gravityForce -= precipFeedback[0] * gravMult * waterWeight; // precipitation weigth added to gravity force

    base[1] += gravityForce;

    // base.x += sin(texCoord.x * PI * 2.0 + iterNum * 0.000005) * (1. - texCoord.y) * 0.00015; // phantom force to simulate high and low pressure areas

    float snowCover = 0.;

    if (wallX0Ym[1] == 0) {                           // below is wall
      nextToWall = true;
      wall[1] = 1;                                    // dist to nearest wall = 1
      wall[0] = wallX0Ym[0];                          // copy wall type from wall below
      snowCover = texture(waterTex, texCoordX0Ym)[3]; // get snow amount
      wall[2] = 1;                                    // directly above ground
    }

    if (wallXmY0[1] == 0) { // left is wall
      nextToWall = true;
      wall[1] = 1;          // dist to nearest wall = 1
      wall[0] = wallXmY0[0];

      if (wallXmY0[0] == 2) { // if left is water, build a dyke
        wall[0] = 1;
        wall[1] = 0;
      }

      if (wallXpY0[1] == 0)        // left and right is wall, make this wall to fill narrow gaps
        wall[1] = 0;
    } else if (wallXpY0[1] == 0) { // right is wall
      nextToWall = true;
      wall[1] = 1;                 // dist to nearest wall = 1
      wall[0] = wallXpY0[0];

      if (wallXpY0[0] == 2) { // if right is water, build a dyke
        wall[0] = 1;
        wall[1] = 0;
      }
    }
    if (wallX0Yp[1] == 0) { // above is wall
      nextToWall = true;
      wall[1] = 1;          // dist to nearest wall = 1
      wall[0] = wallX0Yp[0];

      if (texCoord.y < 0.99 && (wallX0Yp[0] == 1 || wallX0Yp[0] == 2)) { // Fill in land and sea below
        wall[1] = 0;                                                     //  set this to wall
      }
    }


    // if(abs(base.x) > 0.0040 && abs(base.y) > 0.0040){
    //  sample vorticity force
    vec2 vortForceX0Y0 = texture(vortForceTex, texCoord).xy;
    vec2 vortForceXmY0 = texture(vortForceTex, texCoordXmY0).xy;
    vec2 vortForceX0Ym = texture(vortForceTex, texCoordX0Ym).xy;

    // apply vorticity force
    base.xy += vec2(vortForceX0Y0.x + vortForceX0Ym.x, vortForceX0Y0.y + vortForceXmY0.y) * vorticity;
    //}

    if (!nextToWall) { // not next to wall

      // find nearest wall
      int nearest = 255;
      int nearestType = 0;
      if (wallX0Ym[1] < nearest) {
        nearest = wallX0Ym[1];
        nearestType = wallX0Ym[0];
      }
      if (wallX0Yp[1] < nearest) {
        nearest = wallX0Yp[1];
        nearestType = wallX0Yp[0];
      }
      if (wallXmY0[1] < nearest) {
        nearest = wallXmY0[1];
        nearestType = wallXmY0[0];
      }
      if (wallXpY0[1] < nearest) {
        nearest = wallXpY0[1];
        nearestType = wallXpY0[0];
      }

      wall[1] = nearest + 1; // add one to dist to wall
      wall[0] = nearestType; // type = type of nearest wall
    }

    /*
        if (wall[1] <= wallManhattanInfluence) { // within manhattan range of wall

          float influenceDevider = float(wallManhattanInfluence); // devide by how many cells it's aplied to

          // base[0] *= 0.999; // surface drag

          float realTemp = potentialToRealT(base[3]);

          // Smoothing near surface

          if (wallX0Yp[1] != 0 && wallX0Yp[1] <= wallManhattanInfluence) { // above
            exchangeWith(texCoordX0Yp);
          }

          if (wallX0Ym[1] != 0 && wallX0Ym[1] <= wallManhattanInfluence) { // below
            exchangeWith(texCoordX0Ym);
          }

          if (wallXmY0[1] != 0 && wallXmY0[1] <= wallManhattanInfluence) { // left
            exchangeWith(texCoordXmY0);
          }

          if (wallXpY0[1] != 0 && wallXpY0[1] <= wallManhattanInfluence) { // right
            exchangeWith(texCoordXpY0);
          }
        }*/

    if (wall[2] <= wallVerticalInfluence) {                  // within vertical range of wall

      float influenceDevider = float(wallVerticalInfluence); // devide by how many cells it's aplied to

      wall[3] = wallX0Ym[3];                                 // vegetation is copied from below

      // base[2] *= 0.995; // 0.999

      // base[2]  += 0.001; // add air pressure at the suface. makes air rise everywhere and creates huge cells

      if (wall[0] == 1) { // 1 above / next to land surface
        // base[3] += lightHeatingConst * light[0] * cos(sunAngle) / (1. + snowCover) / influenceDevider; // sun heating land

        float lightPower = lightHeatingConst * light[0] * cos(sunAngle); // Light power per horizontal surface area

        // lightPower *= map_rangeC(snowCover, 0., 100.0, 1., 0.);
        lightPower *= map_rangeC(snowCover, 100., 0.0, 1. - ALBEDO_SNOW, 1.);

        base[3] += lightPower / influenceDevider;                                                                                    // sun heating land

        float evaporation = max((maxWater(realTemp) - water[0]) * landEvaporation * (float(wall[3]) / 127.) / influenceDevider, 0.); // water evaporating from land proportional to vegitation

        water[0] += evaporation;
        base[3] -= evaporation * evapHeat;

        if (wall[3] < 10) {                                                      // Dry desert area
          water[3] = min(water[3] + (max(abs(base[0]) - 0.12, 0.) * 0.15), 2.4); // Dust blowing up with wind
        }

      } else if (wall[0] == 2) {                                                                                 // 1 above / next to water surface
        float LocalWaterTemperature = texture(baseTex, texCoordX0Ym)[3];                                         // water temperature
        LocalWaterTemperature = clamp(LocalWaterTemperature, CtoK(0.0), CtoK(maxWaterTemp));                     // limit water temperature. needed for first iteration of old file
        base[3] += (LocalWaterTemperature - realTemp - 1.0) / influenceDevider * 0.0002;                         // air heated or cooled by water

        water[0] += max((maxWater(LocalWaterTemperature) - water[0]) * waterEvaporation / influenceDevider, 0.); // water evaporating

      } else if (wall[0] == 3 && wall[2] == 1) {                                                                 // forest fire & one above surface
        float fireIntensity = float(wall[3]) * 0.00015;
        base[3] += fireIntensity;                                                                                // heat
        water[3] += fireIntensity * 2.0;                                                                         // smoke
        water[0] += fireIntensity * 0.50;                                                                        // extra water from burning trees, both from water in the wood and
                                                                                                                 // from burning of hydrogen and hydrocarbons
      }
    }

  } else { // this is wall


    wall[2] = wallX0Yp[2] - 1;                       // height below ground is counted

    if (wall[2] < 0) {                               // below surface
      water.ba = texture(waterTex, texCoordX0Yp).ba; // soil moisture and snow is copied from above
      wall[3] = wallX0Yp[3];                         // vegetation is copied from above

      if (wallX0Yp[1] == 0 && wall[0] == 2) {        // if above is wall and this is water
        wall[0] = wallX0Yp[0];                       // land can't be over water. copy walltype from above
        base[3] = texture(baseTex, texCoordX0Yp)[3]; // copy temperature from above
        base[3] = clamp(base[3], CtoK(0.0), CtoK(maxWaterTemp));
      }


    } else if (wall[2] == 0) {                                      // at/in surface layer

      if (wall[0] == 1) {                                           // land wall
        water[2] = clamp(water[2] + precipFeedback[2], 0.0, 100.0); // rain accumulation
        water[3] = clamp(water[3] + precipFeedback[3], 0.0, 100.0); // snow accumulation

        // if (random(iterNum + texCoord.x) < 0.001) { // fire updated randomly
        if (int(iterNum) % 700 == 0) {                                                                                                // fire spread at fixed rate

          if (wall[3] >= minimalFireVegitation && (wallXmY0[0] == 3 || wallXpY0[0] == 3 || texture(waterTex, texCoordX0Yp)[3] > 2.5)) // if left or right is on fire or fire is blowing over
            wall[0] = 3;                                                                                                              // spread fire
        }


      } else if (wall[0] == 2) { // water surface
        // average out temperature
        float numNeighbors = 0.;
        float totalNeighborTemp = 0.0;

        if (wallXmY0[0] == 2) { // left is water
          totalNeighborTemp += texture(baseTex, texCoordXmY0)[3];
          numNeighbors += 1.;
        }
        if (wallXpY0[0] == 2) { // right is water
          totalNeighborTemp += texture(baseTex, texCoordXpY0)[3];
          numNeighbors += 1.;
        }
        if (numNeighbors > 0.) { // prevent devide by 0
          float avgNeighborTemp = totalNeighborTemp / numNeighbors;
          base[3] += (avgNeighborTemp - base[3]) * 0.25;
        }
        if (base[3] > 500.0) { // set water temperature for older savefiles
          base[3] = CtoK(25.0);
        }
        // base[3] = clamp(base[3], CtoK(0.0), CtoK(maxWaterTemp)); // limit water temperature range, really only needed for first iteration after loading old save file without water temperature

      } else if (wall[0] == 3 && int(iterNum) % 300 == 0) { // fire wall

        // wall[3] -= int(random(iterNum + texCoord.x * 13.7) * 10.0); // reduce vegetation
        wall[3] -= 1;  // reduce vegetation
        if (wall[3] < minimalFireVegitation)
          wall[0] = 1; // turn off fire
      }
    }
  }
} // main