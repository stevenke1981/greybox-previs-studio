import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * Screen-space "ink" outline for the clean previs look: renders scene normals + depth to an
 * offscreen target and darkens pixels where depth jumps (silhouettes) or normals bend (creases).
 * Works for skinned meshes because it uses the built-in MeshNormalMaterial as override.
 */
export class EdgeOutlinePass extends Pass {
  camera: THREE.Camera;
  /** line width in pixels */
  thickness = 1;
  private rt: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;

  constructor(private scene: THREE.Scene, camera: THREE.Camera, private hidden: () => THREE.Object3D[], w = 16, h = 16) {
    super();
    this.camera = camera;
    this.rt = new THREE.WebGLRenderTarget(w, h, { depthTexture: new THREE.DepthTexture(w, h), type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tNormal: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        resolution: { value: new THREE.Vector2(w, h) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        lineColor: { value: new THREE.Color(0x0c0d0f) },
        thickness: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 resolution; uniform float cameraNear; uniform float cameraFar; uniform vec3 lineColor; uniform float thickness;
        varying vec2 vUv;
        float lin(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
        void main() {
          vec2 px = thickness / resolution;
          float d0 = lin(vUv);
          vec3 n0 = texture2D(tNormal, vUv).xyz;
          float dd = 0.0; float nd = 0.0;
          vec2 o[4]; o[0] = vec2(px.x, 0.0); o[1] = vec2(-px.x, 0.0); o[2] = vec2(0.0, px.y); o[3] = vec2(0.0, -px.y);
          for (int i = 0; i < 4; i++) {
            dd = max(dd, abs(lin(vUv + o[i]) - d0));
            nd = max(nd, distance(texture2D(tNormal, vUv + o[i]).xyz, n0));
          }
          float de = smoothstep(0.02, 0.05, dd / max(d0, 1e-3));
          float ne = smoothstep(0.35, 0.7, nd);
          float e = max(de, ne);
          vec4 c = texture2D(tDiffuse, vUv);
          gl_FragColor = vec4(mix(c.rgb, lineColor, e * 0.9), c.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }

  setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
    this.mat.uniforms.resolution.value.set(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const cam = this.camera as THREE.PerspectiveCamera;
    const hidden = this.hidden();
    const vis = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const bg = this.scene.background;
    const shadows = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    this.scene.background = null;
    this.scene.overrideMaterial = this.normalMat;
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, cam);
    renderer.setClearColor(clear, alpha);
    this.scene.overrideMaterial = null;
    this.scene.background = bg;
    renderer.shadowMap.enabled = shadows;
    hidden.forEach((o, i) => (o.visible = vis[i]));

    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    this.mat.uniforms.cameraNear.value = cam.near;
    this.mat.uniforms.cameraFar.value = cam.far;
    this.mat.uniforms.thickness.value = this.thickness;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}
