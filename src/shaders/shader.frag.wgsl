/**
 * ============================================================================
 * MAIN FRAGMENT SHADER (для куба)
 * ============================================================================
 * 
 * Fragment shader выполняется для КАЖДОГО ПИКСЕЛЯ, который рисуется на экране.
 * Его задача - определить финальный цвет пикселя.
 * 
 * Здесь реализовано:
 * 1) Модель освещения Блинна-Фонга (Blinn-Phong)
 * 2) Shadow Mapping с PCF фильтрацией
 * 3) Текстурирование с specular map
 * 
 * МОДЕЛЬ БЛИННА-ФОНГА:
 * Финальный цвет = Ambient + Diffuse + Specular
 * 
 * - Ambient: базовый свет (имитация отражённого света от окружения)
 * - Diffuse: рассеянный свет (зависит от угла между нормалью и светом)
 * - Specular: блик (зависит от угла отражения и позиции камеры)
 */

// ============================================================================
// СТРУКТУРЫ ДАННЫХ (копируются из vertex shader)
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

/**
 * Точечный источник света.
 * В отличие от направленного, имеет позицию и затухание с расстоянием.
 */
struct PointLight {
  position : vec3<f32>,   // Позиция в мировых координатах
  intensity : f32,        // Интенсивность
  color : vec3<f32>,      // Цвет света
  _pad : f32,
};

/**
 * Прожектор (Spotlight).
 * Точечный источник с ограниченным конусом освещения.
 * 
 * Принцип работы:
 * 1) Вычисляем угол между направлением прожектора и направлением к пикселю
 * 2) Если угол меньше innerConeAngle - полная яркость
 * 3) Если угол между inner и outer - плавное затухание
 * 4) Если угол больше outerConeAngle - нет света
 * 
 * ВАЖНО: Храним КОСИНУСЫ углов, т.к. сравниваем с dot product!
 */
struct SpotLight {
  position : vec3<f32>,       // Позиция прожектора
  intensity : f32,            // Интенсивность
  direction : vec3<f32>,      // Направление (куда светит)
  innerCosAngle : f32,        // cos(innerConeAngle) - полная яркость
  color : vec3<f32>,          // Цвет света
  outerCosAngle : f32,        // cos(outerConeAngle) - край конуса
  enabled : f32,              // 1.0 = включен, 0.0 = выключен
  _pad : vec3<f32>,
};

// ============================================================================
// КОНСТАНТЫ
// ============================================================================

const MAX_POINT_LIGHTS : u32 = 1u;      // Максимум точечных источников (теперь 1)
const SHADOW_MAP_SIZE : f32 = 2048.0;   // Размер shadow map в пикселях

// ============================================================================
// БИНДИНГИ (ресурсы из JavaScript)
// ============================================================================

// Group 0: основные данные
@group(0) @binding(0) var<uniform> scene : Scene;            // Данные сцены
@group(0) @binding(1) var tex : texture_2d<f32>;             // Текстура куба (diffuse)
@group(0) @binding(2) var smp : sampler;                     // Сэмплер для текстуры
@group(0) @binding(3) var<storage, read> pointLights : array<PointLight, MAX_POINT_LIGHTS>;  // Точечные источники
@group(0) @binding(4) var specularMap : texture_2d<f32>;     // Specular map (грязь)
@group(0) @binding(5) var dirtSampler : sampler;             // Сэмплер для specular map
@group(0) @binding(6) var<uniform> spotLight : SpotLight;    // Прожектор

// Group 1: данные для теней
@group(1) @binding(1) var shadowMap : texture_depth_2d;      // Shadow map (текстура глубины!)
@group(1) @binding(2) var shadowSampler : sampler_comparison; // Сэмплер со сравнением

// ============================================================================
// ВХОДНЫЕ ДАННЫЕ (из vertex shader)
// ============================================================================

struct FSIn {
  @location(0) worldPos : vec3<f32>,   // Позиция пикселя в мировых координатах
  @location(1) normal : vec3<f32>,     // Нормаль поверхности (интерполированная!)
  @location(2) uv     : vec2<f32>,     // Текстурные координаты
  @location(3) shadowPos : vec4<f32>,  // Позиция в пространстве света
};

// ============================================================================
// ФУНКЦИЯ РАСЧЁТА ТЕНЕЙ
// ============================================================================

/**
 * calculateShadow - определяет, находится ли пиксель в тени.
 * 
 * АЛГОРИТМ SHADOW MAPPING:
 * 1) Преобразуем shadowPos в UV координаты shadow map
 * 2) Сравниваем глубину пикселя с глубиной в shadow map
 * 3) Если пиксель дальше - он в тени!
 * 
 * PCF (Percentage Closer Filtering):
 * Вместо одного сравнения делаем 9 (сетка 3x3) и усредняем.
 * Это даёт мягкие края теней вместо резких пиксельных границ.
 * 
 * @param shadowPos - позиция пикселя в clip space света
 * @param N - нормаль поверхности
 * @param L - направление к источнику света
 * @return - коэффициент освещённости (0.0 = полная тень, 1.0 = полный свет)
 */
fn calculateShadow(shadowPos : vec4<f32>, N : vec3<f32>, L : vec3<f32>) -> f32 {
  // ========================================
  // ШАГ 1: Преобразование в NDC (Normalized Device Coordinates)
  // ========================================
  
  // Делим на w (перспективное деление)
  // После этого: x,y,z ∈ [-1, 1] для x,y и [0, 1] для z
  let projCoords = shadowPos.xyz / shadowPos.w;
  
  // ========================================
  // ШАГ 2: Преобразование в UV координаты текстуры
  // ========================================
  
  // NDC: x,y ∈ [-1, 1]
  // UV:  u,v ∈ [0, 1]
  // Формула: uv = ndc * 0.5 + 0.5
  // 
  // ВАЖНО: Y инвертируем, потому что в текстуре Y растёт вниз!
  let shadowUV = vec2<f32>(
    projCoords.x * 0.5 + 0.5,
    -projCoords.y * 0.5 + 0.5
  );
  
  // Глубина пикселя с точки зрения света (0 = близко, 1 = далеко)
  let currentDepth = projCoords.z;
  
  // ========================================
  // ШАГ 3: Shadow Bias
  // ========================================
  
  // ПРОБЛЕМА "Shadow Acne":
  // Из-за ограниченной точности shadow map, пиксели могут "затенять сами себя".
  // Это создаёт полосатые артефакты на освещённых поверхностях.
  // 
  // РЕШЕНИЕ: Добавляем небольшое смещение (bias) к глубине.
  // Bias зависит от угла - чем больше угол между нормалью и светом,
  // тем больше bias нужен.
  let bias = max(0.005 * (1.0 - dot(N, L)), 0.001);
  let depthWithBias = currentDepth - bias;
  
  // ========================================
  // ШАГ 4: Clamp UV координаты
  // ========================================
  
  // Ограничиваем UV, чтобы не выходить за границы текстуры
  let clampedUV = clamp(shadowUV, vec2<f32>(0.001), vec2<f32>(0.999));
  
  // ========================================
  // ШАГ 5: PCF фильтрация (3x3)
  // ========================================
  
  // Размер одного текселя в UV координатах
  let texelSize = 1.0 / SHADOW_MAP_SIZE;
  
  // Делаем 9 сравнений и усредняем результат.
  // textureSampleCompare возвращает:
  //   1.0 - если depthWithBias < глубина в shadow map (пиксель освещён)
  //   0.0 - если depthWithBias >= глубина (пиксель в тени)
  //
  // ВАЖНО: В WGSL нельзя использовать textureSampleCompare в цикле
  // из-за требования "uniform control flow", поэтому разворачиваем цикл вручную.
  
  var shadow = 0.0;
  
  // Строка 1: y = -texelSize
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, -texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(0.0, -texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, -texelSize), depthWithBias);
  
  // Строка 2: y = 0
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, 0.0), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV, depthWithBias);  // Центр
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, 0.0), depthWithBias);
  
  // Строка 3: y = texelSize
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(-texelSize, texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(0.0, texelSize), depthWithBias);
  shadow += textureSampleCompare(shadowMap, shadowSampler, clampedUV + vec2<f32>(texelSize, texelSize), depthWithBias);
  
  // Усредняем 9 результатов
  shadow /= 9.0;
  
  // ========================================
  // ШАГ 6: Проверка границ
  // ========================================
  
  // Если пиксель за пределами shadow map - считаем его освещённым.
  // Используем select() вместо if, чтобы сохранить uniform control flow.
  // select(falseValue, trueValue, condition) = condition ? trueValue : falseValue
  let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0 && currentDepth <= 1.0;
  return select(1.0, shadow, inBounds);
}

// ============================================================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================================================

@fragment
fn main(input : FSIn) -> @location(0) vec4<f32> {
  // ========================================
  // ПОДГОТОВКА ВЕКТОРОВ
  // ========================================
  
  // N - нормаль поверхности (нормализуем, т.к. интерполяция могла изменить длину)
  let N = normalize(input.normal);
  
  // V - направление к камере (для расчёта бликов)
  let V = normalize(scene.cameraPos - input.worldPos);

  // Аккумуляторы для компонентов освещения
  var diffuseAcc = scene.ambient.color * scene.ambient.intensity;  // Начинаем с ambient
  var specAcc = vec3<f32>(0.0);  // Блики накапливаем отдельно

  // ========================================
  // НАПРАВЛЕННЫЙ СВЕТ + ТЕНИ
  // ========================================
  
  // L - направление к источнику света (обратное направлению лучей)
  let dirL = normalize(-scene.directional.direction);
  
  // Диффузная составляющая: пропорциональна косинусу угла между N и L
  // dot(N, L) = cos(angle). Если < 0, свет падает с обратной стороны.
  let dirDiffuse = max(dot(N, dirL), 0.0);
  
  // РАСЧЁТ ТЕНИ: определяем, виден ли этот пиксель из позиции света
  let shadowFactor = calculateShadow(input.shadowPos, N, dirL);
  
  // Добавляем диффузный свет с учётом тени
  diffuseAcc += scene.directional.color * (dirDiffuse * scene.directional.intensity * shadowFactor);
  
  // Specular (блик) по модели Блинна-Фонга
  if (dirDiffuse > 0.0) {
    // H - половинный вектор между L и V
    // Блинн заменил вектор отражения R на H - это быстрее вычислять
    let dirHalf = normalize(dirL + V);
    
    // Интенсивность блика: (N · H)^shininess
    // Чем больше shininess, тем меньше и ярче блик
    let dirSpec = pow(max(dot(N, dirHalf), 0.0), scene.material.shininess);
    
    // Добавляем specular с учётом тени (в тени нет бликов!)
    specAcc += scene.directional.color * scene.material.specular * (dirSpec * scene.directional.intensity * shadowFactor);
  }

  // ========================================
  // ТОЧЕЧНЫЕ ИСТОЧНИКИ (без теней)
  // ========================================
  
  let pointCount = min(u32(scene.pointLightCount + 0.5), MAX_POINT_LIGHTS);
  
  for (var i : u32 = 0u; i < pointCount; i = i + 1u) {
    let light = pointLights[i];
    
    // Вектор от пикселя к источнику света
    let toLight = light.position - input.worldPos;
    let dist = max(length(toLight), 1e-4);  // Защита от деления на 0
    let L = toLight / dist;  // Нормализованное направление
    
    // Затухание: интенсивность / расстояние² (закон обратных квадратов)
    let attenuation = light.intensity / max(dist * dist, 1e-4);

    // Диффузная составляющая
    let diff = max(dot(N, L), 0.0);
    diffuseAcc += light.color * (diff * attenuation);

    // Specular составляющая
    if (diff > 0.0) {
      let h = normalize(L + V);
      let spec = pow(max(dot(N, h), 0.0), scene.material.shininess);
      specAcc += light.color * scene.material.specular * (spec * attenuation);
    }
  }

  // ========================================
  // ПРОЖЕКТОР (SPOTLIGHT)
  // ========================================
  //
  // Прожектор = точечный источник + ограничение по конусу
  //
  if (spotLight.enabled > 0.5) {
    // Вектор от прожектора к пикселю
    let toPixel = input.worldPos - spotLight.position;
    let dist = max(length(toPixel), 1e-4);
    let L = -normalize(toPixel);  // Направление К источнику
    
    // Вычисляем косинус угла между направлением прожектора и направлением к пикселю
    // spotLight.direction - куда светит прожектор
    // toPixel/dist - куда находится пиксель относительно прожектора
    let spotCos = dot(normalize(toPixel), spotLight.direction);
    
    // Вычисляем коэффициент затухания по конусу
    // smoothstep создаёт плавный переход между outer и inner углами
    //
    // Если spotCos > innerCosAngle: spotlight = 1.0 (полная яркость)
    // Если spotCos < outerCosAngle: spotlight = 0.0 (вне конуса)
    // Между ними: плавный переход
    //
    // ВНИМАНИЕ: cos убывает с ростом угла! cos(0°)=1, cos(90°)=0
    // Поэтому innerCosAngle > outerCosAngle
    let spotlightFactor = smoothstep(spotLight.outerCosAngle, spotLight.innerCosAngle, spotCos);
    
    // Затухание с расстоянием (как у точечного источника)
    let attenuation = spotLight.intensity / max(dist * dist, 1e-4);
    
    // Финальная интенсивность = затухание × коэффициент конуса
    let finalAttenuation = attenuation * spotlightFactor;
    
    // Диффузная составляющая
    let diff = max(dot(N, L), 0.0);
    diffuseAcc += spotLight.color * (diff * finalAttenuation);
    
    // Specular составляющая
    if (diff > 0.0) {
      let h = normalize(L + V);
      let spec = pow(max(dot(N, h), 0.0), scene.material.shininess);
      specAcc += spotLight.color * scene.material.specular * (spec * finalAttenuation);
    }
  }

  // ========================================
  // ТЕКСТУРИРОВАНИЕ
  // ========================================
  
  // Сэмплируем diffuse текстуру (основной цвет)
  let texColor = textureSample(tex, smp, input.uv).rgb;
  
  // Базовый цвет = текстура * albedo материала
  let baseColor = texColor * scene.material.albedo;

  // ========================================
  // SPECULAR MAP (грязь)
  // ========================================
  
  // Specular map определяет, какие части поверхности блестят
  // Тёмные области = грязь = меньше блеска и темнее
  let specularMask = textureSample(specularMap, dirtSampler, input.uv).r;

  // Грязь затемняет поверхность: 0.0 → 30% яркости, 1.0 → 100%
  let dirtDarkening = mix(0.3, 1.0, specularMask);

  // Грязь убирает блеск: 0.0 → 5% блеска, 1.0 → 100%
  let specularReduction = mix(0.05, 1.0, specularMask);
  let modulatedSpec = specAcc * specularReduction;

  // ========================================
  // ФИНАЛЬНЫЙ ЦВЕТ
  // ========================================
  
  // Собираем всё вместе:
  // (базовый цвет × освещение × грязь) + блики
  let finalColor = baseColor * diffuseAcc * dirtDarkening + modulatedSpec;
  
  return vec4<f32>(finalColor, 1.0);  // alpha = 1.0 (полностью непрозрачный)
}
