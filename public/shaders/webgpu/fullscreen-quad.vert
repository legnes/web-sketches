#version 450 core

layout(location = 0) out vec2 vUV;

void main() {
  const vec2 positions[6] = vec2[6](
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0)
  );

  const vec2 uvs[6] = vec2[6](
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0)
  );

  vUV = uvs[gl_VertexIndex];
  gl_Position = vec4(positions[gl_VertexIndex], 0, 1);
}
