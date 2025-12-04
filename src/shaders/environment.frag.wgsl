/**
 * Фрагментный шейдер для окружения (пол).
 * Поддерживает освещение Блинна-Фонга и shadow mapping.
 */

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
const SHADOW_MAP_SIZE : f32 = 2048.0;

@group(0) @binding(0) var<uniform> scene : Scene;
@group(0) @binding(1) var tex : texture_2d<f32>;
@group(0) @binding(2) var smp : sampler;
@group(0) @binding(3) var<storage, read> pointLights : array<PointLight, MAX_POINT_LIGHTS>;
@group(1) @binding(1) var shadowMap : texture_depth_2d;
@group(1) @binding(2) var shadowSampler : sampler_comparison;

struct FSIn {
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
  @location(3) shadowPos : vec4<f32>,
};

/**
 * Вычисляет коэффициент тени с PCF (Percentage Closer Filtering).
 * Возвращает значение от 0.0 (полная тень) до 1.0 (полностью освещено).
 */
fn calculateShadow(shadowPos : vec4<f32>, N : vec3<f32>, L : vec3<f32>) -> f32 {
  // Преобразуем в NDC: делим на w
  let projCoords = shadowPos.xyz / shadowPos.w;
  
  // Преобразуем из [-1,1] в [0,1] для UV координат
  let shadowUV = vec2<f32>(
    projCoords.x * 0.5 + 0.5,
    -projCoords.y * 0.5 + 0.5  // Инвертируем Y для текстурных координат
  );
  
  // Глубина текущего фрагмента в пространстве света
  let currentDepth = projCoords.z;
  
  // Bias для предотвращения shadow acne
  let bias = max(0.005 * (1.0 - dot(N, L)), 0.001);
  let depthWithBias = currentDepth - bias;
  
  // Clamp UV к границам текстуры для избежания артефактов
  let clampedUV = clamp(shadowUV, vec2<f32>(0.001), vec2<f32>(0.999));
  
  // PCF 3x3 фильтрация для мягких теней
  // textureSampleCompare должен вызываться в uniform control flow
  let texelSize = 1.0 / SHADOW_MAP_SIZE;
  
  var shadow = 0.0;
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, -texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(0.0, -texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, -texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, 0.0), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV, depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, 0.0), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(0.0, texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, texelSize), depthWithBias);
  shadow /= 9.0;
  
  // Проверяем, находится ли точка в пределах shadow map
  // Используем select вместо if для uniform control flow
  let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0 && currentDepth <= 1.0;
  return select(1.0, shadow, inBounds);
}

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let V = normalize(scene.cameraPos - input.worldPos);

  var diffuseAcc = scene.ambient.color * scene.ambient.intensity;
  var specAcc = vec3<f32>(0.0);

  // Directional light с тенями
  let dirL = normalize(-scene.directional.direction);
  let dirDiffuse = max(dot(N, dirL), 0.0);
  
  // Вычисляем коэффициент тени для направленного источника
  let shadowFactor = calculateShadow(input.shadowPos, N, dirL);
  
  diffuseAcc += scene.directional.color * (dirDiffuse * scene.directional.intensity * shadowFactor);
  if (dirDiffuse > 0.0) {
    let dirHalf = normalize(dirL + V);
    let dirSpec = pow(max(dot(N, dirHalf), 0.0), scene.material.shininess);
    specAcc += scene.directional.color * scene.material.specular * (dirSpec * scene.directional.intensity * shadowFactor);
  }

  // Point lights (без теней)
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

  // Сэмплируем текстуру
  let texColor = textureSample(tex, smp, input.uv).rgb;
  let baseColor = texColor * scene.material.albedo;
  let finalColor = baseColor * diffuseAcc + specAcc;
  return vec4<f32>(finalColor, 1.0);
}

