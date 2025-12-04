import type { PointLightUI } from "./lights";

export type UIControls = {
  form: HTMLFormElement | null;
  sx: HTMLInputElement;
  sy: HTMLInputElement;
  sz: HTMLInputElement;
  tz: HTMLInputElement;
  rot: HTMLInputElement;
  spin: HTMLInputElement;
  pulse: HTMLInputElement;
  reset: HTMLButtonElement;
  ambientColor: HTMLInputElement;
  ambientIntensity: HTMLInputElement;
  dirYaw: HTMLInputElement;
  dirPitch: HTMLInputElement;
  dirColor: HTMLInputElement;
  dirIntensity: HTMLInputElement;
  matAlbedo: HTMLInputElement;
  matSpecular: HTMLInputElement;
  matShininess: HTMLInputElement;
  pointCount: HTMLInputElement;
  points: PointLightUI[];
};

export type UIPointDefaults = {
  color: string;
  intensity: string;
  x: string;
  y: string;
  z: string;
};

export type UIDefaults = {
  sx: string;
  sy: string;
  sz: string;
  tz: string;
  rot: string;
  spin: boolean;
  pulse: boolean;
  ambientColor: string;
  ambientIntensity: string;
  dirYaw: string;
  dirPitch: string;
  dirColor: string;
  dirIntensity: string;
  matAlbedo: string;
  matSpecular: string;
  matShininess: string;
  pointCount: string;
  points: UIPointDefaults[];
};

function collectPointLights(maxPointLights: number): PointLightUI[] {
  return Array.from({ length: maxPointLights }, (_, i) => ({
    color: document.getElementById(`p${i}-color`) as HTMLInputElement,
    intensity: document.getElementById(`p${i}-intensity`) as HTMLInputElement,
    x: document.getElementById(`p${i}-x`) as HTMLInputElement,
    y: document.getElementById(`p${i}-y`) as HTMLInputElement,
    z: document.getElementById(`p${i}-z`) as HTMLInputElement,
  }));
}

export function collectUI(maxPointLights: number): UIControls {
  return {
    form: document.getElementById("controls-form") as HTMLFormElement | null,
    sx: document.getElementById("sr-x") as HTMLInputElement,
    sy: document.getElementById("sr-y") as HTMLInputElement,
    sz: document.getElementById("sr-z") as HTMLInputElement,
    tz: document.getElementById("tr-z") as HTMLInputElement,
    rot: document.getElementById("rot") as HTMLInputElement,
    spin: document.getElementById("spin") as HTMLInputElement,
    pulse: document.getElementById("pulse") as HTMLInputElement,
    reset: document.getElementById("reset") as HTMLButtonElement,
    ambientColor: document.getElementById("ambient-color") as HTMLInputElement,
    ambientIntensity: document.getElementById("ambient-intensity") as HTMLInputElement,
    dirYaw: document.getElementById("dir-yaw") as HTMLInputElement,
    dirPitch: document.getElementById("dir-pitch") as HTMLInputElement,
    dirColor: document.getElementById("dir-color") as HTMLInputElement,
    dirIntensity: document.getElementById("dir-intensity") as HTMLInputElement,
    matAlbedo: document.getElementById("mat-albedo") as HTMLInputElement,
    matSpecular: document.getElementById("mat-specular") as HTMLInputElement,
    matShininess: document.getElementById("mat-shininess") as HTMLInputElement,
    pointCount: document.getElementById("point-count") as HTMLInputElement,
    points: collectPointLights(maxPointLights),
  };
}

export function snapshotDefaults(ui: UIControls): UIDefaults {
  return {
    sx: ui.sx.value,
    sy: ui.sy.value,
    sz: ui.sz.value,
    tz: ui.tz.value,
    rot: ui.rot.value,
    spin: ui.spin.checked,
    pulse: ui.pulse.checked,
    ambientColor: ui.ambientColor.value,
    ambientIntensity: ui.ambientIntensity.value,
    dirYaw: ui.dirYaw.value,
    dirPitch: ui.dirPitch.value,
    dirColor: ui.dirColor.value,
    dirIntensity: ui.dirIntensity.value,
    matAlbedo: ui.matAlbedo.value,
    matSpecular: ui.matSpecular.value,
    matShininess: ui.matShininess.value,
    pointCount: ui.pointCount.value,
    points: ui.points.map((p) => ({
      color: p.color.value,
      intensity: p.intensity.value,
      x: p.x.value,
      y: p.y.value,
      z: p.z.value,
    })),
  };
}

export function createUIManager(
  maxPointLights: number,
  onReset?: () => void,
): { ui: UIControls; defaults: UIDefaults; reset: () => void } {
  const ui = collectUI(maxPointLights);
  const defaults = snapshotDefaults(ui);

  const reset = () => {
    if (ui.form && typeof ui.form.reset === "function") {
      ui.form.reset();
    } else {
      ui.sx.value = defaults.sx;
      ui.sy.value = defaults.sy;
      ui.sz.value = defaults.sz;
      ui.tz.value = defaults.tz;
      ui.rot.value = defaults.rot;
      ui.spin.checked = defaults.spin;
      ui.pulse.checked = defaults.pulse;
      ui.ambientColor.value = defaults.ambientColor;
      ui.ambientIntensity.value = defaults.ambientIntensity;
      ui.dirYaw.value = defaults.dirYaw;
      ui.dirPitch.value = defaults.dirPitch;
      ui.dirColor.value = defaults.dirColor;
      ui.dirIntensity.value = defaults.dirIntensity;
      ui.matAlbedo.value = defaults.matAlbedo;
      ui.matSpecular.value = defaults.matSpecular;
      ui.matShininess.value = defaults.matShininess;
      ui.pointCount.value = defaults.pointCount;
      defaults.points.forEach((p, idx) => {
        const dst = ui.points[idx];
        dst.color.value = p.color;
        dst.intensity.value = p.intensity;
        dst.x.value = p.x;
        dst.y.value = p.y;
        dst.z.value = p.z;
      });
    }
    onReset?.();
  };

  ui.reset.addEventListener("click", reset);

  return { ui, defaults, reset };
}
