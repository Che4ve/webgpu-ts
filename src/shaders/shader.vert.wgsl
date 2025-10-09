struct ShaderConstants {
  projection : mat4x4<f32>,
  transform  : mat4x4<f32>,
  color      : vec3<f32>,
  _pad       : f32,
};

@group(0) @binding(0) var<uniform> ubo : ShaderConstants;

struct VSIn {
  @location(0) position : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) uv       : vec2<f32>,
};

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) normal        : vec3<f32>,
  @location(1) uv            : vec2<f32>,
};

@vertex
fn main(input : VSIn) -> VSOut {
  var out : VSOut;
  let point = vec4<f32>(input.position, 1.0);
  let worldPos = ubo.transform * point;
  out.position = ubo.projection * worldPos;

  // Извлекаем столбцы M3 = R * S из ubo.transform
  let c0 = ubo.transform[0].xyz; // столбец X
  let c1 = ubo.transform[1].xyz; // столбец Y
  let c2 = ubo.transform[2].xyz; // столбец Z

  // Длины столбцов — масштабы по осям
  let sx = max(length(c0), 1e-8);
  let sy = max(length(c1), 1e-8);
  let sz = max(length(c2), 1e-8);

  // Ортонормированные столбцы — чистое вращение R
  let r0 = c0 / sx;
  let r1 = c1 / sy;
  let r2 = c2 / sz;
  let R  = mat3x3<f32>(r0, r1, r2);

  // Преобразуем нормаль: N' = normalize( R * (N / S) )
  let Nobj = input.normal / vec3<f32>(sx, sy, sz);
  out.normal = normalize(R * Nobj);

  out.uv = input.uv;
  return out;
}

