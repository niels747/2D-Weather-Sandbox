#version 300 es
precision highp float;

in vec4 feedback;
in vec2 deposition;

layout(location = 0) out vec4 feedbackOut;
layout(location = 1) out vec2 depositionOut;

void main() // simply pass through
{
  feedbackOut = feedback;
  depositionOut = deposition;
}