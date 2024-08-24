const NUM_AGENTS: u32 = 8192;
override WORKGROUP_SIZE: u32 = 64;
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

struct Agents {
  agents: array<Agent, NUM_AGENTS>,
}

struct Forces {
  forces: array<ForceAccumulator, NUM_AGENTS>,
}

@group(0) @binding(0) var<uniform> params: PpsParams;
@group(0) @binding(1) var<storage, read> inAgents: Agents;
@group(0) @binding(2) var<storage, read_write> outForces: Forces;

var<workgroup> workgroupAgents: array<Agent, WORKGROUP_SIZE>;

fn wrappedVector(positionA: vec3f, positionB: vec3f) -> vec3f {
  let dims = vec3f(2, 2, 0);
  let halfDims = dims * 0.5;

  let vector = positionB - positionA;
  let shouldWrap = step(halfDims, abs(vector));
  return (1 - shouldWrap) * vector + shouldWrap * (vector - sign(vector) * dims);
}

@compute @workgroup_size(WORKGROUP_SIZE, 1, 1)
fn main(
  @builtin(global_invocation_id) GlobalInvocationID: vec3u,
  @builtin(local_invocation_id) LocalInvocationId: vec3u,
) {
  let NUM_TILES: u32 = NUM_AGENTS / WORKGROUP_SIZE;

  let selfIndex = GlobalInvocationID.x;
  let selfAgent = inAgents.agents[selfIndex];
  let selfHeading = vec3(cos(selfAgent.rotation), sin(selfAgent.rotation), 0);

  var forceAccum = ForceAccumulator(0, 0);
  for (var i = 0u; i < NUM_TILES; i++) {
    let otherIndex = i * WORKGROUP_SIZE + LocalInvocationId.x;
    workgroupAgents[LocalInvocationId.x] = inAgents.agents[otherIndex];
    workgroupBarrier();
    for (var j = 0u; j < WORKGROUP_SIZE; j++) {
      let otherIndex = i * WORKGROUP_SIZE + j;
      let isNotSelf = f32(clamp(max(otherIndex - selfIndex, selfIndex - otherIndex), 0, 1));

      let other = workgroupAgents[j];
      let vectorToOther = wrappedVector(selfAgent.position, other.position);
      let distanceToOther = length(vectorToOther);
      let isNeighbor = 1 - step(params.neighborhoodRadius, distanceToOther);

      forceAccum.neighbors += isNotSelf * isNeighbor;
      forceAccum.direction += isNotSelf * isNeighbor * sign(cross(selfHeading, vectorToOther).z);
    }
    workgroupBarrier();
  }

  outForces.forces[selfIndex] = forceAccum;
}
