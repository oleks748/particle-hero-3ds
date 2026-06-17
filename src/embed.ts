import * as THREE from "three";
import { gsap } from "gsap";
import { vertexShader, fragmentShader } from "./shaders";
import { ModelLoader } from "./utils/ModelLoader";

type ShapeKey = "server" | "wifi" | "coin" | "head";

const SETTINGS = {
  particleCount: 5000,
  particleSize: 5.0,
  animationSpeed: 0.5,
  morphDuration: 2.5,
  autoMorphDuration: 5000,
  initialExplodeDuration: 500,
  autoRotate: true,
  color: new THREE.Color(0x0d6fe8),
  interactionRadius: 8.0,
  interactionStrength: 10.0,
};

const MODEL_SCALES: Record<ShapeKey, number> = {
  server: 1.05,
  wifi: 1.6,
  coin: 1.2,
  head: 1.3,
};

const MODEL_FILES: Record<ShapeKey, string> = {
  server: "Server.obj",
  wifi: "Wifi.obj",
  coin: "Coin.obj",
  head: "Head.obj",
};

const MODEL_BASE_URL = getModelBaseUrl();

function getModelBaseUrl() {
  const scriptUrl = new URL(import.meta.url);
  scriptUrl.search = "";
  scriptUrl.hash = "";

  if (scriptUrl.pathname.includes("/assets/")) {
    scriptUrl.pathname = scriptUrl.pathname.replace(/\/assets\/[^/]+$/, "/models/");
  } else {
    scriptUrl.pathname = "/models/";
  }

  return scriptUrl.toString();
}

class ParticleHero {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly modelLoader = new ModelLoader();
  private readonly models: Record<string, Float32Array> = {};
  private particles: THREE.Points | null = null;
  private currentShape: ShapeKey | "explode" = "explode";
  private isTransitioning = false;
  private lastMorphTime = 0;
  private modelsReady = false;
  private mouse = new THREE.Vector2(-100, -100);
  private mouseWorld = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.root.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearAlpha(0);

    this.setupParticles();
    this.setupEvents();
    this.setExplodeInstantly();
    this.animate();
    this.init();
  }

  private async init() {
    await this.loadInitialModel();
    this.modelsReady = true;
    window.setTimeout(() => {
      if (this.currentShape === "explode") {
        this.morphTo("server");
        this.lastMorphTime = performance.now();
      }
    }, SETTINGS.initialExplodeDuration);
    this.loadRemainingModels();
  }

  private setupParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(SETTINGS.particleCount * 3);

    for (let i = 0; i < SETTINGS.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 500;
    }

    const randoms = new Float32Array(SETTINGS.particleCount);
    for (let i = 0; i < SETTINGS.particleCount; i++) {
      randoms[i] = Math.random();
    }

    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMouse: { value: new THREE.Vector3() },
        uRadius: { value: SETTINGS.interactionRadius },
        uStrength: { value: SETTINGS.interactionStrength },
        uColor: { value: SETTINGS.color },
        uSize: { value: this.getResponsiveParticleSize() },
        uOpacity: { value: 1.0 },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  private async loadInitialModel() {
    const points = await this.loadModel("server");
    if (points) this.models.server = points;
  }

  private async loadRemainingModels() {
    const entries = await Promise.all(
      (["wifi", "coin", "head"] as ShapeKey[]).map(async (shape) => {
        const points = await this.loadModel(shape);
        return [shape, points] as const;
      })
    );

    entries.forEach(([shape, points]) => {
      if (points) this.models[shape] = points;
    });
  }

  private loadModel(shape: ShapeKey) {
    return this.modelLoader.load(
      `${MODEL_BASE_URL}${MODEL_FILES[shape]}`,
      SETTINGS.particleCount,
      undefined,
      MODEL_SCALES[shape]
    );
  }

  private morphTo(shape: ShapeKey | "explode") {
    if (this.isTransitioning && shape !== "explode") return;
    if (!this.particles) return;

    const targetPositions =
      shape === "explode" ? this.getExplodePositions() : this.models[shape];
    if (!targetPositions) return;

    this.isTransitioning = true;
    const currentPositions = this.particles.geometry.attributes.position
      .array as Float32Array;

    gsap.to(currentPositions, {
      duration: SETTINGS.morphDuration / SETTINGS.animationSpeed,
      endArray: targetPositions as any,
      ease: "expo.inOut",
      onUpdate: () => {
        if (this.particles) {
          this.particles.geometry.attributes.position.needsUpdate = true;
        }
      },
      onComplete: () => {
        this.isTransitioning = false;
        this.currentShape = shape;
      },
    });
  }

  private setExplodeInstantly() {
    if (!this.particles) return;
    const currentPositions = this.particles.geometry.attributes.position
      .array as Float32Array;
    currentPositions.set(this.getExplodePositions());
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.currentShape = "explode";
    this.lastMorphTime = performance.now();
  }

  private getExplodePositions() {
    const positions = new Float32Array(SETTINGS.particleCount * 3);
    for (let i = 0; i < SETTINGS.particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 500;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 500;
    }
    return positions;
  }

  private setupEvents() {
    window.addEventListener("resize", () => this.handleResize());

    const updateMouse = (clientX: number, clientY: number) => {
      const rect = this.root.getBoundingClientRect();
      this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    window.addEventListener("mousemove", (event) => {
      updateMouse(event.clientX, event.clientY);
    });

    window.addEventListener(
      "touchmove",
      (event) => {
        if (event.touches.length > 0) {
          updateMouse(event.touches[0].clientX, event.touches[0].clientY);
        }
      },
      { passive: true }
    );

    const resetMouse = () => this.mouse.set(-100, -100);
    window.addEventListener("mouseleave", resetMouse);
    window.addEventListener("touchend", resetMouse);

    this.handleResize();
  }

  private handleResize() {
    const width = Math.max(this.root.clientWidth, 1);
    const height = Math.max(this.root.clientHeight, 1);

    this.camera.aspect = width / height;
    this.updateCameraPosition();
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(this.getRenderPixelRatio());
    this.updateParticleSize();
  }

  private getRenderPixelRatio() {
    return Math.min(window.devicePixelRatio, 2);
  }

  private getResponsiveParticleSize(size = SETTINGS.particleSize) {
    return size * this.getRenderPixelRatio();
  }

  private updateParticleSize() {
    if (
      this.particles &&
      this.particles.material instanceof THREE.ShaderMaterial
    ) {
      this.particles.material.uniforms.uSize.value =
        this.getResponsiveParticleSize();
    }
  }

  private updateCameraPosition() {
    const aspect = this.camera.aspect;
    const fov = this.camera.fov;
    const targetDim = 25;
    const fovRad = (fov * Math.PI) / 180;
    const dist =
      aspect >= 1
        ? targetDim / (2 * Math.tan(fovRad / 2))
        : targetDim / (aspect * 2 * Math.tan(fovRad / 2));

    const finalDist = Math.max(dist, 44);
    this.camera.position.set(0, 12, finalDist);
    this.camera.lookAt(0, 0, 0);
  }

  private handleAutoMorph() {
    if (!this.modelsReady) return;
    if (this.isTransitioning) return;

    const now = performance.now();
    const waitDuration =
      this.currentShape === "explode"
        ? SETTINGS.initialExplodeDuration
        : SETTINGS.autoMorphDuration;

    if (now - this.lastMorphTime <= waitDuration) return;

    const morphKeys = (Object.keys(MODEL_FILES) as ShapeKey[]).filter(
      (shape) => this.models[shape]
    );
    if (morphKeys.length === 0) return;

    const currentIndex = morphKeys.indexOf(this.currentShape as ShapeKey);
    const nextIndex = (currentIndex + 1) % morphKeys.length;
    this.morphTo(morphKeys[nextIndex]);
    this.lastMorphTime = now;
  }

  private animate() {
    requestAnimationFrame(() => this.animate());

    if (SETTINGS.autoRotate && this.particles) {
      this.particles.rotation.y += 0.005 * SETTINGS.animationSpeed;
    }

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.raycaster.ray.intersectPlane(plane, this.mouseWorld);

    if (
      this.particles &&
      this.particles.material instanceof THREE.ShaderMaterial
    ) {
      this.particles.material.uniforms.uMouse.value.copy(this.mouseWorld);
      this.particles.material.uniforms.uTime.value = performance.now();
    }

    this.handleAutoMorph();
    this.renderer.render(this.scene, this.camera);
  }
}

function ensureRoot() {
  const existingRoot = document.getElementById("particle-hero");
  if (existingRoot) return existingRoot;

  const root = document.createElement("div");
  root.id = "particle-hero";
  root.style.position = "absolute";
  root.style.inset = "0";
  root.style.width = "100%";
  root.style.height = "100%";
  root.style.overflow = "hidden";
  root.style.pointerEvents = "none";
  root.style.zIndex = "0";
  document.body.prepend(root);
  return root;
}

function startParticleHero() {
  new ParticleHero(ensureRoot());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startParticleHero, { once: true });
} else {
  startParticleHero();
}
