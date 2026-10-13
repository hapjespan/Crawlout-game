// Instanced toon material for static structures (buildings, scrap heaps, claim flags). Same look as the units:
// 3-step toon ramp plus rimlight, team color through the team mask in the vertex color alpha. No PBR.
//
// Per instance: iPos (x, y, z meters; yaw radians around +Y, 0 keeps +Z), iScale (x, y, z; team palette slot),
// iTint (rgb multiplier on the albedo; w unused). An optional shadow factor (1 lit, 0 shadowed) drops the light to
// the darkest band; an optional wave animates team-masked vertices (claim flags).
import { MeshBasicNodeMaterial, type Vector3, type Node } from 'three/webgpu';
import { attribute, cameraPosition, cos, dot, float, int, max, mix, normalize, sin, smoothstep, uniform, uniformArray, vec3, vec4, vertexStage } from 'three/tsl';
import { teamPalette } from '../palette.js';
import { toonRamp } from '../units/unitMaterial.js';

export interface PropMaterialOptions {
  lightDir: Vector3;
  name: string;
  /** Shadow factor node (1 lit, 0 in shadow), e.g. three's shadow(light). */
  shadow?: Node<'float'> | undefined;
  /** Seconds (a uniform the renderer advances), drives the flag wave. */
  time?: Node<'float'>;
}

/** The darkest toon band, what a surface in shadow gets. */
const SHADOW_BAND = 0.52;

export function createPropMaterial(opts: PropMaterialOptions): MeshBasicNodeMaterial {
  const iPos = attribute('iPos', 'vec4');
  const iScale = attribute('iScale', 'vec4');
  const iTint = attribute('iTint', 'vec4');
  const position = attribute('position', 'vec3');
  const normal = attribute('normal', 'vec3');
  const color = attribute('color', 'vec4');
  const light = uniform(opts.lightDir.clone().normalize());

  let local: Node<'vec3'> = position;
  if (opts.time) {
    // Flag wave: team-masked vertices sway along z, more towards the free end.
    const t = opts.time;
    const along = max(position.x.sub(0.06), 0);
    const sway = sin(t.mul(5.2).sub(along.mul(4.5))).mul(along).mul(0.14).mul(color.w);
    local = position.add(vec3(0, 0, sway));
  }

  const ca = cos(iPos.w);
  const sa = sin(iPos.w);
  const rotY = (v: Node<'vec3'>): Node<'vec3'> => vec3(v.x.mul(ca).add(v.z.mul(sa)), v.y, v.z.mul(ca).sub(v.x.mul(sa)));
  const worldPos = rotY(local.mul(iScale.xyz)).add(iPos.xyz);
  const worldNrm = vertexStage(rotY(normal.div(iScale.xyz)));
  const vWorldPos = vertexStage(worldPos);

  const palette = uniformArray<'vec3'>(teamPalette(), 'vec3');
  const team = palette.element(int(iScale.w));
  const base = color.xyz.mul(iTint.xyz);
  const albedo = mix(base, team.mul(base.mul(0.6).add(0.55)), color.w);
  const N = normalize(worldNrm);
  let shade = toonRamp(dot(N, light));
  if (opts.shadow) shade = mix(float(SHADOW_BAND), shade, opts.shadow);
  const V = normalize(cameraPosition.sub(vWorldPos));
  const rim = smoothstep(0.62, 0.8, float(1).sub(max(dot(N, V), 0))).mul(0.16);

  const m = new MeshBasicNodeMaterial();
  m.positionNode = worldPos;
  const out = vec4(albedo.mul(shade).add(vec3(rim, rim, rim.mul(0.9))), 1);
  // A shadow caster must not sample its own shadow map in the shadow pass: three's shadow pass reads colorNode.a,
  // so a material that receives the shadow puts its color in fragmentNode instead.
  if (opts.shadow) m.fragmentNode = out;
  else m.colorNode = out;
  m.name = opts.name;
  return m;
}
