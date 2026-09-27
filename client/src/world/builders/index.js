// Composes each map's signature environment from reusable builders.
import { retainingWalls, utilityPoles, stoneWalls, fallenLogs } from './roadside.js';
import { buildSea, buildLighthouse, buildBoats } from './coast.js';
import { buildArches, buildDesertProps } from './canyon.js';
import { buildCity } from './city.js';

export function buildEnvironment(P) {
  const th = P.theme;
  if (th.retainingWalls) retainingWalls(P);
  if (th.utilityPoles) utilityPoles(P);
  if (th.stoneWalls) {
    stoneWalls(P);
    fallenLogs(P);
  }
  if (P.terrain.sea) {
    buildSea(P);
    if (P.track.def.env.lighthouse) buildLighthouse(P);
    buildBoats(P);
  }
  if (th.arches) {
    buildArches(P);
    buildDesertProps(P);
  }
  if (th.buildings === 'city') buildCity(P);
}
