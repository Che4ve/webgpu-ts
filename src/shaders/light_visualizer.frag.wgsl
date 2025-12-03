struct LightColor {
  color : vec3<f32>,
  _pad : f32,
};

@group(0) @binding(1) var<uniform> lightColor : LightColor;

@fragment
fn main() -> @location(0) vec4<f32> {
  // Яркий цвет источника с усилением для видимости
  return vec4<f32>(lightColor.color * 2.5, 1.0);
}

