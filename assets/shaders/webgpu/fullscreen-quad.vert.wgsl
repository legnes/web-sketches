struct VertexOutput {
  @builtin(position) Position : vec4f,
  @location(0) vUV : vec2f,
}

@vertex
fn main(@builtin(vertex_index) VertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2( 1.0,  1.0),
    vec2( 1.0, -1.0),
    vec2(-1.0, -1.0),
    vec2( 1.0,  1.0),
    vec2(-1.0, -1.0),
    vec2(-1.0,  1.0)
  );

  var uvs = array<vec2f, 6>(
    vec2(1.0, 0.0),
    vec2(1.0, 1.0),
    vec2(0.0, 1.0),
    vec2(1.0, 0.0),
    vec2(0.0, 1.0),
    vec2(0.0, 0.0)
  );

  return VertexOutput(
    vec4(positions[VertexIndex], 0.0, 1.0),
    uvs[VertexIndex]
  );
}
