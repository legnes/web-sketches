#version 450 core

layout(location = 0) in vec2 vUV;

layout(set = 0, binding = 0) uniform sampler uSampler;
layout(set = 0, binding = 1) uniform texture2D uTexture;

layout(location = 0) out vec4 color;

void main(void) {
  color = texture(sampler2D(uTexture, uSampler), vUV);
}
