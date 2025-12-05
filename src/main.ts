/**
 * ============================================================================
 * MAIN.TS - Главный файл приложения WebGPU с Shadow Mapping
 * ============================================================================
 *
 * Этот файл содержит:
 * 1) Инициализацию WebGPU
 * 2) Создание ресурсов (текстуры, буферы, pipelines)
 * 3) Render loop с двумя проходами:
 *    - Shadow Pass: рендеринг в shadow map
 *    - Main Pass: обычный рендеринг с тенями
 *
 * АРХИТЕКТУРА SHADOW MAPPING:
 *
 *   ┌─────────────────┐
 *   │   Shadow Pass   │  ← Рендерим сцену "глазами света"
 *   │  (depth only)   │     Записываем глубину в shadow map
 *   └────────┬────────┘
 *            │
 *            ▼
 *   ┌─────────────────┐
 *   │   Shadow Map    │  ← 2D текстура с глубиной
 *   │ (depth texture) │     Формат: depth32float
 *   └────────┬────────┘
 *            │
 *            ▼
 *   ┌─────────────────┐
 *   │   Main Pass     │  ← Обычный рендеринг
 *   │  (with shadows) │     Сравниваем глубину с shadow map
 *   └─────────────────┘
 */

import { CameraController, directionFromAngles } from "./camera";
import { hexToRgb01 } from "./color";
import { createCube, createPlane, createSphere } from "./geometry";
import { createPointLights, createSpotLight, updatePointLights, updateSpotLight } from "./lights";
import type { LightControls } from "./lights";
import * as math from "./math";
import lightFragWGSL from "./shaders/light_visualizer.frag.wgsl?raw";
import lightVertWGSL from "./shaders/light_visualizer.vert.wgsl?raw";
import cubeFragWGSL from "./shaders/shader.frag.wgsl?raw";
import cubeVertWGSL from "./shaders/shader.vert.wgsl?raw";
import envFragWGSL from "./shaders/environment.frag.wgsl?raw";
import shadowVertWGSL from "./shaders/shadow.vert.wgsl?raw"; // Шейдер для shadow pass
import { createUIManager } from "./ui";

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const maxPointLights = 1; // Один точечный источник

/**
 * Размер shadow map в пикселях.
 * Больше = качественнее тени, но больше памяти и медленнее.
 * Типичные значения: 1024, 2048, 4096
 */
const SHADOW_MAP_SIZE = 2048;

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
const spotLight = createSpotLight(); // Прожектор

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

  // ============================================================================
  // SHADOW MAP - текстура глубины для теней
  // ============================================================================
  //
  // Shadow Map - это текстура, в которую мы рендерим глубину сцены
  // с точки зрения источника света.
  //
  // Потом, при обычном рендеринге, мы сравниваем глубину каждого пикселя
  // с глубиной в shadow map. Если пиксель дальше - он в тени!
  //
  const shadowMapTexture = gpu.createTexture({
    size: { width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE },

    // depth32float - формат с 32-битной глубиной (высокая точность)
    // Можно использовать depth24plus для экономии памяти
    format: "depth32float",

    // RENDER_ATTACHMENT - можно рендерить в эту текстуру
    // TEXTURE_BINDING - можно читать в шейдере (для сравнения глубины)
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const shadowMapView = shadowMapTexture.createView();

  // ============================================================================
  // COMPARISON SAMPLER - сэмплер со сравнением
  // ============================================================================
  //
  // Обычный sampler возвращает значение текстуры.
  // Comparison sampler сравнивает значение с референсом и возвращает 0 или 1.
  //
  // compare: "less" означает:
  //   - Если reference < texel: вернуть 1.0 (пиксель освещён)
  //   - Если reference >= texel: вернуть 0.0 (пиксель в тени)
  //
  // В шейдере используется функция textureSampleCompare()
  //
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

  // ============================================================================
  // SHADOW DATA UNIFORM - матрица lightViewProj для main pass
  // ============================================================================
  //
  // Этот буфер передаётся в vertex shader основного прохода (shader.vert.wgsl).
  // Содержит только матрицу lightViewProj (16 floats = 64 bytes).
  //
  // lightViewProj используется для преобразования позиции вершины
  // в пространство источника света (для сравнения с shadow map).
  //
  const shadowDataSize = 16; // mat4x4 = 16 floats
  const shadowDataBuffer = new Float32Array(shadowDataSize);
  const shadowDataUbo = gpu.createBuffer({
    size: shadowDataBuffer.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // ============================================================================
  // SHADOW PASS UNIFORMS - данные для shadow pass
  // ============================================================================
  //
  // Эти буферы используются в shadow.vert.wgsl для рендеринга в shadow map.
  // Содержат:
  //   - lightViewProj (16 floats) - матрица проекции+вида света
  //   - model (16 floats) - матрица модели объекта
  //
  // Нужны отдельные буферы для каждого объекта, т.к. у них разные model матрицы.
  //
  const shadowUniformSize = 32; // 2 × mat4x4 = 32 floats
  const shadowUniformData = new Float32Array(shadowUniformSize);
  const shadowUbo = gpu.createBuffer({
    size: shadowUniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Отдельный буфер для shadow pass пола (у пола своя model матрица)
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

  // ============================================================================
  // SPOTLIGHT BUFFER - буфер для прожектора
  // ============================================================================
  // ВАЖНО: В WGSL vec3 требует выравнивания 16 байт!
  // Структура в памяти (с учётом выравнивания):
  //   [0-2]: position (vec3)     offset 0,  align 16
  //   [3]: intensity (f32)       offset 12
  //   [4-6]: direction (vec3)    offset 16, align 16
  //   [7]: innerCosAngle (f32)   offset 28
  //   [8-10]: color (vec3)       offset 32, align 16
  //   [11]: outerCosAngle (f32)  offset 44
  //   [12]: enabled (f32)        offset 48
  //   [13-15]: padding           offset 52
  //   [16-18]: _pad (vec3)       offset 64, align 16  ← требует выравнивания!
  //   [19]: padding              offset 76
  // Итого: 80 bytes = 20 floats
  const spotLightData = new Float32Array(20);
  const spotLightBuffer = gpu.createBuffer({
    size: spotLightData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: {} }, // spotlight
    ],
  });

  // Layout для окружения (пол) - group 0
  const envBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {} }, // spotlight
    ],
  });

  // ============================================================================
  // SHADOW DATA BIND GROUP LAYOUT (group 1 в main pass)
  // ============================================================================
  //
  // Этот layout описывает ресурсы для работы с тенями в основном рендеринге:
  //   binding 0: lightViewProj матрица (для vertex shader)
  //   binding 1: shadow map текстура (для fragment shader)
  //   binding 2: comparison sampler (для fragment shader)
  //
  // sampleType: "depth" - указывает, что это depth текстура
  // type: "comparison" - указывает, что sampler будет сравнивать значения
  //
  const shadowDataBindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
    ],
  });

  // ============================================================================
  // SHADOW PASS BIND GROUP LAYOUT (group 0 в shadow pass)
  // ============================================================================
  //
  // Простой layout для shadow pass - только uniform buffer с матрицами.
  // Fragment shader не используется, поэтому только VERTEX visibility.
  //
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
      { binding: 6, resource: { buffer: spotLightBuffer } },
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
      { binding: 4, resource: { buffer: spotLightBuffer } },
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

  // ============================================================================
  // SHADOW PIPELINE - пайплайн для рендеринга в shadow map
  // ============================================================================
  //
  // Этот pipeline используется для ПЕРВОГО прохода - записи глубины в shadow map.
  //
  // КЛЮЧЕВЫЕ ОСОБЕННОСТИ:
  // 1) НЕТ fragment shader - нам не нужен цвет, только глубина
  // 2) depthBias - смещение глубины для предотвращения артефактов
  // 3) cullMode: "none" - рендерим ВСЕ грани (иначе не будет теней от некоторых)
  //
  const shadowPipeline = await gpu.createRenderPipelineAsync({
    layout: shadowPipelineLayout,

    vertex: {
      module: gpu.createShaderModule({ code: shadowVertWGSL }),
      entryPoint: "main",
      buffers: [vertexBufferLayout], // Тот же формат вершин, что и в main pass
    },

    // БЕЗ fragment shader!
    // WebGPU автоматически записывает gl_Position.z в depth buffer.
    // Нам не нужен цвет - только глубина.

    primitive: {
      topology: "triangle-list",

      // cullMode: "none" - НЕ отбрасываем грани!
      // Если использовать "front" или "back", некоторые грани не попадут
      // в shadow map и от них не будет теней.
      cullMode: "none",

      frontFace: "cw", // Clockwise = передняя грань
    },

    depthStencil: {
      format: "depth32float", // Формат shadow map
      depthWriteEnabled: true, // Записываем глубину
      depthCompare: "less", // Ближние объекты перезаписывают дальние

      // DEPTH BIAS - смещение глубины для борьбы с "shadow acne"
      //
      // Shadow acne - это артефакт, когда поверхность "затеняет сама себя"
      // из-за ограниченной точности. Выглядит как полоски.
      //
      // depthBias добавляет небольшое смещение к глубине при записи,
      // чтобы поверхность не попадала в собственную тень.
      depthBias: 4,
      depthBiasSlopeScale: 2, // Дополнительное смещение для наклонных поверхностей
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

    // ============================================================================
    // ВЫЧИСЛЕНИЕ lightViewProj ДЛЯ SHADOW MAPPING
    // ============================================================================
    //
    // lightViewProj - это матрица, которая преобразует координаты
    // из мирового пространства в пространство "глазами источника света".
    //
    // lightViewProj = lightProjection × lightView
    //
    // Эта матрица используется дважды:
    // 1) В shadow pass - для рендеринга глубины в shadow map
    // 2) В main pass - для сравнения глубины пикселя с shadow map
    //

    // ШАГ 1: Вычисляем позицию "виртуального источника света"
    //
    // Направленный свет не имеет позиции (лучи параллельны, как от солнца).
    // Но для построения матрицы вида нам нужна точка.
    //
    // Мы размещаем "камеру света" далеко в направлении, откуда светит свет.
    // dirVec - направление лучей света, поэтому позиция = -dirVec * distance
    //
    const lightDistance = 15; // Расстояние до "позиции" света
    const lightPos: math.Vec3 = {
      x: -dirVec.x * lightDistance,
      y: -dirVec.y * lightDistance,
      z: -dirVec.z * lightDistance,
    };

    // Свет смотрит на центр сцены
    const lightTarget: math.Vec3 = { x: 0, y: 0, z: 0 };

    // ШАГ 2: Выбираем вектор "вверх" для lookAt
    //
    // ПРОБЛЕМА: Если свет направлен вертикально (dirVec ≈ (0, 1, 0)),
    // то up = (0, 1, 0) совпадёт с направлением взгляда и lookAt сломается.
    //
    // РЕШЕНИЕ: Если свет почти вертикальный, используем Z как "вверх".
    //
    const absY = Math.abs(dirVec.y);
    const lightUp: math.Vec3 = absY > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };

    // ШАГ 3: Создаём ортографическую проекцию
    //
    // Для направленного света используем ОРТОГРАФИЧЕСКУЮ проекцию,
    // потому что лучи параллельны (нет перспективы).
    //
    // shadowOrthoSize определяет размер области, которая попадёт в shadow map.
    // Слишком маленькая - тени обрежутся. Слишком большая - потеря качества.
    //
    const shadowOrthoSize = 12; // Размер области видимости света
    const lightProj = math.orthographic(
      -shadowOrthoSize, // left
      shadowOrthoSize, // right
      -shadowOrthoSize, // bottom
      shadowOrthoSize, // top
      0.1, // near
      30, // far
    );

    // ШАГ 4: Создаём матрицу вида для света
    const lightView = math.lookAt(lightPos, lightTarget, lightUp);

    // ШАГ 5: Комбинируем в одну матрицу
    // lightViewProj = projection × view
    const lightViewProj = math.multiply(lightProj, lightView);

    // ШАГ 6: Записываем в uniform буфер для передачи в шейдеры
    shadowDataBuffer.set(lightViewProj, 0);
    gpu.queue.writeBuffer(shadowDataUbo, 0, shadowDataBuffer);

    const albedoColor = hexToRgb01(ui.matAlbedo.value);
    const specularColor = hexToRgb01(ui.matSpecular.value);
    uniformData.set(albedoColor, uniformOffsets.materialAlbedo);
    uniformData[uniformOffsets.materialAlbedo + 3] = Number.parseFloat(ui.matShininess.value);
    uniformData.set(specularColor, uniformOffsets.materialSpecular);

    // ========================================
    // ОБНОВЛЕНИЕ ИСТОЧНИКОВ СВЕТА
    // ========================================

    // Объект с UI-элементами для источников света
    const lightControls: LightControls = {
      pointEnabled: ui.pointEnabled,
      points: ui.points,
      spot: ui.spot,
      spotEnabled: ui.spotEnabled,
    };

    // Обновляем точечные источники
    const activePointLights = updatePointLights(now, lightControls, pointLights, pointLightData);
    uniformData[uniformOffsets.pointCount] = activePointLights;
    gpu.queue.writeBuffer(pointLightBuffer, 0, pointLightData);

    // Обновляем прожектор
    updateSpotLight(lightControls, spotLight, spotLightData);
    gpu.queue.writeBuffer(spotLightBuffer, 0, spotLightData);

    gpu.queue.writeBuffer(ubo, 0, uniformData);

    // ============================================================================
    // SHADOW PASS: рендеринг сцены в shadow map
    // ============================================================================
    //
    // Это ПЕРВЫЙ проход рендеринга.
    // Мы рисуем сцену "глазами источника света" и записываем только глубину.
    //
    // Результат - shadow map, который показывает:
    // "Какие точки видит источник света?"
    // Точки, которые он НЕ видит - находятся в тени!
    //

    // Обновляем uniform буферы для shadow pass
    // Каждый объект имеет свою матрицу model, поэтому буферы отдельные

    // Куб: lightViewProj (offset 0) + model (offset 16)
    shadowUniformData.set(lightViewProj, 0);
    shadowUniformData.set(cubeModel, 16);
    gpu.queue.writeBuffer(shadowUbo, 0, shadowUniformData);

    // Пол: lightViewProj (offset 0) + model (offset 16)
    shadowFloorUniformData.set(lightViewProj, 0);
    shadowFloorUniformData.set(floorModel, 16);
    gpu.queue.writeBuffer(shadowFloorUbo, 0, shadowFloorUniformData);

    const colorTex = context.getCurrentTexture();
    const viewTex = colorTex.createView();
    const encoder = gpu.createCommandEncoder();

    // Начинаем shadow pass
    //
    // ВАЖНО: colorAttachments: [] - нет цветового вывода!
    // Мы записываем ТОЛЬКО глубину в depthStencilAttachment.
    //
    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [], // НЕТ цвета - только глубина!
      depthStencilAttachment: {
        view: shadowMapView, // Рендерим в shadow map
        depthClearValue: 1.0, // Очищаем глубину до 1.0 (максимально далеко)
        depthLoadOp: "clear", // Очистить перед рендерингом
        depthStoreOp: "store", // Сохранить результат
      },
    });

    // Устанавливаем shadow pipeline (без fragment shader)
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

    // ============================================================================
    // MAIN PASS: обычный рендеринг с тенями
    // ============================================================================
    //
    // Это ВТОРОЙ проход рендеринга.
    // Теперь мы рисуем сцену "глазами камеры" и используем shadow map
    // для определения, какие пиксели находятся в тени.
    //
    // В fragment shader для каждого пикселя:
    // 1) Преобразуем позицию в пространство света (используя lightViewProj)
    // 2) Сравниваем глубину пикселя с глубиной в shadow map
    // 3) Если пиксель дальше - он в тени, уменьшаем освещение
    //
    const pass = encoder.beginRenderPass({
      // Цветовой вывод - на экран
      colorAttachments: [
        {
          view: viewTex, // Текстура экрана
          clearValue: { r: 0.05, g: 0.05, b: 0.06, a: 1 }, // Цвет очистки (тёмный)
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      // Depth buffer для z-сортировки (чтобы ближние объекты перекрывали дальние)
      depthStencilAttachment: {
        view: depthView, // Depth текстура камеры (не shadow map!)
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    // ============================================
    // Рендеринг пола
    // ============================================
    //
    // ВАЖНО: Используем ДВА bind group:
    //   group 0: данные объекта (uniform buffer, текстуры)
    //   group 1: данные теней (lightViewProj, shadow map, sampler)
    //
    floorUniformData.set(uniformData);
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
