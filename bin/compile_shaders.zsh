#!/usr/bin/env zsh

rm -f assets/shaders/webgpu/built/*
for file in assets/shaders/webgpu/*.{vert,frag,comp}(N); glslangValidator -V $file -o ${file:s/webgpu/webgpu\/built}.spv