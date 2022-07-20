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
uniform sampler2D
    precipFeedbackTex; // [0] droplet weight force,  [1] heating and cooling of
                       // fluid,  [2] evaporation and taking water from cloud

uniform float dryLapse;
uniform float evapHeat;
uniform vec2 resolution;
uniform vec2 texelSize;
uniform float vorticity;
uniform float waterTemperature;
uniform float waterEvaporation;
uniform float landEvaporation;
uniform float waterWeight;
uniform float initial_T[300];

uniform float IR_rate;
uniform float sunAngle;

uniform float iterNum; // used as seed for random function

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall; // [0] walltype    [1] distance to nearest
                                     // wall      [2] height above ground

/*
base:
[0] = vx
[1] = vy
[2] = p
[3] = t
*/

#include functions

#define wallInfluence 2 // 2
#define exchangeRate 0.001

void exchangeWith(vec2 texCoord) // exchange temperature and water
{
  base[3] -= (base[3] - texture(baseTex, texCoord)[3]) * exchangeRate;
  water[0] -= (water[0] - texture(waterTex, texCoord)[0]) * exchangeRate;
}

void main() {
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

  wall[2] = wallX0Ym[2] + 1; // height above ground is counted

  if (texCoord.y < 0.99 && wallX0Yp[1] == 0 && wallX0Yp[0] != 0 &&
      wallX0Yp[0] != 3) {  // Fill in land and sea below
    wall[0] = wallX0Yp[0]; //  set this to type above
    wall[1] = 0;           //  set this to wall
  }

  if (wall[1] != 0) { // is fluid, not wall

    base[3] += light[1] * IR_rate; // IR effect

    base[3] += precipFeedback[1];  // rain changes air temperature
    water[0] += precipFeedback[2]; // rain adds water
    water[1] = max(water[0] - maxWater(realTemp),
                   0.0); // recalculate cloud water after changing water

    water[2] = max(water[2] * 0.998 - 0.00005 + -precipFeedback[0] * 0.008,
                   0.0); // 0.004 for rain visualisation

    // remove smoke
    water[3] /=
        1. + max(-precipFeedback[2] * 0.3, 0.0) -
        precipFeedback[0] * 0.003; // rain formation in clouds removes smoke
                                   // quickly , falling rain slower
    water[3] +=
        precipFeedback[0] * 0.0002; // falling rain slowly removes smoke
                                    // linearly to remove last little bit

water[3] -= max((water[3] - 4.0) * 0.01, 0.); // dissipate fire

    water[3] = max(water[3], 0.0); // smoke can't go below 0

    // GRAVITY
    // temperature is calculated for Vy location
    vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);

#define gravMult 0.0001 // 0.0002

    // float gravityForce = ((base[3] + baseX0Yp[3]) * 0.5 -
    // (initial_T[int(fragCoord.y)] + initial_T[int(fragCoord.y) + 1]) * 0.5) *
    // gravMult; // 0.0005  0.0001  gravity for convection

    float gravityForce = (base[3] - initial_T[int(fragCoord.y)]) *
                         gravMult; // 0.0005  0.0001  gravity for convection

    gravityForce -= water[1] * gravMult * waterWeight; // cloud water weigth

    gravityForce += precipFeedback[0] * gravMult; // precipitation weigth

    base[1] += gravityForce;

    float snowCover = 0.;

    if (wallX0Ym[1] == 0) { // below is wall
      nextToWall = true;
      wall[0] = wallX0Ym[0]; // copy wall type from wall below
      snowCover = texture(waterTex, texCoordX0Ym)[3]; // get snow amount
      wall[2] = 1; // directly above ground
    }
    if (wallX0Yp[1] == 0) {
      nextToWall = true;
      wall[0] = wallX0Yp[0];
    }
    if (wallXmY0[1] == 0) {
      nextToWall = true;
      wall[0] = wallXmY0[0];
    }
    if (wallXpY0[1] == 0) {
      nextToWall = true;
      wall[0] = wallXpY0[0];
    }


     // if(abs(base.x) > 0.0040 && abs(base.y) > 0.0040){
      //  sample vorticity force
      vec2 vortForceX0Y0 = texture(vortForceTex, texCoord).xy;
      vec2 vortForceXmY0 = texture(vortForceTex, texCoordXmY0).xy;
      vec2 vortForceX0Ym = texture(vortForceTex, texCoordX0Ym).xy;

      base.xy += vec2(vortForceX0Y0.x + vortForceX0Ym.x,
                      vortForceX0Y0.y + vortForceXmY0.y) *
                 vorticity; // apply vorticity force
      //}


    if (nextToWall) {
      // wall[0] = wallX0Ym[0]; // type = type of down wall
      wall[1] = 1; // dist to nearest wall = 1

    } else {       // not next to wall

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

    if (wall[1] <= wallInfluence) { // within range of wall

      wall[3] = wallX0Ym[3]; // vegetation is copied from below

      float devider = float(wallInfluence);

      // base[0] *= 0.999; // surface drag

      float realTemp = potentialToRealT(base[3]);

      if (wall[0] == 1) { // land surface
        base[3] += lightHeatingConst * light[0] * cos(sunAngle) /
                   (1. + snowCover) / devider; // sun heating land

        float evaporation =
            max((maxWater(realTemp) - water[0]) * landEvaporation * (float(wall[3])/127.) / devider,
                0.); // water evaporating from land proportional to vegitation

        water[0] += evaporation;
        base[3] -= evaporation * evapHeat;

        if(wall[3] < 10){ // Dry desert area
            water[3] = min(water[3] + (max(abs(base[0])-0.12, 0.) * 0.15), 2.4); // Dust blowing up with wind
        }

      } else if (wall[0] == 2) { // water surface
        base[3] += (waterTemperature - realTemp - 1.0) / devider *
                   0.0002; // air heated or cooled by water

        water[0] += max((maxWater(waterTemperature) - water[0]) *
                            waterEvaporation / devider,
                        0.); // water evaporating
        // water[0] += waterEvaporation * max((0.95 - relativeHumd(realTemp,
        // water[0])),0.0);
      } else if (wall[0] == 3) { // forest fire
        if(wall[2] == 1){ // one above surface

        float fireIntensity = float(wall[3]) * 0.00015;
        base[3] += fireIntensity;  // heat
        water[3] += fireIntensity*2.0; // smoke
        water[0] += fireIntensity * 0.50; // extra water from burning trees, both from water in the wood and from burning of hydrogen and hydrocarbons
}
      }

      if (wallX0Yp[1] != 0 && wallX0Yp[1] <= wallInfluence) { // above
        exchangeWith(texCoordX0Yp);
      }

      if (wallX0Ym[1] != 0 && wallX0Ym[1] <= wallInfluence) { // below
        exchangeWith(texCoordX0Ym);
      }

      if (wallXmY0[1] != 0 && wallXmY0[1] <= wallInfluence) { // left
        exchangeWith(texCoordXmY0);
      }

      if (wallXpY0[1] != 0 && wallXpY0[1] <= wallInfluence) { // right
        exchangeWith(texCoordXpY0);
      }

    }      // within range of wall
  } else { // is wall
    water[2] =
        clamp(water[2] + precipFeedback[2], 0.0, 100.0); // rain accumulation
    water[3] =
        clamp(water[3] + precipFeedback[3], 0.0, 100.0); // snow accumulation
        wall[2] = wallX0Yp[2] - 1; // height below ground is counted

        if(wall[2] < 0){ // below surface
          water.ba = texture(waterTex, texCoordX0Yp).ba; // soil moisture and snow is copied from above
          wall[3] = wallX0Yp[3]; // vegetation is copied from above
        }else if(wall[2] == 0){

         


          if(random(iterNum + texCoord.x) < 0.001){ // fire updated randomly

 //if (wallXmY0[1] == 0) {
            if(wallXmY0[0] == 3 || wallXpY0[0] == 3 || texture(waterTex, texCoordX0Yp)[3] > 2.5) // if left or right is on fire or fire is blowing over
        wall[0] = 3; // spread fire
 //   }

             if(wall[0] == 3){


            wall[3] -= int(random(iterNum + texCoord.x*13.7)*10.0); //reduce vegitation
            if(wall[3] < 25)
              wall[0] = 1; // turn off fire
          }
          }
        }
  }
} // main