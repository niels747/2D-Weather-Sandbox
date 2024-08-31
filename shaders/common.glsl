precision highp int;
precision highp isampler2D;

#define PI 3.1415926535897932384626433832795
#define rad2deg 57.2958
#define deg2rad 0.0174533


#define lightHeatingConst 0.0023 // how much heat a unit of light adds per iteration
#define IRHeatingConst 0.000002  // 0.000005 how much a unit of IR (w/m2) adds or subsracts heat

#define maxWaterTemp 40.0


#define fullGreenSoilMoisture 50.0 // level of soil moisture where vegetation reaches the greenest color

#define fullWhiteSnowHeight 10.0   // snow height at witch full whiteness is displayed and max albedo is achieved
#define snowMassToHeight 0.05

#define snowMeltRate 0.000015
#define ALBEDO_SNOW 0.85
/*
#define ALBEDO_DRYSOIL 0.35
#define ALBEDO_WETSOIL 0.15
#define ALBEDO_GRASS 0.20
#define ALBEDO_FOREST 0.10
*/


// TEXTURE DESCRIPTIONS AND DEFINES

// base texture: RGBA32F
// .x  Horizontal velocity                              -1.0 to 1.0
// .y  Vertical   velocity                              -1.0 to 1.0
#define VX 0
#define VY 1
#define PRESSURE 2    // Pressure                                          >= 0
#define TEMPERATURE 3 // Temperature in air and water, indicator in wall

// water texture: RGBA32F
#define TOTAL 0         // Vapor + cloud water             >= 0
#define CLOUD 1         // cloud water                     >= 0
#define PRECIPITATION 2 // precipitation in air            >= 0
#define SOIL_MOISTURE 2 // moisture in surface             >= 0
#define SMOKE 3         // smoke/dust in air               >= 0 for smoke/dust
#define SNOW 3          // snow at surface in cm           0 to 40000

// wall texture: RGBA8I
#define TYPE 0 //             walltype:

#define WALLTYPE_INERT 0
#define WALLTYPE_LAND 1
#define WALLTYPE_WATER 2 // lake / sea
#define WALLTYPE_FIRE 3
#define WALLTYPE_URBAN 4

#define DISTANCE 1      // manhattan distance to nearest wall                   0 to 127
#define VERT_DISTANCE 2 // height above/below ground. Surface = 0               -127 to 127
#define VEGETATION 3    // vegetation 0 to 127     grass from 0 to 50, trees from 51 to 127


//  light texture: RGBA32F
#define SUNLIGHT 0    // sunlight                                             0 to 1.0
#define NET_HEATING 1 // net heating effect of IR + sun absorbed by smoke
#define IR_DOWN 2     // IR coming down                                       >= 0
#define IR_UP 3       // IR going  up                                         >= 0

// Precipitation mass:
#define WATER 0
#define ICE 1

// Precipitation feedback
#define MASS 0
#define HEAT 1
#define VAPOR 2
// 3 not used

// Precipitation deposition
#define RAIN_DEPOSITION 0
#define SNOW_DEPOSITION 1


// Universal Functions
float map_range(float value, float min1, float max1, float min2, float max2) { return min2 + (value - min1) * (max2 - min2) / (max1 - min1); }

float map_rangeC(float value, float min1, float max1, float min2, float max2) { return clamp(map_range(value, min1, max1, min2, max2), min2, max2); }

uint hash(uint x)
{
  x += (x << 10u);
  x ^= (x >> 6u);
  x += (x << 3u);
  x ^= (x >> 11u);
  x += (x << 15u);
  return x;
}
float random(float f)
{
  const uint mantissaMask = 0x007FFFFFu;
  const uint one = 0x3F800000u;

  uint h = hash(floatBitsToUint(f));
  h &= mantissaMask;
  h |= one;

  float r2 = uintBitsToFloat(h);
  // return mod(r2 - 1.0, 1.0);
  return fract(r2);
}

float random2d(vec2 s)
{
  const uint mantissaMask = 0x007FFFFFu;
  const uint one = 0x3F800000u;

  uint h = hash(floatBitsToUint(s.x) + hash(floatBitsToUint(s.y)));
  h &= mantissaMask;
  h |= one;

  float r2 = uintBitsToFloat(h);
  return mod(r2, 1.0);
}

float rand2d(vec2 co)
{
  const float a = 12.9898;
  const float b = 78.233;
  const float c = 43758.5453123;
  float dt = dot(co.xy, vec2(a, b));
  float sn = mod(dt, 3.14);
  return fract(sin(sn) * c);
}

// Temperature Functions

float potentialToRealT(float potential) { return potential - texCoord.y * dryLapse; }

float potentialToRealT(float potential, float texCoordY) { return potential - texCoordY * dryLapse; }

float realToPotentialT(float real) { return real + texCoord.y * dryLapse; }

float CtoK(float c) { return c + 273.15; }

float KtoC(float k) { return k - 273.15; }

float dT_saturated(float dTdry,
                   float dTl) // dTl = temperature difference because of latent heat
{
  if (dTl == 0.0)
    return dTdry;
  else {
    float multiplier = dTdry / (dTdry - dTl);

    return dTdry * multiplier;
  }
}
////////////// Water Functions ///////////////
#define wf_devider 250.0 // 250.0 Real water 	230 less steep curve
#define wf_pow 17.0      // 17.0						10
// https://www.geogebra.org/calculator/jc9hkfq4

float maxWater(float T)
{
  return pow((T / wf_devider), wf_pow); // T in Kelvin, w in grams per m^3
}

float dewpoint(float W)
{
  if (W < 0.00001)
    return 0.0;
  else
    return wf_devider * pow(W, 1.0 / wf_pow);
}

float relativeHumd(float T, float W) { return (W / maxWater(T)); }

// interpolation

vec4 bilerp(sampler2D tex, vec2 pos)
{
  vec2 st = pos - 0.5; // calc pixel coordinats

  vec2 ipos = vec2(floor(st));
  vec2 fpos = fract(st);

  ipos /= resolution;
  ipos += texelSize * 0.5;

  vec4 a = texture(tex, ipos);
  vec4 b = texture(tex, ipos + vec2(texelSize.x, 0));
  vec4 c = texture(tex, ipos + vec2(0, texelSize.y));
  vec4 d = texture(tex, ipos + vec2(texelSize.x, texelSize.y));

  float mixAB = fpos.x;
  float mixCD = fpos.x;
  float mixAB_CD = fpos.y;

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}

vec4 bilerpWall(sampler2D tex, isampler2D wallTex,
                vec2 pos) // prevents sampeling from wall cell
{
  vec2 st = pos - 0.5;    // calc pixel coordinats

  vec2 ipos = vec2(floor(st));
  vec2 fpos = fract(st);

  vec4 a = texture(tex, (ipos + vec2(0.5, 0.5)) / resolution);
  vec4 b = texture(tex, (ipos + vec2(1.5, 0.5)) / resolution);
  vec4 c = texture(tex, (ipos + vec2(0.5, 1.5)) / resolution);
  vec4 d = texture(tex, (ipos + vec2(1.5, 1.5)) / resolution);

  ivec4 wa = texture(wallTex, (ipos + vec2(0.5, 0.5)) / resolution);
  ivec4 wb = texture(wallTex, (ipos + vec2(1.5, 0.5)) / resolution);
  ivec4 wc = texture(wallTex, (ipos + vec2(0.5, 1.5)) / resolution);
  ivec4 wd = texture(wallTex, (ipos + vec2(1.5, 1.5)) / resolution);

  float mixAB = fpos.x;
  float mixCD = fpos.x;
  float mixAB_CD = fpos.y;

  if (wa[1] == 0)
    mixAB = 1.;
  else if (wb[1] == 0)
    mixAB = 0.;

  if (wc[1] == 0)
    mixCD = 1.;
  else if (wd[1] == 0)
    mixCD = 0.;

  if (wa[1] == 0 && wb[1] == 0)
    mixAB_CD = 1.;
  else if (wc[1] == 0 && wd[1] == 0)
    mixAB_CD = 0.;

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}

#define IR_constant 5.670374419 // ×10−8

float IR_emitted(float T)
{
  return pow(T * 0.01, 4.) * IR_constant; // Stefan–Boltzmann law
}

float IR_temp(float IR) // inversed Stefan–Boltzmann law
{
  return pow(IR / IR_constant, 1. / 4.) * 100.0;
}

float absHorizontalDist(float a, float b) // for wrapping horizontal position around simulation border
{
  return min(min(abs(a - b), abs(1.0 + a - b)), 1.0 - a + b);
}
/*
float realMod(float a, float b)
{
    // proper modulo to handle negative numbers
    return mod(mod(a, b) + b, b);
}
*/


// new hash funtions:


// Standard 2x2 hash algorithm.
vec2 hash22(vec2 p, float seed)
{
  float n = sin(dot(p, vec2(41, 289)));
  p = fract(vec2(2097152, 262144) * n);
  return cos(p * 6.283 + seed * 2.);
  return abs(fract(p + seed * .5) - .5) * 4. - 1.;  // Snooker.
  return abs(cos(p * 6.283 + seed * 2.)) * 2. - 1.; // Bounce.
}

float simplesque2D(vec2 p, float seed)
{
  vec2 s = floor(p + (p.x + p.y) * .3660254); // Skew the current point.
  p -= s - (s.x + s.y) * .2113249;            // Vector to unskewed base vertice.

  // Clever way to perform an "if" statement to determine which of two triangles we need.
  float i = p.x < p.y ? 1. : 0.; // Apparently, faster than: step(p.x, p.y);

  vec2 ioffs = vec2(1. - i, i);  // Vertice offset, based on above.

  // Vectors to the other two triangle vertices.
  vec2 p1 = p - ioffs + .2113249, p2 = p - .5773502;

  // Vector to hold the falloff value of the current pixel with respect to each vertice.
  vec3 d = max(.5 - vec3(dot(p, p), dot(p1, p1), dot(p2, p2)), 0.); // Range [0, 0.5]

  d *= d * d * 12.;                                                 //(2*2*2*1.5)
  // d *= d*d*d*36.;

  vec3 w = vec3(dot(hash22(s, seed), p), dot(hash22(s + ioffs, seed), p1), dot(hash22(s + 1., seed), p2));
  return .5 + dot(w, d); // Range [0, 1]... Hopefully. Needs more attention.
}

float func2D(vec2 p, float seed) { return simplesque2D(p * 4., seed) * .66 + simplesque2D(p * 8., seed) * 0.34; }


// src: https://www.shadertoy.com/view/WttXWX

// --- choose one:
// #define hashi(x) lowbias32(x)
// #define hashi(x) triple32(x)

// #define hash(x) (float(hashi(x)) / float(0xffffffffU))


// bias: 0.17353355999581582 ( very probably the best of its kind )
uint lowbias32(uint x)
{
  x ^= x >> 16;
  x *= 0x7feb352dU;
  x ^= x >> 15;
  x *= 0x846ca68bU;
  x ^= x >> 16;
  return x;
}

// bias: 0.020888578919738908 = minimal theoretic limit
uint triple32(uint x)
{
  x ^= x >> 17;
  x *= 0xed5ad4bbU;
  x ^= x >> 11;
  x *= 0xac4c1b51U;
  x ^= x >> 15;
  x *= 0x31848babU;
  x ^= x >> 14;
  return x;
}

float hash2(int x) { return float(triple32(uint(x))) / float(0xffffffffU); }


// float h = hash( V.x + hashi(V.y) ); // clean 2D hash
//  float h = hash( V.x + (V.y<<16) );  // 2D hash (should be ok too )

float rand2(vec2 s)
{
  // return hash( x + hashi(y) ); // clean 2D hash
  return hash2(int(s.x * 379071.) + int(s.y * 756398.) << 16); // 2D hash (should be ok too )
}