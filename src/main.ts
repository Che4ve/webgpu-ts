import type { Vec3 } from "./math";
import * as math from "./math";

type PointLight = {
  position: Vec3;
  color: [number, number, number];
  intensity: number;
};

type PointLightUI = {
  color: HTMLInputElement;
  intensity: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
};

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const form = document.getElementById("controls-form") as HTMLFormElement;
const maxPointLights = 4;

const ui = {
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
  points: Array.from({ length: maxPointLights }, (_, i) => ({
    color: document.getElementById(`p${i}-color`) as HTMLInputElement,
    intensity: document.getElementById(`p${i}-intensity`) as HTMLInputElement,
    x: document.getElementById(`p${i}-x`) as HTMLInputElement,
    y: document.getElementById(`p${i}-y`) as HTMLInputElement,
    z: document.getElementById(`p${i}-z`) as HTMLInputElement,
  })) as PointLightUI[],
};

const pointLights: PointLight[] = new Array(maxPointLights).fill(null).map(() => ({
  position: { x: 0, y: 1, z: 0 },
  color: [1, 1, 1],
  intensity: 1,
}));

const defaultUI = {
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

const pressedKeys = new Set<string>();
const moveSpeed = 3.5;
const sprintScale = 1.75;
const mouseSensitivity = 0.0025;

const defaultCamera = { position: { x: 0, y: 1.2, z: -3.2 }, yaw: 0, pitch: 0 };
const camera = {
  position: { ...defaultCamera.position },
  yaw: defaultCamera.yaw,
  pitch: defaultCamera.pitch,
};

let spinOrigin = Number.parseFloat(ui.rot.value);
let spinStart = performance.now();
const spinSpeedMs = 700; // скорость вращения при Spin в мс/рад

function hexToRgb01(hex: string): [number, number, number] {
  const v = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = Number.parseInt(v, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [r / 255, g / 255, b / 255];
}

function directionFromAngles(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return math.normalize({
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  });
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

window.addEventListener("keydown", (event) => {
  pressedKeys.add(event.code);
  if (
    ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ControlLeft", "KeyQ", "KeyE"].includes(
      event.code,
    )
  ) {
    event.preventDefault();
  }
});
window.addEventListener("keyup", (event) => pressedKeys.delete(event.code));

canvas.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  camera.yaw += event.movementX * mouseSensitivity;
  camera.pitch -= event.movementY * mouseSensitivity;
  const limit = Math.PI / 2 - 0.05;
  camera.pitch = clamp(camera.pitch, -limit, limit);
});

ui.spin.addEventListener("change", () => {
  spinStart = performance.now();
  spinOrigin = Number.parseFloat(ui.rot.value);
});

function resetUI() {
  if (form instanceof HTMLFormElement && typeof form.reset === "function") {
    form.reset();
  } else {
    ui.sx.value = defaultUI.sx;
    ui.sy.value = defaultUI.sy;
    ui.sz.value = defaultUI.sz;
    ui.tz.value = defaultUI.tz;
    ui.rot.value = defaultUI.rot;
    ui.spin.checked = defaultUI.spin;
    ui.pulse.checked = defaultUI.pulse;
    ui.ambientColor.value = defaultUI.ambientColor;
    ui.ambientIntensity.value = defaultUI.ambientIntensity;
    ui.dirYaw.value = defaultUI.dirYaw;
    ui.dirPitch.value = defaultUI.dirPitch;
    ui.dirColor.value = defaultUI.dirColor;
    ui.dirIntensity.value = defaultUI.dirIntensity;
    ui.matAlbedo.value = defaultUI.matAlbedo;
    ui.matSpecular.value = defaultUI.matSpecular;
    ui.matShininess.value = defaultUI.matShininess;
    ui.pointCount.value = defaultUI.pointCount;
    defaultUI.points.forEach((p, idx) => {
      const dst = ui.points[idx];
      dst.color.value = p.color;
      dst.intensity.value = p.intensity;
      dst.x.value = p.x;
      dst.y.value = p.y;
      dst.z.value = p.z;
    });
  }
  camera.position = { ...defaultCamera.position };
  camera.yaw = defaultCamera.yaw;
  camera.pitch = defaultCamera.pitch;
  spinStart = performance.now();
  spinOrigin = Number.parseFloat(ui.rot.value);
}

ui.reset.addEventListener("click", resetUI);

function updateCamera(dt: number): Vec3 {
  const forward = directionFromAngles(camera.yaw, camera.pitch);
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const right = math.normalize(math.cross(up, forward));

  let move: Vec3 = { x: 0, y: 0, z: 0 };
  if (pressedKeys.has("KeyW")) move = math.add(move, forward);
  if (pressedKeys.has("KeyS")) move = math.sub(move, forward);
  if (pressedKeys.has("KeyA")) move = math.sub(move, right);
  if (pressedKeys.has("KeyD")) move = math.add(move, right);
  if (pressedKeys.has("KeyE") || pressedKeys.has("Space")) move = math.add(move, up);
  if (pressedKeys.has("KeyQ") || pressedKeys.has("ControlLeft")) move = math.sub(move, up);

  const len = Math.hypot(move.x, move.y, move.z);
  if (len > 0) {
    const speed = moveSpeed * (pressedKeys.has("ShiftLeft") ? sprintScale : 1);
    const delta = math.scaleVec(math.scaleVec(move, 1 / len), speed * dt);
    camera.position = math.add(camera.position, delta);
  }

  return forward;
}

function updatePointLights(timeMs: number, out: Float32Array): number {
  out.fill(0);
  const count = Math.min(maxPointLights, Number.parseInt(ui.pointCount.value, 10) || 0);
  const t = timeMs * 0.001;

  for (let i = 0; i < count; i++) {
    const controls = ui.points[i];
    const light = pointLights[i];
    light.color = hexToRgb01(controls.color.value);
    light.intensity = Number.parseFloat(controls.intensity.value);
    light.position = {
      x: Number.parseFloat(controls.x.value),
      y: Number.parseFloat(controls.y.value),
      z: Number.parseFloat(controls.z.value),
    };

    // Небольшая анимация, чтобы свет в сцене жил
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

async function main() {
  if (!navigator.gpu) {
    alert("WebGPU не поддерживается в этом браузере. Попробуйте Chrome Canary/Edge/Safari TP.");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    alert("Не удалось получить устройство WebGPU");
    return;
  }
  const gpu = device;

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: gpu, format, alphaMode: "opaque" });

  const depthTex = gpu.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTex.createView();

  async function loadTexture(gpuDevice: GPUDevice, url: string) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const bmp = await createImageBitmap(img, { imageOrientation: "flipY" });
    const texture = gpuDevice.createTexture({
      size: { width: bmp.width, height: bmp.height },
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    gpuDevice.queue.copyExternalImageToTexture(
      { source: bmp },
      { texture },
      { width: bmp.width, height: bmp.height },
    );
    const sampler = gpuDevice.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    return { texture, sampler };
  }

  const { texture, sampler } = await loadTexture(
    gpu,
    new URL("../assets/cobblestone.png", import.meta.url).toString(),
  );

  const cubePoint: Vec3 = { x: 0.5, y: 0.5, z: 0.5 };
  const { x: hx, y: hy, z: hz } = cubePoint;

  // Вершины: позиция (xyz) + нормаль (xyz) + uv (xy)
  // biome-ignore format: ignore
  const baseVertices = new Float32Array([
    // front (z+)
    -hx,-hy, hz,  0,0,1,  0,0,
     hx,-hy, hz,  0,0,1,  1,0,
     hx, hy, hz,  0,0,1,  1,1,
    -hx, hy, hz,  0,0,1,  0,1,
    // back (z-)
    -hx,-hy,-hz,  0,0,-1, 1,0,
     hx,-hy,-hz,  0,0,-1, 0,0,
     hx, hy,-hz,  0,0,-1, 0,1,
    -hx, hy,-hz,  0,0,-1, 1,1,
    // left (x-)
    -hx,-hy,-hz, -1,0,0,  0,0,
    -hx,-hy, hz, -1,0,0,  1,0,
    -hx, hy, hz, -1,0,0,  1,1,
    -hx, hy,-hz, -1,0,0,  0,1,
    // right (x+)
     hx,-hy,-hz,  1,0,0,  1,0,
     hx,-hy, hz,  1,0,0,  0,0,
     hx, hy, hz,  1,0,0,  0,1,
     hx, hy,-hz,  1,0,0,  1,1,
    // top (y+)
    -hx, hy,-hz,  0,1,0,  0,1,
    -hx, hy, hz,  0,1,0,  0,0,
     hx, hy, hz,  0,1,0,  1,0,
     hx, hy,-hz,  0,1,0,  1,1,
    // bottom (y-)
    -hx,-hy,-hz,  0,-1,0, 0,0,
    -hx,-hy, hz,  0,-1,0, 0,1,
     hx,-hy, hz,  0,-1,0, 1,1,
     hx,-hy,-hz,  0,-1,0, 1,0,
  ]);

  // Индексы: по 2 треугольника на грань
  // biome-ignore format: ignore
  const indices = new Uint32Array([
    0, 1, 2,  2, 3, 0,      // front
    4, 5, 6,  6, 7, 4,      // back
    8, 9,10, 10,11, 8,      // left
   12,13,14, 14,15,12,      // right
   16,17,18, 18,19,16,      // top
   20,21,22, 22,23,20,      // bottom
  ]);

  const vbo = gpu.createBuffer({
    size: baseVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(vbo, 0, baseVertices);

  const ibo = gpu.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(ibo, 0, indices);

  // 3 матрицы + камера + ambient + directional + material + количество точечных (+ паддинг)
  const uniformOffsets = {
    projection: 0,
    view: 16,
    model: 32,
    cameraPos: 48,
    ambient: 52,
    directionalDir: 56,
    directionalColor: 60,
    materialAlbedo: 64,
    materialSpecular: 68,
    pointCount: 72,
    padLights: 76,
  } as const;
  // 80 floats = 320 bytes (WGSL layout size for Scene)
  const uniformData = new Float32Array(80);
  const ubo = gpu.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pointLightData = new Float32Array(maxPointLights * 8);
  const pointLightBuffer = gpu.createBuffer({
    size: pointLightData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    ],
  });
  const bindGroup = gpu.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: ubo } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: sampler },
      { binding: 3, resource: { buffer: pointLightBuffer } },
    ],
  });

  const pipelineLayout = gpu.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

  const vertWGSL = await (await fetch("/src/shaders/shader.vert.wgsl")).text();
  const fragWGSL = await (await fetch("/src/shaders/shader.frag.wgsl")).text();

  const pipeline = await gpu.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: gpu.createShaderModule({ code: vertWGSL }),
      entryPoint: "main",
      buffers: [
        {
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
            { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
            { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
          ],
        },
      ],
    },
    fragment: {
      module: gpu.createShaderModule({ code: fragWGSL }),
      entryPoint: "main",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
      cullMode: "none",
      frontFace: "cw",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
  });

  let lastTime = performance.now();

  function frame() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    const forward = updateCamera(dt);

    const rotation = ui.spin.checked
      ? (() => {
          const angle = (spinOrigin + (now - spinStart) / spinSpeedMs) % (Math.PI * 2);
          ui.rot.value = angle.toString();
          return angle;
        })()
      : Number.parseFloat(ui.rot.value);

    const baseScaleY = Number.parseFloat(ui.sy.value);
    const pulse = ui.pulse.checked ? 1 + 0.2 * Math.sin(now * 0.012) : 1;
    const scaleVec = {
      x: Number.parseFloat(ui.sx.value),
      y: baseScaleY * pulse,
      z: Number.parseFloat(ui.sz.value),
    };
    const scaleMat = math.scale(scaleVec);
    const rotationMat = math.multiply(
      math.rotationAxisY(rotation),
      math.rotationAxisX(-Math.PI / 7),
    );
    const model = math.multiply(
      math.translation({ x: 0, y: 0, z: Number.parseFloat(ui.tz.value) }),
      math.multiply(rotationMat, scaleMat),
    );

    const proj = math.projection(70, canvas.width / canvas.height, 0.01, 100);
    const view = math.lookAt(camera.position, math.add(camera.position, forward), {
      x: 0,
      y: 1,
      z: 0,
    });

    uniformData.set(proj, uniformOffsets.projection);
    uniformData.set(view, uniformOffsets.view);
    uniformData.set(model, uniformOffsets.model);

    uniformData[uniformOffsets.cameraPos + 0] = camera.position.x;
    uniformData[uniformOffsets.cameraPos + 1] = camera.position.y;
    uniformData[uniformOffsets.cameraPos + 2] = camera.position.z;

    const ambientColor = hexToRgb01(ui.ambientColor.value);
    uniformData.set(ambientColor, uniformOffsets.ambient);
    uniformData[uniformOffsets.ambient + 3] = Number.parseFloat(ui.ambientIntensity.value);

    const dirVec = directionFromAngles(
      Number.parseFloat(ui.dirYaw.value),
      Number.parseFloat(ui.dirPitch.value),
    );
    const dirColor = hexToRgb01(ui.dirColor.value);
    uniformData.set(
      [dirVec.x, dirVec.y, dirVec.z, Number.parseFloat(ui.dirIntensity.value)],
      uniformOffsets.directionalDir,
    );
    uniformData.set(dirColor, uniformOffsets.directionalColor);

    const albedoColor = hexToRgb01(ui.matAlbedo.value);
    const specularColor = hexToRgb01(ui.matSpecular.value);
    uniformData.set(albedoColor, uniformOffsets.materialAlbedo);
    uniformData[uniformOffsets.materialAlbedo + 3] = Number.parseFloat(ui.matShininess.value);
    uniformData.set(specularColor, uniformOffsets.materialSpecular);

    const activePointLights = updatePointLights(now, pointLightData);
    uniformData[uniformOffsets.pointCount] = activePointLights;
    gpu.queue.writeBuffer(pointLightBuffer, 0, pointLightData);

    gpu.queue.writeBuffer(ubo, 0, uniformData);

    const colorTex = context.getCurrentTexture();
    const viewTex = colorTex.createView();
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: viewTex,
          clearValue: { r: 0.05, g: 0.05, b: 0.06, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vbo);
    pass.setIndexBuffer(ibo, "uint32");
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(indices.length);
    pass.end();

    gpu.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => console.error(err));
