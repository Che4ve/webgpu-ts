import { hexToRgb01 } from "./color";
import type { Vec3 } from "./math";

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

export type PointLightControls = {
  count: HTMLInputElement;
  entries: PointLightUI[];
};

export function createPointLights(maxPointLights: number): PointLight[] {
  return new Array(maxPointLights).fill(null).map(() => ({
    position: { x: 0, y: 1, z: 0 },
    color: [1, 1, 1] as [number, number, number],
    intensity: 1,
  }));
}

export function updatePointLights(
  timeMs: number,
  controls: PointLightControls,
  pointLights: PointLight[],
  out: Float32Array,
): number {
  out.fill(0);
  const count = Math.min(pointLights.length, Number.parseInt(controls.count.value, 10) || 0);
  const t = timeMs * 0.001;

  for (let i = 0; i < count; i++) {
    const ui = controls.entries[i];
    const light = pointLights[i];
    light.color = hexToRgb01(ui.color.value);
    light.intensity = Number.parseFloat(ui.intensity.value);
    light.position = {
      x: Number.parseFloat(ui.x.value),
      y: Number.parseFloat(ui.y.value),
      z: Number.parseFloat(ui.z.value),
    };

    if (i === 0) {
      light.position.x += Math.cos(t) * 0.35;
      light.position.z += Math.sin(t) * 0.35;
    } else if (i === 1) {
      light.position.y += Math.sin(t * 1.6) * 0.2;
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
