// Material of the ground vegetation (vegetationLayer.ts): one per species, instanced. Lit like the terrain it grows
// from (the shared toonLight and the sun's shadow, the world grade at the terrain's strength), so a meadow reads as
// the ground grown over, not as stickers on it.
//
// Per instance: vPos (x, y, z meters, yaw radians), vVar (scale across, scale up, variation 0..1, wind phase).
// Per vertex: color.rgb the vertex's shading, color.a its wind bend, flower 1 where rgb is an absolute colour.
//   colour   the species' palette from dry to lush by the instance's variation, times the vertex shading; flower
//            heads keep their own colour
//   wind     the tip sways along WIND_DIRECTION with the square of its bend: a travelling wave over the ground, the
//            instance's phase and a slow gust that rolls over the field
//   fade     past `fade[0]` meters from the camera the plant sinks into the ground and is gone at `fade[1]` (no pop);
//            there the terrain's own turf layer carries the colour
import {
  attribute,
  cameraPosition,
  cos,
  distance,
  float,
  Fn,
  mix,
  normalize,
  sin,
  smoothstep,
  uniform,
  vec3,
  vec4,
  vertexStage,
} from 'three/tsl';
import { DoubleSide, MeshBasicNodeMaterial, Vector3, type Node } from 'three/webgpu';
import { worldGrade } from '../look/grade.js';
import { WIND_DIRECTION } from '../props/propWind.js';
import type { SunShadowTerm } from '../shadows/sunShadow.js';
import { toonLight } from '../units/unitMaterial.js';
import { occlusionDiscard, type OcclusionSampler } from '../occlusion/occlusionField.js';

export interface VegetationMaterialOptions {
  name: string;
  lightDir: Vector3;
  shadow?: SunShadowTerm | null;
  /** Linear albedo of the driest and the lushest instance. */
  palette: { dry: readonly [number, number, number]; lush: readonly [number, number, number] };
  /** Sway at the tip (m, before the instance scale) and its speed (rad/s). */
  wind: { amplitude: number; speed: number };
  /** Seconds, advanced by the renderer, and a 0..1 strength (the renderer's wind option). */
  time: Node<'float'>;
  windStrength: Node<'float'>;
  /** Camera distances (m) between which the plant sinks away. */
  fade: readonly [number, number];
  /** Occlusion fade (occlusion/occlusionField.ts) for the tall species: dithered away while it hides a unit. */
  occlusion?: OcclusionSampler | null;
}

/** Share of the world grade, as on the terrain (terrainMaterial TERRAIN_GRADE). */
const GRADE = 0.5;

export function createVegetationMaterial(opts: VegetationMaterialOptions): MeshBasicNodeMaterial {
  const vPos = attribute('vPos', 'vec4');
  const vVar = attribute('vVar', 'vec4');
  const position = attribute('position', 'vec3');
  const normal = attribute('normal', 'vec3');
  const color = attribute('color', 'vec4');
  const flower = attribute('flower', 'float');
  const light = uniform(opts.lightDir.clone().normalize());
  const [dx, dz] = WIND_DIRECTION;

  const fade = float(1).sub(
    smoothstep(opts.fade[0], opts.fade[1], distance(cameraPosition, vPos.xyz)),
  );
  const local = position.mul(vec3(vVar.x, vVar.y, vVar.x)).mul(fade);
  const ca = cos(vPos.w);
  const sa = sin(vPos.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> =>
    vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  const t = opts.time
    .mul(opts.wind.speed)
    .add(vVar.w)
    .add(vPos.x.mul(dx).add(vPos.z.mul(dz)).mul(0.35));
  const gust = sin(opts.time.mul(0.45).sub(vPos.x.mul(dx).add(vPos.z.mul(dz)).mul(0.04)))
    .mul(0.35)
    .add(0.65);
  const sway = sin(t)
    .add(sin(t.mul(2.3).add(1.7)).mul(0.35))
    .mul(color.w.mul(color.w))
    .mul(opts.wind.amplitude)
    .mul(vVar.y)
    .mul(gust)
    .mul(opts.windStrength);
  const worldPos = rotY(local)
    .add(vPos.xyz)
    .add(vec3(dx, 0, dz).mul(sway));
  const N = normalize(vertexStage(rotY(normal)));
  const vWorldPos = vertexStage(worldPos);

  const dry = vec3(...opts.palette.dry);
  const lush = vec3(...opts.palette.lush);
  const leaf = mix(dry, lush, vVar.z).mul(color.xyz);
  const albedo = worldGrade(mix(leaf, color.xyz, flower), GRADE);
  const shade = toonLight(N, light, opts.shadow?.factor);

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const lit = vec4(albedo.mul(shade), 1);
  const hide = opts.occlusion?.(vPos.xz);
  const out = hide
    ? Fn(() => {
        occlusionDiscard(hide);
        return lit;
      })()
    : lit;
  // As propMaterial.ts: a material that receives the shadow puts its colour in fragmentNode (the shadow pass reads colorNode).
  if (opts.shadow) {
    m.fragmentNode = out;
    m.receivedShadowPositionNode = opts.shadow.receivePosition(vWorldPos, N);
  } else m.colorNode = out;
  m.side = DoubleSide;
  m.name = opts.name;
  return m;
}
