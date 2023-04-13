#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 texCoordXmYp; // left up
in vec2 texCoordXpYm; // right down

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

uniform vec4 userInputValues; // xpos   Ypos   intensity   Size
uniform vec2 userInputMove;   // moveX  moveY
uniform int userInputType;    // 0 = nothing 	1 = temp ...

uniform float dryLapse;
uniform float evapHeat;
uniform float meltingHeat;

uniform float globalEffectsHeight;
uniform float globalDrying;
uniform float globalHeating;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

uniform vec2 resolution;

vec2 texelSize;

uniform vec4 initial_Tv[76];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

#include "common.glsl"

void main()
{
  wall = texture(wallTex, texCoord);

  texelSize = vec2(1) / resolution;

  float actualTempChange = 0.0, realTemp;

  if (wall[1] != 0) { // not wall

    vec4 cellX0Y0 = texture(baseTex, texCoord);
    vec4 cellXmY0 = texture(baseTex, texCoordXmY0);
    vec4 cellX0Ym = texture(baseTex, texCoordX0Ym);
    vec4 cellXpY0 = texture(baseTex, texCoordXpY0);
    vec4 cellX0Yp = texture(baseTex, texCoordX0Yp);

    vec4 cellXmYp = texture(baseTex, texCoordXmYp);
    vec4 cellXpYm = texture(baseTex, texCoordXpYm);

    // calculate velocities for different positions within cell
    vec2 velAtP = vec2((cellXmY0.x + cellX0Y0.x) / 2.,
                       (cellX0Ym.y + cellX0Y0.y) / 2.);                                        // center of cell
    vec2 velAtVx = vec2(cellX0Y0.x, (cellX0Ym.y + cellXpY0.y + cellX0Y0.y + cellXpYm.y) / 4.); // midle of right edge of cell
    vec2 velAtVy = vec2((cellXmY0.x + cellX0Yp.x + cellXmYp.x + cellX0Y0.x) / 4.,
                        cellX0Y0.y);                                                           // midle of top edge of cell

    // ADVECT AIR:

    // base = bilerp(baseTex, fragCoord - cellX0Y0.xy); // old simple advection

    base[0] = bilerp(baseTex, fragCoord - velAtVx)[0]; // Vx
    base[1] = bilerp(baseTex, fragCoord - velAtVy)[1]; // Vy
                                                       // base[0] = bilerpWall(baseTex, wallTex, fragCoord - velAtVx)[0]; // Vx
                                                       // base[1] = bilerpWall(baseTex, wallTex, fragCoord - velAtVy)[1]; // Vy


    // base[2] = bilerp(baseTex, fragCoord - velAtP)[2];
    // base[3] = bilerp(baseTex, fragCoord - velAtP)[3];

    base[2] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[2];
    base[3] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[3];

    water.xyw = bilerpWall(waterTex, wallTex, fragCoord - velAtP).xyw; // centered

    // water.z = bilerpWall(waterTex, wallTex, fragCoord + vec2(0.0, +0.01)).z;
    // // precipitation visualization
    water.z = texture(waterTex, texCoord).z; // precipitation visualization

    // vec2 backTracedPos = fragCoord - velAtP; // advect / flow

    // vec2 backTracedPos = texCoord; // no flow

    // water.xy = bilerp(waterTex, backTracedPos).xy;

    realTemp = potentialToRealT(base[3]);

    float newCloudWater = max(water[0] - maxWater(realTemp), 0.0);            // calculate cloud water

    float dT = (newCloudWater - water[1]) * evapHeat;                         // how much that water phase change would change the
                                                                              // temperature

    float dWt = max(water[0] - maxWater(realTemp + dT), 0.0) - newCloudWater; // how much that temperature change would change
                                                                              // the amount of liquid water

    actualTempChange = dT_saturated(dT, dWt * evapHeat);

    base[3] += actualTempChange; // APPLY LATENT HEAT!

    realTemp += actualTempChange;

    float tempC = KtoC(realTemp);

    float relHum = relativeHumd(realTemp, water[0]);

    // Radiative cooling and heating effects

    if (texCoord.y > globalEffectsHeight) { //
      water[0] -= globalDrying;             // drying 0.00001
      base[3] += globalHeating;

      if (texCoord.y > 0.9) {
        base[3] -= (KtoC(realTemp) - -60.0) * 0.001; // tropopause temperature stabilization
      }
    }

    // water[0] -= max(water[1] - 0.1, 0.0) * 0.0001; // Precipitation effect
    // drying !

    water[0] = max(water[0], 0.0);     // prevent water from going negative

  } else {                             // this is wall

    base = texture(baseTex, texCoord); // pass trough

    water = texture(waterTex, texCoord);

    base[3] = 1000.0; // special temperature, just to identify that this is a
                      // wall cell when drawing the graph

    ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

    if (wallX0Yp[1] != 0) { // cell above is not wall, surface layer

      // prevent negative numbers
      wall[3] = max(wall[3], 0);
      water[2] = max(water[2], 0.0);

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      vec4 waterX0Yp = texture(waterTex, texCoordX0Yp);

      float tempC = KtoC(potentialToRealT(baseX0Yp[3])); // temperature of cell above

      if (water[3] > 0.0 && tempC > 0.0) {               // snow melting on ground
        float melting = min(tempC * snowMeltRate, water[3]);
        water[3] -= melting;
        base[3] += melting * meltingHeat; // signal snow melting, will be applied in pressure shader
        water[2] += melting;              // melting snow adds water to soil
      }

      if (water[2] > 0.0 && tempC > 0.0) { // water evaporating from ground
        float evaporation = max((maxWater(CtoK(tempC)) - water[0]) * 0.00001, 0.);
        water[2] -= evaporation;
      }
    }
  }

  // USER INPUT:

  bool inBrush = false;           // if cell is in brush area
  float weight = 1.0;             // 1.0 at center, 0.0 at border

  if (userInputValues.x < -0.5) { // whole width brush
    if (abs(userInputValues.y - texCoord.y) < userInputValues[3] * texelSize.y)
      inBrush = true;
  } else {                                       // circular brush
    vec2 vecFromMouse = vec2(absHorizontalDist(userInputValues.x, texCoord.x), userInputValues.y - texCoord.y);
    vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle

    float distFromMouse = length(vecFromMouse);

    weight = smoothstep(userInputValues[3] * texelSize.y, 0., distFromMouse);

    if (distFromMouse < userInputValues[3] * texelSize.y) {
      inBrush = true;
    }
  }

  if (inBrush) {
    if (userInputType == 1) {        // temperature
      base[3] += userInputValues[2];
    } else if (userInputType == 2) { // water
      water[0] += userInputValues[2];
      water[0] = max(water[0], 0.0);
    } else if (userInputType == 3) { // smoke
      water[3] += userInputValues[2];
      water[3] = max(water[3], 0.0);

    } else if (userInputType == 4) {                                   // drag/move air

      if (userInputValues.x < -0.5) {                                  // whole width brush
        base.x += userInputMove.x * 1.0 * weight * userInputValues[2]; // only move horizontally
      } else {
        base.xy += userInputMove * 1.0 * weight * userInputValues[2];
      }
    } else if (userInputType >= 10) { // wall
      if (userInputValues[2] > 0.0) { // build wall if positive value else remove wall

        bool setWall = false;

        switch (userInputType) { // set wall type
        case 10:
          wall[0] = 0;           // normal wall
          setWall = true;
          break;
        case 11:
          wall[0] = 1; // land
          setWall = true;
          break;
        case 12:
          wall[0] = 2; // lake / sea
                       // wall[2] = 0; // No vegetation    ??? should have been [3]
          setWall = true;
          break;
        case 13:
          if (wall[1] == 0 && wall[0] == 1 && texture(wallTex, texCoordX0Yp)[1] != 0) { // if land wall and no wall above
            wall[0] = 3;                                                                // Fire
            setWall = true;
          }
          break;
        case 14:
          if (wall[1] == 0 && wall[0] == 1 && texture(wallTex, texCoordX0Yp)[1] != 0) { // if land wall and no wall above
            water[2] += userInputValues[2] * 10.0;                                      // water
          }
          break;
        case 15:
          if (wall[1] == 0 && wall[0] == 1 && texture(wallTex, texCoordX0Yp)[1] != 0) { // if land wall and no wall above
            water[3] += userInputValues[2] * 10.0;                                      // snow
          }
          break;
        case 16:
          if (wall[1] == 0 && (wall[0] == 1 || wall[0] == 3) && texture(wallTex, texCoordX0Yp)[1] != 0) { // if land wall and no wall above
            wall[3] += 1;                                                                                 // add vegetation
          }
          break;
        }

        if (setWall) {
          wall[1] = 0;      // set wall
          water = vec4(0.0);
          base[3] = 1000.0; // indicate this is wall and no snow cooling
        }
      } else {
        if (wall[1] == 0) { // remove wall only if it is a wall and not bottem layer

          if (userInputType == 13) {
            if (wall[0] == 3) // extinguish fire
              wall[0] = 1;
          } else if (userInputType == 14) {
            water[2] += userInputValues[2] * 10.0;
          } else if (userInputType == 15) {
            water[3] += userInputValues[2] * 10.0;
          } else if (userInputType == 16) {
            wall[3] = max(wall[3] - 1, 0);       // remove vegetation
          } else if (texCoord.y > texelSize.y) { // remove wall

            wall[1] = 255;                       // remove wall
            base[0] = 0.0;                       // reset all properties to prevent NaN bug
            base[1] = 0.0;
            base[2] = 0.0;
            base[3] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));
            water[0] = 0.0;
            water[1] = 0.0;
            water[2] = 0.0;
            water[3] = 0.0;
          }
        }
      }
    }
  }

  if (wall[1] == 0) { // is wall
    // base[3] += 1000.0; // WHY DOES WALL TEMP HAVE AFFECT ON SIMULATION?
    // special temperature, just to identify that it is a wall cell when drawing
    // the graph
  } else { // no wall

    //  if (texCoord.y > 0.99) // dry the top edge and prevent snow from passing trough
    //    water = vec4(0.0);

    water[1] = max(water[0] - maxWater(realTemp), 0.0); // recalculate cloud water
  }
}