const NUM_AGENTS: u32 = 8192;
override WORKGROUP_SIZE: u32 = 32;
const TWO_PI = 6.28318530718;

struct Agent {
  position: vec3f,
  rotation: f32,
}

struct ForceAccumulator {
  neighbors: f32,
  direction: f32,
}

struct PpsParams {
  speed: f32,
  neighborhoodRadius: f32,
  globalRotation: f32,
  localRotation: f32,
}

struct Forces {
  forces: array<ForceAccumulator, NUM_AGENTS>,
}

struct Agents {
  agents: array<Agent, NUM_AGENTS>,
}

@group(0) @binding(0) var<uniform> params: PpsParams;
@group(0) @binding(2) var<storage, read> inForces: Forces;
@group(0) @binding(1) var<storage, read_write> outAgents: Agents;

fn wrapPosition(position: vec3f) -> vec3f {
  let dims = vec3f(2, 2, 0);
  let halfDims = dims * 0.5;

  return ((position + halfDims) % dims) - halfDims;
}

@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)
fn main(@builtin(global_invocation_id) GlobalInvocationID: vec3u) {
  let selfIndex = GlobalInvocationID.x;
  let forceAccum = inForces.forces[selfIndex];
  var selfAgent = outAgents.agents[selfIndex];
  let selfHeading = vec3(cos(selfAgent.rotation), sin(selfAgent.rotation), 0f);

  selfAgent.position = wrapPosition(selfAgent.position + params.speed * selfHeading);
  selfAgent.rotation = (selfAgent.rotation + params.globalRotation + params.localRotation * forceAccum.neighbors * sign(forceAccum.direction)) % TWO_PI;
  outAgents.agents[selfIndex] = selfAgent;
}
