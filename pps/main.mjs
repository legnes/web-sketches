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

// N^2 computations options
//  1. N threads, each doing N computations
//  2. N threads, accumulate N agents to environment using interlocked add, then update from environment
//  3. P < N threads, subsets of N2 calculation space using shared mem
//      - For each invocation (N / Q times)
//        - For each work group (N / P work groups, thread size P):
//          - For each thread P:
//          [compute shader begins here]
//            - Load curr data p
//            - For each tile in Q (where Q is a multiple of P):
//              - load one body description q
//              - MEM LOCK/BARRIER
//              - for 1-p, accum force on curr by all qs
//            - Write to output buf at position p
//
// Plan: start with N2, then make smarter? Could also start with method 3, but should run some mem tests

// Plan:
//  1. Set up initial data (float4: position f2 and rotation f1 and empty f1)
//  2. Draw particles from data
//  3. Compute O(N) shader update particles
//  4. Improve compute shader
//  5. Xfer --> 3d?

// Constants
const NUM_AGENTS = 2048;

// Define simulation data
const agentData = new Float32Array(NUM_AGENTS * 4);

const ppsParams =
// {speed: 0, neighborhoodRadius: 0, globalRotation: 0, localRotation: 0};
// {speed: 0.02, neighborhoodRadius: 0.2, globalRotation: -0.1, localRotation: 0.05};
// {speed: 0.018, neighborhoodRadius: 0.5, globalRotation: -0.01, localRotation: 0.15};
// {speed: 0.012, neighborhoodRadius: 0.14, globalRotation: 0.034, localRotation: 0.057};
// {speed: 0.044, neighborhoodRadius: 0.421, globalRotation: 0.340, localRotation: 0.043};
// {speed: 0.019, neighborhoodRadius: 0.087, globalRotation: 0.220, localRotation: 0.210};
{speed: 0.016, neighborhoodRadius: 0.090, globalRotation: 0.395, localRotation: 0.157}
const ppsParamsSize = Object.keys(ppsParams).length * Float32Array.BYTES_PER_ELEMENT;

// Set up compute pipeline
const computePipeline = device.createComputePipeline({
  compute: {
    module: device.createShaderModule({ code: await loadShader('pps.comp') }),
    entryPoint: 'main',
  },
});

// Set up compute buffers
const agentBuffers = [];
for (let i = 0; i < 2; i++) {
  agentBuffers.push(device.createBuffer({
    size: agentData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
  }));
}

const ppsParamsBuffer = device.createBuffer({
  size: ppsParamsSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
  device.queue.writeBuffer(agentBuffers[0], 0, agentData);
  device.queue.writeBuffer(agentBuffers[1], 0, agentData);
}
resetPositions();

function updatePpsParams() {
  device.queue.writeBuffer(
    ppsParamsBuffer,
    0,
    new Float32Array([
      ppsParams.speed,
      ppsParams.neighborhoodRadius,
      ppsParams.globalRotation,
      ppsParams.localRotation
    ])
  );
}
updatePpsParams();

function resetAndRandomizePpsParams() {
  resetPositions();
  ppsParams.speed = Math.random() * 0.05;
  ppsParams.neighborhoodRadius = Math.random() * .5;
  ppsParams.globalRotation = (Math.random() * 2 - 1) * Math.PI * 0.2;
  ppsParams.localRotation = Math.random() * Math.PI * 0.2;
  console.log(ppsParams);
  updatePpsParams();
}

document.getElementById('randomizeParamsInput').addEventListener('click', resetAndRandomizePpsParams);


// Bind compute buffers
const computeBindGroups = [];
for (let i = 0; i < 2; i++) {
  computeBindGroups.push(device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: {
        buffer: ppsParamsBuffer,
        offset: 0,
        size: ppsParamsSize
      }
    },{
      binding: 1,
      resource: {
        buffer: agentBuffers[i],
        offset: 0,
        size: agentData.byteLength,
      }
    }, {
      binding: 2,
      resource: {
        buffer: agentBuffers[(i + 1) % 2],
        offset: 0,
        size: agentData.byteLength,
      }
    }]
  }));
}

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

// Render
let frameNumber = -1;
function frame() {
  // Handle all swapping
  const frameParity = ++frameNumber % 2;
  renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

  // Run frame
  const commandEncoder = device.createCommandEncoder();

  // First draw previous calculations (or initial conditions)
  const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
  renderPass.setPipeline(renderPipeline);
  renderPass.setVertexBuffer(0, agentBuffers[frameParity]);
  renderPass.draw(3, NUM_AGENTS, 0, 0, 0);
  renderPass.endPass();

  // Then compute next draw
  const computePass = commandEncoder.beginComputePass();
  computePass.setPipeline(computePipeline);
  computePass.setBindGroup(0, computeBindGroups[frameParity]);
  computePass.dispatch(NUM_AGENTS);
  computePass.endPass();

  device.queue.submit([ commandEncoder.finish() ]);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
