import { CameraController, directionFromAngles } from "./camera";
import { hexToRgb01 } from "./color";
import { createCube, createSphere } from "./geometry";
import { createPointLights, updatePointLights } from "./lights";
import * as math from "./math";
import lightFragWGSL from "./shaders/light_visualizer.frag.wgsl?raw";
import lightVertWGSL from "./shaders/light_visualizer.vert.wgsl?raw";
import cubeFragWGSL from "./shaders/shader.frag.wgsl?raw";
import cubeVertWGSL from "./shaders/shader.vert.wgsl?raw";
import { createUIManager } from "./ui";

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const maxPointLights = 2;

const moveSpeed = 3.5;
const sprintScale = 1.75;
const mouseSensitivity = 0.0025;

const defaultCamera = { position: { x: 0, y: 1.2, z: -3.2 }, yaw: 0, pitch: 0 };
const camera = new CameraController({
  canvas,
  moveSpeed,
  sprintScale,
  mouseSensitivity,
  defaultState: defaultCamera,
});

let spinOrigin = 0;
let spinStart = performance.now();
const spinSpeedMs = 700; // скорость вращения при Spin в мс/рад

const { ui } = createUIManager(maxPointLights, () => {
  camera.reset();
  spinStart = performance.now();
  spinOrigin = Number.parseFloat(ui.rot.value);
});
spinOrigin = Number.parseFloat(ui.rot.value);

ui.spin.addEventListener("change", () => {
  spinStart = performance.now();
  spinOrigin = Number.parseFloat(ui.rot.value);
});

const pointLights = createPointLights(maxPointLights);

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

  const { texture, sampler } = await loadTexture(
    gpu,
    new URL("../assets/cobblestone.png", import.meta.url).toString(),
  );

  const cube = createCube(1);
  const cubeVertices = new Float32Array(cube.vertices);
  const cubeIndices = new Uint32Array(cube.indices);

  const vbo = gpu.createBuffer({
    size: cubeVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(vbo, 0, cubeVertices);

  const ibo = gpu.createBuffer({
    size: cubeIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(ibo, 0, cubeIndices);

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

  const pipeline = await gpu.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: gpu.createShaderModule({ code: cubeVertWGSL }),
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
      module: gpu.createShaderModule({ code: cubeFragWGSL }),
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

  // Создаем сферу для визуализации источников света
  const lightSphereRadius = 0.08;
  const lightSphereSegments = 16;
  const lightSphere = createSphere(lightSphereRadius, lightSphereSegments);
  const lightVertices = new Float32Array(lightSphere.vertices);
  const lightIndices = new Uint32Array(lightSphere.indices);

  const lightVbo = gpu.createBuffer({
    size: lightVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.queue.writeBuffer(lightVbo, 0, lightVertices);

  const lightIbo = gpu.createBuffer({
    size: lightIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  gpu.queue.writeBuffer(lightIbo, 0, lightIndices);

  // Uniform буферы для визуализации источников (отдельные для каждого источника)
  const lightUniformSize = 16 * 4 * 3; // 3 mat4 (projection, view, model)
  const lightColorBufferSize = 16; // vec3 + padding

  // Bind group layout для визуализатора источников
  const lightBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });

  // Создаем массивы буферов для каждого источника
  const lightUbos: GPUBuffer[] = [];
  const lightColorBuffers: GPUBuffer[] = [];
  const lightBindGroups: GPUBindGroup[] = [];

  for (let i = 0; i < maxPointLights; i++) {
    const lightUbo = gpu.createBuffer({
      size: lightUniformSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    lightUbos.push(lightUbo);

    const lightColorBuffer = gpu.createBuffer({
      size: lightColorBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    lightColorBuffers.push(lightColorBuffer);

    // Создаем bind group заранее
    const lightBindGroup = gpu.createBindGroup({
      layout: lightBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: lightUbo } },
        { binding: 1, resource: { buffer: lightColorBuffer } },
      ],
    });
    lightBindGroups.push(lightBindGroup);
  }

  // Временные массивы для обновления данных
  const lightUniformDataArrays = Array.from(
    { length: maxPointLights },
    () => new Float32Array(lightUniformSize / 4),
  );
  const lightColorDataArrays = Array.from({ length: maxPointLights }, () => new Float32Array(4));

  // Pipeline для визуализации источников света
  const lightPipeline = await gpu.createRenderPipelineAsync({
    layout: gpu.createPipelineLayout({ bindGroupLayouts: [lightBindGroupLayout] }),
    vertex: {
      module: gpu.createShaderModule({ code: lightVertWGSL }),
      entryPoint: "main",
      buffers: [
        {
          arrayStride: 12, // только position (vec3)
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        },
      ],
    },
    fragment: {
      module: gpu.createShaderModule({ code: lightFragWGSL }),
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

    const forward = camera.update(dt);

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
    const view = math.lookAt(camera.state.position, math.add(camera.state.position, forward), {
      x: 0,
      y: 1,
      z: 0,
    });

    uniformData.set(proj, uniformOffsets.projection);
    uniformData.set(view, uniformOffsets.view);
    uniformData.set(model, uniformOffsets.model);

    uniformData[uniformOffsets.cameraPos + 0] = camera.state.position.x;
    uniformData[uniformOffsets.cameraPos + 1] = camera.state.position.y;
    uniformData[uniformOffsets.cameraPos + 2] = camera.state.position.z;

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

    const activePointLights = updatePointLights(
      now,
      { count: ui.pointCount, entries: ui.points },
      pointLights,
      pointLightData,
    );
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
    pass.drawIndexed(cubeIndices.length);

    // Рендерим визуализацию точечных источников света
    const pointCount = activePointLights;

    if (pointCount > 0) {
      // Подготавливаем данные для всех источников заранее
      for (let i = 0; i < pointCount; i++) {
        const light = pointLights[i];
        const uniformData = lightUniformDataArrays[i];
        const colorData = lightColorDataArrays[i];

        // Устанавливаем projection и view (одинаковые для всех)
        uniformData.set(proj, 0);
        uniformData.set(view, 16);

        // Создаем матрицу модели для позиции источника
        const lightModel = math.translation(light.position);
        uniformData.set(lightModel, 32);

        // Устанавливаем цвет источника
        colorData[0] = light.color[0];
        colorData[1] = light.color[1];
        colorData[2] = light.color[2];
        colorData[3] = 0; // padding

        // Записываем данные в буферы
        gpu.queue.writeBuffer(lightUbos[i], 0, uniformData);
        gpu.queue.writeBuffer(lightColorBuffers[i], 0, colorData);
      }

      // Рендерим все источники
      for (let i = 0; i < pointCount; i++) {
        pass.setPipeline(lightPipeline);
        pass.setVertexBuffer(0, lightVbo);
        pass.setIndexBuffer(lightIbo, "uint32");
        pass.setBindGroup(0, lightBindGroups[i]);
        pass.drawIndexed(lightIndices.length);
      }
    }

    pass.end();

    gpu.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => console.error(err));
