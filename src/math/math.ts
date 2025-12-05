import type { Mat4, Vec3 } from "./types";

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; // Диагональ
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        // Строка row из a × столбец col из b
        s += a[k * 4 + row] * b[col * 4 + k];
      }
      r[col * 4 + row] = s;
    }
  }
  return r;
}

/**
 * Создаёт матрицу ПЕРСПЕКТИВНОЙ проекции (для камеры).
 *
 * Перспективная проекция создаёт эффект "далёкие объекты меньше".
 * Используется для камеры игрока.
 *
 * @param fovDeg - угол обзора по вертикали в градусах (обычно 60-90)
 * @param aspect - соотношение сторон экрана (width / height)
 * @param near - ближняя плоскость отсечения (объекты ближе не рисуются)
 * @param far - дальняя плоскость отсечения (объекты дальше не рисуются)
 *
 * Результат преобразует координаты в clip space:
 * - x, y ∈ [-1, 1]
 * - z ∈ [0, 1] (в WebGPU!)
 */
export function projection(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  const rad = (fovDeg * Math.PI) / 180; // Переводим градусы в радианы
  const cot = 1 / Math.tan(rad / 2); // Котангенс половины угла
  const m = new Float32Array(16);

  m[0] = cot / aspect; // Масштаб по X (с учётом соотношения сторон)
  m[5] = cot; // Масштаб по Y
  m[11] = 1; // Сохраняем Z в W для перспективного деления
  m[10] = far / (far - near); // Преобразование глубины
  m[14] = (-near * far) / (far - near); // Смещение глубины

  return m;
}

/**
 * Создаёт матрицу перемещения (translation).
 * Сдвигает все точки на вектор v.
 *
 * | 1  0  0  vx |
 * | 0  1  0  vy |
 * | 0  0  1  vz |
 * | 0  0  0  1  |
 */
export function translation(v: Vec3): Mat4 {
  const m = identity();
  m[12] = v.x; // X смещение
  m[13] = v.y; // Y смещение
  m[14] = v.z; // Z смещение
  return m;
}

/**
 * Создаёт матрицу вращения вокруг произвольной оси.
 * Использует формулу Родригеса.
 *
 * @param axis - ось вращения (нормализуется внутри функции)
 * @param angle - угол в радианах
 */
export function rotation(axis: Vec3, angle: number): Mat4 {
  // Нормализуем ось вращения
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const x = axis.x / len,
    y = axis.y / len,
    z = axis.z / len;

  const s = Math.sin(angle),
    c = Math.cos(angle),
    v = 1 - c; // versine

  const m = new Float32Array(16);

  // Формула Родригеса для матрицы вращения
  m[0] = x * x * v + c;
  m[1] = x * y * v + z * s;
  m[2] = x * z * v - y * s;
  m[3] = 0;
  m[4] = y * x * v - z * s;
  m[5] = y * y * v + c;
  m[6] = y * z * v + x * s;
  m[7] = 0;
  m[8] = z * x * v + y * s;
  m[9] = z * y * v - x * s;
  m[10] = z * z * v + c;
  m[11] = 0;
  m[12] = 0;
  m[13] = 0;
  m[14] = 0;
  m[15] = 1;

  return m;
}

/**
 * Создаёт матрицу масштабирования.
 * Растягивает/сжимает объект по осям.
 *
 * | sx  0   0   0 |
 * | 0   sy  0   0 |
 * | 0   0   sz  0 |
 * | 0   0   0   1 |
 */
export function scale(v: Vec3): Mat4 {
  const m = identity();
  m[0] = v.x; // Масштаб по X
  m[5] = v.y; // Масштаб по Y
  m[10] = v.z; // Масштаб по Z
  return m;
}

// Удобные функции для вращения вокруг основных осей
export const rotationAxisX = (angle: number) => rotation({ x: 1, y: 0, z: 0 }, angle);
export const rotationAxisY = (angle: number) => rotation({ x: 0, y: 1, z: 0 }, angle);
export const rotationAxisZ = (angle: number) => rotation({ x: 0, y: 0, z: 1 }, angle);

// ============================================================================
// ВЕКТОРНЫЕ ОПЕРАЦИИ
// ============================================================================

/** Сложение векторов: a + b */
export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** Вычитание векторов: a - b */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Скалярное произведение (dot product): a · b
 *
 * Результат - число, которое показывает:
 * - Если > 0: векторы смотрят в одну сторону
 * - Если = 0: векторы перпендикулярны
 * - Если < 0: векторы смотрят в противоположные стороны
 *
 * Для единичных векторов: dot(a, b) = cos(угол между ними)
 */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Векторное произведение (cross product): a × b
 *
 * Результат - вектор, перпендикулярный обоим исходным.
 * Используется для:
 * - Вычисления нормалей к поверхности
 * - Построения системы координат камеры
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Умножение вектора на скаляр */
export function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/**
 * Нормализация вектора (делает длину = 1).
 * Сохраняет направление, но убирает "размер".
 */
export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ============================================================================
// МАТРИЦЫ ДЛЯ КАМЕРЫ И ТЕНЕЙ
// ============================================================================

/**
 * Создаёт матрицу вида (view matrix) для камеры или источника света.
 *
 * "Смотрит" из точки eye в точку target, с направлением вверх up.
 *
 * @param eye - позиция камеры/света
 * @param target - точка, куда смотрит камера/свет
 * @param up - вектор "вверх" (обычно (0, 1, 0))
 *
 * Результат - матрица, которая преобразует мировые координаты
 * в координаты камеры (view space).
 *
 * Используется:
 * - Для камеры игрока (view = lookAt(cameraPos, lookTarget, up))
 * - Для shadow mapping (lightView = lookAt(lightPos, sceneCenter, up))
 */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  // Направление взгляда (от eye к target)
  const forward = normalize(sub(target, eye));

  // Правый вектор (перпендикулярен forward и up)
  const right = normalize(cross(up, forward));

  // Истинный вектор "вверх" (перпендикулярен forward и right)
  // Пересчитываем, потому что исходный up может быть не перпендикулярен forward
  const camUp = cross(forward, right);

  const m = identity();

  // Верхняя 3x3 часть матрицы - это транспонированная матрица вращения
  // (потому что мы хотим повернуть мир относительно камеры, а не камеру)

  // Строка 0: правый вектор (X-ось камеры)
  m[0] = right.x;
  m[4] = right.y;
  m[8] = right.z;

  // Строка 1: верхний вектор (Y-ось камеры)
  m[1] = camUp.x;
  m[5] = camUp.y;
  m[9] = camUp.z;

  // Строка 2: направление взгляда (Z-ось камеры)
  m[2] = forward.x;
  m[6] = forward.y;
  m[10] = forward.z;

  // Перемещение: смещаем мир в противоположную сторону от позиции камеры
  // Используем dot для проекции позиции камеры на оси камеры
  m[12] = -dot(right, eye);
  m[13] = -dot(camUp, eye);
  m[14] = -dot(forward, eye);

  return m;
}

/**
 * ============================================================================
 * ОРТОГРАФИЧЕСКАЯ ПРОЕКЦИЯ (для Shadow Mapping)
 * ============================================================================
 *
 * В отличие от перспективной проекции, ортографическая НЕ уменьшает
 * далёкие объекты. Все лучи параллельны.
 *
 * Используется для:
 * - Направленного света (солнце) - лучи параллельны
 * - Изометрических игр
 * - CAD программ
 *
 * @param left, right - границы по X
 * @param bottom, top - границы по Y
 * @param near, far - границы по Z (ближняя и дальняя плоскости)
 *
 * Все объекты внутри этого "ящика" (frustum) будут видны.
 *
 *        top
 *         │
 *    ┌────┼────┐
 *    │    │    │  ← far (дальняя плоскость)
 *    │    │    │
 *    │    │    │
 *    │    │    │  ← near (ближняя плоскость)
 *    └────┼────┘
 *         │
 *       bottom
 *   left     right
 *
 * Результат преобразует координаты в clip space WebGPU:
 * - x, y ∈ [-1, 1]
 * - z ∈ [0, 1]
 */
export function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const m = new Float32Array(16);

  // Вычисляем коэффициенты масштабирования
  const lr = 1 / (right - left); // 1 / ширина
  const bt = 1 / (top - bottom); // 1 / высота
  const nf = 1 / (far - near); // 1 / глубина

  // Масштабирование: приводим размеры frustum к [-1, 1] (для x, y) и [0, 1] (для z)
  m[0] = 2 * lr; // Масштаб по X: 2 / ширина
  m[5] = 2 * bt; // Масштаб по Y: 2 / высота
  m[10] = nf; // Масштаб по Z: 1 / глубина (для WebGPU z ∈ [0, 1])

  // Смещение: центрируем frustum в начале координат
  m[12] = -(right + left) * lr; // Смещение по X
  m[13] = -(top + bottom) * bt; // Смещение по Y
  m[14] = -near * nf; // Смещение по Z (near → 0)

  m[15] = 1; // Гомогенная координата

  return m;
}
