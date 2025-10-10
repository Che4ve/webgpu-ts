struct ShaderConstants {
  projection : mat4x4<f32>,
  transform  : mat4x4<f32>,
  color      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> ubo : ShaderConstants;

struct FSIn {
  @location(0) normal : vec3<f32>,
};

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let L = normalize(vec3<f32>(1, 1, -2)); // направление света
  let ambient = 0.2;
  let diffuse = max(dot(N, L), 0.0);
  let lighting = ambient + diffuse;
  return vec4<f32>(ubo.color * lighting, 1.0);
}


