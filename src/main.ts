import { CameraController, directionFromAngles } from "./camera";
import { hexToRgb01 } from "./color";
import { createCube, createPlane, createSphere } from "./geometry";
import { createPointLights, updatePointLights } from "./lights";
import * as math from "./math";
import lightFragWGSL from "./shaders/light_visualizer.frag.wgsl?raw";
import lightVertWGSL from "./shaders/light_visualizer.vert.wgsl?raw";
import cubeFragWGSL from "./shaders/shader.frag.wgsl?raw";
import cubeVertWGSL from "./shaders/shader.vert.wgsl?raw";
import envFragWGSL from "./shaders/environment.frag.wgsl?raw";
import shadowVertWGSL from "./shaders/shadow.vert.wgsl?raw";
import { createUIManager } from "./ui";

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const maxPointLights = 2;
const SHADOW_MAP_SIZE = 4096;

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

  // ============================================
  // Shadow Map: текстура глубины для теней от направленного источника
  // ============================================
  const shadowMapTexture = gpu.createTexture({
    size: { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE },
    format: "depth32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowMapView = shadowMapTexture.createView();

  // Comparison sampler для shadow mapping
  const shadowSampler = gpu.createSampler({
    compare: "less",
  });

  // ============================================
  // Загрузка текстур
  // ============================================

  // Текстура куба (cobblestone)
  const { texture: cubeTexture, sampler: cubeSampler } = await loadTexture(
    gpu,
    new URL("../assets/cobblestone.png", import.meta.url).toString(),
  );

  // Specular map для куба (грязные пятна из файла)
  const { texture: specularMapTexture } = await loadTexture(
    gpu,
    new URL("../assets/dirt.png", import.meta.url).toString(),
  );

  // Отдельный сэмплер для грязи — linear фильтрация для плавных переходов
  const dirtSampler = gpu.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  });

  // Текстура пола (wooden planks из файла)
  const { texture: floorTexture, sampler: floorSampler } = await loadTexture(
    gpu,
    new URL("../assets/woodenPlank.png", import.meta.url).toString(),
  );

  // ============================================
  // Создание геометрии
  // ============================================

  const cube = createCube(1);
  const cubeVertices = new Float32Array(cube.vertices);
  const cubeIndices = new Uint32Array(cube.indices);

  // Пол — большая горизонтальная плоскость под кубом
  const floor = createPlane(20, 20, "horizontal", 10); // 10x тайлинг текстуры
  const floorVertices = new Float32Array(floor.vertices);
  const floorIndices = new Uint32Array(floor.indices);

  // Буферы для куба
  const cubeVbo = gpu.createBuffer({
    size: cubeVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(cubeVbo, 0, cubeVertices);

  const cubeIbo = gpu.createBuffer({
    size: cubeIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(cubeIbo, 0, cubeIndices);

  // Буферы для пола
  const floorVbo = gpu.createBuffer({
    size: floorVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  gpu.queue.writeBuffer(floorVbo, 0, floorVertices);

  const floorIbo = gpu.createBuffer({
    size: floorIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  gpu.queue.writeBuffer(floorIbo, 0, floorIndices);

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

  // Отдельный UBO для пола (чтобы матрица модели не перезаписывалась)
  const floorUniformData = new Float32Array(80);
  const floorUbo = gpu.createBuffer({
    size: floorUniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ============================================
  // Shadow Data Uniform (lightViewProj для main pass)
  // ============================================
  const shadowDataSize = 16; // 1 mat4x4 = 16 floats
  const shadowDataBuffer = new Float32Array(shadowDataSize);
  const shadowDataUbo = gpu.createBuffer({
    size: shadowDataBuffer.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ============================================
  // Shadow Pass Uniforms (lightViewProj + model)
  // ============================================
  const shadowUniformSize = 32; // 2 mat4x4 = 32 floats
  const shadowUniformData = new Float32Array(shadowUniformSize);
  const shadowUbo = gpu.createBuffer({
    size: shadowUniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Отдельный буфер для shadow pass пола
  const shadowFloorUniformData = new Float32Array(shadowUniformSize);
  const shadowFloorUbo = gpu.createBuffer({
    size: shadowFloorUniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pointLightData = new Float32Array(maxPointLights * 8);
  const pointLightBuffer = gpu.createBuffer({
    size: pointLightData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // ============================================
  // Bind Group Layouts
  // ============================================

  // Layout для куба - group 0 (основные данные)
  const cubeBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } }, // specular map
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } }, // dirt sampler
    ],
  });

  // Layout для окружения (пол) - group 0
  const envBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    ],
  });

  // Layout для shadow data - group 1 (lightViewProj + shadow map + shadow sampler)
  const shadowDataBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }, // lightViewProj
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } }, // shadow map
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } }, // shadow sampler
    ],
  });

  // Layout для shadow pass (только uniform buffer)
  const shadowBindGroupLayout = gpu.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} }],
  });

  // ============================================
  // Bind Groups
  // ============================================

  // Bind group 0 для куба (основные данные)
  const cubeBindGroup = gpu.createBindGroup({
    layout: cubeBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: ubo } },
      { binding: 1, resource: cubeTexture.createView() },
      { binding: 2, resource: cubeSampler },
      { binding: 3, resource: { buffer: pointLightBuffer } },
      { binding: 4, resource: specularMapTexture.createView() },
      { binding: 5, resource: dirtSampler },
    ],
  });

  // Bind group 0 для пола (основные данные)
  const floorBindGroup = gpu.createBindGroup({
    layout: envBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: floorUbo } },
      { binding: 1, resource: floorTexture.createView() },
      { binding: 2, resource: floorSampler },
      { binding: 3, resource: { buffer: pointLightBuffer } },
    ],
  });

  // Bind group 1 для shadow data (общий для куба и пола)
  const shadowDataBindGroup = gpu.createBindGroup({
    layout: shadowDataBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: shadowDataUbo } }, // lightViewProj
      { binding: 1, resource: shadowMapView }, // shadow map
      { binding: 2, resource: shadowSampler }, // comparison sampler
    ],
  });

  // ============================================
  // Shadow Pass Bind Groups
  // ============================================
  const shadowCubeBindGroup = gpu.createBindGroup({
    layout: shadowBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: shadowUbo } }],
  });

  const shadowFloorBindGroup = gpu.createBindGroup({
    layout: shadowBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: shadowFloorUbo } }],
  });

  // ============================================
  // Pipeline Layouts
  // ============================================

  // Cube и Env pipeline используют два bind groups: group 0 (данные объекта) и group 1 (shadow data)
  const cubePipelineLayout = gpu.createPipelineLayout({
    bindGroupLayouts: [cubeBindGroupLayout, shadowDataBindGroupLayout],
  });
  const envPipelineLayout = gpu.createPipelineLayout({
    bindGroupLayouts: [envBindGroupLayout, shadowDataBindGroupLayout],
  });
  const shadowPipelineLayout = gpu.createPipelineLayout({
    bindGroupLayouts: [shadowBindGroupLayout],
  });

  // Общая конфигурация vertex buffers
  const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
      { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
      { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
      { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
    ],
  };

  // Pipeline для куба (с specular map)
  const cubePipeline = await gpu.createRenderPipelineAsync({
    layout: cubePipelineLayout,
    vertex: {
      module: gpu.createShaderModule({ code: cubeVertWGSL }),
      entryPoint: "main",
      buffers: [vertexBufferLayout],
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

  // Pipeline для окружения (пол и стены)
  const envPipeline = await gpu.createRenderPipelineAsync({
    layout: envPipelineLayout,
    vertex: {
      module: gpu.createShaderModule({ code: cubeVertWGSL }), // тот же vertex shader
      entryPoint: "main",
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: gpu.createShaderModule({ code: envFragWGSL }),
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

  // ============================================
  // Shadow Pipeline (только depth, без color)
  // ============================================
  const shadowPipeline = await gpu.createRenderPipelineAsync({
    layout: shadowPipelineLayout,
    vertex: {
      module: gpu.createShaderModule({ code: shadowVertWGSL }),
      entryPoint: "main",
      buffers: [vertexBufferLayout],
    },
    // Без fragment shader — записываем только глубину
    primitive: {
      topology: "triangle-list",
      cullMode: "none", // Рендерим все грани для корректных теней
      frontFace: "cw",
    },
    depthStencil: {
      format: "depth32float",
      depthWriteEnabled: true,
      depthCompare: "less",
      depthBias: 4,
      depthBiasSlopeScale: 2,
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
    const cubeModel = math.multiply(
      math.translation({ x: 0, y: 0.5, z: Number.parseFloat(ui.tz.value) }),
      math.multiply(rotationMat, scaleMat),
    );

    // biome-ignore format: ignore
    // Матрица модели для пола (лежит под кубом)
    // Куб с центром на y=0.5 имеет нижнюю грань на y=0, поэтому пол на y=0
    const floorModel: math.Mat4 = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, -1, 2, 1,
    ]);

    const proj = math.projection(70, canvas.width / canvas.height, 0.01, 100);
    const view = math.lookAt(camera.state.position, math.add(camera.state.position, forward), {
      x: 0,
      y: 1,
      z: 0,
    });

    uniformData.set(proj, uniformOffsets.projection);
    uniformData.set(view, uniformOffsets.view);
    // Модель будет обновляться для каждого объекта

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

    // ============================================
    // Вычисление lightViewProj для shadow mapping
    // ============================================
    // Позиция "виртуального источника" света (далеко в направлении, обратном dirVec)
    const lightDistance = 15;
    const lightPos: math.Vec3 = {
      x: -dirVec.x * lightDistance,
      y: -dirVec.y * lightDistance,
      z: -dirVec.z * lightDistance,
    };
    const lightTarget: math.Vec3 = { x: 0, y: 0, z: 0 };
    // Выбираем up вектор, который не совпадает с направлением света
    const absY = Math.abs(dirVec.y);
    const lightUp: math.Vec3 = absY > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };

    // Ортографическая проекция для направленного источника
    const shadowOrthoSize = 12;
    const lightProj = math.orthographic(
      -shadowOrthoSize,
      shadowOrthoSize,
      -shadowOrthoSize,
      shadowOrthoSize,
      0.1,
      30,
    );
    const lightView = math.lookAt(lightPos, lightTarget, lightUp);
    const lightViewProj = math.multiply(lightProj, lightView);

    // Записываем lightViewProj в отдельный буфер для shadow data
    shadowDataBuffer.set(lightViewProj, 0);
    gpu.queue.writeBuffer(shadowDataUbo, 0, shadowDataBuffer);

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

    // ============================================
    // Shadow Pass: рендеринг сцены в shadow map
    // ============================================
    // Обновляем shadow uniform для куба
    shadowUniformData.set(lightViewProj, 0); // lightViewProj
    shadowUniformData.set(cubeModel, 16); // model
    gpu.queue.writeBuffer(shadowUbo, 0, shadowUniformData);

    // Обновляем shadow uniform для пола
    shadowFloorUniformData.set(lightViewProj, 0);
    shadowFloorUniformData.set(floorModel, 16);
    gpu.queue.writeBuffer(shadowFloorUbo, 0, shadowFloorUniformData);

    const colorTex = context.getCurrentTexture();
    const viewTex = colorTex.createView();
    const encoder = gpu.createCommandEncoder();

    // Shadow pass (рендеринг в shadow map)
    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [], // Нет цветового вывода
      depthStencilAttachment: {
        view: shadowMapView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    shadowPass.setPipeline(shadowPipeline);

    // Рендерим куб в shadow map
    shadowPass.setVertexBuffer(0, cubeVbo);
    shadowPass.setIndexBuffer(cubeIbo, "uint32");
    shadowPass.setBindGroup(0, shadowCubeBindGroup);
    shadowPass.drawIndexed(cubeIndices.length);

    // Рендерим пол в shadow map
    shadowPass.setVertexBuffer(0, floorVbo);
    shadowPass.setIndexBuffer(floorIbo, "uint32");
    shadowPass.setBindGroup(0, shadowFloorBindGroup);
    shadowPass.drawIndexed(floorIndices.length);

    shadowPass.end();

    // ============================================
    // Main Pass: обычный рендеринг с тенями
    // ============================================
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

    // ============================================
    // Рендеринг пола (использует отдельный floorUbo)
    // ============================================
    // Копируем общие данные (projection, view, камера, освещение, lightViewProj) в floorUniformData
    floorUniformData.set(uniformData);
    // Устанавливаем матрицу модели пола
    floorUniformData.set(floorModel, uniformOffsets.model);
    // lightViewProj уже скопирован из uniformData
    gpu.queue.writeBuffer(floorUbo, 0, floorUniformData);

    pass.setPipeline(envPipeline);
    pass.setVertexBuffer(0, floorVbo);
    pass.setIndexBuffer(floorIbo, "uint32");
    pass.setBindGroup(0, floorBindGroup);
    pass.setBindGroup(1, shadowDataBindGroup);
    pass.drawIndexed(floorIndices.length);

    // ============================================
    // Рендеринг куба
    // ============================================
    uniformData.set(cubeModel, uniformOffsets.model);
    gpu.queue.writeBuffer(ubo, 0, uniformData);

    pass.setPipeline(cubePipeline);
    pass.setVertexBuffer(0, cubeVbo);
    pass.setIndexBuffer(cubeIbo, "uint32");
    pass.setBindGroup(0, cubeBindGroup);
    pass.setBindGroup(1, shadowDataBindGroup);
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
