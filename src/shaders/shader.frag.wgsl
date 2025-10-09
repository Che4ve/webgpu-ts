struct ShaderConstants {
  projection : mat4x4<f32>,
  transform  : mat4x4<f32>,
  color      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> ubo : ShaderConstants;
// новые биндинги
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;

struct FSIn {
  @location(0) normal : vec3<f32>,
  @location(1) uv     : vec2<f32>,
};

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let L = normalize(vec3<f32>(1, 2, -4)); // направление света
  let ambient = 0.2;
  let diffuse = max(dot(N, L), 0.0);
  let lighting = ambient + diffuse;
  let texColor = textureSample(tex, smp, input.uv).rgb;
  // можно умножить на ubo.color как «tint», если нужно
  return vec4<f32>(texColor * lighting, 1.0);
}


