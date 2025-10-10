import type { Vec3 } from "./math";
import {
	projection,
	rotationAxisY,
	rotationAxisX,
	translation,
	multiply,
} from "./math";

const canvas = document.getElementById("gfx") as HTMLCanvasElement;
const ui = {
	tz: document.getElementById("tr-z") as HTMLInputElement,
	speed: document.getElementById("speed") as HTMLInputElement,
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
		alert(
			"WebGPU не поддерживается в этом браузере. Попробуйте Chrome Canary/Edge/Safari TP.",
		);
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

	// Октаэдр: 6 вершин (вершины по осям координат)
	// biome-ignore format: ignore
	const vertices = new Float32Array([
		0,
		1,
		0, // 0: top
		1,
		0,
		0, // 1: right
		0,
		0,
		1, // 2: front
		-1,
		0,
		0, // 3: left
		0,
		0,
		-1, // 4: back
		0,
		-1,
		0, // 5: bottom
	]);
	// 8 треугольников (верхние 4 + нижние 4)
	// biome-ignore format: ignore
	const indices = new Uint32Array([
		0,
		2,
		1,
		0,
		1,
		4,
		0,
		4,
		3,
		0,
		3,
		2, // верхние грани
		5,
		1,
		2,
		5,
		4,
		1,
		5,
		3,
		4,
		5,
		2,
		3, // нижние грани
	]);

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
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: {},
			},
		],
	});
	const bindGroup = gpu.createBindGroup({
		layout: bindGroupLayout,
		entries: [{ binding: 0, resource: { buffer: ubo } }],
	});

	const pipelineLayout = gpu.createPipelineLayout({
		bindGroupLayouts: [bindGroupLayout],
	});

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
					attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
				},
			],
		},
		fragment: {
			module: gpu.createShaderModule({ code: fragWGSL }),
			entryPoint: "main",
			targets: [{ format }],
		},
		primitive: { topology: "triangle-list", cullMode: "back", frontFace: "cw" },
		depthStencil: {
			format: "depth24plus",
			depthWriteEnabled: true,
			depthCompare: "less-equal",
		},
	});

	const start = performance.now();

	function frame() {
		const now = performance.now();
		const t = (now - start) / 1000;

		const speed = parseFloat(ui.speed.value);
		const angleX = t * speed;
		const angleY = t * speed * 0.7; // немного другая скорость для интереса
		const pos: Vec3 = { x: 0, y: 0, z: parseFloat(ui.tz.value) };
		const color = hexToRgb01(ui.color.value);

		const proj = projection(70, canvas.width / canvas.height, 0.01, 100);
		const rotX = rotationAxisX(angleX);
		const rotY = rotationAxisY(angleY);
		const rot = multiply(rotX, rotY);
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
				{
					view,
					clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
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
		pass.drawIndexed(24); // 8 треугольников * 3 индекса
		pass.end();

		gpu.queue.submit([encoder.finish()]);
		requestAnimationFrame(frame);
	}

	requestAnimationFrame(frame);
}

main().catch((err) => console.error(err));
