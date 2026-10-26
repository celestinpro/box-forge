// three.js preview: parts printed in yellow PLA, laid out on a green cutting mat.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PLA = 0xf2c230;
const EDGE = 0x5a4300;
const MAT = 0x2f5d50;
const GRID_MINOR = 0x3f6f61;
const GRID_MAJOR = 0x6f9a8b;
const GAP = 12; // mm between parts in the preview

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(MAT);
    container.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x29453c, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-120, -200, 300);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(200, 150, 120);
    this.scene.add(rim);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => this.requestRender());

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.grid = null;
    this.lastSpan = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (this.controls.update() || this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  requestRender() {
    this.dirty = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Replace the displayed parts with fresh meshes from the worker. */
  show(meshes) {
    for (const child of [...this.group.children]) {
      child.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.group.remove(child);
    }

    // Lay parts out left to right with a gap, centred on the origin.
    const widths = meshes.map((m) => m.bounds[1][0] - m.bounds[0][0]);
    const total = widths.reduce((a, b) => a + b, 0) + GAP * (meshes.length - 1);
    let cursor = -total / 2;
    let maxY = 0;
    let maxZ = 0;

    meshes.forEach((m, i) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geom.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
      geom.setIndex(new THREE.BufferAttribute(m.triangles, 1));
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({ color: PLA, roughness: 0.55, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
      );
      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute("position", new THREE.BufferAttribute(m.edges, 3));
      const edges = new THREE.LineSegments(edgeGeom, new THREE.LineBasicMaterial({ color: EDGE, transparent: true, opacity: 0.55 }));

      const part = new THREE.Group();
      part.add(mesh, edges);
      part.position.x = cursor - m.bounds[0][0];
      part.position.y = -(m.bounds[0][1] + m.bounds[1][1]) / 2;
      part.name = m.name;
      this.group.add(part);
      cursor += widths[i] + GAP;
      maxY = Math.max(maxY, m.bounds[1][1] - m.bounds[0][1]);
      maxZ = Math.max(maxZ, m.bounds[1][2]);
    });

    this.updateGrid(Math.max(total, maxY));
    const span = Math.max(total, maxY, maxZ);
    // Only reframe when the size changes a lot, so the user's view sticks.
    if (!this.lastSpan || span > this.lastSpan * 1.35 || span < this.lastSpan / 1.35) this.frame(span, maxZ);
    this.lastSpan = span;
    this.requestRender();
  }

  updateGrid(size) {
    const extent = Math.ceil((size * 2.2) / 50) * 50 + 100;
    if (this.grid?.userData.extent === extent) return;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.traverse((o) => o.geometry?.dispose());
    }
    // 10 mm squares with a heavier line every 50 mm, like a cutting mat.
    const grid = new THREE.Group();
    const minor = new THREE.GridHelper(extent, extent / 10, GRID_MINOR, GRID_MINOR);
    const major = new THREE.GridHelper(extent, extent / 50, GRID_MAJOR, GRID_MAJOR);
    for (const g of [minor, major]) {
      g.rotation.x = Math.PI / 2;
      grid.add(g);
    }
    major.position.z = 0.02;
    grid.position.z = -0.05;
    grid.userData.extent = extent;
    this.grid = grid;
    this.scene.add(grid);
  }

  frame(span, height) {
    const d = span * 1.5 + 30;
    this.camera.position.set(-d * 0.35, -d * 0.85, d * 0.62);
    this.controls.target.set(0, 0, height * 0.3);
    this.camera.near = Math.max(0.5, d / 200);
    this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  resetView() {
    this.lastSpan = 0;
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    this.frame(Math.max(size.x, size.y, size.z), size.z);
    this.requestRender();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
