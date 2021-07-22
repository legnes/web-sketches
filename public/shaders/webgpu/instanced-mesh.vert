#version 450 core

layout(location = 0) in vec4 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in mat4 aModelMatrix;

layout(set = 0, binding = 0) uniform PassUniforms {
  mat4 uViewMatrix;
  mat4 uProjectionMatrix;
};

layout(location = 0) out vec3 vNormal;

void main() {
  vNormal = aNormal;
  gl_Position = uProjectionMatrix * uViewMatrix * aModelMatrix * aPosition;
}