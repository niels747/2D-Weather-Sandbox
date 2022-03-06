#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

uniform sampler2D lightTex;

out vec4 fragmentColor;

void main()
{
    vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y, 0.995)); // limit virtical sample to top of simulation

    float light = texture(lightTex, lightTexCoord)[0];

    vec3 topBackgroundCol = vec3(0.0, 0.0, 0.15); // dark blue
    vec3 bottemBackgroundCol = vec3(0.35, 0.58, 0.80); // milky white blue
    //backgroundCol *= 1.0 - texCoord.y * 0.9; // fade to black at the top

    vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, pow(texCoord.y, 0.2));

    fragmentColor = vec4(mixedCol * (light * 0.7 + 0.3), 1.0);
}