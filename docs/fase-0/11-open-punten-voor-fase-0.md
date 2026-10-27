## 11. Open punten voor fase 0

Besloten op 13 oktober 2026: repo op GitHub, CI via GitHub Actions op GitHub-hosted runners; placeholders uit Quaternius (de 8 vrije Gobkit-minions hebben 5 bones zonder benen en 240 tris, ongeschikt als humanoid), props uit de Gobkit Nature Kit; de WebGPU-meting en de handmatige hash-test in Chrome op de MacBook, de browsermatrix verder via Playwright op de runner. Er is geen aparte instructieskill: de rolinstructie van het project is de enige instructie, en de agentdefinities in sectie 8 staan op zichzelf; koppeling aan de Agent Workflow Graph gebeurt bij de repo-inrichting.

- [ ] Scaffold pushen naar github.com/hapjespan/Crawlout
- [x] three.js-versie gepind op 0.186.1 (render-pipeline, sprint 1); WebGPU gemeten in Chrome op de MacBook (render-demo via Playwright, sprint 2 tot 4: 15 draw calls, 120 fps, slechtste frame 10,5 ms); de meting op een laptop met geïntegreerde GPU staat open (vraagt Martien)
- [x] Tickrate bevestigd na de benchmark in sprint 1: 200 units, 10.000 ticks, 0,15 ms per tick gemiddeld, 20 Hz blijft
