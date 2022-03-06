#version 300 es
precision highp float;

in vec2 position_out; 
in vec2 mass_out;
in float density_out;

out vec4 fragmentColor;

void main()
{

   if(mass_out[0] < 0.)
    discard;

/* // dots:
if(mass_out[1] > 0.){
    if(density_out < 1.0)
        fragmentColor = vec4(1.0, 1.0, 1.0, 1.0); // snow
    else
        fragmentColor = vec4(1.0, 1.0, 0.0, 1.0); // hail
}else
fragmentColor = vec4(0.0, 1.0, 1.0, 1.0); // rain
*/

float opacity = (mass_out[0] + mass_out[1]) * 0.3;


if(mass_out[1] > 0.){
    if(density_out <= 1.0) // snow
        fragmentColor = vec4(1.0, 1.0, 1.0, opacity); // oldscool
       // fragmentColor = vec4(1.0, 1.0, 1.0, 0.05); // realisic
    else
        fragmentColor = vec4(1.0, 1.0, 0.0, opacity); // hail
}else // rain
fragmentColor = vec4(0.0, 1.0, 1.0, opacity); // oldscool
//fragmentColor = vec4(0.0, 0.0, 0.0, 0.02); // highly visible
//fragmentColor = vec4(0.5, 0.5, 0.5, 0.05); // realisic
}