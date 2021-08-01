#version 450 core

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aRotation;

void main() {
  const vec3 scale = vec3(.02, .01, 1); // TODO: uniform?
  const vec3 vertices[3] = vec3[3](
    vec3(-0.5,  0.5, 1),
    vec3(-0.5, -0.5, 1),
    vec3( 0.5,  0.0, 1)
  );
  vec3 vertexPosition = vertices[gl_VertexIndex];

  float cosRotation = cos(aRotation);
  float sinRotation = sin(aRotation);
  mat3 modelMatrix = mat3(
    cosRotation * scale.x, sinRotation * scale.x, 0,
    -sinRotation * scale.y, cosRotation * scale.y, 0,
    aPosition * scale.z
  );

  gl_Position = vec4(modelMatrix * vertexPosition, 1);
}
