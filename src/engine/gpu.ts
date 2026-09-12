import { vertex, fragment } from "./shaders";
export type Target = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  float: boolean;
};
export class GPU {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  float: boolean;
  black: WebGLTexture;
  uniforms = new Map<string, WebGLUniformLocation>();
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    if (!gl)
      throw new Error(
        "This instrument needs WebGL2. Try a current browser with hardware acceleration enabled.",
      );
    this.gl = gl;
    this.float = !!gl.getExtension("EXT_color_buffer_float");
    const make = (type: number, code: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, code);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(`Optical shader: ${error}`);
      }
      return s;
    };
    const vs = make(gl.VERTEX_SHADER, vertex),
      fs = make(gl.FRAGMENT_SHADER, fragment),
      program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(
        gl.getProgramInfoLog(program) || "Shader linking failed.",
      );
    this.program = program;
    gl.useProgram(program);
    for (
      let i = 0;
      i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      i++
    ) {
      const info = gl.getActiveUniform(program, i)!;
      this.uniforms.set(info.name, gl.getUniformLocation(program, info.name)!);
    }
    this.black = this.texture(1, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    ["uA", "uB", "uC", "uPrev"].forEach((n, i) =>
      gl.uniform1i(this.uniforms.get(n)!, i),
    );
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }
  texture(width: number, height: number, float = false) {
    const g = this.gl,
      t = g.createTexture()!;
    g.bindTexture(g.TEXTURE_2D, t);
    g.texStorage2D(g.TEXTURE_2D, 1, float ? g.RGBA16F : g.RGBA8, width, height);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
  }
  target(width: number, height: number, float = this.float): Target {
    const g = this.gl,
      texture = this.texture(width, height, float),
      framebuffer = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, framebuffer);
    g.framebufferTexture2D(
      g.FRAMEBUFFER,
      g.COLOR_ATTACHMENT0,
      g.TEXTURE_2D,
      texture,
      0,
    );
    if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) {
      g.deleteTexture(texture);
      g.deleteFramebuffer(framebuffer);
      throw new Error(
        "Could not allocate optical frame memory. Reduce resolution.",
      );
    }
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height, float };
  }
  destroy(t: Target) {
    this.gl.deleteFramebuffer(t.framebuffer);
    this.gl.deleteTexture(t.texture);
  }
  clear(t: Target) {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, t.framebuffer);
    g.clearColor(0, 0, 0, 1);
    g.clear(g.COLOR_BUFFER_BIT);
  }
  draw(
    target: Target | null,
    kind: number,
    textures: (WebGLTexture | undefined)[],
    values: Record<string, number> = {},
  ) {
    const g = this.gl;
    g.useProgram(this.program);
    g.bindFramebuffer(g.FRAMEBUFFER, target?.framebuffer ?? null);
    g.viewport(
      0,
      0,
      target?.width ?? this.canvas.width,
      target?.height ?? this.canvas.height,
    );
    for (let i = 0; i < 4; i++) {
      g.activeTexture(g.TEXTURE0 + i);
      g.bindTexture(g.TEXTURE_2D, textures[i] ?? this.black);
    }
    g.uniform1i(this.uniforms.get("uKind")!, kind);
    g.uniform2f(
      this.uniforms.get("uResolution")!,
      target?.width ?? this.canvas.width,
      target?.height ?? this.canvas.height,
    );
    for (const [k, v] of Object.entries(values)) {
      const loc = this.uniforms.get(k);
      if (loc) g.uniform1f(loc, v);
    }
    g.drawArrays(g.TRIANGLES, 0, 3);
  }
  copy(from: Target, to: Target) {
    const g = this.gl;
    g.bindFramebuffer(g.READ_FRAMEBUFFER, from.framebuffer);
    g.bindFramebuffer(g.DRAW_FRAMEBUFFER, to.framebuffer);
    g.blitFramebuffer(
      0,
      0,
      from.width,
      from.height,
      0,
      0,
      to.width,
      to.height,
      g.COLOR_BUFFER_BIT,
      g.LINEAR,
    );
  }
  read(t: Target): Float32Array | Uint8Array {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, t.framebuffer);
    const data = t.float
      ? new Float32Array(t.width * t.height * 4)
      : new Uint8Array(t.width * t.height * 4);
    g.readPixels(
      0,
      0,
      t.width,
      t.height,
      g.RGBA,
      t.float ? g.FLOAT : g.UNSIGNED_BYTE,
      data,
    );
    return data;
  }
  upload(t: Target, data: Float32Array | Uint8Array) {
    const g = this.gl;
    g.bindTexture(g.TEXTURE_2D, t.texture);
    g.texSubImage2D(
      g.TEXTURE_2D,
      0,
      0,
      0,
      t.width,
      t.height,
      g.RGBA,
      data instanceof Float32Array ? g.FLOAT : g.UNSIGNED_BYTE,
      data,
    );
  }
  dispose() {
    this.gl.deleteTexture(this.black);
    this.gl.deleteProgram(this.program);
  }
}
