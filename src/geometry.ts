export type MeshData = {
  vertices: Float32Array;
  indices: Uint32Array;
};

// Cube with position + normal + uv (stride 32 bytes)
export function createCube(size = 1): MeshData {
  const h = size / 2;
  const hx = h;
  const hy = h;
  const hz = h;

  // biome-ignore format: ignore
  const vertices = new Float32Array([
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

  // biome-ignore format: ignore
  const indices = new Uint32Array([
    0, 1, 2,  2, 3, 0,      // front
    4, 5, 6,  6, 7, 4,      // back
    8, 9,10, 10,11, 8,      // left
   12,13,14, 14,15,12,      // right
   16,17,18, 18,19,16,      // top
   20,21,22, 22,23,20,      // bottom
  ]);

  return { vertices, indices };
}

export function createSphere(radius: number, segments: number = 16): MeshData {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let lat = 0; lat <= segments; lat++) {
    const theta = (lat * Math.PI) / segments;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= segments; lon++) {
      const phi = (lon * 2 * Math.PI) / segments;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = radius * cosPhi * sinTheta;
      const y = radius * cosTheta;
      const z = radius * sinPhi * sinTheta;

      vertices.push(x, y, z);
    }
  }

  for (let lat = 0; lat < segments; lat++) {
    for (let lon = 0; lon < segments; lon++) {
      const first = lat * (segments + 1) + lon;
      const second = first + segments + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
