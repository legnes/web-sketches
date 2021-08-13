precision mediump float;

#define RESOLUTION 256.0
#define SEARCH_RADIUS 4
#define FIXED_DT 5. // TODO: Can lower this when mass is conserved
#define FORCE_SCALE 0.5
#define OBSTACLE_RADIUS 0.05

varying vec2 vUV;

uniform sampler2D uSimulationData;
uniform float uDiffusionRadius;
uniform float uForceX;
uniform float uForceY;

struct Particle
{
  vec2 position;
  vec2 velocity;
  float mass;
};

float packVec2ToUint8(vec2 val) {
  return clamp((floor(val.x * 15. + .5) * 16. + floor(val.y * 15. + .5)) / 255., 0., 1.);
}

vec2 unpackUint8ToVec2(float val) {
  float intVal = floor(val * 255.);
  float intX = floor(intVal / 16.);
  float intY = intVal - (intX * 16.);
  return vec2(intX, intY) / 15.;
}

vec4 packParticle(Particle particle, vec2 uv) {
  float position = packVec2ToUint8(particle.position - uv * RESOLUTION + 0.5);
  float velocity = packVec2ToUint8(particle.velocity * 0.5 + 0.5);
  float massShifted = floor(particle.mass / 256.);
  float massMsd = massShifted / 255.;
  float massLsd = (particle.mass - massShifted * 256.) / 255.;
  return vec4(position, velocity, massMsd, massLsd);
}

Particle unpackParticle(vec2 uv) {
  vec4 packedData = texture2D(uSimulationData, uv);
  vec2 position = unpackUint8ToVec2(packedData.x) + uv * RESOLUTION - 0.5;
  vec2 velocity = unpackUint8ToVec2(packedData.y) * 2. - 1.;
  float mass = packedData.z * 255. * 256. + packedData.w * 255.;
  return Particle(position, velocity, mass);
}

vec3 calculateOverlap(vec2 particlePosition, vec2 gridPosition) {
  vec4 gridAABB = vec4(gridPosition - 0.5, gridPosition + 0.5);
  vec4 particleAABB = vec4(particlePosition - uDiffusionRadius, particlePosition + uDiffusionRadius);
  vec4 overlapAABB = vec4(max(gridAABB.xy, particleAABB.xy), min(gridAABB.zw, particleAABB.zw));
  vec2 overlapCenter = 0.5 * (overlapAABB.xy + overlapAABB.zw);
  vec2 overlapSize = max(overlapAABB.zw - overlapAABB.xy, 0.);
  float overlapRelativeArea = overlapSize.x * overlapSize.y / (4.0 * uDiffusionRadius * uDiffusionRadius);
  return vec3(overlapCenter, overlapRelativeArea);
}

void main(void) {
  vec2 selfTexelCoord = floor(vUV * RESOLUTION) + 0.5;
  vec2 selfUV = selfTexelCoord / RESOLUTION;
  vec2 centerToSelf = selfUV - 0.5;
  float isColliding = 1. - step(OBSTACLE_RADIUS, length(centerToSelf));
  Particle self = Particle(vec2(0.), vec2(0.), 0.);

  // Based on https://michaelmoroz.github.io/Reintegration-Tracking/
  for (int x = -SEARCH_RADIUS; x <= SEARCH_RADIUS; x++) {
    for(int y = -SEARCH_RADIUS; y <= SEARCH_RADIUS; y++) {
      vec2 otherUV = selfUV + vec2(x, y) / RESOLUTION;
      Particle other = unpackParticle(otherUV);
      // TODO: I think at small dt and small velocities, mass explodes because maybe of the position quantization
      other.position += other.velocity * FIXED_DT;

      vec3 overlapData = calculateOverlap(other.position, selfTexelCoord);
      vec2 overlapCenterOfMass = overlapData.xy;
      float overlapRelativeArea = overlapData.z;
      float overlapMass = overlapRelativeArea * other.mass;

      self.mass += overlapMass;
      self.position += overlapCenterOfMass * overlapMass;
      self.velocity += other.velocity * overlapMass;
    }
  }

  if (self.mass > 0.0) {
    self.position /= self.mass;
    self.velocity /= self.mass;
    self.velocity += vec2(uForceX, uForceY) * FORCE_SCALE / self.mass * FIXED_DT;
    if (isColliding > 0.5 && dot(centerToSelf, self.velocity) < 0.) {
      self.velocity = reflect(self.velocity, normalize(centerToSelf));
    }
  }

  gl_FragColor = packParticle(self, selfUV);
}
