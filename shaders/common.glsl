precision highp int;        // needed for chrome 97, older versions didn't need this specified
precision highp isampler2D; // Not sure if the WebGL standard changed

#define PI 3.1415926535897932384626433832795
#define rad2deg 57.2958
#define deg2rad 0.0174533


#define lightHeatingConst 0.0023 // how much heat a unit of light adds per iteration
#define IRHeatingConst 0.000002  // 0.000005 how much a unit of IR (w/m2) adds or subsracts heat

#define maxWaterTemp 40.0

#define snowMeltRate 0.0003
#define ALBEDO_SNOW 0.85
/*
#define ALBEDO_DRYSOIL 0.35
#define ALBEDO_WETSOIL 0.15
#define ALBEDO_GRASS 0.20
#define ALBEDO_FOREST 0.10
*/
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

float random2d(float x, float y)
{
  const uint mantissaMask = 0x007FFFFFu;
  const uint one = 0x3F800000u;

  uint h = hash(floatBitsToUint(x));
  h &= mantissaMask;
  h |= one;

  float r2 = uintBitsToFloat(h);
  return mod(r2 - 1.0, 1.0);
}

float rand2d(vec2 co)
{
  highp float a = 12.9898;
  highp float b = 78.233;
  highp float c = 43758.5453;
  highp float dt = dot(co.xy, vec2(a, b));
  highp float sn = mod(dt, 3.14);
  return fract(sin(sn) * c);
}

// Temperature Functions

float potentialToRealT(float potential) { return potential - texCoord.y * dryLapse; }

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