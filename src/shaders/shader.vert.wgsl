struct ShaderConstants {
  projection : mat4x4<f32>,
  transform  : mat4x4<f32>,
  color      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> ubo : ShaderConstants;

struct VSIn {
  @location(0) position : vec3<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
};

@vertex
fn main(input : VSIn) -> VSOut {
  var out : VSOut;
  let point = vec4<f32>(input.position, 1.0);
  let transformed = ubo.transform * point;
  let projected  = ubo.projection * transformed;
  out.position = projected;
  return out;
}


