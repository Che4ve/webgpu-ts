struct ShaderConstants {
  projection : mat4x4<f32>,
  transform  : mat4x4<f32>,
  color      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> ubo : ShaderConstants;

@fragment
fn main() -> @location(0) vec4<f32> {
  return vec4<f32>(ubo.color, 1.0);
}


