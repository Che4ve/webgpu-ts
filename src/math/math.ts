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
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      r[col * 4 + row] = s;
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

export function scale(v: Vec3): Mat4 {
  const m = identity();
  m[0] = v.x;
  m[5] = v.y;
  m[10] = v.z;
  return m;
}

export const rotationAxisX = (angle: number) => rotation({ x: 1, y: 0, z: 0 }, angle);
export const rotationAxisY = (angle: number) => rotation({ x: 0, y: 1, z: 0 }, angle);
export const rotationAxisZ = (angle: number) => rotation({ x: 0, y: 0, z: 1 }, angle);

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function scaleVec(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// Left-handed look-at (forward is +Z like WebGPU's default projection)
export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(up, forward));
  const camUp = cross(forward, right);

  const m = identity();
  m[0] = right.x;
  m[1] = right.y;
  m[2] = right.z;

  m[4] = camUp.x;
  m[5] = camUp.y;
  m[6] = camUp.z;

  m[8] = forward.x;
  m[9] = forward.y;
  m[10] = forward.z;

  m[12] = -dot(right, eye);
  m[13] = -dot(camUp, eye);
  m[14] = -dot(forward, eye);
  return m;
}
