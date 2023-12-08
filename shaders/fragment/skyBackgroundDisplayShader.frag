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

uniform sampler2D lightningTex;

uniform float exposure;
uniform float iterNum;

uniform vec3 planePos;

out vec4 fragmentColor;

float map_range(float value, float min1, float max1, float min2, float max2) { return min2 + (value - min1) * (max2 - min2) / (max1 - min1); }

vec3 hsv2rgb(vec3 c)
{
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float realMod(float a, float b)
{
  // proper modulo to handle negative numbers
  return mod(mod(a, b) + b, b);
}


vec4 displayLightning(vec2 pos)
{
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);
  // planeTexCoord.x = realMod(planeTexCoord.x, 1.0);
  lightningTexCoord.y -= pos.y;

  const float simHeight = 12000.0;
  float cellHeight = simHeight / resolution.y;

  float scaleMult = 60.0 / cellHeight; // 6000

  lightningTexCoord.x *= scaleMult * aspectRatios.x;
  lightningTexCoord.y *= -scaleMult;

  lightningTexCoord /= 0.7;                                                                                                 // scale

  lightningTexCoord.x /= 3440. / 1283.;                                                                                     // dimentions                                                                                    // Aspect ratio

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec4(0);

  vec4 pixVal = texture(lightningTex, lightningTexCoord);

  // pixVal.rgb *= 5.0 * (sin(iterNum * 0.02) - 0.5);

  pixVal.rgb *= 5.0 * (1. / ((mod(float(iterNum), 300.) * 0.15)) - 0.0);

  if (pixVal.b < 1.)
    pixVal.a = 0.;

  return pixVal;
}

vec4 displayA380(vec2 pos, float angle)
{
  vec2 planeTexCoord = texCoord;

  planeTexCoord.x -= mod(pos.x, 1.);
  // planeTexCoord.x = realMod(planeTexCoord.x, 1.0);
  planeTexCoord.y -= pos.y;

  const float simHeight = 12000.0;
  float cellHeight = simHeight / resolution.y;

  float scaleMult = 60.0 / cellHeight; // 6000

  planeTexCoord.x *= scaleMult * aspectRatios.x;
  planeTexCoord.y *= -scaleMult;

  // planeTexCoord.y -= 0.7;

  // rotate

  float sin_factor = sin(angle);
  float cos_factor = cos(angle);

  planeTexCoord = vec2((planeTexCoord.x), planeTexCoord.y) * mat2(cos_factor, sin_factor, -sin_factor, cos_factor);

  planeTexCoord *= 0.15;              // scale
  planeTexCoord *= vec2(500., 1000.); // Aspect ratio

  planeTexCoord += vec2(0.5, 0.6);    // center rotation point


  if (planeTexCoord.x < 0.01 || planeTexCoord.x > 1.01 || planeTexCoord.y < 0.01 || planeTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec4(0);

  return texture(planeTex, planeTexCoord);
}


void main()
{
  vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y + texelSize.y * 0.5, 1.0 - texelSize.y)); // limit vertical sample position to top of simulation

  float light = texture(lightTex, lightTexCoord)[0];

  // vec3 topBackgroundCol = vec3(0.0, 0.0, 0.0);      // 0.15 dark blue
  // vec3 bottemBackgroundCol = vec3(0.20, 0.66, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue
  // vec3 bottemBackgroundCol = vec3(0.40, 0.76, 1.0); // vec3(0.35, 0.58, 0.80) milky white blue

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(pow(texCoord.y * 0.35, 0.5), 0., 1.)); // 0.2

  // vec3 mixedCol = mix(bottemBackgroundCol, topBackgroundCol, clamp(texCoord.y, 0., 1.)); // 0.2


  float hue = 0.6;
  float sat = map_range(texCoord.y, 0., 2.5, 0.5, 1.0);


  float val = pow(map_range(texCoord.y, 0., 3.2, 1.0, 0.1), 5.0); // pow 3 map 1.0 to 0.3


  val = pow(val, 1. / 2.2); // gamma correction
  vec3 mixedCol = hsv2rgb(vec3(hue, sat, val));


  const float timePerIteration = 0.00008;          // app.js line 118
  const float speed_kmh = 250.0;
  float speed_kmpi = speed_kmh * timePerIteration; // km per iteration
  float areaWidth = 100.0;                         // km

                                                   // vec2 planePos = vec2(0.5 - iterNum * speed_kmpi / areaWidth, 0.1); // 0.5 - iterNum * speed_kmpi / areaWidth

  // float angle = iterNum * 0.01;

  vec4 A380Col = displayA380(planePos.xy, planePos.z);

  mixedCol *= 1.0 - A380Col.a;
  mixedCol += A380Col.rgb;


  vec4 lightningCol = displayLightning(vec2(0.55, 0.5));

  mixedCol *= 1.0 - lightningCol.a;
  mixedCol += lightningCol.rgb * lightningCol.a * 4.0;


  // if (texCoord.y > 2.99 && texCoord.x > 0.5) mixedCol.r = 1.;// show top of simulation area

  fragmentColor = vec4(mixedCol * (light * 1.0 + 0.3) * exposure, 1.0);
}