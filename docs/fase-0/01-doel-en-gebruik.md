## 1. Doel en gebruik

Dit document is het werkcontract voor Claude Code: drie vastgezette contracten plus een brief per werkstroom, zodat zeven subagents parallel kunnen bouwen zonder elkaar te blokkeren. Het ontwerp zelf staat in het [Spelfundament v0.1](https://claude.ai/code/artifact/9fc584bb-560f-4342-8a79-ef1c2d2d8097).

1. Elke agent leest sectie 1, 3, 7 en zijn eigen brief in sectie 9. De contracten (4 tot 6) leest hij alleen waar zijn brief ernaar verwijst.
2. De contracten zijn bevroren. Een wijziging aan een contract is een pull request op dit document met Fable-review, nooit een stille aanpassing in code.
3. Elke werkstroom levert in zijn eigen package en raakt geen ander package aan. Gedeelde types staan in packages/protocol en packages/data.
4. Fase 0 is klaar als: de repo staat, de drie contracten als TypeScript-types en JSON-schema's in packages/protocol en packages/data liggen, de lint-regels uit sectie 7 draaien, en de CI groen is op een lege simulatie.
5. Buiten fase 0: balans, art, netwerk-optimalisatie, Raiders en Garde. Alleen de Dwellers-slice.
