#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform isampler2D wallTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform vec3 view; // Xpos  Ypos    Zoom
uniform vec3 cursor; // xpos   Ypos  Size

out vec4 fragmentColor;

#include functions

#include "commonDisplay.glsl"

void main()
{
    //vec4 col = texture(baseTex, texCoord);
    vec4 col = bilerpWall(baseTex, wallTex, fragCoord);
    ivec2 wall = texture(wallTex, texCoord).xy;

    float realTempC = KtoC(potentialToRealT(col[3]));

    if (wall[1] == 0) { // is wall
        switch (wall[0]) { // wall type
        case 0:
            fragmentColor = vec4(0, 0, 0, 1);
            break;
        case 1: // land wall
            fragmentColor = vec4(vec3(0.10), 1.0);
            break;
        case 2: // water wall
            fragmentColor = vec4(0, 0.5, 0.99, 1);
            break;
        case 3: // Fire wall
            fragmentColor = vec4(1.0, 0.5, 0.0, 1);
            break;
        }
    } else {
        // fragmentColor = vec4(hsv2rgb(vec3(max(min(map_range(float(int(realTempC)),-30.0,30.0,1.0,0.0),0.80),0.0),1.0,1.0)),1.0);

        int palletteIndex = int(map_range(realTempC, -26. - 2., 30., 0., 29.));
        palletteIndex = clamp(palletteIndex, 0, 29);

        fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
        
    }
    drawCursor();
}