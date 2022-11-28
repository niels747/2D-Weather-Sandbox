#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down

uniform sampler2D baseTex;
uniform isampler2D wallTex;

layout(location = 0) out vec4 base;
layout(location = 2) out ivec4 wall;

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXmY0 = texture(baseTex, texCoordXmY0);
  vec4 baseX0Ym = texture(baseTex, texCoordX0Ym);

  wall = texture(wallTex, texCoord); // pass trough

  ivec2 wallX0Ym = texture(wallTex, texCoordX0Ym).xy;
  if (wallX0Ym[1] == 0) {            // cell below is wall
    base[3] -= baseX0Ym[3] - 1000.0; // Snow melting cools air
  }

  // if(wall[1] == 0) // if this is wall
  //    base[0] = 0.; // set velocity to 0

  // if(texCoord.y > 0.99) // keep pressure at top close to 0
  //    base[2] *= 0.995; // 0.999

  //  if(texCoord.y > 0.2)
  //    base[3] -= 0.0005;

  // pressure changes proportional to the net in or outflow, to or from the cell.
  // 0.05 - 0.49   was 0.40, lower multiplier dampenes pressure waves.
  base[2] += (baseXmY0[0] - base[0] + baseX0Ym[1] - base[1]) * 0.45;
}
