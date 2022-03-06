#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord; // this
in vec2 texCoordXmY0; // left
in vec2 texCoordX0Ym; // down
in vec2 texCoordXpY0; // right
in vec2 texCoordX0Yp; // up

uniform sampler2D curlTex;

uniform vec2 texelSize;

// outputs
layout(location=0) out vec2 vortForce;

void main()
{
    // calculate vorticity
    float curl = texture(curlTex, texCoord)[0];
    float curlXmY0 = texture(curlTex, texCoordXmY0)[0];
    float curlX0Ym = texture(curlTex, texCoordX0Ym)[0];
    float curlXpY0 = texture(curlTex, texCoordXpY0)[0]; 
    float curlX0Yp = texture(curlTex, texCoordX0Yp)[0];

    vec2 force = vec2(abs(curlX0Ym) - abs(curlX0Yp), abs(curlXpY0) - abs(curlXmY0));
    float magnitude = length(force) + 0.0001;

  //  if(magnitude != 0.0){ // prevent divide by 0
      force /= magnitude; // normalize vector
     //force *= 0.1;
      force *= curl;
  //  }

    vortForce = force;
}


