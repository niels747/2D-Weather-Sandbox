#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D baseTex;
uniform vec2 texelSize;

// outputs (MRT)
layout(location=0) out vec2 vortForce;
layout(location=1) out float outCurl;

float calcCurlAt(vec2 uv) {
    vec4 cell   = texture(baseTex, uv);
    vec4 cellXp = texture(baseTex, uv + vec2(texelSize.x, 0.0));
    vec4 cellYp = texture(baseTex, uv + vec2(0.0, texelSize.y));
    return cellYp[0] - cell[0] - cellXp[1] + cell[1];
}

void main()
{
    // Calculate curl at center and 4 neighbor stencil points directly from baseTex
    float curl     = calcCurlAt(texCoord);
    float curlXmY0 = calcCurlAt(texCoordXmY0);
    float curlX0Ym = calcCurlAt(texCoordX0Ym);
    float curlXpY0 = calcCurlAt(texCoordXpY0);
    float curlX0Yp = calcCurlAt(texCoordX0Yp);

    vec2 force = vec2(abs(curlX0Ym) - abs(curlX0Yp), abs(curlXpY0) - abs(curlXmY0));
    float magnitude = length(force) + 0.0001;

    force /= magnitude;
    force *= curl;

    vortForce = force;
    outCurl = curl;
}


