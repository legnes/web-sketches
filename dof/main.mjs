import bunny from '../meshes/bunny.mjs';
import { mat4, vec3 } from '../lib/gl-matrix.mjs';

// TODO:
//  - [ ] fix color quantizing (accum in float and do final blit)
//  - [ ] aperture shapes
//  - [ ] blue noise/fake noise
//  - [ ] make sure early z/depth/frag test is running (explicit flag? no alpha channel?)
//  - [ ] refactor everything
//  - [ ] accum temporally (w no rotation)????
//  - [ ] foc dist & fake aperture --> real focal length (mm) and aperture (f stop)
//  - [ ] can get rid of blit pass?
//  - [ ] compress bunny
//  - [ ]

// Helpers

// Based on
// glmatrix and
// https://www.opengl.org/archives/resources/code/samples/advanced/advanced97/notes/node87.html
function skewedFrustumZO(out, left, right, bottom, top, near, far, dx, dy, focus) {
  left -= dx * near / focus;
  right -= dx * near / focus;
  top -= dy * near / focus;
  bottom -= dy * near / focus;

  var rl = 1 / (right - left);
  var tb = 1 / (top - bottom);
  var nf = 1 / (near - far);
  out[0] = near * 2 * rl;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = near * 2 * tb;
  out[6] = 0;
  out[7] = 0;
  out[8] = (right + left) * rl;
  out[9] = (top + bottom) * tb;
  out[10] = far * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = far * near * nf;
  out[15] = 0;
  return out;
}

const loadShader = async (name) => {
  const response = await fetch(`../shaders/webgpu/built/${name}.spv`);
  const data = await response.arrayBuffer();
  return new Uint32Array(data);
};

// WebGPU
if (!navigator.gpu) {
  alert('WebGPU is not supported/enabled in your browser');
  throw new Error('Could not find WebGPU');
}

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

const canvas = document.getElementById('webgpu-canvas');
const context = canvas.getContext('webgpu');

const presentationFormat = context.getPreferredFormat(adapter);
const depthFormat = 'depth24plus';
context.configure({
  device,
  format: presentationFormat
});

// Instancing constants
const NUM_INSTANCES_X = 8;
const NUM_INSTANCES_Z = 8;
const INSTANCE_SPACING_X = 10;
const INSTANCE_SPACING_Z = 10;
const NUM_INSTANCES = NUM_INSTANCES_X * NUM_INSTANCES_Z;
const SPIN_SPEED = Math.PI / 4 / 1000;

// DOF constants
const jitter = vec3.create();
const jitteredViewMatrix = mat4.create();
const numJitters = 16;
const jitterNorm = 1 / numJitters;
const normConstant = [jitterNorm, jitterNorm, jitterNorm, jitterNorm];
const jitters = Array.from({ length: numJitters }).map(() => ([Math.random() * 2 * Math.PI, Math.sqrt(Math.random())]));

// DOF variables
let focalDist = 20;
const focalDistControl = document.getElementById('focalDist');
const focalDistDisplay = document.getElementById('focalDistValue');
focalDistControl.value = focalDist;
focalDistDisplay.textContent = focalDist;
focalDistControl.addEventListener('input', (evt) => {
  focalDist = evt.target.value;
  focalDistDisplay.textContent = focalDist;
});
let aperture = .5;
const apertureControl = document.getElementById('aperture');
const apertureDisplay = document.getElementById('apertureValue');
apertureControl.value = aperture;
apertureDisplay.textContent = aperture;
apertureControl.addEventListener('input', (evt) => {
  aperture = evt.target.value;
  apertureDisplay.textContent = aperture;
});

// Geometry
const verticesBuffer = device.createBuffer({
  size: bunny.vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(verticesBuffer, 0, bunny.vertices);

const indicesBuffer = device.createBuffer({
  size: bunny.indices.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(indicesBuffer, 0, bunny.indices);

// Instances
const tempVec3 = vec3.create();
const tempMat4 = mat4.create();
const instancesData = new Float32Array(16 * NUM_INSTANCES);
for (let i = 0; i < NUM_INSTANCES_Z; i++) {
  const z = ((1 - NUM_INSTANCES_Z) / 2 + i) * INSTANCE_SPACING_Z;
  for (let j = 0; j < NUM_INSTANCES_X; j++) {
    const x = ((1 - NUM_INSTANCES_X) / 2 + j) * INSTANCE_SPACING_X;
    mat4.fromTranslation(tempMat4, vec3.set(tempVec3, x, 0, z));
    instancesData.set(tempMat4, (i * NUM_INSTANCES_X + j) * 16);
  }
}

const instancesBuffer = device.createBuffer({
  size: instancesData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(instancesBuffer, 0, instancesData);

// Uniform data & buffers
const cameraPosition = [0, 16, NUM_INSTANCES_Z * INSTANCE_SPACING_Z / 2 + 4];
const cameraTarget = [0, 0, 0];
const upVector = [0, 1, 0];
const cameraForward = vec3.subtract([], cameraTarget, cameraPosition);
const cameraRight = vec3.cross([], cameraForward, upVector);
const cameraUp = vec3.cross([], cameraRight, cameraForward);
vec3.normalize(cameraForward, cameraForward);
vec3.normalize(cameraRight, cameraRight);
vec3.normalize(cameraUp, cameraUp);
const viewMatrix = mat4.lookAt(mat4.create(), cameraPosition, cameraTarget, upVector);

const near = 0.1;
const far = 200;
const fovy = Math.PI / 2;
const halfHeight = near * Math.tan(fovy / 2);
const halfWidth = halfHeight * canvas.width / canvas.height;
const projectionMatrix = skewedFrustumZO(mat4.create(), -halfWidth, halfWidth, -halfHeight, halfHeight, near, far, 0, 0, 1);

const sceneUniformsBuffer = device.createBuffer({
  size: viewMatrix.byteLength + projectionMatrix.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const sampler = device.createSampler();
const texture = device.createTexture({
  size: [canvas.width, canvas.height, 1],
  format: presentationFormat,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.SAMPLED | GPUTextureUsage.SHADER_READ
});

// Pipeline
const scenePipeline = device.createRenderPipeline({
  vertex: {
    module: device.createShaderModule({ code: await loadShader('instanced-mesh.vert') }),
    entryPoint: 'main',
    buffers: [{
      arrayStride: 6 * 4,
      attributes: [{
        format: 'float32x3',
        offset: 0,
        shaderLocation: 0
      },{
        format: 'float32x3',
        offset: 3 * 4,
        shaderLocation: 1
      }]
    }, {
      arrayStride: 16 * 4,
      stepMode: 'instance',
      attributes: [{
        format: 'float32x4',
        offset: 0,
        shaderLocation: 2
      }, {
        format: 'float32x4',
        offset: 4 * 4,
        shaderLocation: 3
      }, {
        format: 'float32x4',
        offset: 8 * 4,
        shaderLocation: 4
      }, {
        format: 'float32x4',
        offset: 12 * 4,
        shaderLocation: 5
      }]
    }]
  },
  fragment: {
    module: device.createShaderModule({ code: await loadShader('half-lambert.frag') }),
    entryPoint: 'main',
    targets: [{
      format: presentationFormat
    }]
  },
  primitive: {
    topology: 'triangle-list',
    frontFace: 'ccw',
    cullMode: 'back'
  },
  depthStencil: {
    format: depthFormat,
    depthWriteEnabled: true,
    depthCompare: 'less'
  }
});

const blitPipeline = device.createRenderPipeline({
  vertex: {
    module: device.createShaderModule({ code: await loadShader('fullscreen-quad.vert') }),
    entryPoint: 'main',
    buffers: []
  },
  fragment: {
    module: device.createShaderModule({ code: await loadShader('copy-texture.frag') }),
    entryPoint: 'main',
    targets: [{
      format: presentationFormat,
      blend: {
        color: {
          srcFactor: 'constant',
          dstFactor: 'one',
          operation: 'add'
        },
        alpha: {
          srcFactor: 'constant',
          dstFactor: 'one',
          operation: 'add'
        }
      }
    }]
  },
  primitive: {
    topology: 'triangle-list'
  }
});

// Uniform bind groups
const sceneBindGroup = device.createBindGroup({
  layout: scenePipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: {
      buffer: sceneUniformsBuffer
    }
  }]
});

const blitBindGroup = device.createBindGroup({
  layout: blitPipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: sampler,
  },{
    binding: 1,
    resource: texture.createView(),
  }],
});

// Pass
const depthTexture = device.createTexture({
  size: [canvas.width, canvas.height, 1],
  format: depthFormat,
  usage: GPUTextureUsage.RENDER_ATTACHMENT
});

const scenePassDescriptor = {
  colorAttachments: [{
    view: texture.createView(),
    loadValue: [0, 0, 0, 0]
  }],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthLoadValue: 1,
    depthStoreOp: 'store',
    stencilLoadValue: 0,
    stencilStoreOp: 'store'
  }
};

const blitPassDescriptor = {
  colorAttachments: [{
    view: undefined,
    loadValue: 'load'
  }]
};

const clearPassDescriptor = {
  colorAttachments: [{
    view: undefined,
    loadValue: [0, 0, 0, 0]
  }]
};

// Render
let previousFrameTime = Date.now();
function frame() {
  // Update time
  const currentFrameTime = Date.now();
  const dt = currentFrameTime - previousFrameTime;
  previousFrameTime = currentFrameTime;

  // Update rotation
  for (let i = 0; i < NUM_INSTANCES_Z; i++) {
    const z = ((1 - NUM_INSTANCES_Z) / 2 + i) * INSTANCE_SPACING_Z;
    for (let j = 0; j < NUM_INSTANCES_X; j++) {
      const x = ((1 - NUM_INSTANCES_X) / 2 + j) * INSTANCE_SPACING_X;
      const instanceOffset = (i * NUM_INSTANCES_X + j) * 16;
      const modelMatrix = instancesData.subarray(instanceOffset, instanceOffset + 16);
      mat4.rotateY(modelMatrix, modelMatrix, SPIN_SPEED * dt);
    }
  }
  device.queue.writeBuffer(instancesBuffer, 0, instancesData);

  // Swap chain target
  clearPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
  blitPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

  // Clear pass
  const clearCommandEncoder = device.createCommandEncoder();
  const clearPassEncoder = clearCommandEncoder.beginRenderPass(clearPassDescriptor);
  clearPassEncoder.endPass();
  device.queue.submit([ clearCommandEncoder.finish() ]);

  for (let i = 0; i < jitters.length; i++) {
    // Update jitter
    const dx = jitters[i][1] * Math.cos(jitters[i][0]) * aperture;
    const dy = jitters[i][1] * Math.sin(jitters[i][0]) * aperture;
    vec3.zero(jitter);
    vec3.scaleAndAdd(jitter, jitter, cameraRight, -dx);
    vec3.scaleAndAdd(jitter, jitter, cameraUp, -dy);
    mat4.translate(jitteredViewMatrix, viewMatrix, jitter);
    skewedFrustumZO(projectionMatrix, -halfWidth, halfWidth, -halfHeight, halfHeight, near, far, dx, dy, focalDist)
    device.queue.writeBuffer(sceneUniformsBuffer, 0, jitteredViewMatrix);
    device.queue.writeBuffer(sceneUniformsBuffer, viewMatrix.byteLength, projectionMatrix);

    // Send commands
    const commandEncoder = device.createCommandEncoder();

    // Scene pass
    const scenePassEncoder = commandEncoder.beginRenderPass(scenePassDescriptor);
    scenePassEncoder.setPipeline(scenePipeline);
    scenePassEncoder.setVertexBuffer(0, verticesBuffer);
    scenePassEncoder.setVertexBuffer(1, instancesBuffer);
    scenePassEncoder.setIndexBuffer(indicesBuffer, 'uint16');
    scenePassEncoder.setBindGroup(0, sceneBindGroup);
    scenePassEncoder.drawIndexed(bunny.indices.length, NUM_INSTANCES, 0, 0, 0);
    scenePassEncoder.endPass();

    // Blit pass
    const blitPassEncoder = commandEncoder.beginRenderPass(blitPassDescriptor);
    blitPassEncoder.setPipeline(blitPipeline);
    blitPassEncoder.setBindGroup(0, blitBindGroup);
    blitPassEncoder.setBlendConstant(normConstant);
    blitPassEncoder.draw(6, 1, 0, 0);
    blitPassEncoder.endPass();

    device.queue.submit([ commandEncoder.finish() ]);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
