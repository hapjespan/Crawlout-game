## 2. Architectuur

Vier delen met drie contracten ertussen: de sim-worker rekent, de main thread toont en stuurt, de relay ordent, de data voedt.

&#91;embedded content: architectuur · sim-worker, main thread, relay, data\]

Commando's gaan van de HUD via het netwerk naar de relay en komen als frame-bundel terug bij elke speler; pas dan voert de sim ze uit. De renderer ziet alleen snapshots, nooit sim-state, zodat render en sim onafhankelijk van elkaar te vervangen zijn. Lokaal spelen vervangt de relay door een loopback in het geheugen, met dezelfde berichten.
