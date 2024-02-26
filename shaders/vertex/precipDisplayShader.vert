#version 300 es
precision highp float;

in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

out vec2 position_out;
out vec2 mass_out;
out float density_out;

uniform vec2 texelSize;
uniform vec2 aspectRatios; // sim   canvas
uniform vec3 view;         // Xpos  Ypos    Zoom

void main()
{
  vec2 outpos = dropPosition;

  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];

  outpos *= view[2]; // zoom

  outpos.y *= aspectRatios[1] / aspectRatios[0];

  gl_Position = vec4(outpos, 0.0, 1.0);

  float size = 4.0; // 4.0

  // if(mass[1] > 0. && density == 1.0) // hail
  //   size = 0.6;

  gl_PointSize = view[2] * size / aspectRatios[0];

  position_out = dropPosition;
  mass_out = mass;
  density_out = density;
}