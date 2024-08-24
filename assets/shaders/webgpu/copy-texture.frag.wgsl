@group(0) @binding(0) var srcSampler: sampler;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;

@fragment
fn main(@location(0) vUV: vec2f) -> @location(0) vec4f {
  return textureSample(srcTexture, srcSampler, vUV);
}
