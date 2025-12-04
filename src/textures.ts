/**
 * Модуль для программной генерации текстур в стиле Minecraft.
 * Создаёт текстуры пола (stone bricks), стены (wooden planks) и specular map (грязные пятна).
 */

/**
 * Генерирует текстуру каменных кирпичей (stone bricks) для пола.
 * @param size - размер текстуры (должен быть степенью двойки)
 * @returns ImageData с текстурой
 */
export function generateStoneBricksTexture(size: number = 64): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);

  // Базовые цвета камня (серые оттенки)
  const stoneColors = [
    [120, 120, 120],
    [130, 130, 130],
    [110, 110, 110],
    [125, 125, 125],
  ];

  // Цвет швов между кирпичами (тёмно-серый)
  const mortarColor = [80, 80, 80];

  // Размер одного кирпича
  const brickWidth = size / 4;
  const brickHeight = size / 4;
  const mortarSize = 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Определяем ряд кирпичей
      const row = Math.floor(y / brickHeight);
      // Смещение для чередования рядов
      const offset = (row % 2) * (brickWidth / 2);
      const col = Math.floor((x + offset) / brickWidth);

      // Проверяем, находимся ли мы на шве
      const localX = (x + offset) % brickWidth;
      const localY = y % brickHeight;

      const isMortar =
        localX < mortarSize ||
        localY < mortarSize ||
        localX >= brickWidth - mortarSize / 2 ||
        localY >= brickHeight - mortarSize / 2;

      if (isMortar) {
        // Шов между кирпичами
        data[idx] = mortarColor[0] + Math.random() * 10 - 5;
        data[idx + 1] = mortarColor[1] + Math.random() * 10 - 5;
        data[idx + 2] = mortarColor[2] + Math.random() * 10 - 5;
      } else {
        // Выбираем цвет кирпича на основе позиции (для детерминированности)
        const colorIdx = (row * 7 + col * 3) % stoneColors.length;
        const baseColor = stoneColors[colorIdx];

        // Добавляем небольшой шум для реалистичности
        const noise = Math.random() * 15 - 7.5;
        data[idx] = Math.max(0, Math.min(255, baseColor[0] + noise));
        data[idx + 1] = Math.max(0, Math.min(255, baseColor[1] + noise));
        data[idx + 2] = Math.max(0, Math.min(255, baseColor[2] + noise));
      }
      data[idx + 3] = 255; // Alpha
    }
  }

  return new ImageData(data, size, size);
}

/**
 * Генерирует текстуру деревянных досок (wooden planks) для стены.
 * @param size - размер текстуры (должен быть степенью двойки)
 * @returns ImageData с текстурой
 */
export function generateWoodenPlanksTexture(size: number = 64): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);

  // Базовые цвета дерева (коричневые оттенки)
  const woodColors = [
    [139, 90, 43],
    [160, 105, 55],
    [120, 75, 35],
    [150, 95, 50],
  ];

  // Цвет щелей между досками
  const gapColor = [60, 40, 20];

  // Ширина одной доски
  const plankWidth = size / 4;
  const gapSize = 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Определяем, к какой доске относится пиксель
      const plankIdx = Math.floor(x / plankWidth);
      const localX = x % plankWidth;

      // Проверяем, находимся ли мы на щели между досками
      const isGap = localX < gapSize || localX >= plankWidth - gapSize;

      if (isGap) {
        data[idx] = gapColor[0];
        data[idx + 1] = gapColor[1];
        data[idx + 2] = gapColor[2];
      } else {
        // Базовый цвет доски
        const baseColor = woodColors[plankIdx % woodColors.length];

        // Создаём эффект древесных волокон
        const grainNoise = Math.sin(y * 0.5 + plankIdx * 10) * 8;
        const randomNoise = Math.random() * 10 - 5;

        data[idx] = Math.max(0, Math.min(255, baseColor[0] + grainNoise + randomNoise));
        data[idx + 1] = Math.max(0, Math.min(255, baseColor[1] + grainNoise + randomNoise));
        data[idx + 2] = Math.max(0, Math.min(255, baseColor[2] + grainNoise + randomNoise));
      }
      data[idx + 3] = 255; // Alpha
    }
  }

  return new ImageData(data, size, size);
}

/**
 * Генерирует specular map с пятнами грязи.
 * Белые области = блестящие, тёмные области = матовые (грязь).
 * @param size - размер текстуры (должен быть степенью двойки)
 * @returns ImageData с текстурой
 */
export function generateDirtSpecularMap(size: number = 64): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);

  // Сначала заполняем белым (полное отражение)
  for (let i = 0; i < size * size * 4; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  // Генерируем случайные пятна грязи
  const numSpots = 15 + Math.floor(Math.random() * 10);
  const seededRandom = createSeededRandom(42); // Фиксированный seed для воспроизводимости

  for (let spot = 0; spot < numSpots; spot++) {
    const centerX = Math.floor(seededRandom() * size);
    const centerY = Math.floor(seededRandom() * size);
    const radius = 3 + Math.floor(seededRandom() * 8);
    const intensity = 0.3 + seededRandom() * 0.5; // Насколько тёмное пятно

    // Рисуем пятно с плавными краями
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = (centerX + dx + size) % size;
        const y = (centerY + dy + size) % size;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
          const idx = (y * size + x) * 4;
          // Плавное затухание к краям пятна
          const falloff = 1 - dist / radius;
          const darkness = intensity * falloff * falloff;

          // Уменьшаем яркость (делаем грязнее)
          const currentValue = data[idx];
          const newValue = Math.max(50, currentValue * (1 - darkness));

          data[idx] = newValue;
          data[idx + 1] = newValue;
          data[idx + 2] = newValue;
        }
      }
    }
  }

  return new ImageData(data, size, size);
}

/**
 * Создаёт генератор псевдослучайных чисел с заданным seed.
 * Используется для воспроизводимой генерации текстур.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Создаёт GPUTexture из ImageData.
 * @param device - GPUDevice
 * @param imageData - ImageData для загрузки
 * @param generateMipmaps - генерировать ли mipmaps
 * @returns GPUTexture
 */
export function createTextureFromImageData(
  device: GPUDevice,
  imageData: ImageData,
  generateMipmaps: boolean = false,
): GPUTexture {
  const size = imageData.width;
  const mipLevelCount = generateMipmaps ? Math.floor(Math.log2(size)) + 1 : 1;

  const texture = device.createTexture({
    size: { width: size, height: size },
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
    mipLevelCount,
  });

  device.queue.writeTexture(
    { texture, mipLevel: 0 },
    imageData.data,
    { bytesPerRow: size * 4 },
    { width: size, height: size },
  );

  return texture;
}

/**
 * Генерирует mipmaps для текстуры используя render passes.
 * @param device - GPUDevice
 * @param texture - текстура с выделенными mip levels
 */
export function generateMipmaps(device: GPUDevice, texture: GPUTexture): void {
  const mipLevelCount = texture.mipLevelCount;
  if (mipLevelCount <= 1) return;

  // Шейдер для генерации mipmaps
  const mipmapShaderModule = device.createShaderModule({
    code: `
      @group(0) @binding(0) var srcTexture: texture_2d<f32>;
      @group(0) @binding(1) var srcSampler: sampler;

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
      }

      @vertex
      fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var pos = array<vec2<f32>, 6>(
          vec2<f32>(-1.0, -1.0),
          vec2<f32>( 1.0, -1.0),
          vec2<f32>(-1.0,  1.0),
          vec2<f32>(-1.0,  1.0),
          vec2<f32>( 1.0, -1.0),
          vec2<f32>( 1.0,  1.0),
        );
        var uv = array<vec2<f32>, 6>(
          vec2<f32>(0.0, 1.0),
          vec2<f32>(1.0, 1.0),
          vec2<f32>(0.0, 0.0),
          vec2<f32>(0.0, 0.0),
          vec2<f32>(1.0, 1.0),
          vec2<f32>(1.0, 0.0),
        );
        var output: VertexOutput;
        output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
        output.uv = uv[vertexIndex];
        return output;
      }

      @fragment
      fn fragmentMain(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        return textureSample(srcTexture, srcSampler, uv);
      }
    `,
  });

  const sampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: {
      module: mipmapShaderModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: mipmapShaderModule,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });

  const encoder = device.createCommandEncoder();

  let srcWidth = texture.width;
  let srcHeight = texture.height;

  for (let level = 1; level < mipLevelCount; level++) {
    const dstWidth = Math.max(1, srcWidth >> 1);
    const dstHeight = Math.max(1, srcHeight >> 1);

    const srcView = texture.createView({
      baseMipLevel: level - 1,
      mipLevelCount: 1,
    });

    const dstView = texture.createView({
      baseMipLevel: level,
      mipLevelCount: 1,
    });

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: srcView },
        { binding: 1, resource: sampler },
      ],
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: dstView,
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();

    srcWidth = dstWidth;
    srcHeight = dstHeight;
  }

  device.queue.submit([encoder.finish()]);
}
