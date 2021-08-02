// Helpers
const DEG_TO_RAD = Math.PI / 180;

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

// Constants
// TODO: I think size bottleneck is with accumulation calculation
// The accumulation memory access pattern runs faster than naive loop
// but things are still pretty slow because the calculations are slow
const NUM_AGENTS = 8192;
const ACCUMULATE_FORCES_WORGROUP_SIZE = 64;
const UPDATE_AGENTS_WORGROUP_SIZE = 32;

// Define simulation data
const agentData = new Float32Array(NUM_AGENTS * 4);
const forcesSize = NUM_AGENTS * 4 * 4;

const ppsParams =
// {speed: 0, neighborhoodRadius: 0, globalRotation: 0, localRotation: 0};
// {speed: 0.02, neighborhoodRadius: 0.09, globalRotation: 0.40, localRotation: 0.16};
{speed: 0.006, neighborhoodRadius: 0.09, globalRotation: -0.1, localRotation: 0.12};
// {speed: 0.004, neighborhoodRadius: 0.261, globalRotation: 0.009, localRotation: 0.005};
const paramsData = new Float32Array(Object.keys(ppsParams).length);

// Set up compute pipelines
const accumulateForcesPipeline = device.createComputePipeline({
  compute: {
    module: device.createShaderModule({ code: await loadShader('ppsAccumulateForces.comp') }),
    entryPoint: 'main',
  },
});

const updateAgentsPipeline = device.createComputePipeline({
  compute: {
    module: device.createShaderModule({ code: await loadShader('ppsUpdateAgents.comp') }),
    entryPoint: 'main',
  },
});

// Set up compute buffers
const forcesBuffer = device.createBuffer({
  size: forcesSize,
  usage: GPUBufferUsage.STORAGE,
});

const agentsBuffer = device.createBuffer({
  size: agentData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
});

const paramsBuffer = device.createBuffer({
  size: paramsData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
});

// Pass buffers and uniforms
function resetPositions() {
  for (let i = 0; i < NUM_AGENTS; i++) {
    const baseIndex = i * 4;
    agentData[baseIndex + 0] = Math.random() * 2 - 1;
    agentData[baseIndex + 1] = Math.random() * 2 - 1;
    agentData[baseIndex + 2] = 1;
    agentData[baseIndex + 3] = Math.random() * 2 * Math.PI;
  }
  device.queue.writeBuffer(agentsBuffer, 0, agentData);
}
resetPositions();

function updatePpsParams() {
  paramsData[0] = ppsParams.speed;
  paramsData[1] = ppsParams.neighborhoodRadius;
  paramsData[2] = ppsParams.globalRotation;
  paramsData[3] = ppsParams.localRotation;
  device.queue.writeBuffer(paramsBuffer, 0, paramsData);
}
updatePpsParams();

// Bind compute buffers
const computeBindGroupEntries = [{
  binding: 0,
  resource: {
    buffer: paramsBuffer,
    offset: 0,
    size: paramsData.byteLength
  }
},{
  binding: 1,
  resource: {
    buffer: agentsBuffer,
    offset: 0,
    size: agentData.byteLength,
  }
}, {
  binding: 2,
  resource: {
    buffer: forcesBuffer,
    offset: 0,
    size: forcesSize,
  }
}]

const accumulateForcesBindGroup = device.createBindGroup({
  layout: accumulateForcesPipeline.getBindGroupLayout(0),
  entries: computeBindGroupEntries
});

const updateAgentsBindGroup = device.createBindGroup({
  layout: updateAgentsPipeline.getBindGroupLayout(0),
  entries: computeBindGroupEntries
});

// Set up render pipeline
const renderPipeline = device.createRenderPipeline({
  vertex: {
    module: device.createShaderModule({ code: await loadShader('instanced-triangle.vert') }),
    entryPoint: 'main',
    buffers: [{
      arrayStride: 4 * 4,
      stepMode: 'instance',
      attributes: [{
        format: 'float32x3',
        offset: 0,
        shaderLocation: 0
      }, {
        format: 'float32',
        offset: 4 * 3,
        shaderLocation: 1
      }]
    }]
  },
  fragment: {
    module: device.createShaderModule({ code: await loadShader('debug.frag') }),
    entryPoint: 'main',
    targets: [{
      format: presentationFormat
    }]
  },
  primitive: {
    topology: 'triangle-list',
  },
});

const renderPassDescriptor = {
  colorAttachments: [{
    view: undefined,
    loadValue: [.94, .9, .9, 1]
  }]
};

// Handle interaction
function randomRange(min, max) {
  return +(min + (max - min) * Math.random()).toFixed(3);
}

function resetAndRandomizePpsParams() {
  resetPositions();
  ppsParams.speed = randomRange(0, 0.01);
  ppsParams.neighborhoodRadius = randomRange(0, 0.5);
  ppsParams.globalRotation = randomRange(-Math.PI * 0.1, Math.PI * 0.1);
  ppsParams.localRotation = randomRange(0, Math.PI * 0.1);
  console.log(ppsParams);
  updatePpsParams();
  updatePpsParamsDisplay();
}

function updatePpsParamsDisplay() {
  for (const key in ppsParams) {
    document.getElementById(`${key}Value`).textContent = ppsParams[key];
    document.getElementById(`${key}Input`).value = ppsParams[key];
  }
}
updatePpsParamsDisplay();

document.getElementById('resetSimInput').addEventListener('click', resetPositions);
document.getElementById('randomizeParamsInput').addEventListener('click', resetAndRandomizePpsParams);
for (const key in ppsParams) {
  document.getElementById(`${key}Input`).addEventListener('input', (evt) => {
    ppsParams[key] = +evt.target.value;
    updatePpsParams();
    updatePpsParamsDisplay();
  });
}

// Render
function frame() {
  // Handle all swapping
  renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

  // Run frame
  const commandEncoder = device.createCommandEncoder();

  // First draw previous calculations (or initial conditions)
  const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
  renderPass.setPipeline(renderPipeline);
  renderPass.setVertexBuffer(0, agentsBuffer);
  renderPass.draw(3, NUM_AGENTS, 0, 0, 0);
  renderPass.endPass();

  // Then compute next draw
  const accumulateForcesPass = commandEncoder.beginComputePass();
  accumulateForcesPass.setPipeline(accumulateForcesPipeline);
  accumulateForcesPass.setBindGroup(0, accumulateForcesBindGroup);
  accumulateForcesPass.dispatch(NUM_AGENTS / ACCUMULATE_FORCES_WORGROUP_SIZE);
  accumulateForcesPass.endPass();

  const updateAgentsPass = commandEncoder.beginComputePass();
  updateAgentsPass.setPipeline(updateAgentsPipeline);
  updateAgentsPass.setBindGroup(0, updateAgentsBindGroup);
  updateAgentsPass.dispatch(NUM_AGENTS / UPDATE_AGENTS_WORGROUP_SIZE);
  updateAgentsPass.endPass();

  device.queue.submit([ commandEncoder.finish() ]);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
