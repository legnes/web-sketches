// TODO:
//  - Use SPH in addition to artificial forces
//  - Figure out momentum conservation at small v and/or dt

// Helpers
const loadShader = async (name) => {
  const response = await fetch(`../assets/shaders/${name}.glsl`);
  const shader = await response.text();
  return shader;
};

const buildShader = async (gl, name) => {
  let shaderType = null;
  if (/\.vert$/.test(name)) shaderType = gl.VERTEX_SHADER;
  if (/\.frag/.test(name)) shaderType = gl.FRAGMENT_SHADER;
  if (!shaderType) throw new Error(`Unable to determine type of shader ${name}`);
  const shaderSource = await loadShader(name);
  const shader = gl.createShader(shaderType);
  gl.shaderSource(shader, shaderSource);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`error in shader ${name}: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
};

const buildProgram = async (gl, vertexShaderName, fragmentShaderName) => {
  // TODO: parallelize
  const program = gl.createProgram();
  gl.attachShader(program, await buildShader(gl, vertexShaderName));
  gl.attachShader(program, await buildShader(gl, fragmentShaderName));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`error in program using ${vertexShaderName} and ${fragmentShaderName}: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
};

// WebGL
const canvas = document.getElementById('webgl-canvas');
const gl = canvas.getContext('webgl');

if (!gl) {
  alert('WebGL is not supported/enabled in your browser');
  throw new Error('Could not find WebGL');
}

const simulationProgram = await buildProgram(gl, 'fullscreen-quad.vert', 'reintegration-tracking-simulation.frag');
const displayProgram = await buildProgram(gl, 'fullscreen-quad.vert', 'reintegration-tracking-display.frag');

// Setup fullscreen quad geometry
const verts = [
   1.0,  1.0,
  -1.0,  1.0,
  -1.0, -1.0,
  -1.0, -1.0,
   1.0, -1.0,
   1.0,  1.0
];
const fullscreenQuadVBO = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenQuadVBO);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);

// Initialize data textures
const textures = [ gl.createTexture(), gl.createTexture() ];

// Initialize simulation data
const MAX_INT4_VALUE = 14;
const ZERO_INT4_VALUE = 119;
const simulationWidth = 512;
const simulationHeight = 512;
const initialData = new Uint8Array(simulationWidth * simulationHeight * 4);
const getRandomVec2AsUint8 = () => (Math.round(Math.random() * MAX_INT4_VALUE) * 16 + Math.round(Math.random() * MAX_INT4_VALUE));
function resetSimulation() {
  for (let i = 0; i < simulationHeight * simulationWidth; i++) {
    // Position
    initialData[i * 4 + 0] = getRandomVec2AsUint8();
    // Velocity
    initialData[i * 4 + 1] = getRandomVec2AsUint8();
    // Mass
    initialData[i * 4 + 2] = 0;
    initialData[i * 4 + 3] = Math.round(Math.random() * 255);
  }
  // const initialCoord = (simulationWidth * 8 + 7) * 4;
  // initialData[initialCoord + 0] = ZERO_INT4_VALUE;
  // initialData[initialCoord + 1] = 135;
  // initialData[initialCoord + 2] = 10;
  // initialData[initialCoord + 3] = 255;
  // 0-14
  // 0-6, 7, 8-14
  // 01110000 --> 112
  // 01110111 --> 119
  // 10000111 --> 135

  // Pass data to textures
  for (let i = 0; i < 2; i++) {
    const texture = textures[i];
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, simulationWidth, simulationHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, initialData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    textures.push(texture);
  }
}
resetSimulation();

// Set up framebuffers using same textures
const frameBuffers = textures.map((texture) => {
  const frameBuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return frameBuffer;
});
gl.bindFramebuffer(gl.FRAMEBUFFER, null);

// Handle inputs
const inputSimulationUniforms = {
  uDiffusionRadius: 0.6,
  uForceX: 0,
  uForceY: 0,
};
for (const uniformName in inputSimulationUniforms) {
  const uniformInputElt = document.getElementById(`${uniformName}Input`);
  const uniformDisplayElt = document.getElementById(`${uniformName}Display`);
  uniformInputElt.addEventListener('input', evt => {
    inputSimulationUniforms[uniformName] = +evt.target.value;
    uniformDisplayElt.textContent = evt.target.value;
  });
  uniformInputElt.value = inputSimulationUniforms[uniformName];
  uniformDisplayElt.textContent = inputSimulationUniforms[uniformName];
}
document.getElementById('resetSimInput').addEventListener('click', resetSimulation);

let frameNumber = -1;
function frame() {
  // Update frame
  frameNumber++;
  const readIndex = frameNumber % 2;
  const writeIndex = 1 - readIndex;

  // Simulation
  gl.useProgram(simulationProgram);
  const aPositionLocationSimulation = gl.getAttribLocation(simulationProgram, "aPosition");
  gl.vertexAttribPointer(aPositionLocationSimulation, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPositionLocationSimulation);
  const uSimulationDataLocationSimulation = gl.getUniformLocation(simulationProgram, "uSimulationData");
  gl.uniform1i(uSimulationDataLocationSimulation, 0);
  gl.bindTexture(gl.TEXTURE_2D, textures[readIndex]);
  for (const uniformName in inputSimulationUniforms) {
    const location = gl.getUniformLocation(simulationProgram, uniformName);
    gl.uniform1f(location, inputSimulationUniforms[uniformName]);
  }
  gl.viewport(0, 0, simulationWidth, simulationHeight);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffers[writeIndex]);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Display
  gl.useProgram(displayProgram);
  const aPositionLocationDisplay = gl.getAttribLocation(displayProgram, "aPosition");
  gl.vertexAttribPointer(aPositionLocationDisplay, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPositionLocationDisplay);
  const uSimulationDataLocationDisplay = gl.getUniformLocation(displayProgram, "uSimulationData");
  gl.uniform1i(uSimulationDataLocationDisplay, 0);
  gl.bindTexture(gl.TEXTURE_2D, textures[writeIndex]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
