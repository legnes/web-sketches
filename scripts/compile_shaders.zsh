#!/usr/bin/env zsh

rm -f public/shaders/webgpu/built/*
for file in public/shaders/webgpu/*.{vert,frag,comp}(N); glslangValidator -V $file -o ${file:s/webgpu/webgpu\/built}.spv