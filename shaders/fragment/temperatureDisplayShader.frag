#version 300 es
precision highp float;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform sampler2D baseTex;
uniform isampler2D wallTex;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform float dryLapse;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include functions

#include "commonDisplay.glsl"


// Computes the signed distance from a line
float line_distance(vec2 p, vec2 p1, vec2 p2)
{
  vec2 center = (p1 + p2) * 0.5;
  float len = length(p2 - p1);
  vec2 dir = (p2 - p1) / len;
  vec2 rel_p = p - center;
  return dot(rel_p, vec2(dir.y, -dir.x));
}

// Computes the signed distance from a line segment
float segment_distance(vec2 p, vec2 p1, vec2 p2)
{
  vec2 center = (p1 + p2) * 0.5;
  float len = length(p2 - p1);
  vec2 dir = (p2 - p1) / len;
  vec2 rel_p = p - center;
  float dist1 = abs(dot(rel_p, vec2(dir.y, -dir.x)));
  float dist2 = abs(dot(rel_p, dir)) - 0.5 * len;
  return max(dist1, dist2);
}


float arrow(vec2 P, float size)
{
  float x = P.x;
  float y = P.y;
  float r1 = abs(x) + abs(y) - size / 2.;
  float r2 = max(abs(x + size / 2.), abs(y)) - size / 2.;
  float r3 = max(abs(x - size / 6.) - size / 4., abs(y) - size / 4.);
  return min(r3, max(.75 * r1, r2));
}

float arrow_triangle(vec2 texcoord, float body, float head, float height, float linewidth, float antialias)
{
  float w = linewidth / 2.0 + antialias;
  vec2 start = -vec2(body / 2.0, 0.0);
  vec2 end = +vec2(body / 2.0, 0.0);
  // Head : 3 lines
  float d1 = line_distance(texcoord, end, end - head * vec2(+1.0, -height));
  float d2 = line_distance(texcoord, end - head * vec2(+1.0, +height), end);
  float d3 = texcoord.x - end.x + head;
  // Body : 1 segment
  float d4 = segment_distance(texcoord, start, end - vec2(linewidth, 0.0));
  float d = min(max(max(d1, d2), -d3), d4);
  return d;
}


void main()
{
  // vec4 col = texture(baseTex, texCoord);
  vec4 base = bilerpWall(baseTex, wallTex, fragCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float realTempC = KtoC(potentialToRealT(base[3]));

  if (wall[1] == 0) {  // is wall
    switch (wall[0]) { // wall type
    case 0:
      fragmentColor = vec4(0, 0, 0, 1);
      break;
    case 1: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case 2: // water wall
      fragmentColor = vec4(0, 0.5, 0.99, 1);
      break;
    case 3: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    }
  } else { // fluid
    // fragmentColor = vec4(hsv2rgb(vec3(max(min(map_range(float(int(realTempC)),-30.0,30.0,1.0,0.0),0.80),0.0),1.0,1.0)),1.0);

    int palletteIndex = int(map_range(realTempC, -26. - 2., 30., 0., 29.));
    palletteIndex = clamp(palletteIndex, 0, 29);

    fragmentColor = vec4(tempColorPalette[palletteIndex], 1.0);
    drawVectorField(base.xy);
  }


  // arrow_triangle(vec2 texcoord, float body, float head, float height, float linewidth, float antialias)
  /*
  float velAngle = atan(base.y / base.x);
  vec2 rotated = vec2(localcoord.x * cos(velAngle) - localcoord.y * sin(velAngle), localcoord.x * sin(velAngle) + localcoord.y * cos(velAngle));
  if (arrow_triangle(rotated, 0.5, 0.1, 0.6, 0.1, 0.0) < 0.1) {
    fragmentColor = vec4(vec3(0), 1.);
  }
*/


  // drawDirLines(base.xy);
  // drawIsoLines(base[2]);
  drawCursor();
}