precision highp int; // needed for chrome 97, older versions didn't need this specified
precision highp isampler2D; // Not sure if the WebGL standard changed

#define lightHeatingConst 0.004 // how much a unit of light adds heat
#define IRHeatingConst 0.000002 // 0.000005 how much a unit of IR (w/m2) adds or subsracts heat

// Universal Functions
float map_range(float value, float min1, float max1, float min2, float max2)
{
    return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

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
    return mod(r2 - 1.0, 1.0);
}

// Temperature Functions

float potentialToRealT(float potential)
{
    return potential - texCoord.y * dryLapse;
}

float realToPotentialT(float real) { return real + texCoord.y * dryLapse; }

float CtoK(float c) { return c + 273.15; }

float KtoC(float k) { return k - 273.15; }

float dT_saturated(
    float dTdry,
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
#define wf_pow 17.0 // 17.0						10
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

vec4 bilerpWall(sampler2D tex, isampler2D wallTex, vec2 pos) // prevents sampeling from wall cell
{
    vec2 st = pos - 0.5; // calc pixel coordinats

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

float absHorizontalDist(float a, float b) // for wrapping around simulation border
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

