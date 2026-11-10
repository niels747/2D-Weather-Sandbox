#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;    // pixel
in vec2 texCoord;     // this normalized

in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

in vec2 onScreenUV;

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;
uniform sampler2D lightTex;
uniform sampler2D noiseTex;
uniform sampler2D surfaceTextureMap;
uniform sampler2D curlTex;
uniform sampler2D lightningTex;
uniform sampler2D lightningDataTex;

uniform sampler2D ambientLightTex;

uniform vec2 aspectRatios; // [0] Sim       [1] canvas

#define URBAN 0
#define FIRE_FOREST 1
#define SNOW_FOREST 2
#define FOREST 3
#define INDUS 4


uniform vec2 resolution; // sim resolution
uniform vec2 texelSize;

uniform float cellHeight; // in meters

uniform float dryLapse;
uniform float sunAngle;

uniform float minShadowLight;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // Xpos   Ypos  Size   type

uniform float displayVectorField;

uniform float iterNum;

out vec4 fragmentColor;

#include "common.glsl"

#include "commonDisplay.glsl"

vec4 base, water;
ivec4 wall;
float lightIntensity;

vec3 color;
float opacity = 1.0;

vec3 emittedLight = vec3(0.); // pure light, like lightning

float shadowLight;

vec3 onLight = vec3(0.); // extra light that lights up objects, just like sunlight and shadowlight

bool useCustomAirLighting = false;
vec3 customAirLitColor = vec3(0.0);

// Fast, artifact-free procedural value noise & fBm for sub-grid cloud edge microstructure (no JPEG block artifacts)
float hash21(vec2 p)
{
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p)
{
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Billowing cauliflower fBm (rounded convective lobes & sharp crevices for warm liquid cumulus)
float cumulusBillowFbm(vec2 p)
{
  float sum = 0.0;
  float amp = 0.54;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    float n = valueNoise(p);
    float billow = 1.0 - abs(n * 2.0 - 1.0); // rounded puffy cellular ridges with crisp dark creases
    billow = billow * billow * (3.0 - 2.0 * billow);
    sum += billow * amp;
    p = rot * p * 2.07 + vec2(17.1, 31.7);
    amp *= 0.50;
  }
  return sum;
}

// Fibrous wind-streaked fBm (silky ice crystal mares' tails for high cirrus & cumulonimbus anvils)
float cirrusFibrousFbm(vec2 p, vec2 windDir)
{
  vec2 ortho = vec2(-windDir.y, windDir.x);
  vec2 anisoP = vec2(dot(p, windDir) * 0.22, dot(p, ortho) * 1.95);
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 4; i++) {
    sum += valueNoise(anisoP) * amp;
    anisoP = anisoP * vec2(1.75, 2.25) + vec2(11.3, 23.9);
    amp *= 0.48;
  }
  return sum;
}

// Dual-phase Lagrangian flow-advected cloud microstructure (flows at exact fluid velocity with zero static swimming)
float sampleFlowCloudDetail(vec2 simPos, vec2 vel, float curlVal, float iceFrac)
{
  const float cycle = 84.0;
  float p0 = fract(iterNum / cycle);
  float p1 = fract(iterNum / cycle + 0.5);
  float blend = abs(2.0 * p0 - 1.0);

  vec2 curlWarp = vec2(-vel.y, vel.x) * curlVal * 4.5;
  vec2 pos0 = (simPos - vel * (p0 - 0.5) * cycle + curlWarp) * 0.24;
  vec2 pos1 = (simPos - vel * (p1 - 0.5) * cycle + curlWarp) * 0.24 + vec2(37.2, 19.8);

  // Add a finer second scale for crisp close-up turret florets
  float cum0 = cumulusBillowFbm(pos0) * 0.72 + cumulusBillowFbm(pos0 * 2.3 + vec2(5.1, 9.4)) * 0.28;
  float cum1 = cumulusBillowFbm(pos1) * 0.72 + cumulusBillowFbm(pos1 * 2.3 + vec2(5.1, 9.4)) * 0.28;
  float cumulusDetail = mix(cum0, cum1, blend);

  float speed = length(vel);
  vec2 windDir = (speed > 0.002) ? (vel / speed) : vec2(1.0, 0.06);
  float cir0 = cirrusFibrousFbm(pos0 * 0.80, windDir);
  float cir1 = cirrusFibrousFbm(pos1 * 0.80, windDir);
  float cirrusDetail = mix(cir0, cir1, blend);

  return mix(cumulusDetail, cirrusDetail, iceFrac);
}

// Safely sample cloud water for 3D optical gradients without reading land snow from wall cells
float sampleCloudSafe(vec2 pos)
{
  vec2 clampedPos = vec2(pos.x, clamp(pos.y, 0.5, resolution.y - 0.5));
  ivec4 w = texture(wallTex, clampedPos * texelSize);
  if (w[DISTANCE] == 0)
    return 0.0;
  if (w[DISTANCE] >= 5 && clampedPos.y > 3.5 && clampedPos.y < resolution.y - 3.5)
    return max(bicubicClamped(waterTex, clampedPos)[CLOUD], 0.0);
  return max(bilerpWallVis(waterTex, wallTex, clampedPos)[CLOUD], 0.0);
}


const vec3 bareDrySoilCol = pow(vec3(0.85, 0.60, 0.40), vec3(GAMMA));
const vec3 bareWetSoilCol = pow(vec3(0.5, 0.2, 0.1), vec3(GAMMA));
const vec3 greenGrassCol = pow(vec3(0.0, 0.7, 0.2), vec3(GAMMA));
const vec3 dryGrassCol = pow(vec3(0.843, 0.588, 0.294), vec3(GAMMA));


vec4 surfaceTexture(int index, vec2 pos)
{
#define numTextures 5.;             // number of textures in the map
  const float texRelHeight = 1. / numTextures;
  pos.y = clamp(pos.y, 0.01, 0.99); // make sure position is within the subtexture
  pos /= numTextures;
  pos.y += float(index) * texRelHeight;
  return texture(surfaceTextureMap, pos);
}


vec3 getWallColor(float depth)
{
  vec3 vegetationCol = mix(greenGrassCol, dryGrassCol, max(1.0 - water[SOIL_MOISTURE] * (1. / fullGreenSoilMoisture), 0.)); // green to brown

  vec3 bareSoilCol = mix(bareDrySoilCol, bareWetSoilCol, map_rangeC(water[SOIL_MOISTURE], 0.0, 20.0, 0.0, 1.0));

  vec3 surfCol = mix(bareSoilCol, vegetationCol, min(float(wall[VEGETATION]) / 50., 1.));

  const vec3 rockCol = vec3(0.70);                                 // gray rock

  vec3 color = mix(surfCol, rockCol, clamp(depth * 0.35, 0., 1.)); // * 0.15


  color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb;                                   // add noise texture

  color = mix(color, vec3(1.0), clamp(min(water[SNOW], fullWhiteSnowHeight) / fullWhiteSnowHeight - max(depth * 0.3, 0.), 0.0, 1.0)); // mix in white for snow cover

  return color;
}

const vec2 lightningTexRes = vec2(2500, 5000);
const float lightningTexAspect = lightningTexRes.x / lightningTexRes.y;

float calcLightningTime(float startIterNum)
{
  float lightningTime = iterNum - startIterNum;
  return lightningTime / 5.0; // 30.0    0. to 1. leader stage, 1. + Flash stage
}

float lightningIntensityOverTime(float Tin, vec2 lightningPos, float intensity)
{
  float T0 = Tin - 1.;

  float repeatPeriod = map_range(random2d(lightningPos), 0., 1., 1.5, 3.0);                                            // 2.5
  float numFlashes = floor(map_range(random2d(lightningPos * 2.737250), 0., 1., 1.0, max(intensity - 0.5, 0.) * 2.0)); // 0.4

  float minT = max(T0 - (repeatPeriod * numFlashes), 0.);

  float T = max(mod(T0, repeatPeriod), minT);

  return max((1. / (0.05 + pow(T * 2.0, 3.))) - 0.005, 0.) * pow(intensity, 2.0); // fading out curve
}

vec3 displayLightning(vec2 pos, float lightningTime, float currentLightningIntensity)
{
  vec2 lightningTexCoord = texCoord;

  lightningTexCoord.x -= mod(pos.x, 1.);

  lightningTexCoord.y -= pos.y;

  float scaleMult = 1. / pos.y; // 1.0 means lightning is as tall as the simheight

  lightningTexCoord.x *= scaleMult * aspectRatios[0] / lightningTexAspect;
  lightningTexCoord.y *= -scaleMult;

  lightningTexCoord.x += 0.5;                                                                                               // center lightning bolt

  if (lightningTexCoord.x < 0.01 || lightningTexCoord.x > 1.01 || lightningTexCoord.y < 0.01 || lightningTexCoord.y > 1.01) // prevent edge effect when mipmapping
    return vec3(0);

  float pixVal = texture(lightningTex, lightningTexCoord).r;

  const float branchShowFactor = 2.5;       // 1.5
  const float leaderBrightness = 50000.;    // 200.0
  const float mainBoltBrightness = 100000.; // 100000.

  float brightnessThreshold = 1. - lightningTime * branchShowFactor;
  brightnessThreshold += lightningTexCoord.y * branchShowFactor; // grow from the top to the bottem

  brightnessThreshold = clamp(brightnessThreshold, 0., 1.);

  if (lightningTime > 1.0) { // main bolt
    brightnessThreshold = 0.95;
    currentLightningIntensity *= mainBoltBrightness;
  } else {
    currentLightningIntensity = leaderBrightness;
  }

  pixVal -= brightnessThreshold;

  pixVal = max(pixVal, 0.0);

  pixVal *= currentLightningIntensity;

  const vec3 lightningCol = vec3(0.70, 0.57, 1.0); // 0.584, 0.576, 1.0

  vec3 outputColor = max(pixVal * lightningCol, vec3(0));

  return outputColor;
}


float saturate(float x) { return min(1.0, max(0.0, x)); }
vec3 saturate(vec3 x) { return min(vec3(1., 1., 1.), max(vec3(0., 0., 0.), x)); }


vec3 bump3y(vec3 x, vec3 yoffset)
{
  vec3 y = vec3(1., 1., 1.) - x * x;
  y = saturate(y - yoffset);
  return y;
}
vec3 spectral_zucconi(float w)
{
  // w: [400, 700] wavelenght(nm)
  // x: [0,   1]
  float x = saturate((w - 400.0) / 300.0);
  const vec3 cs = vec3(3.54541723, 2.86670055, 2.29421995);
  const vec3 xs = vec3(0.69548916, 0.49416934, 0.28269708);
  const vec3 ys = vec3(0.02320775, 0.15936245, 0.53520021);
  return bump3y(cs * (x - xs), ys);
}


vec4 getAirColor(vec2 fragCoordIn)
{
  vec2 bndFragCoord = vec2(fragCoordIn.x, clamp(fragCoordIn.y, 0.5, resolution.y - 0.5)); // bound y within range
  wall = texture(wallTex, bndFragCoord * texelSize);

  bool clearOfWalls = (wall[DISTANCE] >= 5) && (bndFragCoord.y > 3.5) && (bndFragCoord.y < resolution.y - 3.5);
  if (clearOfWalls) {
    base = bicubicClamped(baseTex, bndFragCoord);
    water = bicubicClamped(waterTex, bndFragCoord);
  } else {
    base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
    water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  }

  // Smooth sub-texel sunlight sampling
  lightIntensity = bilerp(lightTex, bndFragCoord)[0] / standardSunBrightness;

  float realTemp = potentialToRealT(base[TEMPERATURE]);
  float iceFrac = cloudIceFraction(realTemp);

  shadowLight = minShadowLight;

  float rawCloud = max(water[CLOUD], 0.0);
  float cloudwater = rawCloud;

  // Sub-grid flow-advected edge detail (cauliflower lobes for warm cumulus, silky streaks for high ice cirrus/anvils)
  float microFbm = 0.5;
  if (rawCloud > 0.001 || water[PRECIPITATION] > 0.002) {
    float localCurl = texture(curlTex, bndFragCoord * texelSize).r;
    microFbm = sampleFlowCloudDetail(bndFragCoord, base.xy, localCurl, iceFrac);

    if (rawCloud > 0.001) {
      // Gently sculpt thin-to-moderate cloud margins while keeping dense cloud cores faithful to the fluid solver
      float edgeMask = exp(-rawCloud * 1.35) * smoothstep(0.001, 0.04, rawCloud);
      float erodeStrength = mix(0.26, 0.38, iceFrac);
      cloudwater = max(rawCloud + (microFbm - 0.48) * erodeStrength * edgeMask, 0.0);
    }
  }

  // Beer-Lambert optical opacity: warm liquid droplets are crisp & dense; high ice cirrus/anvils are gossamer & translucent
  float cloudExt = cloudwater * mix(10.5, 6.0, iceFrac);
  float cloudOpacity = 1.0 - exp(-cloudExt);

  // Wind-sheared precipitation curtains (slanted rain / virga shafts above 0 C, soft drifting snow trails below 0 C)
  float precipAmount = max(water[PRECIPITATION], 0.0);
  float precipOpacity = 0.0;
  vec3 precipAlbedo = vec3(0.85);
  if (precipAmount > 0.001) {
    float rainFactor = smoothstep(-1.5, 3.5, KtoC(realTemp));
    float fallTilt = clamp(base.x * mix(5.0, 2.8, rainFactor), -2.2, 2.2);
    float fallDrift = iterNum * mix(0.09, 0.24, rainFactor);
    vec2 streakUV = vec2((bndFragCoord.x - bndFragCoord.y * fallTilt) * 0.45, bndFragCoord.y * 0.06 + fallDrift);
    float streakTex = 0.76 + 0.24 * valueNoise(streakUV);
    float precipOptical = precipAmount * mix(0.95, 0.62, rainFactor) * streakTex;
    precipOpacity = 1.0 - exp(-precipOptical);
    precipAlbedo = mix(vec3(0.93, 0.96, 1.00), vec3(0.70, 0.78, 0.88), rainFactor); // bright snow vs. cool slate-silver rain shafts
  }

  float hydrometeorOpacity = 1.0 - (1.0 - cloudOpacity) * (1.0 - precipOpacity);

  // 3D Volumetric-Style Cloud & Precipitation Lighting
  float scatering = clamp(map_range(abs(sunAngle), 68. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.);
  vec3 directSunCol = sunColor(scatering);
  float sunElev = cos(sunAngle);
  float daylight = smoothstep(-0.06, 0.18, sunElev);
  float twilight = smoothstep(-0.08, 0.05, sunElev) * (1.0 - smoothstep(0.06, 0.34, sunElev));

  vec3 cloudNormal = vec3(0.0, 0.25, 0.968);
  float stormCoreDarkening = 1.0;

  if (rawCloud > 0.002 && wall[DISTANCE] >= 2) {
    // Multi-scale optical gradient reconstructs 3D outward-bulging cauliflower domes & crevices
    float wallGradMask = smoothstep(1.5, 4.5, float(wall[DISTANCE]));
    float cL = sampleCloudSafe(bndFragCoord - vec2(1.35, 0.0));
    float cR = sampleCloudSafe(bndFragCoord + vec2(1.35, 0.0));
    float cD = sampleCloudSafe(bndFragCoord - vec2(0.0, 1.35));
    float cU = sampleCloudSafe(bndFragCoord + vec2(0.0, 1.35));

    vec2 fineGrad = vec2(cR - cL, cU - cD) * 0.37;

    vec2 macroGrad = fineGrad;
    if (wall[DISTANCE] >= 6) {
      float mL = sampleCloudSafe(bndFragCoord - vec2(4.2, 0.0));
      float mR = sampleCloudSafe(bndFragCoord + vec2(4.2, 0.0));
      float mD = sampleCloudSafe(bndFragCoord - vec2(0.0, 4.2));
      float mU = sampleCloudSafe(bndFragCoord + vec2(0.0, 4.2));
      macroGrad = vec2(mR - mL, mU - mD) * 0.12;
    }

    // Subtle micro-normal perturbation on sunlit cumulus turrets
    vec2 microGrad = vec2(microFbm - 0.5) * 0.06 * exp(-rawCloud * 0.8);
    vec2 combinedGrad = (fineGrad * 0.65 + macroGrad * 0.55 + microGrad) * wallGradMask;

    // Outward 3D normal points opposite to inward density gradient (-d(q)/dx, -d(q)/dy, +z_bulge)
    float zBulge = 0.26 + 0.18 * clamp(rawCloud, 0.0, 2.0);
    cloudNormal = normalize(vec3(-combinedGrad.x, -combinedGrad.y, zBulge));

    // Deep storm cores absorb & trap multi-scattered photons, creating dramatic dark cumulonimbus bases
    stormCoreDarkening = 1.0 / (1.0 + max(rawCloud - 0.65, 0.0) * 0.095 + precipAmount * 0.085);
  }

  // Sun direction in 3D (with slight forward camera-side elevation so midday clouds retain rich 3D lobe sculpting)
  vec3 sunDir3D = normalize(vec3(sin(sunAngle), max(sunElev, -0.15), 0.38));
  float NdotL = dot(cloudNormal, sunDir3D);

  // Sample upwind sunlight 2.2 cells toward the sun for thin-edge forward Mie scattering ("silver lining")
  vec2 sunStep2D = vec2(sin(sunAngle), max(sunElev, 0.05)) * 2.2;
  vec2 upwindPos = vec2(bndFragCoord.x + sunStep2D.x, min(bndFragCoord.y + sunStep2D.y, resolution.y - 0.5));
  float upwindLight = bilerp(lightTex, upwindPos)[0] / standardSunBrightness;

  // 3D lobe relief + Schneider-Vos Beer-Powder multi-scattering + Henyey-Greenstein silver lining
  float reliefFactor = mix(0.64, 1.24, smoothstep(-0.60, 0.78, NdotL));
  float beerPowder = mix(1.0, 1.0 - 0.36 * exp(-cloudwater * 3.4), clamp(cloudOpacity, 0.0, 1.0));
  float rimPeak = exp(-cloudwater * 1.9) * (1.0 - exp(-cloudwater * 9.0));
  float silverLining = rimPeak * max(upwindLight, lightIntensity) * mix(0.48, 0.82, twilight);

  vec3 directTerm = directSunCol * (lightIntensity * reliefFactor * beerPowder + silverLining);

  // Physically colored hemispheric sky-dome + earth-bounce ambient shading (replaces colorless gray shadows!)
  vec3 daySkyTint = vec3(0.56, 0.73, 1.00);
  vec3 twilightSkyTint = vec3(0.46, 0.48, 0.86); // rich periwinkle-indigo sunset shadow fill
  vec3 skyDomeTint = mix(daySkyTint, twilightSkyTint, twilight);
  vec3 groundBounceTint = mix(vec3(0.66, 0.68, 0.74), vec3(0.82, 0.68, 0.58), twilight);

  float skyHemiWeight = clamp(cloudNormal.y * 0.5 + 0.55, 0.0, 1.0);
  vec3 directionalTint = mix(groundBounceTint, skyDomeTint, skyHemiWeight);
  vec3 shadowTint = mix(vec3(0.82, 0.88, 1.00), directionalTint, daylight); // cool moonlight tint at night

  // Deep cumulonimbus storm bases shift slightly toward brooding slate-blue
  vec3 stormSlateTint = mix(vec3(0.72, 0.80, 0.94), vec3(1.0), stormCoreDarkening);
  vec3 ambientBounce = texture(ambientLightTex, bndFragCoord * texelSize).rgb * pow(1.0 - clamp(-texCoord.y * 15.0, 0.0, 1.0), 2.5);

  // Smoke & fire plume optics
  const vec3 smokeThinCol = vec3(0.78, 0.52, 0.30);
  const vec3 smokeThickCol = vec3(0.04, 0.04, 0.05);

  float smokeOpacity = clamp(1. - (1. / (water[SMOKE] + 1.)), 0.0, 1.0);
  float fireIntensity = clamp((smokeOpacity - 0.8) * 25., 0.0, 1.0);

  vec3 fireCol = hsv2rgb(vec3(fireIntensity * 0.008, 0.98, 5.0));
  vec3 smokeOrFireCol = mix(mix(smokeThinCol, smokeThickCol, smokeOpacity), fireCol, fireIntensity);

  shadowLight += fireIntensity * 2.5;

  // Lightning bolt & in-cloud lightning volumetric scatter
  vec4 lightningData = texture(lightningDataTex, vec2(0.5));
  vec2 lightningPos = lightningData.xy;
  float lightningStartIterNum = lightningData[START_ITERNUM];

  float lightningTime = calcLightningTime(lightningStartIterNum);
  float currentLightningIntensity = lightningIntensityOverTime(lightningTime, lightningPos, lightningData[INTENSITY]);

  if (lightningData[INTENSITY] > 1.0) { // CG bolt
    emittedLight += displayLightning(lightningPos, lightningTime, currentLightningIntensity);
    emittedLight /= 1. + cloudExt * 9.0;
  }

#define lightningOnLightBrightness 0.004
  vec2 dist = vec2(lightningPos.x - texCoord.x, max((abs(lightningPos.y / 2. - texCoord.y) - 0.1), 0.));
  dist.x *= aspectRatios[0];
  float lightningOnLight = lightningOnLightBrightness / (pow(length(dist), 2.) + 0.03);
  lightningOnLight *= currentLightningIntensity;
  vec3 lightningTint = vec3(0.78, 0.72, 1.0) * lightningOnLight;
  onLight += lightningTint;

  // Base unlit albedo blended between cloud condensate and precipitation shafts
  float cloudVsPrecip = (hydrometeorOpacity > 1e-5) ? clamp(cloudOpacity / hydrometeorOpacity, 0.0, 1.0) : 1.0;
  vec3 baseHydrometeorAlbedo = mix(precipAlbedo, vec3(0.995) * mix(0.82, 1.0, stormCoreDarkening), cloudVsPrecip);

  // Combine sky-dome fill, crevice AO, overhead sky transmittance, ground bounce, and lightning scatter
  float ambientStrength = minShadowLight * creviceAO * mix(0.55, 1.15, skyOcclusion);
  vec3 ambientTerm = shadowTint * stormSlateTint * ambientStrength + ambientBounce * mix(0.65, 1.1, creviceAO) + lightningTint;
  vec3 litHydrometeor = baseHydrometeorAlbedo * (directTerm + ambientTerm);
  vec3 litSmokeOrFire = smokeOrFireCol * (directSunCol * lightIntensity + vec3(shadowLight) + ambientBounce + lightningTint);

  float totalOpacity = 1.0 - (1.0 - smokeOpacity) * (1.0 - hydrometeorOpacity);
  float safeOp = max(totalOpacity, 1e-5);

  vec3 blendedAlbedo = (smokeOrFireCol * smokeOpacity + baseHydrometeorAlbedo * hydrometeorOpacity * (1.0 - smokeOpacity)) / safeOp;
  customAirLitColor = (litSmokeOrFire * smokeOpacity + litHydrometeor * hydrometeorOpacity * (1.0 - smokeOpacity)) / safeOp;
  useCustomAirLighting = true;

  return vec4(blendedAlbedo, totalOpacity);
}

float rand(float n) { return fract(sin(n) * 43758.5453123); }

void main()
{
  vec2 bndFragCoord = vec2(fragCoord.x, clamp(fragCoord.y, 0., resolution.y)); // bound y within range
  base = bilerpWallVis(baseTex, wallTex, bndFragCoord);
  wall = texture(wallTex, bndFragCoord * texelSize);                           // texCoord
  water = bilerpWallVis(waterTex, wallTex, bndFragCoord);
  lightIntensity = texture(lightTex, bndFragCoord * texelSize)[0] / standardSunBrightness;

  ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

  float realTemp = potentialToRealT(base[TEMPERATURE]);

  bool nightTime = abs(sunAngle) > 85.0 * deg2rad; // false = day time

  shadowLight = minShadowLight;

  // fragmentColor = vec4(vec3(light),1); return; // View light texture for debugging

  float cloudwater = water[CLOUD];

  if (texCoord.y < 0.) {                                     // < texelSize.y below simulation area

    float depth = float(-wall[VERT_DISTANCE]) - fragCoord.y; // -1.0?

    color = getWallColor(depth);

    lightIntensity = texture(lightTex, vec2(texCoord.x, texelSize.y))[0] / standardSunBrightness; // sample lowest part of sim area
    lightIntensity *= pow(0.5, -fragCoord.y);                                                     // 0.5 should be same as in lightingshader deeper is darker

  } else if (texCoord.y > 1.0) {                                                                  // above simulation area
    // color = vec3(0); // no need to set
    opacity = 0.0;                  // completely transparent
  } else if (wall[DISTANCE] == 0) { // is wall
                                    // color = getWallColor(texCoord);

    ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
    ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

    switch (wall[TYPE]) {
      // case WALLTYPE_INERT:
      //   color = vec3(0, 0, 0);
      //   break;

    case WALLTYPE_RUNWAY:

      if (wall[VERT_DISTANCE] == 0) {
        vec2 modTexCoord = mod(texCoord * resolution, 1.0);

        color = vec3(0.1);
        color *= texture(noiseTex, vec2(texCoord.x * resolution.x, texCoord.y * resolution.y) * 0.2).rgb; // add noise texture

        if (length(modTexCoord - vec2(0.7, 0.97)) < 0.03) {                                               // side lights
          onLight += vec3(1., 0.8, 0.3) * 300.0;
        }

        if (abs(mod(-iterNum - floor(texCoord.x * resolution.x), 150.0)) < 1.0 && length(modTexCoord - vec2(0.2, 0.98)) < 0.02) {
          onLight += vec3(0., 1.0, 0.) * 5000.0;
        }

        break;
      }

    case WALLTYPE_URBAN:
    case WALLTYPE_INDUSTRIAL:
    case WALLTYPE_FIRE:
    case WALLTYPE_LAND:

      // horizontally interpolate depth value
      float interpDepth = mix(mix(float(-wallXmY0[VERT_DISTANCE]), float(-wall[VERT_DISTANCE]), clamp(fract(fragCoord.x) + 0.5, 0.5, 1.)), float(-wallXpY0[VERT_DISTANCE]), clamp(fract(fragCoord.x) - 0.5, 0., 0.5));
      float depth = interpDepth - fract(fragCoord.y); // - 1.0 ?

      color = getWallColor(depth);

      break;
    case WALLTYPE_WATER:

      // Precomputed values (tweak to taste)
      // Frequencies
      const int numWaveComp = 5;
      const float freqs[numWaveComp] = float[numWaveComp](2.3, 3.7, 5.1, 7.6, 21.7);
      // Amplitudes
      const float amps[numWaveComp] = float[numWaveComp](0.05, 0.03, 0.02, 0.015, 0.004);
      // Speeds
      const float speeds[numWaveComp] = float[numWaveComp](0.006, 0.011, 0.018, 0.025, 0.05);
      // Phases (in radians)
      const float phases[numWaveComp] = float[numWaveComp](1.2, 3.9, 0.7, 5.1, 3.1);

      // Sum up the components
      float waveSignalL = 0.0;
      float waveSignalR = 0.0;

      for (int i = 0; i < numWaveComp; i++) {
        waveSignalL += sin(fragCoord.x * freqs[i] + iterNum * speeds[i] + phases[i]) * amps[i];
        waveSignalR += sin(fragCoord.x * freqs[i] - iterNum * speeds[i] + phases[i]) * amps[i];
      }

      vec4 baseX0Yp = texture(baseTex, texCoordX0Yp);
      float windSpeed = baseX0Yp[VX] * 10.;

      // combine based on wind direction
      float waterLevel = 0.8 + waveSignalL * max(-windSpeed, 0.) + waveSignalR * max(windSpeed, 0.);

      if (wall[VERT_DISTANCE] == 0 && fract(fragCoord.y) > waterLevel) { // air
        vec4 airColor = getAirColor(fragCoord + vec2(0., 0.5));

        opacity = airColor.a;
        color = airColor.rgb;
      } else {
        float waterDepth = max(float(-wall[VERT_DISTANCE]) - fract(fragCoord.y), 0.0);
        color = mix(vec3(0.04, 0.48, 0.92), vec3(0.01, 0.18, 0.48), clamp(waterDepth * 0.14, 0.0, 1.0)); // shallow turquoise-blue to deep marine blue
        useCustomAirLighting = false;
      }

      // draw 45° slopes under water

      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);

      if (wallXmY0[DISTANCE] == 0 && wallXmY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the left and below
        if (localX + localY < 1.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
          useCustomAirLighting = false;
        }
      }
      if (wallXpY0[DISTANCE] == 0 && wallXpY0[TYPE] != WALLTYPE_WATER && (fragCoord.y < 1. || wallX0Ym[TYPE] != WALLTYPE_WATER)) { // wall to the right and below
        if (localY - localX < 0.0) {
          opacity = 1.0;
          water = texture(waterTex, texCoord);
          color = getWallColor(float(-wall[VERT_DISTANCE]) - localY);
          shadowLight = minShadowLight;
          useCustomAirLighting = false;
        }
      }

      break;
    }
  } else { // air

    vec4 airColor = getAirColor(fragCoord);

    opacity = airColor.a;
    color = airColor.rgb;


    vec2 rainbowCenter = vec2(0.0, -1.5 + abs(sunAngle) * 0.60);

    float centerDist = length(onScreenUV - rainbowCenter) * 1.3;

    const float cameraHeight = 1.0;

    float angle = atan(centerDist / cameraHeight) * rad2deg;

    float waveLength = map_range(angle, 40.0, 42.0, 400., 700.);

    float rainSnowFactor = map_rangeC(KtoC(realTemp), 0.0, 5.0, 0.0, 1.0); // only rain if above freezing

    vec3 rainbowCol = spectral_zucconi(waveLength) * min(pow(lightIntensity, 2.0) * 1.9, 1.0) * min(water[PRECIPITATION] * 3.0, 1.0) * rainSnowFactor * 0.7;

    emittedLight += rainbowCol;
    opacity = max(opacity - length(rainbowCol), 0.); // remove some white rain to prevent overbrightening and increase color saturation


    if (wall[VERT_DISTANCE] >= 0 && wall[VERT_DISTANCE] < 10) { // near surface
      float localX = fract(fragCoord.x);
      float localY = fract(fragCoord.y);
      // ivec4 wallX0Ym = texture(wallTex, texCoordX0Ym);

#define texAspect 2560. / 4096. // height / width of tree texture
#define maxTreeHeight 40.       // height in meters when vegetation max = 127
#define maxBuildingHeight 400.  // height in meters upto wich the urban texture reaches


      if (wallX0Ym[TYPE] == WALLTYPE_URBAN) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(URBAN, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
          useCustomAirLighting = false;
        }
      } else if (wallX0Ym[TYPE] == WALLTYPE_INDUSTRIAL) {

        float heightAboveGround = localY + float(wall[VERT_DISTANCE] - 1);

        float urbanTexHeightNorm = maxBuildingHeight / cellHeight; // example: 200 / 40 = 5

        float urbanTexCoordX = mod(fragCoord.x, resolution.x) * texAspect / urbanTexHeightNorm;
        float urbanTexCoordY = heightAboveGround / urbanTexHeightNorm;

        // urbanTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // building height

        urbanTexCoordY = 1.0 - urbanTexCoordY;

        vec4 texCol = surfaceTexture(INDUS, vec2(urbanTexCoordX, urbanTexCoordY));
        if (texCol.a > 0.5) { // if not transparent

          if (nightTime) {
            shadowLight = 1.0;                 // city lights
            texCol.rgb *= vec3(1.0, 0.8, 0.5); // yellowish windows
          } else {                             // day time
            texCol.rgb *= vec3(0.8, 0.9, 1.0); // Blueish windows

            if (length(texCol.rgb) < 0.1)
              texCol.rgb = texture(noiseTex, fragCoord * 0.3).rgb * 0.3;
          }
          color = texCol.rgb;
          opacity = texCol.a;
          useCustomAirLighting = false;
        }
      }


      if (wall[VERT_DISTANCE] == 1) {                                                 // 1 above surface
                                                                                      //  if (wallX0Ym[VERT_DISTANCE] == 0) {

        float treeTexHeightNorm = maxTreeHeight / cellHeight;                         // example: 40 / 120 = 0.333

        float treeTexCoordY = localY / treeTexHeightNorm;                             // full height trees

        treeTexCoordY += map_rangeC(float(wallX0Ym[VEGETATION]), 127., 50., 0., 1.0); // apply trees height depending on vegetation

        float treeTexCoordX = fragCoord.x * texAspect / treeTexHeightNorm;            // static scaled trees

        float heightAboveGround = localY / treeTexHeightNorm;

        treeTexCoordX -= base.x * heightAboveGround * 1.00; // 2.5  trees waving with the wind effect

        treeTexCoordX *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY *= 0.72;                              // Trees only go up to 72% of the texture height
        treeTexCoordY = 1. - treeTexCoordY;                 // texture is upside down

        vec4 texCol = vec4(0.);
        if (wallX0Ym[TYPE] == WALLTYPE_LAND || wallX0Ym[TYPE] == WALLTYPE_URBAN) { // land below
          vec4 surfaceWater = texture(waterTex, texCoordX0Ym);                     // snow on land below
          float snow = surfaceWater[SNOW];
          if (snow * 0.01 / cellHeight > heightAboveGround)
            texCol = vec4(vec3(1.), 1.);                                                                                                                          // show white snow layer above ground
          else {                                                                                                                                                  // display vegetation
            vec4 treeColor = surfaceTexture(FOREST, vec2(treeTexCoordX, treeTexCoordY));
            vec4 vegetationCol = mix(treeColor, vec4(dryGrassCol, 1.), max(0.5 - surfaceWater[SOIL_MOISTURE] * (0.5 / fullGreenSoilMoisture), 0.) * treeColor.a); // green to brown
            texCol = mix(vegetationCol, surfaceTexture(SNOW_FOREST, vec2(treeTexCoordX, treeTexCoordY)), min(snow / fullWhiteSnowHeight, 1.0));
          }
        } else if (wallX0Ym[TYPE] == WALLTYPE_FIRE) {
          texCol = surfaceTexture(FIRE_FOREST, vec2(treeTexCoordX, treeTexCoordY));
        }
        if (texCol.a > 0.5) { // if not transparent
          color = texCol.rgb;

          shadowLight = minShadowLight;        // make sure trees are dark at night

          if (wallX0Ym[TYPE] == WALLTYPE_FIRE) // fire below
            shadowLight = 1.0;

          opacity = 1. - (1. - opacity) * (1. - texCol.a); // alpha blending
          useCustomAirLighting = false;
        }

        // draw 45° slopes
        ivec4 wallXmY0 = texture(wallTex, texCoordXmY0);
        ivec4 wallXpY0 = texture(wallTex, texCoordXpY0);

        if (wallXmY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the left and below
          if (localX + localY < 1.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
            useCustomAirLighting = false;
          }
        }
        if (wallXpY0[DISTANCE] == 0 && wall[TYPE] != WALLTYPE_WATER) { // wall to the right and below
          if (localY - localX < 0.0) {
            opacity = 1.0;
            water = texture(waterTex, texCoordX0Ym);
            color = getWallColor(localY - 0.6);
            shadowLight = minShadowLight; // fire should not light ground
            useCustomAirLighting = false;
          }
        }
      }
    }
    float arrow = vectorField(base.xy, displayVectorField);

    if (arrow > 0.5) {
      fragmentColor = vec4(vec3(1., 1., 0.), 1.);
      return; // exit shader
    }
  }


  float scatering = clamp(map_range(abs(sunAngle), 68. * deg2rad, 90. * deg2rad, 0., 1.), 0., 1.); // atmospheric reddening toward sunset

  vec3 finalLight = sunColor(scatering) * lightIntensity;

  float flashlightBoost = 0.0;
  if (fract(cursor.w) > 0.5) { // enable flashlight
    vec2 vecFromMouse = cursor.xy - texCoord;
    vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle
    flashlightBoost = max(cos(min(length(vecFromMouse) * 5.0, 2.)) * 1.0, 0.0);
    shadowLight += flashlightBoost;
  }

  vec3 ambientLight = texture(ambientLightTex, texCoord).rgb;

  onLight += ambientLight * pow(1. - clamp(-texCoord.y * 15., 0., 1.), 2.5);

  // Subtle sky-blue tint in daytime terrain shadows so shaded mountains & oceans match the atmosphere
  float daylightTerrain = smoothstep(92.0 * deg2rad, 76.0 * deg2rad, abs(sunAngle));
  vec3 terrainShadowVec = mix(vec3(1.0), vec3(0.78, 0.88, 1.05), daylightTerrain * 0.45) * shadowLight;

  finalLight += terrainShadowVec + onLight;

  opacity += length(emittedLight);
  opacity = clamp(opacity, 0.0, 1.0);

  vec3 litSurfaceOrCloud = useCustomAirLighting
    ? (customAirLitColor + color * flashlightBoost)
    : (color * finalLight);

  fragmentColor = vec4(max(litSurfaceOrCloud, 0.) + emittedLight, opacity);

  drawCursor(cursor, view); // over everything else
}
