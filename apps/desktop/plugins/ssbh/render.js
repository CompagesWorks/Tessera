const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 view;
uniform mat4 projection;
out vec3 vNormal;
out vec2 vUv;
void main() {
  vNormal = mat3(view) * normal;
  vUv = uv;
  gl_Position = projection * view * vec4(position, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 vNormal;
in vec2 vUv;
uniform sampler2D color;
out vec4 outColor;
void main() {
  vec4 base = texture(color, vUv);
  float light = 0.35 + 0.65 * abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)));
  outColor = vec4(base.rgb * light, 1.0);
}`;

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

function orbitView(yaw, pitch, distance, target) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = [cy, 0, -sy];
  const y = [-sy * sp, cp, -cy * sp];
  const z = [sy * cp, sp, cy * cp];
  const eye = target.map((t, k) => t + z[k] * distance);
  const dot = (a) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1];
}

function createViewer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) throw new Error('webgl2');
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  const at = (name) => gl.getAttribLocation(program, name);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));

  let draws = [];
  let camera = { yaw: 0.6, pitch: 0.25, distance: 30, target: [0, 0, 0], radius: 10 };
  let frame = 0;

  const buffer = (target, data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };
  const attribute = (name, data, size) => {
    const location = at(name);
    if (location < 0) return;
    if (!data) return gl.disableVertexAttribArray(location);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl.ARRAY_BUFFER, data));
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  function render() {
    frame = 0;
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniform('view'), false, orbitView(camera.yaw, camera.pitch, camera.distance, camera.target));
    gl.uniformMatrix4fv(uniform('projection'), false, perspective(0.8, width / height, camera.radius / 100, camera.distance + camera.radius * 4));
    for (const draw of draws) {
      if (!draw.visible) continue;
      gl.bindVertexArray(draw.vao);
      gl.bindTexture(gl.TEXTURE_2D, draw.texture ?? white);
      gl.drawElements(gl.TRIANGLES, draw.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  function setObjects(objects, box) {
    for (const draw of draws) gl.deleteVertexArray(draw.vao);
    draws = objects.map((object) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      attribute('position', object.positions, 3);
      attribute('normal', object.normals, 3);
      attribute('uv', object.uvs, 2);
      buffer(gl.ELEMENT_ARRAY_BUFFER, object.indices);
      gl.bindVertexArray(null);
      return { vao, count: object.indices.length, visible: object.visible !== false, texture: null };
    });
    fit(box);
  }

  function fit(box) {
    camera = { ...camera, yaw: 0.6, pitch: 0.25, target: box.center, radius: box.radius, distance: box.radius * 2.4 };
    redraw();
  }

  const uploaded = new WeakMap();
  function setTexture(index, image) {
    if (image && !uploaded.has(image)) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      uploaded.set(image, texture);
    }
    for (const i of index) draws[i].texture = image ? uploaded.get(image) : null;
    redraw();
  }

  function setVisible(index, visible) {
    draws[index].visible = visible;
    redraw();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, pan: event.button !== 0 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    Object.assign(drag, { x: event.clientX, y: event.clientY });
    if (drag.pan) {
      const view = orbitView(camera.yaw, camera.pitch, camera.distance, camera.target);
      const scale = camera.distance / canvas.clientHeight;
      camera.target = camera.target.map((t, k) => t - view[k * 4] * dx * scale + view[k * 4 + 1] * dy * scale);
    } else {
      camera.yaw -= dx * 0.01;
      camera.pitch = Math.max(-1.55, Math.min(1.55, camera.pitch + dy * 0.01));
    }
    redraw();
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.distance = Math.max(camera.radius * 0.05, camera.distance * Math.exp(event.deltaY * 0.001));
    redraw();
  }, { passive: false });
  new ResizeObserver(redraw).observe(canvas);

  return { setObjects, setTexture, setVisible, fit };
}
