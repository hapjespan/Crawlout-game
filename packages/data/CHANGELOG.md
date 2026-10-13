# @crawlout/data

- 0.1.0: schema-skeletten voor contract 3 en de omrekening naar sim-eenheden. Eigenaar: content (werkstroom 4); skeletten door architect.
- 0.2.0: pure loader `loadGameData(raw)` (valideren, omrekenen naar sim-eenheden, numerieke ids op gesorteerde string-id), `readDataDir` in `@crawlout/data/node`, DamageMatrix-schema als strict object met `_comment`, en Dwellers-startdata in data/ (data/VERSION 0.2.0). Alle waarden startwaarde, geen balans.
- 0.2.1: data/sim.json met schema `SimTuning` en `GameData.sim` (unitRadiusU, arriveRadiusU, separationPermille, flowFieldBudget, walkAnimStep); ter review door de architect.
- 0.3.0: loadouts `gatherAmount`/`gatherS` (GameData: gatherAmount, gatherTicks), heroes `maxRevives`, MapDef `dominance { pointsRequired, minutes }` (tijdelijk optioneel, TODO verplicht na map-agent; `convertDominance` naar ticks), `EffectStat`-enum, en de typeId-ruimte `src/typeIds.ts` (unitTypeId, buildingTypeId, SCRAP_NODE_TYPE_ID, CLAIM_POINT_TYPE_ID, kindOfTypeId); ter review door de architect. data/VERSION 0.3.0.
