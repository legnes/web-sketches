@vertex
fn main(
  @builtin(vertex_index) VertexIndex: u32,
  @location(0) aPosition: vec3f,
  @location(1) aRotation: f32
) -> @builtin(position) vec4f {
  const scale = vec3(0.02, 0.01, 1.0); // TODO: uniform?
  var vertices = array<vec3f, 3>(
    vec3(-0.5,  0.5, 1),
    vec3(-0.5, -0.5, 1),
    vec3( 0.5,  0.0, 1)
  );
  let vertexPosition = vertices[VertexIndex];

  let cosRotation = cos(aRotation);
  let sinRotation = sin(aRotation);
  let modelMatrix = mat3x3<f32>(
    vec3(cosRotation * scale.x, sinRotation * scale.x, 0f),
    vec3(-sinRotation * scale.y, cosRotation * scale.y, 0f),
    aPosition * scale.z
  );

  return vec4(modelMatrix * vertexPosition, 1);
}
