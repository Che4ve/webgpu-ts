import type { Mat4, Vec3 } from "./types";

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const r = new Float32Array(16);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[j * 4 + k] * b[k * 4 + i];
      r[j * 4 + i] = s;
    }
  }
  return r;
}

export function projection(fovDeg: number, aspect: number, near: number, far: number): Mat4 {
  const rad = (fovDeg * Math.PI) / 180;
  const cot = 1 / Math.tan(rad / 2);
  const m = new Float32Array(16);
  m[0] = cot / aspect;
  m[5] = cot;
  m[11] = 1; // m[2][3]
  m[10] = far / (far - near); // m[2][2]
  m[14] = (-near * far) / (far - near); // m[3][2]
  return m;
}

export function translation(v: Vec3): Mat4 {
  const m = identity();
  m[12] = v.x; // m[3][0]
  m[13] = v.y; // m[3][1]
  m[14] = v.z; // m[3][2]
  return m;
}

export function rotation(axis: Vec3, angle: number): Mat4 {
  const len = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const x = axis.x / len,
    y = axis.y / len,
    z = axis.z / len;
  const s = Math.sin(angle),
    c = Math.cos(angle),
    v = 1 - c;
  const m = new Float32Array(16);
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

export const rotationAxisX = (angle: number) => rotation({ x: 1, y: 0, z: 0 }, angle);
export const rotationAxisY = (angle: number) => rotation({ x: 0, y: 1, z: 0 }, angle);
export const rotationAxisZ = (angle: number) => rotation({ x: 0, y: 0, z: 1 }, angle);
