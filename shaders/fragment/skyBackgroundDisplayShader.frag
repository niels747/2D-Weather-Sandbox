#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;
in vec2 texCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform vec2 aspectRatios;

uniform sampler2D lightTex;
uniform sampler2D planeTex;
uniform sampler2D planeGearTex;

uniform sampler2D ambientLightTex;

uniform float minShadowLight;

uniform float iterNum;

uniform float simHeight;

uniform vec2 planeDirectionAndGearPos;

uniform vec3 planePos;

out vec4 fragmentColor;

float light;

vec3 ambientLight;

const float dryLapse = 0.; // definition needed for common.glsl
#include "common.glsl"

#include "commonDisplay.glsl"

vec4 displayA380(vec2 pos, float angle, out vec3 emittedLight, out vec3 onLight)
{
  vec2 planeTexCoord = texCoord;

  bool planeDir = planeDirectionAndGearPos[0] == 1.; // true = left, false = right

  planeTexCoord.x -= mod(pos.x, 1.);
  // planeTexCoord.x = realMod(planeTexCoord.x, 1.0);
  planeTexCoord.y -= pos.y;
  float cellHeight = simHeight / resolution.y;

  float scaleMult = 60.0 / cellHeight; // 6000

  planeTexCoord.x *= scaleMult * aspectRatios.x;
  planeTexCoord.y *= -scaleMult;

  // planeTexCoord.y -= 0.7;

  // rotate

  float sin_factor = sin(angle);
  float cos_factor = cos(angle);

  planeTexCoord = vec2(planeTexCoord.x, planeTexCoord.y) * mat2(cos_factor, sin_factor, -sin_factor, cos_factor);

  planeTexCoord *= 0.15;              // scale
  planeTexCoord *= vec2(500., 1000.); // Aspect ratio

  planeTexCoord += vec2(0.5, 0.6);    // center rotation point


  if (planeTexCoord.x < 0.01 || planeTexCoord.x > 1.01 || planeTexCoord.y < 0.01 || planeTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec4(0);

  vec2 gearTexCoord = vec2(planeDir ? planeTexCoord.x - 0.10 : 0.90 - planeTexCoord.x, (planeTexCoord.y - 0.46 + planeDirectionAndGearPos[1] * 0.01)) * 2.0;

  vec4 outputCol = texture(planeTex, planeTexCoord);

  vec2 planeFragCoord = planeTexCoord * vec2(1000., 500.);

  float T = mod(iterNum, 60.) / 60.;

  emittedLight += (planeDir ? vec3(1., 0., 0.) : vec3(0., 1., 0.)) * 5. * max(3. - length(planeFragCoord - vec2(planeDir ? 611. : 391., 287.)), 0.);      // wing red/green continuous light
  emittedLight += vec3(1., 1., 1.) * 5. * max(3. - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.);                                      // Tail white continuous light

  emittedLight += vec3(1., 0., 0.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 341. : 659., 256.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light top

  emittedLight += vec3(1., 0., 0.) * 10. * max(5. - length(planeFragCoord - vec2(planeDir ? 460. : 540., 347.)), 0.) * ((T > 0.5 && T < 0.55) ? 1. : 0.); // red beacon light bottem

  emittedLight +=
    vec3(0.50, 0.65, 1.) * 30. * max(7. - length(planeFragCoord - vec2(planeDir ? 611. : 387., 287.)), 0.) * (((T > 0.0 && T < 0.05) || (T > 0.10 && T < 0.15)) ? 1. : 0.); // white wing beacon light

  emittedLight += vec3(1., 1., 1.) * 20. * max(7. - length(planeFragCoord - vec2(planeDir ? 861. : 138., 286.)), 0.) * ((T > 0.0 && T < 0.05) ? 1. : 0.);                   // Tail white beacon light


  float planeCenterLight = texture(lightTex, pos)[0]; // W/m2

  if (planeCenterLight < 100.0) {                     // if dark

                                                      // logo lights:
    onLight += vec3(1., 1., 1.) * (1. - smoothstep(0.0, 130.0, length(planeFragCoord - vec2(planeDir ? 800. : 210., 170.)))); // Tail logo

    // landing lights:
    if (planeDirectionAndGearPos[1] < 2.0) {                                                                                   // gear extended
      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 170. : 836., 350.))), 0.); // Front gear landing light

      emittedLight += vec3(0.8, 0.9, 1.0) * 30. * max(3. - length((planeFragCoord - vec2(planeDir ? 336. : 660., 323.))), 0.); // Wing landing light

      onLight += vec3(1., 1., 1.) * 0.9 * (1. - smoothstep(0.0, 150.0, length(planeFragCoord - vec2(planeDir ? 220. : 770., 400.))));
    }
  }

  if (outputCol.a < 0.5)
    outputCol += texture(planeGearTex, gearTexCoord);

  onLight *= outputCol.a; // only shine on plane itself
  return outputCol;
}


void main()
{
  vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y + texelSize.y * 0.5, 1.0 - texelSize.y)); // limit vertical sample position to top of simulation

  light = texture(lightTex, lightTexCoord)[0] / standardSunBrightness;
  ambientLight = texture(ambientLightTex, texCoord).rgb;

  // vec3 topBackgroundCol = vec3(0.0, 0.0, 0.0);      // 0.15 dark blue
  // vec3 bottemBackgroundCol = vec3(0.20, 0.66, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue
  // vec3 bottemBackgroundCol = vec3(0.40, 0.76, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(pow(texCoord.y * 0.35, 0.5), 0., 1.)); // 0.2

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(texCoord.y, 0., 1.)); // 0.2


  float hue = 0.6;
  float sat = map_rangeC(texCoord.y, 0., 2.5, 0.7, 1.0); // more blue at the top


  float val = pow(map_rangeC(texCoord.y, 0., 3.2, 1.0, 0.05), 5.0); // pow 5 map 1.0 to 0.1

  vec3 mixedCol = hsv2rgb(vec3(hue, sat, val));                     // blue air

  vec3 airplaneLights;

  vec3 airplaneOnLight;

  vec4 A380Col = displayA380(planePos.xy, planePos.z, airplaneLights, airplaneOnLight);

  mixedCol *= 1.0 - A380Col.a;
  mixedCol += A380Col.rgb * A380Col.a;

  vec3 finalColor = mixedCol * (light + minShadowLight + airplaneOnLight);

  float airDensityFactor = clamp(1.0 - texCoord.y, 0., 1.);

  finalColor += ambientLight * 0.1 * airDensityFactor / standardSunBrightness;

  finalColor += airplaneLights;

  fragmentColor = vec4(finalColor, 1.0);
}