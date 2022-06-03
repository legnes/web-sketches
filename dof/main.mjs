import bunny from '../assets/meshes/bunny.mjs';
import { mat4, vec3, vec2 } from '../assets/lib/gl-matrix.mjs';

// TODO:
//  - [ ] fix color quantizings
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

// Returns a point in a square centered at the origin with side length 2 (-1, 1)
// Uses R2 sampling from
// http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
const g = 1.32471795724474602596;
const a1 = 1 / g;
const a2 = 1 / (g * g);
let _n = 0;
function randSquare(out, seed) {
  let n = seed;
  if (typeof n === 'undefined') {
    n = _n++;
  }

  out[0] = ((0.5 + a1 * n) % 1) * 2 - 1;
  out[1] = ((0.5 + a2 * n) % 1) * 2 - 1;
  return out;
}

const heptagonPoints = Array.from({ length: 7 }, (val, i) => {
  const theta = (Math.PI / 2) + (Math.PI * 2 / 7 * i);
  return [ Math.cos(theta), Math.sin(theta) ];
});
const pToVert1 = [];
const pToVert2 = [];
const crossProd = [];
function isInHeptagon(point) {
  for (let i = 0, j = 6; i < 7; j = i++) {
    vec2.sub(pToVert1, heptagonPoints[j], point);
    vec2.sub(pToVert2, heptagonPoints[i], point);
    vec2.cross(crossProd, pToVert1, pToVert2);
    if (crossProd[2] < 0) return false;
  }
  return true;
}

function randHeptagon(out) {
  // TODO: can do better than rejection sampling?
  let isInBounds = false;
  while (!isInBounds) {
    randSquare(out);
    isInBounds = isInHeptagon(out);
  }
  return out;
}

function randCircle(out) {
  // TODO: Use golden spiral/circular R2 Won came up with
  const r = Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI
  out[0] = r * Math.cos(theta);
  out[1] = r * Math.sin(theta);
  return out;
}

const loadShader = async (name) => {
  const response = await fetch(`../assets/shaders/webgpu/built/${name}.spv`);
  const data = await response.arrayBuffer();
  return new Uint32Array(data);
};

const loadShaderWgsl = async (name) => {
  const response = await fetch(`../assets/shaders/webgpu/${name}.wgsl`);
  return response.text();
};

// WebGPU
if (!navigator.gpu) {
  alert('WebGPU is not supported/enabled in your browser');
  throw new Error('Could not find WebGPU');
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  alert('WebGPU is not supported/enabled in your browser');
  throw new Error('Could not find adapter');
}

const device = await adapter.requestDevice();

const canvas = document.getElementById('webgpu-canvas');
const context = canvas.getContext('webgpu');

const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
const depthFormat = 'depth24plus';
context.configure({
  device,
  format: presentationFormat,
  alphaMode: 'opaque'
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
const numJitters = 24;
const jitterNorm = 1 / numJitters;
const normConstant = [jitterNorm, jitterNorm, jitterNorm, jitterNorm];
// const jitters = Array.from({ length: numJitters }).map(() => randSquare([]));
// const jitters = Array.from({ length: numJitters }).map(() => randCircle([]));
const jitters = Array.from({ length: numJitters }).map(() => randHeptagon([]));

// DOF variables
let focalDist = 20;
const focalDistControl = document.getElementById('focalDist');
const focalDistDisplay = document.getElementById('focalDistValue');
focalDistControl.value = focalDist;
focalDistDisplay.textContent = focalDist;
focalDistControl.addEventListener('input', (evt) => {
  focalDist = evt.target.value;
  focalDistDisplay.textContent = focalDist;
  updateSceneUniformBuffers();
});
let aperture = .5;
const apertureControl = document.getElementById('aperture');
const apertureDisplay = document.getElementById('apertureValue');
apertureControl.value = aperture;
apertureDisplay.textContent = aperture;
apertureControl.addEventListener('input', (evt) => {
  aperture = evt.target.value;
  apertureDisplay.textContent = aperture;
  updateSceneUniformBuffers();
});

// Geometry
const verticesBuffer = device.createBuffer({
  label: "verticesBuffer",
  size: bunny.vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});
device.queue.writeBuffer(verticesBuffer, 0, bunny.vertices);

const indicesBuffer = device.createBuffer({
  label: "indicesBuffer",
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
  label: "instancesBuffer",
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

const rotationMatrix = mat4.fromRotation(mat4.create(), 0, upVector);

const sceneUniformBuffers = []
for (let i = 0; i < jitters.length; i++) {
  // Build jitter uniforms
  const jitterBuffer = device.createBuffer({
    label: `jitterBuffer${i}`,
    size: viewMatrix.byteLength + projectionMatrix.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  sceneUniformBuffers.push(jitterBuffer);
}
function updateSceneUniformBuffers() {
  for (let i = 0; i < jitters.length; i++) {
    const dx = jitters[i][0] * aperture;
    const dy = jitters[i][1] * aperture;
    vec3.zero(jitter);
    vec3.scaleAndAdd(jitter, jitter, cameraRight, -dx);
    vec3.scaleAndAdd(jitter, jitter, cameraUp, -dy);
    mat4.translate(jitteredViewMatrix, viewMatrix, jitter);
    skewedFrustumZO(projectionMatrix, -halfWidth, halfWidth, -halfHeight, halfHeight, near, far, dx, dy, focalDist);

    const jitterBuffer = sceneUniformBuffers[i];
    device.queue.writeBuffer(jitterBuffer, 0, jitteredViewMatrix);
    device.queue.writeBuffer(jitterBuffer, jitteredViewMatrix.byteLength, projectionMatrix);
  }
}
updateSceneUniformBuffers();

const rotationUniformBuffer = device.createBuffer({
  label: "rotationUniformBuffer",
  size: rotationMatrix.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});

const sampler = device.createSampler({ label: "sampler" });
const texture = device.createTexture({
  label: "texture",
  size: [canvas.width, canvas.height, 1],
  format: presentationFormat,
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
});

// Pipeline
const scenePipeline = device.createRenderPipeline({
  label: "scenePipeline",
  layout: 'auto',
  vertex: {
    module: device.createShaderModule({ code: await loadShaderWgsl('instanced-mesh.vert') }),
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
    module: device.createShaderModule({ code: await loadShaderWgsl('half-lambert.frag') }),
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
  label: "blitPipeline",
  layout: 'auto',
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
const rotationBindGroup = device.createBindGroup({
  label: "rotationBindGroup",
  layout: scenePipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: {
      buffer: rotationUniformBuffer
    }
  }]
});

const sceneBindGroups = sceneUniformBuffers.map((jitterBuffer, idx) => device.createBindGroup({
  label: `sceneBindGroup${idx}`,
  layout: scenePipeline.getBindGroupLayout(1),
  entries: [{
    binding: 0,
    resource: {
      buffer: jitterBuffer
    }
  }]
}));

const blitBindGroup = device.createBindGroup({
  label: "blitBindGroup",
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
  label: "depthTexture",
  size: [canvas.width, canvas.height, 1],
  format: depthFormat,
  usage: GPUTextureUsage.RENDER_ATTACHMENT
});

const scenePassDescriptor = {
  label: "scenePass",
  colorAttachments: [{
    view: texture.createView(),
    clearValue: [0, 0, 0, 0],
    loadOp: 'clear',
    storeOp: 'store'
  }],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthClearValue: 1,
    depthLoadOp: 'clear',
    depthStoreOp: 'store',
  }
};

const blitPassDescriptor = {
  label: "blitPass",
  colorAttachments: [{
    view: undefined,
    loadOp: 'load',
    storeOp: 'store'
  }]
};

const clearPassDescriptor = {
  label: "clearPass",
  colorAttachments: [{
    view: undefined,
    clearValue: [0, 0, 0, 0],
    loadOp: 'clear',
    storeOp: 'store'
  }]
};

// Bundle
// SE TODO: would love to be able to like bundle the bundles, but we alternate pass descriptors
const sceneBundles = [];
for (let i = 0; i < jitters.length; i++) {
  const sceneBundleEncoder = device.createRenderBundleEncoder({
    colorFormats: [presentationFormat],
    depthStencilFormat: depthFormat
  });
  sceneBundleEncoder.setPipeline(scenePipeline);
  sceneBundleEncoder.setVertexBuffer(0, verticesBuffer);
  sceneBundleEncoder.setVertexBuffer(1, instancesBuffer);
  sceneBundleEncoder.setIndexBuffer(indicesBuffer, 'uint16');
  sceneBundleEncoder.setBindGroup(0, rotationBindGroup);
  sceneBundleEncoder.setBindGroup(1, sceneBindGroups[i]);
  sceneBundleEncoder.drawIndexed(bunny.indices.length, NUM_INSTANCES, 0, 0, 0);
  sceneBundles.push(sceneBundleEncoder.finish());
}
const blitBundleEncoder = device.createRenderBundleEncoder({
  colorFormats: [presentationFormat]
});
blitBundleEncoder.setPipeline(blitPipeline);
blitBundleEncoder.setBindGroup(0, blitBindGroup);
blitBundleEncoder.draw(6, 1, 0, 0);
const blitBundle = blitBundleEncoder.finish();

// Render
let previousFrameTime = Date.now();
function frame() {
  // Update time
  const currentFrameTime = Date.now();
  const dt = currentFrameTime - previousFrameTime;
  previousFrameTime = currentFrameTime;

  // Update rotation
  mat4.rotateY(rotationMatrix, rotationMatrix, SPIN_SPEED * dt);
  device.queue.writeBuffer(rotationUniformBuffer, 0, rotationMatrix);

  // Swap chain target
  clearPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();
  blitPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

  // Clear pass
  const clearCommandEncoder = device.createCommandEncoder();
  const clearPassEncoder = clearCommandEncoder.beginRenderPass(clearPassDescriptor);
  clearPassEncoder.end();
  device.queue.submit([ clearCommandEncoder.finish() ]);

  for (let i = 0; i < jitters.length; i++) {
    // Send commands
    const commandEncoder = device.createCommandEncoder();

    // SE TODO: to resolve color quantization, render and blit accum to float, then blit once more with tonemap
    // SE TODO: figure out how to accum --> float without blit (depth check still writes or smth)?
    // SE TODO: improve bundling by un-interleaving!!! (see above)

    // Scene pass
    const scenePassEncoder = commandEncoder.beginRenderPass(scenePassDescriptor);
    scenePassEncoder.executeBundles([ sceneBundles[i] ])
    scenePassEncoder.end();

    // Blit pass
    const blitPassEncoder = commandEncoder.beginRenderPass(blitPassDescriptor);
    blitPassEncoder.setBlendConstant(normConstant);
    blitPassEncoder.executeBundles([ blitBundle ]);
    blitPassEncoder.end();

    device.queue.submit([ commandEncoder.finish() ]);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
