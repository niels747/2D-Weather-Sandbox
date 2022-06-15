const vec3 tempColorPalette[] = vec3[](vec3(1., 0.7, 1.), vec3(1., 0.5, 1.), vec3(1., 0.3, 1.), vec3(0.8, 0., 0.8), vec3(0.65, 0., 0.6), vec3(0.5, 0., 0.5), vec3(0.35, 0., 0.6), vec3(0., 0., 0.7), vec3(0., 0., 1.), vec3(0., 0.30, 1.), vec3(0., 0.44, 1.), vec3(0., 0.62, 1.0), vec3(0., 0.80, 1.0), vec3(0., 1., 1.), vec3(0., 0.50, 0.), vec3(0., 0.61, 0.0), vec3(0., 0.72, 0.), vec3(0., 0.85, 0.), vec3(0., 1., 0.), vec3(0.5, 1., 0.), vec3(0.80, 1., 0.), vec3(1., 1., 0.), vec3(1., 0.8, 0.), vec3(1., 0.6, 0.), vec3(1., 0.4, 0.), vec3(1., 0., 0.), vec3(0.85, 0., 0.), vec3(0.72, 0., 0.), vec3(0.61, 0., 0.), vec3(0.52, 0., 0.));


// functions for display shaders
void drawCursor() // OFF: cursor.w < 1       Normal round: cursor.w 1 to 2         WHOLE WIDTH: cursor.w >= 2        
{
    if (cursor.w >= 1.) { // draw cursor enabled
        float distFromMouseF;
        if (cursor.w >= 2.) { // whole width brush
            distFromMouseF = abs(cursor.y - texCoord.y); // whole width bar
        } else {
            vec2 vecFromMouse = cursor.xy - texCoord;
            vecFromMouse.x *= texelSize.y / texelSize.x; // aspect ratio correction to make it a circle
            distFromMouseF = length(vecFromMouse);
        }
        if (abs(distFromMouseF - cursor.z * texelSize.y) < 0.000001 / view[2] * resolution.x) { // draw brush
            fragmentColor = vec4(0.5, 0.5, 0.5, 1.0); // gray line
        }
    }
}

vec4 bilerpWallVis(
    sampler2D tex, isampler2D wallTex,
    vec2 pos) // prevents sampeling from wall cell unless nearest is wall cell
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

vec3 sunColor(float scattering) // 0.0 = white   1.0 = red
{
    float val = 1.0 - scattering;
    return hsv2rgb(vec3(0.015 + val * 0.15, min(2.0 - val * 2.0, 1.), 1.));
}






















































































