struct RotationUniforms {
  matrix : mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> uRotation : RotationUniforms;

struct SceneUniforms {
  viewMatrix : mat4x4<f32>,
  projectionMatrix : mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> uScene : SceneUniforms;

struct VertexOutput {
  @builtin(position) Position : vec4<f32>,
  @location(0) normal : vec3<f32>,
};

@stage(vertex)
fn main(
  @location(0) aPosition : vec4<f32>,
  @location(1) aNormal : vec3<f32>,
  @location(2) aModelMatrix1 : vec4<f32>,
  @location(3) aModelMatrix2 : vec4<f32>,
  @location(4) aModelMatrix3 : vec4<f32>,
  @location(5) aModelMatrix4 : vec4<f32>
) -> VertexOutput {
  let modelMatrix = mat4x4<f32>(aModelMatrix1, aModelMatrix2, aModelMatrix3, aModelMatrix4);
  var output : VertexOutput;
  output.normal = aNormal;
  output.Position = uScene.projectionMatrix * uScene.viewMatrix * modelMatrix * uRotation.matrix * aPosition;
  return output;
}
