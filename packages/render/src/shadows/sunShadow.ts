// The sun's real shadow (shadows guide). One DirectionalLight casts it; buildings, units, props and trees are in its
// shadow map (castShadow on their batches) and every toon material multiplies the shadow factor into its direct sun
// term (unitMaterial.ts toonLight), so the terrain, water, buildings, units and props all receive it.
//
// - Frustum: fitted every frame to the ground the RTS camera sees (shadowFit.ts), snapped to whole texels.
// - Filtering: three r186's PCF is a 5-tap Vogel disk with interleaved gradient noise over hardware 2x2 compares
//   (PCFSoftShadowMap was folded into it); `radius` sets the penumbra, kept near SOFTNESS meters whatever the zoom.
// - Bias: a small constant depth bias in meters plus a normal offset of a few texels, applied along each material's
//   own world normal (instanced materials rotate their normals in the shader; three's normalBias would push along the
//   unrotated mesh normal), see `receive`.
// - Distance: past maxDistance from the eye the shadow fades out, so a full zoom-out on a large map never stretches
//   the map so thin that shadows turn to mush.
import { DirectionalLight, Vector3, type Camera, type Scene, type Node } from 'three/webgpu';
import { cameraPosition, float, mix, positionWorld, shadow, smoothstep, uniform } from 'three/tsl';
import { fitShadowFrustum, type ShadowFit } from './shadowFit.js';

export type ShadowQuality = 'high' | 'low';

/** What a material needs to receive the sun's shadow (SunShadow implements it). */
export interface SunShadowTerm {
  /** 1 lit, 0 in shadow. */
  readonly factor: Node<'float'>;
  /** The lookup position for a world position and world normal: assign to receivedShadowPositionNode. */
  receivePosition(worldPos: Node<'vec3'>, worldNormal: Node<'vec3'>): Node<'vec3'>;
}

export interface ShadowQualitySettings {
  /** Shadow map edge in texels. */
  mapSize: number;
  /** No shadow beyond this distance from the eye (m); it fades out over the last FADE share. */
  maxDistance: number;
  /** Whether small props (rocks, crates, barrels) cast; trees, buildings and units always do. */
  smallProps: boolean;
}

export const SHADOW_QUALITY: Readonly<Record<ShadowQuality, ShadowQualitySettings>> = {
  high: { mapSize: 4096, maxDistance: 520, smallProps: true },
  low: { mapSize: 2048, maxDistance: 260, smallProps: false },
};

/** Penumbra width the PCF radius aims for (m), and its range in texels. */
export const SOFTNESS = 0.14;
export const RADIUS_TEXELS = [1, 3] as const;
/** Constant depth bias (m) and normal offset (texels of the fitted map, plus a floor in meters). */
export const DEPTH_BIAS_M = 0.04;
export const NORMAL_OFFSET_TEXELS = 1.5;
export const NORMAL_OFFSET_MIN = 0.02;
/** The shadow fades out over the last share of maxDistance. */
export const FADE = 0.25;

/** PCF radius in texels for a texel size (m). */
export function pcfRadius(texel: number): number {
  return Math.min(RADIUS_TEXELS[1], Math.max(RADIUS_TEXELS[0], SOFTNESS / Math.max(texel, 1e-6)));
}

export class SunShadow implements SunShadowTerm {
  readonly light: DirectionalLight;
  /** Shadow factor for materials: 1 lit, 0 in shadow (faded to 1 beyond maxDistance). */
  readonly factor: Node<'float'>;
  readonly quality: ShadowQuality;
  readonly settings: ShadowQualitySettings;
  /** The last fit (tests, debugging). */
  lastFit: ShadowFit | null = null;
  private readonly dir: Vector3;
  private readonly normalOffset = uniform(0.05);
  private readonly fadeFrom = uniform(400);
  private readonly fadeTo = uniform(520);
  private readonly corner = new Vector3();
  private readonly corners = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];

  constructor(scene: Scene, lightDir: Vector3, quality: ShadowQuality = 'high') {
    this.dir = lightDir.clone().normalize();
    this.quality = quality;
    this.settings = SHADOW_QUALITY[quality];
    const light = new DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(this.settings.mapSize, this.settings.mapSize);
    light.shadow.normalBias = 0; // per material along its own normal, see receive()
    light.shadow.radius = 2;
    light.name = 'sun';
    scene.add(light);
    scene.add(light.target);
    this.light = light;
    const raw = shadow(light) as unknown as Node<'float'>;
    const fade = smoothstep(this.fadeFrom, this.fadeTo, positionWorld.sub(cameraPosition).length());
    this.factor = mix(raw, float(1), fade);
  }

  /**
   * Where a material looks the shadow up: its world position pushed along its world normal by the normal offset.
   * Assign to the material's receivedShadowPositionNode.
   */
  receivePosition(worldPos: Node<'vec3'>, worldNormal: Node<'vec3'>): Node<'vec3'> {
    return worldPos.add(worldNormal.mul(this.normalOffset));
  }

  /**
   * Fits the shadow camera to the ground the camera sees. `groundLo`/`groundHi`: the terrain's height range.
   * Call after the camera's matrices are updated, before rendering.
   */
  update(camera: Camera, groundLo: number, groundHi: number): void {
    const eye = camera.position;
    const ndc = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    ndc.forEach(([x, y], i) => {
      this.corner.set(x, y, 1).unproject(camera);
      this.corners[i]!.copy(this.corner).sub(eye);
    });
    const max = this.settings.maxDistance;
    const fit = fitShadowFrustum({
      eye,
      corners: this.corners,
      groundLo,
      groundHi,
      maxDistance: max,
      sunDir: this.dir,
      mapSize: this.settings.mapSize,
    });
    this.lastFit = fit;
    const cam = this.light.shadow.camera;
    if (
      cam.left !== fit.left ||
      cam.right !== fit.right ||
      cam.top !== fit.top ||
      cam.bottom !== fit.bottom ||
      cam.near !== fit.near ||
      cam.far !== fit.far
    ) {
      cam.left = fit.left;
      cam.right = fit.right;
      cam.top = fit.top;
      cam.bottom = fit.bottom;
      cam.near = fit.near;
      cam.far = fit.far;
      cam.updateProjectionMatrix();
    }
    const texel = Math.max(fit.texelX, fit.texelY);
    this.light.shadow.bias = -DEPTH_BIAS_M / Math.max(1, fit.far - fit.near);
    this.light.shadow.radius = pcfRadius(texel);
    this.normalOffset.value = NORMAL_OFFSET_MIN + NORMAL_OFFSET_TEXELS * texel;
    this.fadeFrom.value = max * (1 - FADE);
    this.fadeTo.value = max;
    this.light.position.set(fit.position.x, fit.position.y, fit.position.z);
    this.light.target.position.set(0, 0, 0);
    this.light.target.updateMatrixWorld();
    this.light.updateMatrixWorld();
  }

  dispose(): void {
    this.light.shadow.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
    this.light.dispose();
  }
}
