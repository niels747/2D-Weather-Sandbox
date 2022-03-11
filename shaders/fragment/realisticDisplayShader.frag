#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord; // pixel
in vec2 texCoord; // normalized

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;
uniform float sunAngle;

uniform float exposure;
uniform vec3 view; // Xpos  Ypos    Zoom
uniform vec3 cursor; // xpos   Ypos  Size


out vec4 fragmentColor;

#include functions

#include "commonDisplay.glsl"

vec4 base, water;
ivec2 wall;
float light;

vec3 color;
float opacity = 1.0;

vec3 getWallColor(vec2 coord)
{
    base = bilerpWallVis(baseTex, wallTex, coord / texelSize);
    wall = texture(wallTex, coord).xy;
    water = bilerpWallVis(waterTex, wallTex, coord / texelSize);
    light = texture(lightTex, coord)[0];

    light /= max(1.0 - texCoord.y * 1500.0, 1.0);

    light = pow(light, 1. / 2.2); // gamma correction

    switch (wall[0]) { // wall type
    case 0: // normal wall
        return vec3(0, 0, 0);
        break;
    case 1: // land wall

        vec3 groundCol;

        if (water[2] < -998.0) { // not at surface
            groundCol = vec3(0.10); // dark gray rock
        } else { // surface
            groundCol = mix(vec3(0.5, 0.2, 0.1), vec3(0.0, 0.7, 0.2), water[2] / 100.); // brown to green, dry earth to grass
            groundCol = mix(groundCol, vec3(1.0), water[3] / 100.); // brown/green to white, snow cover
        }
        return vec3((groundCol + texture(noiseTex, vec2(texCoord.x, texCoord.y * (resolution.y / resolution.x)) * 50.0).rgb * 0.2));
        break;
    case 2: // water wall
        return vec3(0, 0.5, 1.0);
        break;
    case 3: // Fire wall
        return vec3(1.0, 0.5, 0.0);
        break;
    }
}

void main()
{
    base = bilerpWallVis(baseTex, wallTex, fragCoord);
    wall = texture(wallTex, texCoord).xy;
    water = bilerpWallVis(waterTex, wallTex, fragCoord);
    light = texture(lightTex, texCoord)[0];
    light = pow(light, 1. / 2.2); // gamma correction

   // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging
    

    float cloudwater = water[1];

    if (texCoord.y < 0.003) { // below simulation area
        // worldColor = vec4(0.0, 0.0, 0.0, 1.0);
        color = getWallColor(vec2(texCoord.x, max(texCoord.y, 0.002)));
    } else if (texCoord.y > 1.0) { // above simulation area
        color = vec3(0);
        opacity = 0.0;
    } else if (wall[1] == 0) { // is wall
        color = getWallColor(texCoord);
    } else { // air
        // backgroundCol *= map_range(light, 0.0,1.0, 0.60,1.0);

        vec3 cloudCol = vec3(1.0 / (cloudwater * 0.1 + 1.0)); // white to black
        float cloudOpacity = clamp(cloudwater * 4.0, 0.0, 1.0);

        cloudOpacity += clamp(1. - (1. / (water[2] + 1.)), 0.0, 1.0); // precipitation

        float smokeOpacity = clamp(1. - (1. / (water[3] + 1.)), 0.0, 1.0);
        //float smokeOpacity = water[3]*0.5;
        vec3 smokeCol = mix(vec3(0.8, 0.51, 0.26), vec3(0.0, 0.0, 0.0), smokeOpacity);

        opacity = 1. - (1. - smokeOpacity) * (1. - cloudOpacity); // alpha blending
        color = (smokeCol * smokeOpacity / opacity) + (cloudCol * cloudOpacity * (1. - smokeOpacity) / opacity); // color blending

        opacity = clamp(opacity, 0.0, 1.0);
    }

    float scatering = clamp((0.15 / max(cos(sunAngle), 0.) - 0.15) * (2.0 - texCoord.y * 0.99) * 0.5, 0., 1.); // how red the sunlight is
    vec3 lightCol = sunColor(scatering) * light;
    const float shadowLight = 0.05;
    lightCol += vec3(shadowLight);

    fragmentColor = vec4(clamp(color * lightCol * exposure, 0., 1.), opacity);
    
    drawCursor();
}
