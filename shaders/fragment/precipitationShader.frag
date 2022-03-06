#version 300 es
precision highp float;

in vec4 feedback;

out vec4 fragmentColor;

void main()
{
fragmentColor = vec4(feedback); // simply pass through
}