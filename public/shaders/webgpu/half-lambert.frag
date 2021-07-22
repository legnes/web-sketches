#version 450 core

layout(location = 0) in vec3 vNormal;

layout(location = 0) out vec4 color;

void main(void) {
  vec3 lightDir = normalize(vec3(-1, -1, 0));
  float lambert = dot(vNormal, -lightDir);
  float halfLambert = lambert * 0.5 + 0.5;
  halfLambert *= halfLambert;
  color = mix(vec4(0, 0, 0, 1), vec4(1, 0, 1, 1), halfLambert);
}