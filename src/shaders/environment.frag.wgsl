/**
 * ============================================================================
 * ENVIRONMENT FRAGMENT SHADER (для пола)
 * ============================================================================
 * 
 * Упрощённая версия shader.frag.wgsl для окружения (пол).
 * Отличия:
 * - Нет specular map (грязи)
 * - Те же самые тени и освещение Блинна-Фонга
 * 
 * Этот шейдер использует тот же vertex shader (shader.vert.wgsl),
 * поэтому получает те же входные данные.
 */

// ============================================================================
// СТРУКТУРЫ ДАННЫХ (идентичны shader.frag.wgsl)
// ============================================================================

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

/**
 * Прожектор (Spotlight).
 */
struct SpotLight {
  position : vec3<f32>,
  intensity : f32,
  direction : vec3<f32>,
  innerCosAngle : f32,
  color : vec3<f32>,
  outerCosAngle : f32,
  enabled : f32,
  _pad : vec3<f32>,
};

const MAX_POINT_LIGHTS : u32 = 1u;
const SHADOW_MAP_SIZE : f32 = 2048.0;

// ============================================================================
// БИНДИНГИ
// ============================================================================

// Group 0: данные пола (без specular map!)
@group(0) @binding(0) var<uniform> scene : Scene;
@group(0) @binding(1) var tex : texture_2d<f32>;             // Текстура пола (доски)
@group(0) @binding(2) var smp : sampler;                     // Сэмплер
@group(0) @binding(3) var<storage, read> pointLights : array<PointLight, MAX_POINT_LIGHTS>;
@group(0) @binding(4) var<uniform> spotLight : SpotLight;    // Прожектор

// Group 1: данные для теней
@group(1) @binding(1) var shadowMap : texture_depth_2d;
@group(1) @binding(2) var shadowSampler : sampler_comparison;

// ============================================================================
// ВХОДНЫЕ ДАННЫЕ
// ============================================================================

struct FSIn {
  @location(0) worldPos : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) uv     : vec2<f32>,
  @location(3) shadowPos : vec4<f32>,
};

// ============================================================================
// ФУНКЦИЯ РАСЧЁТА ТЕНЕЙ (идентична shader.frag.wgsl)
// ============================================================================

/**
 * Вычисляет коэффициент тени с PCF фильтрацией.
 * Подробные комментарии см. в shader.frag.wgsl
 */
fn calculateShadow(shadowPos : vec4<f32>, N : vec3<f32>, L : vec3<f32>) -> f32 {
  let projCoords = shadowPos.xyz / shadowPos.w;
  
  let shadowUV = vec2<f32>(
    projCoords.x * 0.5 + 0.5,
    -projCoords.y * 0.5 + 0.5
  );
  
  let currentDepth = projCoords.z;
  let bias = max(0.005 * (1.0 - dot(N, L)), 0.001);
  let depthWithBias = currentDepth - bias;
  let clampedUV = clamp(shadowUV, vec2<f32>(0.001), vec2<f32>(0.999));
  
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
  
  let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0 && currentDepth <= 1.0;
  return select(1.0, shadow, inBounds);
}

// ============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================================

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  let N = normalize(input.normal);
  let V = normalize(scene.cameraPos - input.worldPos);

  var diffuseAcc = scene.ambient.color * scene.ambient.intensity;
  var specAcc = vec3<f32>(0.0);

  // ========================================
  // НАПРАВЛЕННЫЙ СВЕТ + ТЕНИ
  // ========================================
  
  let dirL = normalize(-scene.directional.direction);
  let dirDiffuse = max(dot(N, dirL), 0.0);
  
  // Вычисляем коэффициент тени
  let shadowFactor = calculateShadow(input.shadowPos, N, dirL);
  
  // Применяем тень к освещению
  diffuseAcc += scene.directional.color * (dirDiffuse * scene.directional.intensity * shadowFactor);
  
  if (dirDiffuse > 0.0) {
    let dirHalf = normalize(dirL + V);
    let dirSpec = pow(max(dot(N, dirHalf), 0.0), scene.material.shininess);
    specAcc += scene.directional.color * scene.material.specular * (dirSpec * scene.directional.intensity * shadowFactor);
  }

  // ========================================
  // ТОЧЕЧНЫЕ ИСТОЧНИКИ (без теней)
  // ========================================
  
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

  // ========================================
  // ПРОЖЕКТОР (SPOTLIGHT)
  // ========================================
  if (spotLight.enabled > 0.5) {
    let toPixel = input.worldPos - spotLight.position;
    let dist = max(length(toPixel), 1e-4);
    let L = -normalize(toPixel);
    
    let spotCos = dot(normalize(toPixel), spotLight.direction);
    let spotlightFactor = smoothstep(spotLight.outerCosAngle, spotLight.innerCosAngle, spotCos);
    let attenuation = spotLight.intensity / max(dist * dist, 1e-4);
    let finalAttenuation = attenuation * spotlightFactor;
    
    let diff = max(dot(N, L), 0.0);
    diffuseAcc += spotLight.color * (diff * finalAttenuation);
    
    if (diff > 0.0) {
      let h = normalize(L + V);
      let spec = pow(max(dot(N, h), 0.0), scene.material.shininess);
      specAcc += spotLight.color * scene.material.specular * (spec * finalAttenuation);
    }
  }

  // ========================================
  // ФИНАЛЬНЫЙ ЦВЕТ (без specular map)
  // ========================================
  
  let texColor = textureSample(tex, smp, input.uv).rgb;
  let baseColor = texColor * scene.material.albedo;
  let finalColor = baseColor * diffuseAcc + specAcc;
  
  return vec4<f32>(finalColor, 1.0);
}
