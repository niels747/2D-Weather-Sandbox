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

#define BRUSH_INTENSITY 2
#define BRUSH_SIZE 3

uniform vec2 userInputMove;  // moveX  moveY
uniform int userInputType;   // 0 = nothing 	1 = temp ...

uniform vec4 airplaneValues; // xpos   Ypos   throttle   fire

uniform bool wrapHorizontally;

uniform float dryLapse;
uniform float evapHeat;
uniform float meltingHeat;
uniform float condensationRate;

uniform float globalEffectsStartAlt;
uniform float globalEffectsEndAlt;
uniform float globalDrying;
uniform float globalHeating;
uniform float soundingForcing;
uniform float waterTemperature;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water;
layout(location = 2) out ivec4 wall;

uniform vec2 resolution;

vec2 texelSize;

uniform sampler2D initialProfileTex;
uniform sampler2D realWorldSoundingTexT;
uniform sampler2D realWorldSoundingTexW;
uniform sampler2D realWorldSoundingTexVel;

#include "common.glsl"

float getProfileChannel(vec4 texel, int y)
{
  // Profiles are uploaded as a 1-row RGBA32F texture with four vertical samples per texel.
  int channel = y % 4;
  if (channel == 0)
    return texel.x;
  if (channel == 1)
    return texel.y;
  if (channel == 2)
    return texel.z;
  return texel.w;
}

// A NaN or a corrupt value in a profile texture ends up in the temperature of every cell of the
// row that reads it, from where it spreads trough the whole simulation. Profiles store potential
// temperatures (which include the lapse of the entire column, up to 150 K for a 15 km high
// simulation), so they are limited by converting them to the real temperature of their row first.
float limitProfileT(float potential, int y)
{
  float lapse = float(y) / resolution.y * dryLapse;
  return cleanTempK(potential - lapse) + lapse;
}

float getInitialT(int y)
{
  return limitProfileT(getProfileChannel(texelFetch(initialProfileTex, ivec2(y / 4, 0), 0), y), y);
}

float getRealWorldSounding_T(int y)
{
  return limitProfileT((getProfileChannel(texelFetch(realWorldSoundingTexT, ivec2(y / 4, 0), 0), y) +
                        getProfileChannel(texelFetch(realWorldSoundingTexT, ivec2(max(y - 1, 0) / 4, 0), 0), max(y - 1, 0))) /
                       2.,
                      y);
}

float getRealWorldSounding_W(int y)
{
  return cleanWater((getProfileChannel(texelFetch(realWorldSoundingTexW, ivec2(y / 4, 0), 0), y) +
                     getProfileChannel(texelFetch(realWorldSoundingTexW, ivec2(max(y - 1, 0) / 4, 0), 0), max(y - 1, 0))) /
                    2.);
}

float getRealWorldSounding_Vel(int y)
{
  return safeClamp((getProfileChannel(texelFetch(realWorldSoundingTexVel, ivec2(y / 4, 0), 0), y) +
                    getProfileChannel(texelFetch(realWorldSoundingTexVel, ivec2(max(y - 1, 0) / 4, 0), 0), max(y - 1, 0))) /
                     2.,
                   -1.0, 1.0);
}

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

    base[PRESSURE] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[PRESSURE];
    base[TEMPERATURE] = bilerpWall(baseTex, wallTex, fragCoord - velAtP)[TEMPERATURE];

    water.xyw = bilerpWall(waterTex, wallTex, fragCoord - velAtP).xyw; // centered

                                                                       //   water.z = bilerpWall(waterTex, wallTex, fragCoord + vec2(0.0, +0.01)).z;
    // // precipitation visualization
    water[PRECIPITATION] = bilerpWall(waterTex, wallTex, fragCoord - velAtP + vec2(0, 0.05))[PRECIPITATION]; // precipitation visualization advected with flow, and downward

    // vec2 backTracedPos = fragCoord - velAtP; // advect / flow

    // vec2 backTracedPos = texCoord; // no flow

    // water.xy = bilerp(waterTex, backTracedPos).xy;

    realTemp = potentialToRealT(base[TEMPERATURE]);

    // Advected values come from interpolated neighbours and from the precipitation feedback, so
    // they can be NaN or out of range. Clean them up before they enter the phase change math:
    // water[CLOUD] is part of water[TOTAL] and can never be bigger than it or smaller than zero.
    water[TOTAL] = cleanWater(water[TOTAL]);
    water[CLOUD] = cleanWater(water[CLOUD]);
    if (water[CLOUD] > water[TOTAL])
      water[CLOUD] = water[TOTAL];

    float excessWater = water[TOTAL] - maxWater(realTemp); // the amount of extra water beyond 100% rel hum, including both vapor and cloud water

    float overSaturation = excessWater - water[CLOUD]; // amount of water vapor that should condence, but hasn't yet

    float condensation;

    if (overSaturation < 0.) {                          // evaporation
      condensation = overSaturation * 0.20;             // evaporation is rapid
    } else {                                            // condensation
      condensation = overSaturation * condensationRate; // 0.002 0.25 amount of the oversaturated water vapor that slowly condences
    }
    condensation = max(condensation, -water[CLOUD]);    // Prevent cloudwater from going negative
    condensation = capWaterFlux(condensation, maxWater(realTemp));

    float dT = capTempFlux(condensation * evapHeat * 1.0); // how much that water phase change would change the temperature
    base[TEMPERATURE] += dT;
    realTemp += dT;
    // A phase change only moves water between the vapor and the cloud fraction of the cell, so
    // the total amount of water must not change here: subtracting condensation from water[TOTAL]
    // as well destroys (or with negative condensation creates) mass on every single iteration,
    // which is what makes the vapor content of the whole atmosphere drift upwards and explode.
    water[CLOUD] += condensation;


    // float newCloudWater = water[CLOUD] + condensation;                             // slowly condence the oversaturated vapor

    // float dWt = max(water[TOTAL] - maxWater(realTemp + dT), 0.0) - overSaturation; // how much that temperature change would change
    //  the amount of liquid water

    // actualTempChange = dT_saturated(dT, dWt * evapHeat);

    //  base[TEMPERATURE] += actualTempChange; // APPLY LATENT HEAT!

    // realTemp += actualTempChange;

    // float tempC = KtoC(realTemp);


    //   water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // recalculate cloud water

    // float relHum = relativeHumd(realTemp, water[TOTAL]); // not used

    // Radiative cooling and heating effects

    if (texCoord.y > globalEffectsStartAlt && texCoord.y < globalEffectsEndAlt) {
      water[TOTAL] -= clamp(globalDrying, 0., max(water[TOTAL] - maxWater(max(realTemp - 20.0, CtoK(-80.))), 0.)); // only dry down to a dew point 20 C below the temperature

      base[TEMPERATURE] += globalHeating;


      // apply real sounding

      int soundingArrayindex = int(texCoord.y * (1.0 / texelSize.y));

      float Tdiff = base[TEMPERATURE] - getRealWorldSounding_T(soundingArrayindex);
      base[TEMPERATURE] -= Tdiff * 0.001 * soundingForcing;


      float Wdiff = water[TOTAL] - getRealWorldSounding_W(soundingArrayindex);
      water[TOTAL] -= Wdiff * 0.001 * soundingForcing;

      base.xy *= 1.0 - map_rangeC(soundingForcing, 0.1, 1.0, 0.0, 0.001); // drag to stabilize with high forcing

      float velDiff = base[VX] - getRealWorldSounding_Vel(soundingArrayindex);
      base[VX] -= velDiff * map_rangeC(soundingForcing, 0.9, 1.0, 0.0, 0.001);


      // if (texCoord.y > 0.93) {
      //   base[TEMPERATURE] -= (KtoC(realTemp) - -55.0) * 0.0005; // tropopause temperature stabilization
      //   water[TOTAL] -= (water[TOTAL] - 0.0125) * 0.0001;       // keep stratosphere dew point around -80C
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

    // water[TOTAL] = 1111.; // indicate this is wall

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

      // Evaporation of the ground itself is NOT done here: a wall cell can not hold vapor, water[TOTAL]
      // is overwritten with the wall indicator below and thrown away every iteration, so adding vapor
      // here only drained soil moisture into nowhere (and made it negative, which turned the
      // evaporation term of the boundary shader into a negative value that destroyed vapor and
      // heated the air). Land evaporation is applied to the air cell above the surface in
      // boundaryShader.frag, where it both adds vapor and cools the air consistently.
      water[SOIL_MOISTURE] = max(water[SOIL_MOISTURE], 0.0);
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
      base[3] += userInputValues[BRUSH_INTENSITY];
      if (wall[TYPE] == 2 && wall[DISTANCE] == 0)                          // water wall
        base[3] = clamp(base[TEMPERATURE], CtoK(0.0), CtoK(maxWaterTemp)); // limit water temperature range
    } else if (userInputType == 2) {                                       // water


      //     if ()

      float cloudWaterChange = userInputValues[BRUSH_INTENSITY]; // positive intensity
      // float vaporChange = max(userInputValues[BRUSH_INTENSITY]);


      if (water[CLOUD] > 0.0) {                // add as liquid
        water[CLOUD] += cloudWaterChange;
        water[CLOUD] = max(water[CLOUD], 0.0); // prevent negative cloudwater
      }                                        // else {                                 // add as gas
      water[TOTAL] += cloudWaterChange;
      water[TOTAL] = max(water[TOTAL], 0.0);
      // }

    } else if (userInputType == 3 && wall[DISTANCE] != 0) { // smoke, only apply if not wall
      water[SMOKE] += userInputValues[BRUSH_INTENSITY];
      water[SMOKE] = min(max(water[SMOKE], 0.0), 2.0);

    } else if (userInputType == 4) {                                                 // drag/move air

      if (userInputValues.x < -0.5) {                                                // whole width brush
        base.x += userInputMove.x * 5.0 * weight * userInputValues[BRUSH_INTENSITY]; // only move horizontally
      } else {
        base.xy += userInputMove * 5.0 * weight * userInputValues[BRUSH_INTENSITY];
      }
    } else if (userInputType >= 10) {               // wall
      if (userInputValues[BRUSH_INTENSITY] > 0.0) { // build wall if positive value else remove wall

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
        case 13:                                                                                                     // set fire
          if (wall[DISTANCE] == 0 && wall[TYPE] == WALLTYPE_LAND && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_FIRE;
            setWall = true;
          }
          break;
        case 14:                                               // set urban
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_RUNWAY || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_URBAN;
          }
          break;
        case 15:                                               // set runway
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_RUNWAY;
          }
          break;
        case 16:                                               // set industrial
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_RUNWAY) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[TYPE] = WALLTYPE_INDUSTRIAL;
          }
          break;

        case 20:                                                                                                      // add soil moisture
          if (wall[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER && texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            water[SOIL_MOISTURE] += userInputValues[BRUSH_INTENSITY] * 10.0;
          }
          break;
        case 21:                                               // add snow
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            water[SNOW] += userInputValues[BRUSH_INTENSITY] * 0.5;
          }
          break;
        case 22:                                               // add vegetation
          if (wall[DISTANCE] == 0 && (wall[TYPE] == WALLTYPE_LAND || wall[TYPE] == WALLTYPE_FIRE || wall[TYPE] == WALLTYPE_URBAN || wall[TYPE] == WALLTYPE_INDUSTRIAL) &&
              texture(wallTex, texCoordX0Yp)[DISTANCE] != 0) { // if land wall and no wall above
            wall[VEGETATION] += 1;                             // add vegetation
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
        if (wall[DISTANCE] == 0) {           // remove wall only if it is a wall and not bottem layer

          if (userInputType == 13) {         // fire
            if (wall[TYPE] == WALLTYPE_FIRE) // extinguish fire
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 14) {
            if (wall[TYPE] == WALLTYPE_URBAN) // remove buildings
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 15) {
            if (wall[TYPE] == WALLTYPE_RUNWAY) // remove runway
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 16) {
            if (wall[TYPE] == WALLTYPE_INDUSTRIAL) // remove industry
              wall[TYPE] = WALLTYPE_LAND;
          } else if (userInputType == 20) {        // remove moisture
            water[SOIL_MOISTURE] += userInputValues[BRUSH_INTENSITY] * 10.0;
          } else if (userInputType == 21) {
            water[SNOW] += userInputValues[BRUSH_INTENSITY] * 0.5; // remove snow
          } else if (userInputType == 22) {
            wall[VEGETATION] = max(wall[VEGETATION] - 1, 0);       // remove vegetation
          } else if (texCoord.y > texelSize.y) {
            wall[DISTANCE] = 255;                                  // remove wall
            base[VX] = 0.0;                                        // reset all properties to prevent NaN bug
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

    // Walls can not hold vapor. The indicator values are not just decoration: the precipitation
    // shader uses "water[TOTAL] > 1000." to detect that a droplet is inside the ground and the
    // lighting shader uses the same channel to make terrain opaque to longwave radiation. Zeroing
    // it instead turned every droplet that touched terrain into a droplet that kept exchanging
    // vapor with wall cells, and let IR shine trough mountains.
    if (wall[TYPE] == WALLTYPE_WATER) {
      water[TOTAL] = 1002.;
    } else { // any type of land wall
      water[TOTAL] = 1001.;
    }
    water[CLOUD] = 0.0; // a wall never contains cloud water, so that the total stays >= the cloud amount

  } else { // no wall
           //   water[CLOUD] = max(water[TOTAL] - maxWater(realTemp), 0.0); // recalculate cloud water
  }

  vec2 vecFromPlane;

  if (wrapHorizontally) {
    vecFromPlane = vec2(absHorizontalDist(airplaneValues.x, texCoord.x), airplaneValues.y - texCoord.y);
  } else {
    vecFromPlane = vec2(abs(airplaneValues.x - texCoord.x), airplaneValues.y - texCoord.y);
  }

  vecFromPlane.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle
  vecFromPlane *= resolution.y;                // convert to cell coordinates

  if (airplaneValues[3] < 0.0)
    vecFromPlane += vec2(0., -1.);            // dump water below plane

  float distFromPlane = length(vecFromPlane); // in cells


  float planeInfluence = max(1.0 - distFromPlane, 0.) * 0.03;


  if (airplaneValues[3] < 0.0) {
    water[PRECIPITATION] += planeInfluence * 100.0; // dump water
  }

  // water[TOTAL] += planeInfluence * airplaneValues[2] * 1.0; // moisture
  // water[SMOKE] += planeInfluence * 0.1;                     // smoke
  //   base[TEMPERATURE] += planeInfluence * 74.0; // heat


  if (airplaneValues[3] > 0.9) { // PLANE CRASH!

    if (distFromPlane < 1.5) {
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

  // ── last line of defence for the whole vapor cycle ──
  // Everything that can add water to a cell passed trough this shader: advection, condensation,
  // evaporation, tools, plane crashes and the precipitation feedback. Limiting it here means a
  // single broken cell can never grow towards infinity or NaN and take the rest of the
  // simulation with it, because the water amount also feeds back into temperature (latent heat),
  // into the buoyancy (cloud water weight) and into the longwave radiation (greenhouse effect).
  if (wall[DISTANCE] != 0) { // air
    water[TOTAL] = cleanWater(water[TOTAL]);
    water[CLOUD] = cleanWater(water[CLOUD]);
    water[SMOKE] = safeClamp(water[SMOKE], 0.0, 100.0);
    water[PRECIPITATION] = safeClamp(water[PRECIPITATION], 0.0, 100.0);
    if (water[CLOUD] > water[TOTAL]) // cloud water is part of the total water
      water[CLOUD] = water[TOTAL];

    // and the temperature of an air cell always stays physically possible (potential
    // temperature, so the limit has to move up with the height of the cell)
    base[TEMPERATURE] = cleanTempK(base[TEMPERATURE] - texCoord.y * dryLapse) + texCoord.y * dryLapse;
  }
}
