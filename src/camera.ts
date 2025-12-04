import type { Vec3 } from "./math";
import * as math from "./math";

export type CameraState = {
  position: Vec3;
  yaw: number;
  pitch: number;
};

export type CameraControllerOptions = {
  canvas: HTMLCanvasElement;
  moveSpeed: number;
  sprintScale: number;
  mouseSensitivity: number;
  defaultState: CameraState;
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

// Производная WebGPU/D3D: yaw вокруг Y, pitch вокруг X, взгляд в +Z
export function directionFromAngles(yaw: number, pitch: number): Vec3 {
  const cosPitch = Math.cos(pitch);
  return math.normalize({
    x: Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * cosPitch,
  });
}

export class CameraController {
  private readonly pressedKeys = new Set<string>();
  private readonly canvas: HTMLCanvasElement;
  private readonly mouseSensitivity: number;
  private readonly moveSpeed: number;
  private readonly sprintScale: number;
  private readonly defaultState: CameraState;

  public state: CameraState;

  constructor(options: CameraControllerOptions) {
    this.canvas = options.canvas;
    this.mouseSensitivity = options.mouseSensitivity;
    this.moveSpeed = options.moveSpeed;
    this.sprintScale = options.sprintScale;
    this.defaultState = { ...options.defaultState, position: { ...options.defaultState.position } };
    this.state = { ...options.defaultState, position: { ...options.defaultState.position } };

    this.attachEvents();
  }

  private attachEvents() {
    window.addEventListener("keydown", (event) => {
      this.pressedKeys.add(event.code);
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ControlLeft", "KeyQ", "KeyE"].includes(
          event.code,
        )
      ) {
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => this.pressedKeys.delete(event.code));

    this.canvas.addEventListener("click", () => {
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
    });

    document.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.state.yaw += event.movementX * this.mouseSensitivity;
      this.state.pitch -= event.movementY * this.mouseSensitivity;
      const limit = Math.PI / 2 - 0.05;
      this.state.pitch = clamp(this.state.pitch, -limit, limit);
    });
  }

  reset() {
    this.state = { ...this.defaultState, position: { ...this.defaultState.position } };
  }

  update(dt: number): Vec3 {
    const forward = directionFromAngles(this.state.yaw, this.state.pitch);
    const up: Vec3 = { x: 0, y: 1, z: 0 };
    const right = math.normalize(math.cross(up, forward));

    let move: Vec3 = { x: 0, y: 0, z: 0 };
    if (this.pressedKeys.has("KeyW")) move = math.add(move, forward);
    if (this.pressedKeys.has("KeyS")) move = math.sub(move, forward);
    if (this.pressedKeys.has("KeyA")) move = math.sub(move, right);
    if (this.pressedKeys.has("KeyD")) move = math.add(move, right);
    if (this.pressedKeys.has("KeyE") || this.pressedKeys.has("Space")) move = math.add(move, up);
    if (this.pressedKeys.has("KeyQ") || this.pressedKeys.has("ControlLeft")) move = math.sub(move, up);

    const len = Math.hypot(move.x, move.y, move.z);
    if (len > 0) {
      const speed = this.moveSpeed * (this.pressedKeys.has("ShiftLeft") ? this.sprintScale : 1);
      const delta = math.scaleVec(math.scaleVec(move, 1 / len), speed * dt);
      this.state = {
        ...this.state,
        position: math.add(this.state.position, delta),
      };
    }

    return forward;
  }
}
