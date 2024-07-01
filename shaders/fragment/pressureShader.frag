#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;     // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down

uniform sampler2D baseTex;
uniform sampler2D waterTex;
uniform isampler2D wallTex;

layout(location = 0) out vec4 base;
layout(location = 1) out vec4 water; // new
layout(location = 2) out ivec4 wall;


#define VX 0
#define VY 1
#define P 2
#define T 3

void addPressure(float dP)
{
  float newP = base[P] + dP;
  float Pr = newP / base[P];   // Pressure ratio
  float Tr = pow(Pr, 0.28577); // Temperature ratio
  base[P] = newP;
  base[T] *= Tr;               // temperature change depends on pressure change
}

float calcDensity(float _P, float _T)
{                           // pressure in hPa, temperature in K, density in kg/m3
  const float _R = 2.87058; // J/(kg·K)
                            //  const float _R = 0.01; // J/(kg·K)
  return _P / (_R * _T);
}

// void addPressure(float dP)
// {
//   float pressChangeMult = dP / base[2];

//   base[2] += dP;

//   base[3] *= 1.0 + pressChangeMult * 0.6; // 0.29 temperature change per pressure change, determines dry adiabatic lapse rate

//   water[0] *= 1.0 + pressChangeMult;      // the ammount of water vapor changes proortional to the air density change
// }

void main()
{
  base = texture(baseTex, texCoord);
  vec4 baseXmY0 = texture(baseTex, texCoordXmY0);
  vec4 baseX0Ym = texture(baseTex, texCoordX0Ym);

  water = texture(waterTex, texCoord);

  wall = texture(wallTex, texCoord); // pass trough

  ivec2 wallX0Ym = texture(wallTex, texCoordX0Ym).xy;
  if (wallX0Ym[1] == 0) {            // cell below is wall
    base[3] -= baseX0Ym[3] - 1000.0; // Snow melting cools air
  }

  // if(wall[1] == 0) // if this is wall
  //    base[0] = 0.; // set velocity to 0

  //  if(texCoord.y > 0.2)
  //    base[3] -= 0.0005;

  // water[0] = 0.0;

  // pressure changes proportional to the net in or outflow, to or from the cell.
  // 0.05 - 0.49   was 0.40, lower multiplier dampenes pressure waves.
  // base[2] += (baseXmY0[0] - base[0] + baseX0Ym[1] - base[1]) * 0.45;
  // addPressure((baseXmY0.x - base.x + baseX0Ym.y - base.y) * 0.49); // 0.49


  float net_inflow = baseXmY0[VX] - base[VX] + baseX0Ym[VY] - base[VY];

  // float dP = net_inflow * cell[P];


  // multiplier determines expansion ratio
  float dP = net_inflow * base[P] * 0.99; // 0.1 t0 1.0
  /// float dP = net_inflow * calcDensity(cell[P], cell[T]) * 1000.0; // 200.0 to 1000.0

  addPressure(dP);
}
