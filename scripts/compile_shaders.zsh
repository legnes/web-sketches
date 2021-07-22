#!/usr/bin/env zsh

rm -f shaders/webgpu/built/*
for file in shaders/webgpu/*.{vert,frag,comp}(N); glslangValidator -V $file -o ${file:s/webgpu/webgpu\/built}.spv