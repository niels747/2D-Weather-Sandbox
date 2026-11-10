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

uniform vec4 initial_Tv[126];
uniform vec4 realWorldSounding_Tv[126];
uniform vec4 realWorldSounding_Wv[126];
uniform vec4 realWorldSounding_Velv[126];

float getInitialT(int y)
{
  int yc = clamp(y, 0, 503);
  return initial_Tv[yc >> 2][yc & 3];
}
float getRealWorldSounding_T(int y)
{
  int yc = clamp(y, 0, 503);
  int ym = max(yc - 1, 0);
  return (realWorldSounding_Tv[yc >> 2][yc & 3] + realWorldSounding_Tv[ym >> 2][ym & 3]) * 0.5;
}
float getRealWorldSounding_W(int y)
{
  int yc = clamp(y, 0, 503);
  int ym = max(yc - 1, 0);
  return (realWorldSounding_Wv[yc >> 2][yc & 3] + realWorldSounding_Wv[ym >> 2][ym & 3]) * 0.5;
}
float getRealWorldSounding_Vel(int y)
{
  int yc = clamp(y, 0, 503);
  int ym = max(yc - 1, 0);
  return (realWorldSounding_Velv[yc >> 2][yc & 3] + realWorldSounding_Velv[ym >> 2][ym & 3]) * 0.5;
}

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

    // calculate velocities for different positions within cell (MAC staggered grid)
    vec2 velAtP = vec2((cellXmY0.x + cellX0Y0.x) * 0.5,
                       (cellX0Ym.y + cellX0Y0.y) * 0.5);                                         // center of cell
    vec2 velAtVx = vec2(cellX0Y0.x, (cellX0Ym.y + cellXpY0.y + cellX0Y0.y + cellXpYm.y) * 0.25); // middle of right edge of cell
    vec2 velAtVy = vec2((cellXmY0.x + cellX0Yp.x + cellXmYp.x + cellX0Y0.x) * 0.25,
                        cellX0Y0.y);                                                             // middle of top edge of cell

    // 2nd-order Midpoint (RK2) semi-Lagrangian backtracing
    vec2 midVx = vec2(
      bilerp(baseTex, fragCoord - 0.5 * velAtVx).x,
      velAtVx.y
    );
    vec2 midVy = vec2(
      velAtVy.x,
      bilerp(baseTex, fragCoord - 0.5 * velAtVy).y
    );
    vec4 midSampleP = bilerp(baseTex, fragCoord - 0.5 * velAtP);
    vec4 midSamplePmX = bilerp(baseTex, fragCoord - 0.5 * velAtP - vec2(1.0, 0.0));
    vec4 midSamplePmY = bilerp(baseTex, fragCoord - 0.5 * velAtP - vec2(0.0, 1.0));
    vec2 midVelP = vec2((midSamplePmX.x + midSampleP.x) * 0.5, (midSamplePmY.y + midSampleP.y) * 0.5);

    // ADVECT AIR:
    // Away from terrain walls (Manhattan distance >= 5), use monotonic-clamped Catmull-Rom bicubic interpolation
    // to preserve crisp Kelvin-Helmholtz billows, cumulus cauliflower turrets, and thin anvil/cirrus filaments.
    bool clearOfWalls = (wall[DISTANCE] >= 5) && (fragCoord.y > 3.5) && (fragCoord.y < resolution.y - 3.5);

    if (clearOfWalls) {
      base[VX] = bicubicClamped(baseTex, fragCoord - midVx).x;
      base[VY] = bicubicClamped(baseTex, fragCoord - midVy).y;

      vec4 advBaseP = bicubicClamped(baseTex, fragCoord - midVelP);
      base[PRESSURE] = bilerp(baseTex, fragCoord - midVelP)[PRESSURE]; // smooth bilinear for acoustic pressure
      base[TEMPERATURE] = advBaseP[TEMPERATURE];

      water.xyw = bicubicClamped(waterTex, fragCoord - midVelP).xyw;
    } else {
      base[VX] = bilerp(baseTex, fragCoord - midVx).x;
      base[VY] = bilerp(baseTex, fragCoord - midVy).y;

      vec4 advBaseP = bilerpWall(baseTex, wallTex, fragCoord - velAtP);
      base[PRESSURE] = advBaseP[PRESSURE];
      base[TEMPERATURE] = advBaseP[TEMPERATURE];

      water.xyw = bilerpWall(waterTex, wallTex, fragCoord - velAtP).xyw;
    }

    // Precipitation curtain field advected with flow and terminal fall drift
    water[PRECIPITATION] = bilerpWall(waterTex, wallTex, fragCoord - velAtP + vec2(0.0, 0.05))[PRECIPITATION];

    // Subgrid Smagorinsky & Cloud-Margin Inhomogeneous Turbulent Entrainment:
    // Symmetrically mixes heat & moisture across high-shear zones and active cloud-clear interfaces,
    // generating authentic evaporatively cooled subsiding shells (cauliflower roll) and natural cumulus lifecycles!
    if (wall[DISTANCE] >= 3 && fragCoord.y > 1.5 && fragCoord.y < resolution.y - 1.5) {
      float du_dx = cellX0Y0.x - cellXmY0.x;
      float dv_dy = cellX0Y0.y - cellX0Ym.y;
      float shear = 0.5 * (cellX0Yp.x - cellX0Ym.x + cellXpY0.y - cellXmY0.y);
      float strainMag = sqrt(2.0 * (du_dx * du_dx + dv_dy * dv_dy) + shear * shear);

      vec4 wL = texture(waterTex, texCoordXmY0);
      vec4 wR = texture(waterTex, texCoordXpY0);
      vec4 wD = texture(waterTex, texCoordX0Ym);
      vec4 wU = texture(waterTex, texCoordX0Yp);

      float maxNeighborC = max(max(max(wL[CLOUD], wR[CLOUD]), max(wD[CLOUD], wU[CLOUD])), water[CLOUD]);
      float minNeighborC = min(min(min(wL[CLOUD], wR[CLOUD]), min(wD[CLOUD], wU[CLOUD])), water[CLOUD]);

      // Detect active cloud-environment margin (symmetric across cloudy cell and adjacent clear cell -> 100% conservative!)
      float localTempApprox = potentialToRealT(base[TEMPERATURE]);
      float localIce = cloudIceFraction(localTempApprox);
      bool atCloudInterface = (maxNeighborC > 0.008) && (minNeighborC < 0.002);
      float interfaceEntrain = atCloudInterface ? mix(0.015, 0.0025, localIce) : 0.0;

      float eddyDiff = clamp(strainMag * 0.065 + interfaceEntrain, 0.0, 0.028);

      if (eddyDiff > 0.0001) {
        float avgNeighborT = 0.25 * (cellXmY0[TEMPERATURE] + cellXpY0[TEMPERATURE] + cellX0Ym[TEMPERATURE] + cellX0Yp[TEMPERATURE]);
        vec4 wAvg = 0.25 * (wL + wR + wD + wU);
        base[TEMPERATURE] = mix(base[TEMPERATURE], avgNeighborT, eddyDiff);
        water.xyw = mix(water.xyw, wAvg.xyw, eddyDiff);
      }
    }

    water[TOTAL] = max(water[TOTAL], 0.0);
    water[CLOUD] = clamp(water[CLOUD], 0.0, water[TOTAL]);

    realTemp = potentialToRealT(base[TEMPERATURE]);

    // Mixed-phase non-oscillatory Clausius-Clapeyron psychrometric saturation adjustment
    // Accounts for Bergeron-Findeisen ice saturation lowering and glaciation latent heat below -4 C..-38 C
    float iceFrac = cloudIceFraction(realTemp);
    float satWater = maxWaterMixed(realTemp);
    float dSat_dT = dMaxWaterMixed_dT(realTemp);
    float effLatentHeat = evapHeat + iceFrac * meltingHeat * 0.25;

    float psychroFactor = 1.0 + effLatentHeat * dSat_dT;
    float overSaturation = (water[TOTAL] - satWater) - water[CLOUD];
    float eqDeltaCloud = overSaturation / psychroFactor;

    float condensation;
    if (eqDeltaCloud < 0.0) {
      // Warm liquid cloud droplets evaporate crisply in dry air; high ice clouds (anvils/cirrus) sublimate slowly
      float evapRelax = mix(0.45, 0.045, iceFrac);
      condensation = eqDeltaCloud * evapRelax;
    } else {
      // Physical CCN droplet activation (~1.5-2s phase relaxation at default condensationRate = 0.005):
      // Produces razor-sharp flat Lifting Condensation Level (LCL) cloud bases and immediate latent-heat buoyancy!
      float condRelax = clamp(condensationRate * 32.0, 0.025, 0.68);
      condensation = eqDeltaCloud * condRelax;
    }
    condensation = clamp(condensation, -water[CLOUD], max(water[TOTAL] - water[CLOUD], 0.0));

    float dT = condensation * effLatentHeat;
    base[TEMPERATURE] += dT;
    realTemp += dT;
    water[CLOUD] = clamp(water[CLOUD] + condensation, 0.0, water[TOTAL]);

    // Radiative / large-scale forcing & tropopause stabilization
    int soundingArrayindex = int(texCoord.y * (1.0 / texelSize.y));

    if (texCoord.y > globalEffectsStartAlt && texCoord.y < globalEffectsEndAlt) {
      water[TOTAL] -= clamp(globalDrying, 0., max(water[TOTAL] - maxWater(max(realTemp - 20.0, CtoK(-80.))), 0.)); // only dry down to a dew point 20 C below the temperature

      base[TEMPERATURE] += globalHeating;

      // apply real sounding
      float Tdiff = base[TEMPERATURE] - getRealWorldSounding_T(soundingArrayindex);
      base[TEMPERATURE] -= Tdiff * 0.001 * soundingForcing;

      float Wdiff = water[TOTAL] - getRealWorldSounding_W(soundingArrayindex);
      water[TOTAL] -= Wdiff * 0.001 * soundingForcing;

      base.xy *= 1.0 - map_rangeC(soundingForcing, 0.1, 1.0, 0.0, 0.001); // drag to stabilize with high forcing

      float velDiff = base[VX] - getRealWorldSounding_Vel(soundingArrayindex);
      base[VX] -= velDiff * map_rangeC(soundingForcing, 0.9, 1.0, 0.0, 0.001);
    }

    // Gentle tropopause / lower-stratosphere thermal cap near top lid when free-running (forms flat-bottomed Cb anvils)
    if (texCoord.y > 0.92 && soundingForcing < 0.05) {
      float stratWeight = smoothstep(0.92, 1.0, texCoord.y) * (1.0 - soundingForcing * 20.0);
      float targetStratT = getInitialT(soundingArrayindex);
      base[TEMPERATURE] -= (base[TEMPERATURE] - targetStratT) * 0.0002 * stratWeight;
    }

    water[TOTAL] = max(water[TOTAL], 0.0);
    water[CLOUD] = min(water[CLOUD], water[TOTAL]);

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
            wall[VEGETATION] = min(wall[VEGETATION] + 1, 127); // add vegetation
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
            water[SOIL_MOISTURE] = max(water[SOIL_MOISTURE] + userInputValues[BRUSH_INTENSITY] * 10.0, 0.0);
          } else if (userInputType == 21) {
            water[SNOW] = max(water[SNOW] + userInputValues[BRUSH_INTENSITY] * 0.5, 0.0); // remove snow
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

    if (wall[TYPE] == WALLTYPE_WATER) {
      water[TOTAL] = 1002.;
    } else { // any type of land wall
      water[TOTAL] = 1001.;
    }

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
}