#define PI 3.1415926535897932384626433832795
#define rad2deg 57.2958
#define deg2rad 0.0174533

const vec3 tempColorPalette[] = vec3[](vec3(1., 0.7, 1.), vec3(1., 0.5, 1.), vec3(1., 0.3, 1.), vec3(0.8, 0., 0.8), vec3(0.65, 0., 0.6), vec3(0.5, 0., 0.5), vec3(0.35, 0., 0.6), vec3(0., 0., 0.7), vec3(0., 0., 1.), vec3(0., 0.30, 1.), vec3(0., 0.44, 1.), vec3(0., 0.62, 1.0), vec3(0., 0.80, 1.0), vec3(0., 1., 1.), vec3(0., 0.50, 0.), vec3(0., 0.61, 0.0), vec3(0., 0.72, 0.), vec3(0., 0.85, 0.),
                                       vec3(0., 1., 0.), vec3(0.5, 1., 0.), vec3(0.80, 1., 0.), vec3(1., 1., 0.), vec3(1., 0.8, 0.), vec3(1., 0.6, 0.), vec3(1., 0.4, 0.), vec3(1., 0., 0.), vec3(0.85, 0., 0.), vec3(0.72, 0., 0.), vec3(0.61, 0., 0.), vec3(0.52, 0., 0.));


// functions for display shaders
void drawCursor(/*vec4 cursor*/) // OFF: cursor.w < 1       Normal round: cursor.w 1 to 2         WHOLE WIDTH: cursor.w >= 2
{
  if (cursor.w >= 1.) { // draw cursor enabled
    float distFromMouseF;
    if (cursor.w >= 2.) {                          // whole width brush
      distFromMouseF = abs(cursor.y - texCoord.y); // whole width bar
    } else {
      vec2 vecFromMouse = cursor.xy - texCoord;
      vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle
      distFromMouseF = length(vecFromMouse);
    }
    if (abs(distFromMouseF - cursor.z * texelSize.y) < 0.00001 / view[2] * resolution.x) { // draw brush
      fragmentColor = vec4(0.5, 0.5, 0.5, 1.0);                                            // gray line
    }
  }
}

void drawDirLines(vec2 vel)
{
  vec2 localcoord = vec2(-1.0, 0.0);
  float centerDist = length(localcoord); // distance from center of cell
  float velMag = length(vel);

  float relAngle = acos(dot(vel, localcoord) / (velMag * centerDist)); // angle between velocity and line from center of cell to this pixel

  float velMagSqrt = sqrt(velMag);

  float sizeMult = 3.952 / velMagSqrt;


  if (mod(relAngle, 0.50) < 0.01)
    fragmentColor = vec4(vec3(0), 1.);
}

void drawIsoBars(float press)
{
  if (abs(mod(press, 0.001)) < 0.0001)
    fragmentColor = vec4(vec3(0), 1.);
}


void drawVectorField(vec2 vel)
{
  vec2 localcoord = mod(fragCoord, 1.0) - vec2(0.5);
  float centerDist = length(localcoord); // distance from center of cell
  float velMag = length(vel);

  float relAngle = acos(dot(vel, localcoord) / (velMag * centerDist)); // angle between velocity and line from center of cell to this pixel

  float velMagSqrt = sqrt(velMag);

  float sizeMult = 3.952 / velMagSqrt;

  if (centerDist < velMagSqrt * 0.3)
    sizeMult = 0.;

  if (relAngle < (90. * deg2rad) - pow(centerDist * sizeMult, 0.2))
    fragmentColor = vec4(vec3(0), 1.);
}


// prevents sampling from wall cell unless nearest is wall cell
// fixes visual quirks such as fog near walls
vec4 bilerpWallVis(sampler2D tex, isampler2D wallTex, vec2 pos)
{
  // return texture(tex, pos / resolution);

  vec2 st = pos - vec2(0.5); // calc pixel coordinats

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

  bool isWall = false;

  // find nearest cell and check if it's wall
  if (mixAB_CD < 0.5) {
    if (mixAB < 0.5) { // A
      if (wa[1] == 0) {
        mixAB_CD = 0.;
        mixAB = 0.;
        isWall = true;
      }
    } else { // B
      if (wb[1] == 0) {
        mixAB_CD = 0.;
        mixAB = 1.;
        isWall = true;
      }
    }
  } else {
    if (mixCD < 0.5) { // C
      if (wc[1] == 0) {
        mixAB_CD = 1.;
        mixCD = 0.;
        isWall = true;
      }
    } else { // D
      if (wd[1] == 0) {
        mixAB_CD = 1.;
        mixCD = 1.;
        isWall = true;
      }
    }
  }

  if (!isWall) { // prevent mixing from wall
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
  }

  return mix(mix(a, b, mixAB), mix(c, d, mixCD), mixAB_CD);
}

// Color Functions

vec3 hsv2rgb(vec3 c)
{
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 sunColor(float scattering) // 0.0 = white     0.5 = orange     1.0 = red
{
  float val = 1.0 - scattering;
  return hsv2rgb(vec3(0.015 + val * 0.15, min(2.0 - val * 2.0, 1.), 1.));
}
