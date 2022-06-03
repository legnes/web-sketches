@stage(fragment)
fn main(@location(0) vNormal : vec3<f32>) -> @location(0) vec4<f32> {
  let lightDir : vec3<f32> = normalize(vec3<f32>(-1.0, -1.0, 0.0));
  let lambert : f32 = dot(vNormal, -lightDir);
  var halfLambert : f32 = lambert * 0.5 + 0.5;
  halfLambert *= halfLambert;
  return mix(vec4<f32>(0.0, 0.0, 0.0, 1.0), vec4<f32>(1.0, 0.0, 1.0, 1.0), halfLambert);
}