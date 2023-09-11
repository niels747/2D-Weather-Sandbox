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
uniform sampler2D A320Tex;

uniform float exposure;
uniform float iterNum;

out vec4 fragmentColor;

float map_range(float value, float min1, float max1, float min2, float max2) { return min2 + (value - min1) * (max2 - min2) / (max1 - min1); }

vec3 hsv2rgb(vec3 c)
{
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


vec4 displayA320()
{

  // float aspect = texelSize.y / texelSize.x;

  vec2 planeTexCoord = texCoord;
  planeTexCoord.x -= 0.5 - iterNum * 0.0002; // 20 meters if area is 100km wide. / 0.288 = 69.44 m/s = 250 km/h
  planeTexCoord.x = mod(planeTexCoord.x, 1.0);
  planeTexCoord.y -= 0.1;
  planeTexCoord.x *= 800.0;
  planeTexCoord.y *= -2600.0 / aspectRatios.x;

  if (planeTexCoord.x < 0.0 || planeTexCoord.x > 1.0 || planeTexCoord.y < 0.0 || planeTexCoord.y > 1.0)
    return vec4(0);

  return texture(A320Tex, planeTexCoord);
}


void main()
{
  vec2 lightTexCoord = vec2(texCoord.x, min(texCoord.y, 1.0 - texelSize.y)); // limit vertical sample position to top of simulation

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

  mixedCol *= 1.0 - displayA320().a;
  mixedCol += displayA320().rgb;


  // if (texCoord.y > 2.99 && texCoord.x > 0.5) mixedCol.r = 1.;// show top of simulation area


  fragmentColor = vec4(mixedCol * (light * 1.0 + 0.3) * exposure, 1.0);
}