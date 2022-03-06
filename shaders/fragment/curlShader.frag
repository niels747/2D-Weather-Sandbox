#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 texCoord; // this
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
out float curl;

void main()
{
    vec4 cell = texture(baseTex, texCoord);
    vec4 cellXpY0 = texture(baseTex, texCoordXpY0);
    vec4 cellX0Yp = texture(baseTex, texCoordX0Yp); 

    curl = cellX0Yp[0] - cell[0] - cellXpY0[1] + cell[1];
}

