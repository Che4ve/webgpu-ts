import type { Vec3 } from "./math";
import { projection, rotationAxisY, translation, multiply } from "./math";

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const ui = {
  tx: document.getElementById("tr-x") as HTMLInputElement,
  ty: document.getElementById("tr-y") as HTMLInputElement,
  tz: document.getElementById("tr-z") as HTMLInputElement,
  rot: document.getElementById("rot") as HTMLInputElement,
  spin: document.getElementById("spin") as HTMLInputElement,
  color: document.getElementById("color") as HTMLInputElement,
};

function hexToRgb01(hex: string): [number, number, number] {
  const v = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(v, 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return [r / 255, g / 255, b / 255];
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
  const gpu = device; // non-null after guard

  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: gpu, format, alphaMode: "opaque" });

  const depthTex = gpu.createTexture({
    size: { width: canvas.width, height: canvas.height },
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTex.createView();

  const vertices = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
  const indices = new Uint32Array([0, 1, 2, 2, 3, 0]);

  const vbo = gpu.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(vbo, 0, vertices);

  const ibo = gpu.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: false,
  });
  gpu.queue.writeBuffer(ibo, 0, indices);

  // Uniforms: 2 mat4 (128) + vec3 (12) + padding (4) = 144 bytes
  const uniformSize = 16 * 4 + 16 * 4 + 12 + 4;
  const ubo = gpu.createBuffer({
    size: uniformSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroupLayout = gpu.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
    ],
  });
  const bindGroup = gpu.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: ubo } }],
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
          arrayStride: 12,
          attributes: [
            {
              shaderLocation: 0,
              offset: 0,
              format: "float32x3",
            },
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
      cullMode: "back",
      frontFace: "cw",
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less-equal",
    },
  });

  let start = performance.now();
  let startAngle = 0;
  const spinSpeed = 700;

  function toggleSpin(e: Event) {
    if ((e.target as HTMLInputElement).checked) {
      start = performance.now();
      startAngle = parseFloat(ui.rot.value);
      console.log(startAngle);
    }
  }

  ui.spin.addEventListener("change", toggleSpin);

  function frame() {
    const now = performance.now();
    const t = (startAngle + (now - start) / spinSpeed) % (Math.PI * 2);

    const spin = ui.spin.checked;
    ui.rot.value = spin ? t.toString() : ui.rot.value;
    const rotation = spin ? t : parseFloat(ui.rot.value);

    const pos: Vec3 = {
      x: parseFloat(ui.tx.value),
      y: parseFloat(ui.ty.value),
      z: parseFloat(ui.tz.value),
    };
    const color = hexToRgb01(ui.color.value);

    const proj = projection(70, canvas.width / canvas.height, 0.01, 100);
    const rot = rotationAxisY(rotation);
    const trans = translation(pos);
    const transform = multiply(rot, trans);

    // pack uniforms
    const data = new Float32Array(uniformSize / 4);
    data.set(proj, 0);
    data.set(transform, 16);
    data.set(color, 32);
    gpu.queue.writeBuffer(ubo, 0, data);

    const colorTex = context.getCurrentTexture();
    const view = colorTex.createView();
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, loadOp: "clear", storeOp: "store" },
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
    pass.drawIndexed(6);
    pass.end();

    gpu.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => console.error(err));
