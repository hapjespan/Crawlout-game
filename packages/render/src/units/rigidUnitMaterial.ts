// Toon material of the rigid units (robots): no skinning, the pose of every instance comes from rigidMotion.ts.
// Same look as buildings and props (propMaterial.ts): 3-step toon ramp, sky fill, rimlight, team color through the team
// mask in the vertex color alpha, diffuse from a texture array (attribute uvl, layer < 0 reads white). The surface
// recipe is the buildings' (look/): a flat part carries its surface kind in uvl.x (metal, rubber, lens, ...), gets the
// kind's wasteland tint and the procedural weathering (in model space, so the pattern turns with the robot), then
// the shared world grade, and a toon specular from the kind's roughness and metalness.
//
// Per instance (InstanceBatch, 8 vertex buffers with position, normal, color and uvl, WebGPU's limit):
//   iPos   x, y, z meters (y already holds the lift), yaw radians around +Y (0 keeps +Z)
//   iScale uniform scale x, y, z (pulse; 1 otherwise), team palette slot
//   iTint  rgb multiplier on the albedo (the per-asset albedo gain); w unused
//   iMotion  pitch (rad, nose down positive), roll (rad), dim 0..1 (power down), glow 0..1 (team-colored pulse)
// The pose turns the model around `pivotY` (0 at the feet for a walker, the middle for a drone), scale first, then
// pitch, then roll, then yaw.
import { MeshBasicNodeMaterial, type Node, type Texture, type Vector3 } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cos,
  dot,
  float,
  int,
  max,
  mix,
  normalize,
  select,
  sin,
  texture,
  uniform,
  uniformArray,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { TEAM_GRADE, worldGrade } from '../look/grade.js';
import { surfaceIndex, type SurfaceKind } from '../look/surfaces.js';
import {
  createSurfaceTable,
  fitAlbedoNode,
  metalDiffuse,
  toonSpecular,
  weather,
} from '../look/surfaceShading.js';
import { teamPalette } from '../palette.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { rimLight, skyFill, teamAlbedo, toonLight } from './unitMaterial.js';

export interface RigidUnitMaterialOptions {
  lightDir: Vector3;
  name: string;
  /** Diffuse texture array, sampled with the uvl attribute (u, v, layer; layer < 0 reads white). */
  layers?: Texture | null;
  /** Mean linear luminance per layer of `layers` (textureArray.ts): the team pivot of a textured team material. */
  layerLuma?: readonly number[];
  /** Height of the point the pose turns the model around (meters in model space). */
  pivotY: number;
  /** Ignored: the shared world grade (look/grade.ts) applies to every material. Kept for the callers that pass it. */
  grade?: number;
  /** Surface kind per layer of `layers` (by material name, surfaceKindOfMaterial). Default wood. */
  layerKinds?: readonly SurfaceKind[];
  /** The sun's shadow (shadows/sunShadow.ts), received by the robots (they cast it too, see rigidUnitLayer.ts). */
  shadow?: SunShadowTerm | null;
}

/** How much a fully dimmed unit keeps of its color (a powered-down robot goes nearly black). */
export const DIM_KEEP = 0.15;
/** Glow strength: team color added at glow 1 on the team-masked parts (and a floor everywhere else). */
export const GLOW_GAIN = 0.55;
export const GLOW_FLOOR = 0.25;
/** The rimlight relative to the units (a robot has hard edges; same share as the props). */
const RIM_SHARE = 0.85;

const LUMA = [0.2126, 0.7152, 0.0722] as const;

export function createRigidUnitMaterial(opts: RigidUnitMaterialOptions): MeshBasicNodeMaterial {
  const iPos = attribute('iPos', 'vec4');
  const iScale = attribute('iScale', 'vec4');
  const iTint = attribute('iTint', 'vec4');
  const iMotion = attribute('iMotion', 'vec4');
  const position = attribute('position', 'vec3');
  const normal = attribute('normal', 'vec3');
  const color = attribute('color', 'vec4');
  const light = uniform(opts.lightDir.clone().normalize());

  // Pose around the pivot: Rx(pitch) then Rz(roll) (nose down is a positive pitch), then yaw.
  const pivot = vec3(0, opts.pivotY, 0);
  const cp = cos(iMotion.x);
  const sp = sin(iMotion.x);
  const cr = cos(iMotion.y);
  const sr = sin(iMotion.y);
  const pose = (v: Node<'vec3'>): Node<'vec3'> => {
    const rx = vec3(v.x, v.y.mul(cp).sub(v.z.mul(sp)), v.y.mul(sp).add(v.z.mul(cp)));
    return vec3(rx.x.mul(cr).sub(rx.y.mul(sr)), rx.x.mul(sr).add(rx.y.mul(cr)), rx.z);
  };
  const ca = cos(iPos.w);
  const sa = sin(iPos.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> =>
    vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  const local = pose(position.sub(pivot).mul(iScale.xyz)).add(pivot);
  const worldPos = rotY(local).add(iPos.xyz);
  const worldNrm = vertexStage(rotY(pose(normal)));
  const vWorldPos = vertexStage(worldPos);

  const palette = uniformArray<'vec3'>(teamPalette(), 'vec3');
  const team = palette.element(int(iScale.w));
  let base: Node<'vec3'> = color.xyz.mul(iTint.xyz);
  // Team pivot (unitMaterial.ts teamAlbedo): the untextured base times the mean of its texture layer.
  let pivotLuma: Node<'float'> = dot(base, vec3(...LUMA));
  let flat: Node<'float'> = float(1);
  let kindIndex: Node<'int'> = int(surfaceIndex('paintedMetal'));
  if (opts.layers) {
    const uvl = attribute('uvl', 'vec3');
    const layer = int(max(uvl.z, 0).add(0.5));
    const plain = uvl.z.lessThan(-0.5);
    const texel = select(plain, vec4(1, 1, 1, 1), texture(opts.layers, uvl.xy).depth(layer));
    base = base.mul(texel.xyz);
    flat = select(plain, float(1), float(0));
    if (opts.layerLuma && opts.layerLuma.length > 0) {
      const means = uniformArray<'float'>([...opts.layerLuma], 'float');
      pivotLuma = pivotLuma.mul(select(plain, float(1), means.element(layer)));
    }
    const kinds = opts.layerKinds?.map(surfaceIndex) ?? [];
    kindIndex = int(uvl.x.add(0.5)); // a flat fragment carries its kind in u (buildingGeometry.ts)
    if (kinds.length > 0)
      kindIndex = select(
        plain,
        kindIndex,
        int(uniformArray<'float'>(kinds, 'float').element(layer).add(0.5)),
      );
  }
  const surface = createSurfaceTable().at(kindIndex);
  const rawLuma = max(dot(base, vec3(...LUMA)), 1e-4);
  base = mix(base, surface.tint, flat.mul(surface.flatBlend));
  base = fitAlbedoNode(base, surface.albedoMin, surface.albedoMax);
  pivotLuma = pivotLuma.mul(max(dot(base, vec3(...LUMA)), 1e-4).div(rawLuma));
  const N = normalize(worldNrm);
  base = weather({
    albedo: base,
    pos: position, // model space: the pattern turns and tilts with the robot
    normal: N,
    height: position.y.mul(iScale.y),
    surface,
    amount: mix(float(0.3), float(1), flat),
    team: color.w,
  });
  const graded = worldGrade(
    teamAlbedo(base, team, color.w, max(pivotLuma, 1e-3)),
    mix(float(1), float(TEAM_GRADE), color.w),
  );
  const albedo = metalDiffuse(graded, surface).mul(float(1).sub(iMotion.z.mul(1 - DIM_KEEP)));
  const shade = toonLight(N, light, opts.shadow?.factor);
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = rimLight(N, V, light, albedo).mul(RIM_SHARE);
  const spec = toonSpecular(N, V, light, surface, albedo, opts.shadow?.factor ?? 1).mul(
    float(1).sub(iMotion.z),
  );
  const glow = team.mul(iMotion.w.mul(GLOW_GAIN)).mul(max(color.w, GLOW_FLOOR));

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const out = vec4(albedo.mul(skyFill(N).add(shade)).add(rim).add(spec).add(glow), 1);
  // A shadow caster must not sample its own shadow map in the shadow pass (three reads colorNode.a there).
  if (opts.shadow) {
    m.fragmentNode = out;
    m.receivedShadowPositionNode = opts.shadow.receivePosition(vWorldPos, N);
  } else m.colorNode = out;
  m.name = opts.name;
  return m;
}
