import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";

export class ModelLoader {
  private loader: OBJLoader;

  constructor() {
    this.loader = new OBJLoader();
  }

  public async load(
    path: string,
    particleCount: number,
    onProgress?: (percent: number) => void,
    scaleMultiplier: number = 1
  ): Promise<Float32Array | null> {
    const cacheBustedPath = `${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`;

    return new Promise((resolve) => {
      this.loader.load(
        cacheBustedPath,
        (obj) => {
          const meshes: THREE.Mesh[] = [];
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              meshes.push(child as THREE.Mesh);
            }
          });

          if (meshes.length > 0) {
            const geometry = this.mergeMeshGeometries(meshes);
            this.normalizeGeometry(geometry);
            geometry.scale(scaleMultiplier, scaleMultiplier, scaleMultiplier);
            const points = this.samplePointsOnSurface(geometry, particleCount);
            resolve(points);
          } else {
            resolve(null);
          }
        },
        (xhr) => {
          if (xhr.total > 0 && onProgress) {
            onProgress((xhr.loaded / xhr.total) * 100);
          }
        },
        (error) => {
          console.error("Error loading model:", error);
          resolve(null);
        }
      );
    });
  }

  private mergeMeshGeometries(meshes: THREE.Mesh[]): THREE.BufferGeometry {
    const positions: number[] = [];

    meshes.forEach((mesh) => {
      mesh.updateMatrixWorld(true);
      const position = mesh.geometry.getAttribute("position");
      const vertex = new THREE.Vector3();

      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i);
        mesh.localToWorld(vertex);
        positions.push(vertex.x, vertex.y, vertex.z);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    return geometry;
  }

  private normalizeGeometry(geometry: THREE.BufferGeometry, targetSize: number = 20) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale = targetSize / maxDim;
      geometry.scale(scale, scale, scale);
    }
    geometry.center();
  }

  private samplePointsOnSurface(geometry: THREE.BufferGeometry, count: number): Float32Array {
    const mesh = new THREE.Mesh(geometry);
    const sampler = new MeshSurfaceSampler(mesh).build();
    const sampledPositions = new Float32Array(count * 3);
    const tempPosition = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      sampler.sample(tempPosition);
      sampledPositions[i * 3] = tempPosition.x;
      sampledPositions[i * 3 + 1] = tempPosition.y;
      sampledPositions[i * 3 + 2] = tempPosition.z;
    }

    return sampledPositions;
  }
}
