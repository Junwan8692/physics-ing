/*
 * Vendored from https://github.com/grmchn/purupuru-maker
 * Copyright (c) 2026 Puru-Puru Maker contributors
 * Licensed under the MIT License. See licenses/PURUPURU_MAKER_MIT.txt
 * Modifications: import paths only (plus removal of duplicate type
 * declarations in motion/types.ts). No logic changes.
 */
import { boundsOfPositions } from "../core/math";
import { MAXIMUM_AUTOMATIC_FRAME_TRAVEL } from "../core/rigidFrame";
import type { MeshData, Point } from "../core/types";

type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

export interface SceneRendererOptions {
  alpha?: boolean;
  background?: readonly [number, number, number, number];
  padding?: number;
  blurredBackdrop?: boolean;
}

export interface RenderSceneOptions {
  frameOffset?: Point;
  background?: readonly [number, number, number, number];
  recordArea?: { x: number; y: number; width: number; height: number };
  foregroundScale?: number;
}

export type EdgeRepresentativeColors = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];

const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
uniform vec2 u_scale;
uniform vec2 u_translation;
uniform float u_content_scale;
out vec2 v_uv;
void main() {
  vec2 clip = (a_position * u_content_scale + u_translation) * u_scale;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform vec2 u_blur_radius_uv;
uniform float u_blur_mix;
uniform float u_gradient_mix;
uniform vec4 u_edge_top;
uniform vec4 u_edge_right;
uniform vec4 u_edge_bottom;
uniform vec4 u_edge_left;
in vec2 v_uv;
out vec4 out_color;
vec2 nearest_edge_uv(vec2 uv) {
  float nearest = uv.x;
  vec2 result = vec2(0.002, uv.y);
  if (1.0 - uv.x < nearest) {
    nearest = 1.0 - uv.x;
    result = vec2(0.998, uv.y);
  }
  if (uv.y < nearest) {
    nearest = uv.y;
    result = vec2(uv.x, 0.002);
  }
  if (1.0 - uv.y < nearest) {
    result = vec2(uv.x, 0.998);
  }
  return clamp(result, vec2(0.002), vec2(0.998));
}
vec2 nearest_edge_tangent(vec2 uv) {
  float horizontal_edge = min(uv.x, 1.0 - uv.x);
  float vertical_edge = min(uv.y, 1.0 - uv.y);
  return horizontal_edge < vertical_edge ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
}
void main() {
  float backdrop = max(u_blur_mix, u_gradient_mix);
  vec2 sample_uv = mix(v_uv, nearest_edge_uv(v_uv), backdrop);
  vec2 blur_offset = nearest_edge_tangent(v_uv) * u_blur_radius_uv;
  vec4 sharp = texture(u_image, sample_uv);
  vec4 blurred = sharp * 0.24;
  blurred += texture(u_image, sample_uv + blur_offset) * 0.10;
  blurred += texture(u_image, sample_uv - blur_offset) * 0.10;
  blurred += texture(u_image, sample_uv + blur_offset * 0.72) * 0.12;
  blurred += texture(u_image, sample_uv - blur_offset * 0.72) * 0.12;
  blurred += texture(u_image, sample_uv + blur_offset * 0.38) * 0.16;
  blurred += texture(u_image, sample_uv - blur_offset * 0.38) * 0.16;
  vec4 horizontal = mix(u_edge_left, u_edge_right, smoothstep(0.0, 1.0, v_uv.x));
  vec4 vertical = mix(u_edge_top, u_edge_bottom, smoothstep(0.0, 1.0, v_uv.y));
  vec4 edge_gradient = mix(horizontal, vertical, 0.5);
  vec3 bright_blur = mix(blurred.rgb, vec3(1.0), 0.36);
  vec4 hybrid = mix(edge_gradient, vec4(bright_blur, 1.0), 0.80);
  out_color = mix(sharp, hybrid, backdrop);
}`;

export const BACKDROP_PARALLAX = 0.5;
export const BACKDROP_BLUR_GUARD_PIXELS = 52;

export function calculateBackdropFrameOffset(frameOffset: Point | undefined, parallax = BACKDROP_PARALLAX): Point {
  const ratio = Number.isFinite(parallax) ? Math.max(0, Math.min(1, parallax)) : 0;
  return {
    x: (Number.isFinite(frameOffset?.x) ? frameOffset?.x ?? 0 : 0) * ratio,
    y: (Number.isFinite(frameOffset?.y) ? frameOffset?.y ?? 0 : 0) * ratio,
  };
}

const DEFAULT_EDGE_COLORS: EdgeRepresentativeColors = [
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
];

function median(values: number[]): number {
  if (values.length === 0) return 255;
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] ?? 255;
  return ((values[middle - 1] ?? 255) + (values[middle] ?? 255)) / 2;
}

export function calculateEdgeRepresentativeColors(image: ImageData): EdgeRepresentativeColors {
  if (image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) {
    throw new RangeError("ImageData must contain a non-empty RGBA image.");
  }
  const stripX = Math.max(1, Math.round(image.width * 0.1));
  const stripY = Math.max(1, Math.round(image.height * 0.1));
  const ranges = [
    { x0: 0, y0: 0, x1: image.width, y1: stripY },
    { x0: image.width - stripX, y0: 0, x1: image.width, y1: image.height },
    { x0: 0, y0: image.height - stripY, x1: image.width, y1: image.height },
    { x0: 0, y0: 0, x1: stripX, y1: image.height },
  ] as const;
  return ranges.map((range) => {
    const channels = [[], [], []] as [number[], number[], number[]];
    for (let y = range.y0; y < range.y1; y += 1) {
      for (let x = range.x0; x < range.x1; x += 1) {
        const offset = (y * image.width + x) * 4;
        if ((image.data[offset + 3] ?? 0) < 16) continue;
        channels[0].push(image.data[offset] ?? 255);
        channels[1].push(image.data[offset + 1] ?? 255);
        channels[2].push(image.data[offset + 2] ?? 255);
      }
    }
    return [median(channels[0]) / 255, median(channels[1]) / 255, median(channels[2]) / 255, 1] as const;
  }) as unknown as EdgeRepresentativeColors;
}

function sampleEdgeRepresentativeColors(source: TexImageSource): EdgeRepresentativeColors {
  try {
    const size = 32;
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
    const context = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) return DEFAULT_EDGE_COLORS;
    context.clearRect(0, 0, size, size);
    context.drawImage(source as CanvasImageSource, 0, 0, size, size);
    return calculateEdgeRepresentativeColors(context.getImageData(0, 0, size, size));
  } catch {
    return DEFAULT_EDGE_COLORS;
  }
}

export function calculateBlurredBackdropScale(
  outputShortSide: number,
  maximumFrameTravel = MAXIMUM_AUTOMATIC_FRAME_TRAVEL,
  parallax = BACKDROP_PARALLAX,
  blurGuardPixels = BACKDROP_BLUR_GUARD_PIXELS,
): number {
  if (!(outputShortSide > 0) || !Number.isFinite(outputShortSide)) {
    throw new RangeError("Output short side must be positive and finite.");
  }
  const translationGuard = Math.max(0, maximumFrameTravel) * Math.max(0, parallax);
  const blurGuard = Math.max(0, blurGuardPixels) / outputShortSide;
  return 1 + 2 * (translationGuard + blurGuard);
}

export interface FrameTravelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function calculateFixedSafeCropScale(
  bounds: FrameTravelBounds,
  contentWidth: number,
  contentHeight: number,
): number {
  if (!(contentWidth > 0) || !(contentHeight > 0) || ![
    contentWidth,
    contentHeight,
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
  ].every(Number.isFinite)) {
    throw new RangeError("Crop bounds and content dimensions must be finite and positive.");
  }
  const horizontalMargin = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) / contentWidth;
  const verticalMargin = Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY)) / contentHeight;
  const margin = Math.min(0.49, Math.max(0, horizontalMargin, verticalMargin));
  return 1 / (1 - margin * 2);
}

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to allocate a WebGL shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to allocate a WebGL program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown program link error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export class SceneRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly positionBuffer: WebGLBuffer;
  private readonly uvBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly scaleLocation: WebGLUniformLocation;
  private readonly translationLocation: WebGLUniformLocation;
  private readonly contentScaleLocation: WebGLUniformLocation;
  private readonly blurRadiusLocation: WebGLUniformLocation;
  private readonly blurMixLocation: WebGLUniformLocation;
  private readonly gradientMixLocation: WebGLUniformLocation;
  private readonly edgeColorLocations: readonly WebGLUniformLocation[];
  private readonly defaultBackground: readonly [number, number, number, number];
  private readonly padding: number;
  private readonly blurredBackdrop: boolean;
  private mesh: MeshData | undefined;
  private positionScratch: Float32Array | undefined;
  private edgeColors: EdgeRepresentativeColors = DEFAULT_EDGE_COLORS;
  private disposed = false;

  public constructor(private readonly canvas: RenderCanvas, options: SceneRendererOptions = {}) {
    const gl = canvas.getContext("webgl2", {
      alpha: options.alpha ?? false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available.");
    this.gl = gl;
    this.program = createProgram(gl);
    const vertexArray = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const scaleLocation = gl.getUniformLocation(this.program, "u_scale");
    const translationLocation = gl.getUniformLocation(this.program, "u_translation");
    const contentScaleLocation = gl.getUniformLocation(this.program, "u_content_scale");
    const blurRadiusLocation = gl.getUniformLocation(this.program, "u_blur_radius_uv");
    const blurMixLocation = gl.getUniformLocation(this.program, "u_blur_mix");
    const gradientMixLocation = gl.getUniformLocation(this.program, "u_gradient_mix");
    const edgeColorLocations = ["u_edge_top", "u_edge_right", "u_edge_bottom", "u_edge_left"].map((name) => gl.getUniformLocation(this.program, name));
    if (!vertexArray || !positionBuffer || !uvBuffer || !indexBuffer || !texture || !scaleLocation || !translationLocation || !contentScaleLocation || !blurRadiusLocation || !blurMixLocation || !gradientMixLocation || edgeColorLocations.some((location) => !location)) {
      throw new Error("Unable to allocate WebGL2 scene resources.");
    }
    this.vertexArray = vertexArray;
    this.positionBuffer = positionBuffer;
    this.uvBuffer = uvBuffer;
    this.indexBuffer = indexBuffer;
    this.texture = texture;
    this.scaleLocation = scaleLocation;
    this.translationLocation = translationLocation;
    this.contentScaleLocation = contentScaleLocation;
    this.blurRadiusLocation = blurRadiusLocation;
    this.blurMixLocation = blurMixLocation;
    this.gradientMixLocation = gradientMixLocation;
    this.edgeColorLocations = edgeColorLocations as WebGLUniformLocation[];
    this.defaultBackground = options.background ?? [1, 1, 1, 1];
    this.padding = Math.min(0.4, Math.max(0, options.padding ?? 0.04));
    this.blurredBackdrop = options.blurredBackdrop ?? false;
  }

  public setMesh(mesh: MeshData): void {
    this.assertUsable();
    this.mesh = mesh;
    this.positionScratch = new Float32Array(mesh.positions.length);
    const gl = this.gl;
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  public setImage(source: TexImageSource): void {
    this.assertUsable();
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.edgeColors = sampleEdgeRepresentativeColors(source);
  }

  public render(options: RenderSceneOptions = {}): void {
    this.assertUsable();
    const mesh = this.mesh;
    if (!mesh) throw new Error("A mesh must be assigned before rendering.");
    const gl = this.gl;
    const background = options.background ?? this.defaultBackground;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(background[0], background[1], background[2], background[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    const positionScratch = this.positionScratch;
    if (!positionScratch) throw new Error("The renderer position buffer is not initialized.");
    const bounds = boundsOfPositions(mesh.restPositions);
    const fullWidth = bounds.maxX - bounds.minX;
    const fullHeight = bounds.maxY - bounds.minY;
    const area = options.recordArea ?? { x: 0, y: 0, width: 1, height: 1 };
    const areaX = Math.max(0, Math.min(1, area.x));
    const areaY = Math.max(0, Math.min(1, area.y));
    const areaWidth = Math.max(0.001, Math.min(1 - areaX, area.width));
    const areaHeight = Math.max(0.001, Math.min(1 - areaY, area.height));
    const contentWidth = fullWidth * areaWidth;
    const contentHeight = fullHeight * areaHeight;
    const centerX = bounds.minX + (areaX + areaWidth / 2) * fullWidth;
    const centerY = bounds.minY + (areaY + areaHeight / 2) * fullHeight;
    const foregroundScale = Number.isFinite(options.foregroundScale) ? Math.max(1, options.foregroundScale ?? 1) : 1;
    const available = 1 - this.padding * 2;
    const canvasAspect = this.canvas.width / Math.max(1, this.canvas.height);
    const scaleY = available * Math.min(2 / contentHeight, 2 * canvasAspect / contentWidth);
    const scaleX = scaleY / canvasAspect;
    gl.uniform2f(this.scaleLocation, scaleX, scaleY);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const backdropScale = calculateBlurredBackdropScale(Math.min(this.canvas.width, this.canvas.height));
    gl.uniform2f(
      this.blurRadiusLocation,
      BACKDROP_BLUR_GUARD_PIXELS / (Math.max(1, this.canvas.width) * backdropScale),
      BACKDROP_BLUR_GUARD_PIXELS / (Math.max(1, this.canvas.height) * backdropScale),
    );
    for (let edge = 0; edge < this.edgeColors.length; edge += 1) {
      const color = this.edgeColors[edge] ?? DEFAULT_EDGE_COLORS[edge];
      const location = this.edgeColorLocations[edge];
      if (color && location) gl.uniform4f(location, color[0], color[1], color[2], color[3]);
    }

    if (this.blurredBackdrop) {
      const backdropOffset = calculateBackdropFrameOffset(options.frameOffset);
      for (let index = 0; index < mesh.restPositions.length; index += 1) {
        positionScratch[index] = mesh.restPositions[index] ?? 0;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positionScratch);
      const backdropContentScale = backdropScale / available;
      gl.uniform1f(this.contentScaleLocation, backdropContentScale);
      gl.uniform1f(this.blurMixLocation, 1);
      gl.uniform1f(this.gradientMixLocation, 1);
      gl.uniform2f(
        this.translationLocation,
        backdropOffset.x - centerX * backdropContentScale,
        backdropOffset.y - centerY * backdropContentScale,
      );
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
    }

    for (let index = 0; index < mesh.positions.length; index += 1) {
      positionScratch[index] = mesh.positions[index] ?? 0;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positionScratch);
    gl.uniform1f(this.contentScaleLocation, foregroundScale);
    gl.uniform1f(this.blurMixLocation, 0);
    gl.uniform1f(this.gradientMixLocation, 0);
    gl.uniform2f(
      this.translationLocation,
      (options.frameOffset?.x ?? 0) - centerX * foregroundScale,
      (options.frameOffset?.y ?? 0) - centerY * foregroundScale,
    );
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  public isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteVertexArray(this.vertexArray);
    gl.deleteProgram(this.program);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("SceneRenderer has been disposed.");
    if (this.gl.isContextLost()) throw new Error("The WebGL2 context is lost.");
  }
}
