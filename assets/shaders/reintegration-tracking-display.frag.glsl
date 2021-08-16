precision mediump float;

#define RESOLUTION 512.0
#define MAX_INT4_VALUE 14.

varying vec2 vUV;

uniform sampler2D uSimulationData;

struct Particle {
  vec2 position;
  vec2 velocity;
  float mass;
};

vec2 unpackUint8ToVec2(float val) {
  float intVal = floor(val * 255.);
  float intX = floor(intVal / 16.);
  float intY = intVal - (intX * 16.);
  return vec2(intX, intY) / MAX_INT4_VALUE;
}

Particle unpackParticle(vec2 uv) {
  vec4 packedData = texture2D(uSimulationData, uv);
  vec2 position = unpackUint8ToVec2(packedData.x) + uv * RESOLUTION - 0.5;
  vec2 velocity = unpackUint8ToVec2(packedData.y) * 2. - 1.;
  float mass = packedData.z * 255. * 256. + packedData.w * 255.;
  return Particle(position, velocity, mass);
}

void main(void) {
  vec2 selfUV = (floor(vUV * RESOLUTION) + 0.5) / RESOLUTION;
  Particle particle = unpackParticle(selfUV);
  gl_FragColor = vec4(particle.mass / 1024., 0, particle.mass / 2048., 1);
}
