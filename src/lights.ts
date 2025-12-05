/**
 * ============================================================================
 * МОДУЛЬ ИСТОЧНИКОВ СВЕТА
 * ============================================================================
 * 
 * Содержит:
 * - PointLight - точечный источник (свет во все стороны)
 * - SpotLight - прожектор (свет в конусе)
 */

import { hexToRgb01 } from "./color";
import type { Vec3 } from "./math";

// ============================================================================
// ТОЧЕЧНЫЙ ИСТОЧНИК СВЕТА
// ============================================================================

export type PointLight = {
  position: Vec3;
  color: [number, number, number];
  intensity: number;
};

export type PointLightUI = {
  color: HTMLInputElement;
  intensity: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
};

// ============================================================================
// ПРОЖЕКТОР (SPOTLIGHT)
// ============================================================================

/**
 * Прожектор - источник света, который светит в определённом направлении
 * с ограниченным углом конуса.
 * 
 * innerConeAngle - внутренний угол (полная яркость)
 * outerConeAngle - внешний угол (плавное затухание к краям)
 * 
 *         ╲     ╱  ← outerConeAngle
 *          ╲   ╱
 *           ╲ ╱   ← innerConeAngle  
 *            ●    ← позиция прожектора
 *            │
 *            ▼ направление
 */
export type SpotLight = {
  position: Vec3;
  direction: Vec3;
  color: [number, number, number];
  intensity: number;
  innerConeAngle: number;  // В радианах
  outerConeAngle: number;  // В радианах
};

export type SpotLightUI = {
  color: HTMLInputElement;
  intensity: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
  dirX: HTMLInputElement;
  dirY: HTMLInputElement;
  dirZ: HTMLInputElement;
  innerAngle: HTMLInputElement;
  outerAngle: HTMLInputElement;
};

export type LightControls = {
  pointEnabled: HTMLInputElement; // чекбокс включения точечного света
  points: PointLightUI[];
  spot: SpotLightUI;
  spotEnabled: HTMLInputElement;
};

// ============================================================================
// СОЗДАНИЕ ИСТОЧНИКОВ
// ============================================================================

export function createPointLights(maxPointLights: number): PointLight[] {
  return new Array(maxPointLights).fill(null).map(() => ({
    position: { x: 0, y: 1, z: 0 },
    color: [1, 1, 1] as [number, number, number],
    intensity: 1,
  }));
}

export function createSpotLight(): SpotLight {
  return {
    position: { x: 0, y: 2, z: 0 },
    direction: { x: 0, y: -1, z: 0 },  // Светит вниз по умолчанию
    color: [1, 1, 1] as [number, number, number],
    intensity: 5,
    innerConeAngle: Math.PI / 6,   // 30 градусов
    outerConeAngle: Math.PI / 4,   // 45 градусов
  };
}

// ============================================================================
// ОБНОВЛЕНИЕ ДАННЫХ
// ============================================================================

/**
 * Обновляет точечные источники и записывает в буфер.
 * Структура в буфере (на каждый источник, 8 floats):
 *   [0-2]: position (vec3)
 *   [3]: intensity
 *   [4-6]: color (vec3)
 *   [7]: padding
 */
export function updatePointLights(
  timeMs: number,
  controls: LightControls,
  pointLights: PointLight[],
  out: Float32Array,
): number {
  out.fill(0);
  // Если точечный свет выключен чекбоксом — ничего не пишем и возвращаем 0 активных источников
  if (!controls.pointEnabled.checked) {
    return 0;
  }

  // Только один источники (maxPointLights = 1), без слайдера count
  const count = Math.min(pointLights.length, 1);
  const t = timeMs * 0.001;

  for (let i = 0; i < count; i++) {
    const ui = controls.points[i];
    const light = pointLights[i];
    light.color = hexToRgb01(ui.color.value);
    light.intensity = Number.parseFloat(ui.intensity.value);
    light.position = {
      x: Number.parseFloat(ui.x.value),
      y: Number.parseFloat(ui.y.value),
      z: Number.parseFloat(ui.z.value),
    };

    // Анимация первого источника
    if (i === 0) {
      light.position.x += Math.cos(t) * 0.35;
      light.position.z += Math.sin(t) * 0.35;
    }

    const base = i * 8;
    out[base + 0] = light.position.x;
    out[base + 1] = light.position.y;
    out[base + 2] = light.position.z;
    out[base + 3] = light.intensity;
    out[base + 4] = light.color[0];
    out[base + 5] = light.color[1];
    out[base + 6] = light.color[2];
    out[base + 7] = 0;
  }
  return count;
}

/**
 * Обновляет прожектор и записывает в буфер.
 * 
 * ВАЖНО: В WGSL vec3 требует выравнивания 16 байт!
 * Структура в буфере (20 floats = 80 bytes):
 *   [0-2]: position (vec3)     offset 0
 *   [3]: intensity (f32)       offset 12
 *   [4-6]: direction (vec3)    offset 16 (выровнено!)
 *   [7]: innerCosAngle (f32)   offset 28
 *   [8-10]: color (vec3)       offset 32 (выровнено!)
 *   [11]: outerCosAngle (f32)  offset 44
 *   [12]: enabled (f32)        offset 48
 *   [13-15]: padding           offset 52
 *   [16-19]: _pad (vec3 + align) offset 64 (выровнено до 80)
 */
export function updateSpotLight(
  controls: LightControls,
  spotLight: SpotLight,
  out: Float32Array,
): void {
  out.fill(0);
  
  const enabled = controls.spotEnabled.checked;
  if (!enabled) {
    out[12] = 0.0;  // Прожектор выключен
    return;
  }
  
  const ui = controls.spot;
  
  spotLight.color = hexToRgb01(ui.color.value);
  spotLight.intensity = Number.parseFloat(ui.intensity.value);
  spotLight.position = {
    x: Number.parseFloat(ui.x.value),
    y: Number.parseFloat(ui.y.value),
    z: Number.parseFloat(ui.z.value),
  };
  
  // Направление прожектора (нормализуем)
  const dx = Number.parseFloat(ui.dirX.value);
  const dy = Number.parseFloat(ui.dirY.value);
  const dz = Number.parseFloat(ui.dirZ.value);
  const len = Math.hypot(dx, dy, dz) || 1;
  spotLight.direction = { x: dx / len, y: dy / len, z: dz / len };
  
  // Углы конуса в радианах
  spotLight.innerConeAngle = Number.parseFloat(ui.innerAngle.value) * Math.PI / 180;
  spotLight.outerConeAngle = Number.parseFloat(ui.outerAngle.value) * Math.PI / 180;
  
  // Записываем в буфер
  // ВАЖНО: Передаём КОСИНУСЫ углов, т.к. в шейдере сравниваем с dot product
  out[0] = spotLight.position.x;
  out[1] = spotLight.position.y;
  out[2] = spotLight.position.z;
  out[3] = spotLight.intensity;
  out[4] = spotLight.direction.x;
  out[5] = spotLight.direction.y;
  out[6] = spotLight.direction.z;
  out[7] = Math.cos(spotLight.innerConeAngle);  // Косинус внутреннего угла
  out[8] = spotLight.color[0];
  out[9] = spotLight.color[1];
  out[10] = spotLight.color[2];
  out[11] = Math.cos(spotLight.outerConeAngle);  // Косинус внешнего угла
  out[12] = 1.0;  // Прожектор включен
  // [13-19] остаются нулями (padding)
}
