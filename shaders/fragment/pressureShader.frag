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

  wall = texture(wallTex, texCoord); // pass through

  if (wall[1] != 0) {
    ivec2 wallX0Ym = texture(wallTex, texCoordX0Ym).xy;
    if (wallX0Ym[1] == 0 && wallX0Ym[0] == 1) { // cell below is land wall
      base[3] -= (baseX0Ym[3] - 1000.0) * 0.2;  // Snow melting cools air (scaled across 5 acoustic substeps)
    }

    // Split-explicit acoustic substep pressure update (Klemp-Wilhelmson anelastic-style projection)
    float div = (base[0] - baseXmY0[0]) + (base[1] - baseX0Ym[1]);
    base[2] -= div * 0.24;

    // Gentle acoustic wave absorption at the stratospheric top lid
    if (texCoord.y > 0.95) {
      base[2] *= 1.0 - smoothstep(0.95, 1.0, texCoord.y) * 0.002;
    }
  }
}
