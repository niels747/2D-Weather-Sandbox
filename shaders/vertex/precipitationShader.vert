#version 300 es
precision highp float;

in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

// transform feedback varyings:
out vec2 position_out;
out vec2 mass_out;
out float density_out;

// to fragmentshader for feedback to fluid
// feedback[0] droplet weigth / number of inactive droplets count
// feedback[1] heat exchange with fluid
// feedback[2] water exchange with fluid / rain accumulation on ground
// feedback[3] snow acumulation on ground
out vec4 feedback;

vec2 texCoord; // for functions

uniform sampler2D baseTex;
uniform sampler2D waterTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform float dryLapse;

uniform float frameNum;
uniform float inactiveDroplets; // used to maintain constant spawnrate

uniform float evapHeat;
uniform float meltingHeat;
uniform float waterWeight;

// prcipitation settings:
uniform float aboveZeroThreshold; // 1.0
uniform float subZeroThreshold; // 0.50
uniform float spawnChance; // 0.00015 - 0.00050
uniform float snowDensity; // 0.2 - 0.5
uniform float fallSpeed; // 0.0003
uniform float growthRate0C; // 0.0005
uniform float growthRate_30C; // 0.01
uniform float freezingRate; //0.0002
uniform float meltingRate; // 0.0015
uniform float evapRate; // 0.0005

#include functions

vec2 newPos;
vec2 newMass;
float newDensity;

void disableDroplet()
{
    gl_PointSize = 1.;
    newMass[0] = -10. + dropPosition.x; // disable droplet and save position as seed for spawning
    newMass[1] = dropPosition.y;
}

void main()
{
    newPos = dropPosition;
    newMass = mass; // amount of water and ice carried
    newDensity = density; // determines fall speed

    if (mass[0] < 0.) { // inactive
        // generate random spawn position: x and y from 0. to 1.
        texCoord = vec2(random(mass[0] * frameNum * 2.4173), random(mass[1] * frameNum * 7.3916));

        // sample fluid at generated position
        vec4 base = texture(baseTex, texCoord);
        vec4 water = texture(waterTex, texCoord);

        // check if position is okay to spawn
        float realTemp = potentialToRealT(base[3]); // in Kelvin

#define initalMass 0.05 // 0.05 initial droplet mass
        float thresHold;
        if (realTemp > CtoK(0.0))
            thresHold = aboveZeroThreshold; // in above freezing conditions coalescence only happens in really dense clouds
        else // the colder it gets, the faster ice starts to form
            //  treshHold = max(map_range(realTemp, CtoK(0.0), CtoK(-30.0), subZeroThreshold, initalMass), initalMass);
            thresHold = subZeroThreshold;

        if (water[1] > thresHold && base[3] < 500.) { // if cloudwater above thresHold and not wall
            if ((water[1] - thresHold) / inactiveDroplets * resolution.x * resolution.y * spawnChance > random(mass[0] * 0.3724 + frameNum + random(mass[1]))) { // spawn
                newPos = vec2((texCoord.x - 0.5) * 2., (texCoord.y - 0.5) * 2.); // convert texture coordinate (0 to 1) to position (-1 to 1)

                if (realTemp < CtoK(0.0)) {
                    newMass[0] = 0.0; // enable
                    newMass[1] = initalMass; // snow
                    feedback[1] += newMass[1] * meltingHeat; // add heat of freezing
                    newDensity = snowDensity;
                } else {
                    newMass[0] = initalMass; // rain
                    newMass[1] = 0.0;
                    newDensity = 1.0;
                }
                feedback[2] -= initalMass;
            }
        }

        if (feedback[2] < 0.0) { // spawned
            gl_PointSize = 1.0;
            gl_Position = vec4(newPos, 0.0, 1.0);
        } else { // still inactive
            feedback[0] = 1.0; // count 1 inactive droplet
            gl_Position = vec4(vec2(-1. + texelSize.x, -1. + texelSize.y),0.0,1.0); // render to bottem left corner (0, 0) to count inactive droplets
        }

    } else { // active
        texCoord = vec2(dropPosition.x / 2. + 0.5,
            dropPosition.y / 2. + 0.5); // convert position (-1 to 1) to texture coordinate (0 to 1)
        vec4 water = texture(waterTex, texCoord);
        vec4 base = texture(baseTex, texCoord);

        float realTemp = potentialToRealT(base[3]); // in Kelvin

        float totalMass = newMass[0] + newMass[1];

        if (totalMass < 0.04) { // 0.00001   to small

            feedback[1] = totalMass * evapHeat; // evaporation of residual droplet
            feedback[2] = totalMass; // evaporation of residual droplet

            disableDroplet();

        } else if (newPos.y < -1.0 || base[3] > 500.) { // to low or wall

            if (texture(baseTex, vec2(texCoord.x, texCoord.y + texelSize.y))[3] > 500.) // if above cell was already wall. because of fast fall speed
                newPos.y += texelSize.y * 2.; // move position up

            feedback[2] = newMass[0]; // rain accumulation

            feedback[3] = newMass[1]; // snow accumulation

            disableDroplet();
        } else { // update droplet

            float surfaceArea = sqrt(totalMass);

            float growthRate = clamp(map_range(realTemp, CtoK(0.0), CtoK(-30.0), growthRate0C, growthRate_30C), growthRate0C, growthRate_30C); // the colder it gets the easier ice starts to form

            float growth = water[1] * growthRate * surfaceArea;
            feedback[2] -= growth * 1.0;

            if (realTemp < CtoK(0.0)) { // freezing
                newMass[1] += growth; // ice growth
                feedback[1] += growth * meltingHeat;

                float freezing = min((CtoK(0.0) - realTemp) * freezingRate * surfaceArea, newMass[0]); // rain freezing
                newMass[0] -= freezing;
                newMass[1] += freezing;
                feedback[1] += freezing * meltingHeat;

            } else { // melting
                newMass[0] += growth; // water growth

                float melting = min((realTemp - CtoK(0.0)) * meltingRate * surfaceArea / newDensity, newMass[1]); // 0.0002 snow / hail melting
                newMass[1] -= melting;
                newMass[0] += melting;
                feedback[1] -= melting * meltingHeat;

                newDensity = min(newDensity + (melting / totalMass) * 1.00,
                    1.0); // density increases upto 1.0
            }

            float dropletTemp = potentialToRealT(base[3]); // should be wetbulb temperature...

            if (newMass[1] > 0.0) // if any ice
                dropletTemp = min(dropletTemp, CtoK(0.0)); // temp can not be more than 0 C

            float evapAndSubli = max((maxWater(dropletTemp) - water[0]) * surfaceArea * evapRate, 0.); // 0.0005 evaporation and sublimation only positive

            float evap = min(newMass[0], evapAndSubli); // can only evaporate as much water as it contains
            float subli = min(newMass[1], evapAndSubli - evap); // the rest is ice sublimation, upto the amount of ice it contains

            newMass[0] -= evap; // water evaporation
            newMass[1] -= subli; // ice sublimation

            feedback[2] += evap; // added to water vapor in air
            feedback[2] += subli;
            feedback[1] -= evap * evapHeat; // heat cost extracted from air
            feedback[1] -= subli * evapHeat;
            feedback[1] -= subli * meltingHeat;

            // Update position
            newPos += base.xy / resolution * 2.; // move with air       * 2 because -1. to 1.
            newPos.y -= fallSpeed * newDensity * sqrt(totalMass / surfaceArea); // fall speed relative to air

            newPos.x = mod(newPos.x + 1., 2.) - 1.; // wrap horizontal position around edges

            feedback[0] = -totalMass * waterWeight;

#define pntSize 16. // 8
            float pntSurface = pntSize * pntSize; // suface area

            feedback[0] /= pntSurface;
            feedback[1] /= pntSurface;
            feedback[2] /= pntSurface;

            gl_PointSize = pntSize;
        } // update

        gl_Position = vec4(newPos, 0.0, 1.0);
    } // active

    position_out = newPos;
    mass_out = newMass;
    density_out = max(newDensity, 0.);
}