struct Ambient {
  color : vec3<f32>,
  intensity : f32,
};

struct Directional {
  direction : vec3<f32>,
  intensity : f32,
  color : vec3<f32>,
  _pad : f32,
};

struct Material {
  albedo : vec3<f32>,
  shininess : f32,
  specular : vec3<f32>,
  _pad : f32,
};

struct Scene {
  projection : mat4x4<f32>,
  view : mat4x4<f32>,
  model : mat4x4<f32>,
  cameraPos : vec3<f32>,
  _padCam : f32,
  ambient : Ambient,
  directional : Directional,
  material : Material,
  pointLightCount : f32,
  _padLights : vec3<f32>,
};

struct PointLight {
  position : vec3<f32>,
  intensity : f32,
  color : vec3<f32>,
  _pad : f32,
};

const MAX_POINT_LIGHTS : u32 = 2u;

@group(0) @binding(0) var<uniform> scene : Scene;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;
@group(0) @binding(3) var<storage, read> pointLights : array<PointLight, MAX_POINT_LIGHTS>;

struct FSIn {
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
};

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let V = normalize(scene.cameraPos - input.worldPos);

  var diffuseAcc = scene.ambient.color * scene.ambient.intensity;
  var specAcc = vec3<f32>(0.0);

  let dirL = normalize(-scene.directional.direction);
  let dirDiffuse = max(dot(N, dirL), 0.0);
  diffuseAcc += scene.directional.color * (dirDiffuse * scene.directional.intensity);
  if (dirDiffuse > 0.0) {
    let dirHalf = normalize(dirL + V);
    let dirSpec = pow(max(dot(N, dirHalf), 0.0), scene.material.shininess);
    specAcc += scene.directional.color * scene.material.specular * (dirSpec * scene.directional.intensity);
  }

  let pointCount = min(u32(scene.pointLightCount + 0.5), MAX_POINT_LIGHTS);
  for (var i : u32 = 0u; i < pointCount; i = i + 1u) {
    let light = pointLights[i];
    let toLight = light.position - input.worldPos;
    let dist = max(length(toLight), 1e-4);
    let L = toLight / dist;
    let attenuation = light.intensity / max(dist * dist, 1e-4);

    let diff = max(dot(N, L), 0.0);
    diffuseAcc += light.color * (diff * attenuation);

    if (diff > 0.0) {
      let h = normalize(L + V);
      let spec = pow(max(dot(N, h), 0.0), scene.material.shininess);
      specAcc += light.color * scene.material.specular * (spec * attenuation);
    }
  }

  let texColor = textureSample(tex, smp, input.uv).rgb;
  let baseColor = texColor * scene.material.albedo;
  let finalColor = baseColor * diffuseAcc + specAcc;
  return vec4<f32>(finalColor, 1.0);
}

