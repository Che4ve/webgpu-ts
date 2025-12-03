struct LightScene {
  projection : mat4x4<f32>,
  view : mat4x4<f32>,
  model : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> scene : LightScene;

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
  let worldPos = scene.model * point;
  let viewPos = scene.view * worldPos;
  out.position = scene.projection * viewPos;
  return out;
}

