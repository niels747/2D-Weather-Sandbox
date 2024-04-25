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

uniform vec4 userInputValues; // xpos    Ypos     intensity     Brush Size

#define INTENSITY 2
#define BRUSH_SIZE 3

uniform vec2 userInputMove;  // moveX  moveY
uniform int userInputType;   // 0 = nothing 	1 = temp ...

uniform vec4 airplaneValues; // xpos   Ypos   throttle   fire

uniform bool wrapHorizontally;

uniform float dryLapse;
uniform float evapHeat;
uniform float meltingHeat;

uniform float globalEffectsHeight;
uniform float globalDrying;
uniform float globalHeating;
uniform float waterTemperature;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

uniform vec2 resolution;

vec2 texelSize;

uniform vec4 initial_Tv[126];

float getInitialT(int y) { return initial_Tv[y / 4][y % 4]; }

#include "common.glsl"

void main()
{
  wall = texture(wallTex, texCoord);

  texelSize = vec2(1.) / resolution;

  float actualTempChange = 0.0, realTemp;

  if (wall[DISTANCE] != 0) { // not wall

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

    base[VX] = bilerp(baseTex, fragCoord - velAtVx).x;
    base[VY] = bilerp(baseTex, fragCoord - velAtVy).y;

    base[2] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[2];
    base[3] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[3];

    water.xyw = bilerpWall(waterTex, wallTex, fragCoord - velAtP).xyw; // centered

    // water.z = bilerpWall(waterTex, wallTex, fragCoord + vec2(0.0, +0.01)).z;
    // // precipitation visualization
    water.z = texture(waterTex, texCoord).z; // precipitation visualization

    // vec2 backTracedPos = fragCoord - velAtP; // advect / flow

    // vec2 backTracedPos = texCoord; // no flow

    // water.xy = bilerp(waterTex, backTracedPos).xy;

    realTemp = potentialToRealT(base[TEMPERATURE]);

    float newCloudWater = max(water[TOTAL] - maxWater(realTemp), 0.0);            // calculate cloud water

    float dT = (newCloudWater - water[CLOUD]) * evapHeat;                         // how much that water phase change would change the
                                                                                  // temperature

    float dWt = max(water[TOTAL] - maxWater(realTemp + dT), 0.0) - newCloudWater; // how much that temperature change would change
                                                                                  // the amount of liquid water

    actualTempChange = dT_saturated(dT, dWt * evapHeat);

    base[TEMPERATURE] += actualTempChange; // APPLY LATENT HEAT!

    realTemp += actualTempChange;

    float tempC = KtoC(realTemp);

    float relHum = relativeHumd(realTemp, water[TOTAL]);

    // Radiative cooling and heating effects

    if (texCoord.y > globalEffectsHeight) { //
      water[TOTAL] -= globalDrying;         // drying 0.00001
      base[TEMPERATURE] += globalHeating;

      // if (texCoord.y > 0.9) {
      //   base[3] -= (KtoC(realTemp) - -60.0) * 0.001; // tropopause temperature stabilization
      // }
    }

    // water[0] -= max(water[1] - 0.1, 0.0) * 0.0001; // Precipitation effect
    // drying !

    water[TOTAL] = max(water[TOTAL], 0.0); // prevent water from going negative

  } else {                                 // this is wall

    base = texture(baseTex, texCoord);     // pass trough

    water = texture(waterTex, texCoord);

    if (wall[TYPE] == WALLTYPE_LAND) { // land
      base[TEMPERATURE] = 1000.0;      // Set snow melting feedback to 0
    }

    water[TOTAL] = 1111.; // indicate this is wall

    ivec4 wallX0Yp = texture(wallTex, texCoordX0Yp);

    // prevent negative numbers
    wall[VEGETATION] = max(wall[VEGETATION], 0);
    water[SOIL_MOISTURE] = max(water[SOIL_MOISTURE], 0.0);

    if (wallX0Yp[DISTANCE] != 0) { // cell above is not wall, surface layer


      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      vec4 waterX0Yp = texture(waterTex, texCoordX0Yp);

      float tempC = KtoC(potentialToRealT(baseX0Yp[TEMPERATURE])); // temperature of cell above

      if (water[SNOW] > 0.0 && tempC > 0.0) {                      // snow melting on ground
        float melting = min(tempC * snowMeltRate, water[SNOW]);
        water[SNOW] -= melting;
        base[TEMPERATURE] += melting / snowMassToHeight * meltingHeat; // signal snow melting mass, cooling will be applied in pressure shader
        water[SOIL_MOISTURE] += melting;                               // melting snow adds water to soil
      }

      if (water[SOIL_MOISTURE] > 0.0 && tempC > 0.0) { // water evaporating from ground
        float evaporation = max((maxWater(CtoK(tempC)) - water[TOTAL]) * 0.00001, 0.);
        water[SOIL_MOISTURE] -= evaporation;
      }
    }
  }

  // USER INPUT:

  bool inBrush = false;           // if cell is in brush area
  float weight = 1.0;             // 1.0 at center, 0.0 at border

  if (userInputValues.x < -0.5) { // whole width brush
    if (abs(userInputValues.y - texCoord.y) < userInputValues[BRUSH_SIZE] * texelSize.y)
      inBrush = true;
  } else { // circular brush

    vec2 vecFromMouse;

    if (wrapHorizontally) {
      vecFromMouse = vec2(absHorizontalDist(userInputValues.x, texCoord.x), userInputValues.y - texCoord.y);
    } else {
      vecFromMouse = vec2(abs(userInputValues.x - texCoord.x), userInputValues.y - texCoord.y);
    }

    vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle

    float distFromMouse = length(vecFromMouse);

    weight = smoothstep(userInputValues[BRUSH_SIZE] * texelSize.y, 0., distFromMouse);

    if (distFromMouse < userInputValues[BRUSH_SIZE] * texelSize.y) {
      inBrush = true;
    }
  }

  if (inBrush) {
    if (userInputType == 1) {                                              // temperature
      base[3] += userInputValues[INTENSITY];
      if (wall[TYPE] == 2 && wall[DISTANCE] == 0)                          // water wall
        base[3] = clamp(base[TEMPERATURE], CtoK(0.0), CtoK(maxWaterTemp)); // limit water temperature range
    } else if (userInputType == 2) {                                       // water
      water[TOTAL] += userInputValues[INTENSITY];
      water[TOTAL] = max(water[TOTAL], 0.0);
    } else if (userInputType == 3 && wall[DISTANCE] != 0) { // smoke, only apply if not wall
      water[SMOKE] += userInputValues[INTENSITY];
      water[SMOKE] = min(max(water[SMOKE], 0.0), 2.0);

    } else if (userInputType == 4) {                                           // drag/move air

      if (userInputValues.x < -0.5) {                                          // whole width brush
        base.x += userInputMove.x * 1.0 * weight * userInputValues[INTENSITY]; // only move horizontally
      } else {
        base.xy += userInputMove * 1.0 * weight * userInputValues[INTENSITY];
      }
    } else if (userInputType >= 10) {         // wall
      if (userInputValues[INTENSITY] > 0.0) { // build wall if positive value else remove wall

        bool setWall = false;

        switch (userInputType) {       // set wall type
        case 10:
          wall[TYPE] = WALLTYPE_INERT; // inert wall
          setWall = true;
          break;
        case 11:
          wall[TYPE] = WALLTYPE_LAND; // land
          setWall = true;
          break;
        case 12:
          wall[TYPE] = WALLTYPE_WATER; // lake / sea
                                       // wall[VEGETATION] = 0; // No vegetation
          setWall = true;
          break;
        case 13:
          if (wall[DISTANCE] == 0 && wall[TYPE] == WALLTYPE_LAND && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_FIRE;
            setWall = true;
          }
          break;
        case 14:
          if (wall[DISTANCE] == 0 && wall[TYPE] == WALLTYPE_LAND && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_URBAN;
          }
          break;


        case 20:
          if (wall[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            water[SOIL_MOISTURE] += userInputValues[INTENSITY] * 10.0;
          }
          break;
        case 21:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN) && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            water[SNOW] += userInputValues[INTENSITY] * 0.5;
          }
          break;
        case 22:
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE || wall[TYPE] == WALLTYPE_URBAN) && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[VEGETATION] += 1;                                                                                                                                                    // add vegetation
          }
          break;
        }

        if (setWall) {
          wall[DISTANCE] = 0;         // set wall
          base[TEMPERATURE] = 1000.0; // indicate this is wall and no snow cooling
                                      // water = vec4(0.0);

          if (wall[TYPE] == WALLTYPE_LAND) {
            water[SOIL_MOISTURE] = 25.0;
            // wall[VEGETATION] = 100;
          } else if (wall[TYPE] == WALLTYPE_WATER) { // water surface
            base[TEMPERATURE] = waterTemperature;
          }
        }
      } else {
        if (wall[DISTANCE] == 0) {            // remove wall only if it is a wall and not bottem layer

          if (userInputType == 13) {          // fire
            if (wall[TYPE] == WALLTYPE_FIRE)  // extinguish fire
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 14) {   // urban
            if (wall[TYPE] == WALLTYPE_URBAN) // remove buildings
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 20) {   // remove moisture
            water[SOIL_MOISTURE] += userInputValues[INTENSITY] * 10.0;
          } else if (userInputType == 21) {
            water[SNOW] += userInputValues[INTENSITY] * 0.5; // remove snow
          } else if (userInputType == 22) {
            wall[VEGETATION] = max(wall[VEGETATION] - 1, 0); // remove vegetation
          } else if (texCoord.y > texelSize.y) {
            wall[DISTANCE] = 255;                            // remove wall
            base[VX] = 0.0;                                  // reset all properties to prevent NaN bug
            base[VY] = 0.0;
            base[PRESSURE] = 0.0;
            base[TEMPERATURE] = getInitialT(int(texCoord.y * (1.0 / texelSize.y)));
            water[TOTAL] = 0.0;
            water[CLOUD] = 0.0;
            water[PRECIPITATION] = 0.0;
            water[SMOKE] = 0.0;
          }
        }
      }
    }
  }

  if (wall[DISTANCE] == 0) { // is wall
    // base[3] += 1000.0; // WHY DOES WALL TEMP HAVE AFFECT ON SIMULATION?
    // special temperature, just to identify that it is a wall cell when drawing
    // the graph
    water[TOTAL] = 1111.;                                       // indicate this is wall
  } else {                                                      // no wall
    water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // recalculate cloud water
  }
  // airplaneValues.xy
  float planeInfluence = max(0.003 - length(texCoord - airplaneValues.xy), 0.) * 10.0;
  water[TOTAL] += planeInfluence * airplaneValues[2] * 1.0; // moisture
  // water[3] += planeInfluence * 0.1; // smoke
  //  base[3] += planeInfluence * 74.0; // heat


  if (airplaneValues[3] > 0.9) { // PLANE CRASH!

    vec2 vecFromPlane;

    if (wrapHorizontally) {
      vecFromPlane = vec2(absHorizontalDist(airplaneValues.x, texCoord.x), airplaneValues.y - texCoord.y);
    } else {
      vecFromPlane = vec2(abs(airplaneValues.x - texCoord.x), airplaneValues.y - texCoord.y);
    }

    vecFromPlane.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle

    float distFromPlane = length(vecFromPlane);

    if (distFromPlane < 1. / resolution.y * 1.5) {
      if (wall[DISTANCE] == 0) {
        if (wall[TYPE] == WALLTYPE_LAND && wall[VERT_DISTANCE] == 0) // if land surface, set ground on fire
          wall[TYPE] = WALLTYPE_FIRE;                                // start fire when plane hits the ground
      } else {                                                       // air, create FIRE BALL!
        base[PRESSURE] += 0.05;                                      // pressure wave
        base[TEMPERATURE] = CtoK(50.0);                              // heat
        water[TOTAL] += 1.;                                          // moisture
        water[SMOKE] += 10.;                                         // smoke
      }
    }
  }
}