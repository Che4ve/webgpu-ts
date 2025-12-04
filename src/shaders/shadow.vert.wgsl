/**
 * Vertex shader для shadow pass.
 * Рендерит геометрию с точки зрения направленного источника света.
 * Записывает только глубину (depth) без цветового вывода.
 */

struct ShadowUniforms {
  lightViewProj : mat4x4<f32>,
  model : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> shadow : ShadowUniforms;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv : vec2<f32>,
};

@vertex
fn main(input : VSIn) -> @builtin(position) vec4<f32> {
  let worldPos = shadow.model * vec4<f32>(input.position, 1.0);
  return shadow.lightViewProj * worldPos;
}

