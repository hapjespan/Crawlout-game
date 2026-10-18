# Prompt voor Claude Design: de HUD van Crawlout

Ontwerp de complete in-game interface (HUD) van **Crawlout**, een realtime-strategiespel (RTS) in de browser. Deze prompt beschrijft **wat** de speler met elk element moet kunnen en welke informatie het draagt. Hoe het eruitziet, is aan jou. Lever per element een ontwerp en de toestanden die hieronder genoemd worden.

## Context van het spel

- Twee spelers (of speler tegen AI) bouwen elk een nederzetting in een post-apocalyptische woestenij. Werktitel: Crawlout. De toon is die van een ruw, stoffig, licht ironisch retro-futuristisch wasteland. Gebruik geen bestaand merk of beschermd IP.
- **Winnen** gaat op twee manieren: het hoofdgebouw van de tegenstander vernietigen, of **dominantie**: een aantal claimpunten (bijvoorbeeld 3 van 5) een tijd lang (8 minuten) vasthouden.
- **Economie:** één grondstof, **scrap**, verzameld door plunderaars. **Bedden** (woningen) bepalen hoeveel bewoners je hebt. Robots tellen apart mee tot een maximum.
- **Units:**
  - Bewoners met een rol: plunderaar (verzamelt), bouwer (bouwt), militie (vecht, met wapen- en pantservarianten), technicus.
  - Robots: beveiligingsrobot, reparatiedrone, sentinel (tank).
  - Eén **held**, de Opziener, met SPECIAL-statistieken (S, P, E, C, I, A, L), levels, perks en een actieve vaardigheid (Lockdown).
- **Gebouwen:** hoofdgebouw (Basis), woning, werkplaats (onderzoek, units omscholen), lab (onderzoek), trainingsfaciliteit (SPECIAL trainen), robotfabriek (robots produceren), turret, laserturret, radiobaken, claimpaal.
- **Speelstijl:** muis en toetsenbord op een laptop of desktop. Linksklik selecteert, rechtsklik geeft een order, slepen maakt een selectiekader. Alle sneltoetsen moeten zichtbaar zijn in de UI.
- **Taal:** alle tekst is Nederlands.
- **Schermgroottes:** minimaal 1280x720, tot 1920x1080 en hoger. De speelwereld moet zichtbaar blijven; de HUD mag het midden niet bedekken.
- **Toegankelijkheid:** status nooit alleen via kleur, alles met het toetsenbord te bedienen, voldoende contrast boven een bewegende 3D-wereld.

## Elementen om te ontwerpen

### 1. Bovenbalk: grondstoffen en populatie

- **Toont:**
  - scrap;
  - bewoners;
  - populatie tegenover het maximum (bijvoorbeeld 6/6, met een waarschuwing als het vol zit);
  - bedden;
  - robots tegenover de robotruimte, alleen zichtbaar als je robots hebt of er een in productie is.
- **Toestanden:**
  - populatie vol;
  - te weinig scrap voor iets dat je net probeerde;
  - de tellers veranderen (scrap erbij of eraf).

### 2. Dominantie-teller (bovenin, midden)

- **Toont:** hoeveel punten jij houdt tegenover het benodigde aantal (bijvoorbeeld 1/3) en hoe lang je nog moet volhouden (aftellen, 8:00).
- **Waarschuwing:** als de tegenstander aan het tellen is, met zijn stand en zijn resterende tijd.
- **Toestanden:**
  - niemand telt;
  - jij telt;
  - de tegenstander telt;
  - beide houden punten maar niemand heeft er genoeg.

### 3. Heldpaneel (Opziener, links)

- **Toont:**
  - naam en level;
  - een XP-balk naar het volgende level;
  - de zeven SPECIAL-waarden, waarbij getrainde punten herkenbaar zijn;
  - hoe vaak de held nog opgelapt kan worden ("Oplappen: nog 4x").
- **Actieve vaardigheid** (Lockdown, sneltoets Z): beschikbaar, op cooldown (resterende tijd) of buiten bereik.
- **Perk kiezen:** bij een level-up verschijnt een opvallende melding "Kies perk (n)" (sneltoets P). Die opent een keuzescherm, zie element 11.
- **Held dood of wordt opgelapt:** toon status en resterende tijd, en dat oplappen bij de Basis gebeurt.
- **Toestanden:**
  - levend;
  - vaardigheid op cooldown;
  - perk wacht;
  - dood;
  - wordt opgelapt.

### 4. Minimap (rechtsboven)

- **Toont:**
  - de hele kaart met terrein, water en bos;
  - eigen en vijandelijke units en gebouwen;
  - scrapbronnen;
  - claimpunten met eigenaar en claimvoortgang;
  - het zichtbare cameragebied.
- **Bediening:** klik verplaatst de camera. Een rechtsklik als order is een optie.
- Altijd zichtbaar.

### 5. Eenhedenbalk (onderin)

- **Groepen per type** met aantal en hoeveel er vrij zijn (bijvoorbeeld "Plunderaar 4, 4 vrij"). Een klik selecteert de groep en zet de camera erop.
- **Per unit een klein statusbalkje, zonder tekst:**
  - groen: beschikbaar;
  - oranje: aan het werk;
  - rood: bezig (lopen, vechten).

  Tijdens verzamelen loopt de verzameltijd als laadbalk mee. Bij meer dan 8 units worden de balkjes vanzelf smaller. Een klik selecteert die unit en zet de camera erop.

- **Sneltoets** (punt) springt naar de volgende vrije unit.

### 6. Gebouwenbalk (onderin, naast de eenheden)

- Toont alleen gebouwen waar je iets kunt doen:
  - werkplaats, lab, trainingsfaciliteit en robotfabriek;
  - de Basis alleen als de held opgelapt kan worden.
- **Per gebouw:** naam, een badge met het aantal acties dat je nu kunt starten, en een voortgangsbalk als er iets loopt.
- **Klik:** selecteert het gebouw, opent zijn kaarten en zet de camera erop. Meerdere gebouwen van hetzelfde type doorloop je met herhaald klikken.

### 7. Selectiepaneel (linksonder)

- **Eén eigen unit:** naam, type of loadout, rol, levensbalk en wat hij doet.
- **Meerdere units:** compacte kaartjes per unit met levensbalk. Een klik selecteert alleen die unit.
- **Eigen gebouw:** naam, levensbalk, en "In aanbouw" met voortgang.
- **Vijandelijke unit of vijandelijk gebouw (bekijken):**
  - type;
  - "Vijand" met de factie;
  - levensbalk;
  - wapen en pantsertype.

  Zichtbaar anders dan een eigen selectie, en er zijn geen commando's mogelijk.

- **Leeg:** "Niets geselecteerd".

### 8. Commandopaneel (rechtsonder)

- Toont alleen de commando's die bij de selectie passen, elk met sneltoets:
  - Verplaats (M), Stop (S), Val aan (A), Verzamel (T), Bouw (B);
  - de held krijgt zijn vaardigheden;
  - rol wisselen (Plunderaar 1, Bouwer 2, Militie 3) verschijnt pas als je een afgebouwde werkplaats hebt.
- **Zonder selectie:** alleen een korte hint.
- **Bij een vijand:** de melding dat je die niet kunt bevelen.
- **Richtmodus** (na Verplaats, Val aan of een vaardigheid): duidelijke status "kies een doel", Esc annuleert.

### 9. Bouwmenu (na B, met een bouwer geselecteerd)

- **Lijst van bouwbare gebouwen**, per gebouw:
  - naam;
  - kosten;
  - formaat (bijvoorbeeld 21 bij 19);
  - sneltoets;
  - vergrendeld of te duur, met de reden.
- **Plaatsingsbalk tijdens het plaatsen:** "Plaats Werkplaats (Esc om te annuleren)", plus de reden als de plek niet mag:
  - buiten je gebied;
  - overlapt een gebouw;
  - te steil of onbegaanbaar;
  - water;
  - te dicht bij een ander gebouw;
  - te dicht bij een afleverpunt;
  - staat op een scrapbron of claimpunt;
  - te weinig scrap.
- **Claimpaal** bij een claimpunt wordt een claim. De plaatsing laat zien waar de paal komt.

### 10. Kaartenvenster van een gebouw (rechts, boven het commandopaneel)

- **Kaartsoorten:**
  - onderzoek;
  - craft (unit omscholen of uitrusten);
  - oplappen (held);
  - produceren (robots);
  - trainen (SPECIAL).
- **Per kaart:**
  - naam;
  - icoon;
  - kosten in scrap;
  - duur;
  - effect in gewone taal (bijvoorbeeld "+15% leven voor militie");
  - wat het ontgrendelt;
  - sneltoets.
- **Toestanden per kaart, elk met reden:**
  - beschikbaar;
  - te duur;
  - vergrendeld ("Vereist: Geweerrek");
  - gebouw bezig;
  - loopt, met voortgangsbalk en Annuleer;
  - klaar.
- **Cijfertoetsen:** met de cijfertoetsen kiezen, na K bij craft. Lange namen moeten passen.

### 11. Perk-keuzescherm (held)

- **Opzet:** een keuze uit enkele perks, elk met naam, effect in gewone taal en een SPECIAL-eis.
- **Toestanden:**
  - kiesbaar;
  - eis niet gehaald (zichtbaar, niet kiesbaar);
  - gekozen.
- **Bediening:** sluiten met Esc of het kruisje. Snelkeuze F1 tot en met F3.

### 12. Meldingen (toasts)

- **Soorten:**
  - je wordt aangevallen;
  - bewoner verloren;
  - claimpunt verloren;
  - dominantie-dreiging.
- **Klik op een melding** springt naar de plek, behalve bij dominantie.
- **Korte hints:** zoals "Buiten bereik" (verdwijnt na ongeveer 2 s) en kaart-meldingen zoals "Te weinig scrap".

### 13. Systeembalken en dialogen

- **Fps-indicator** rechtsboven, naast Opgeven: compact, optioneel.
- **Opgeven:** knop met een bevestigingsdialoog.
- **Netwerk:**
  - "Gepauzeerd: wachten op (speler)…";
  - "Desync gedetecteerd op frame N. Het potje is gestopt."
- **Lobby** voor multiplayer: spelers in de kamer, gereed-status, starten.
- **Einde van het potje:** "Gewonnen" of "Verloren", door vernietiging of dominantie, met een knop voor een nieuw potje. Een korte samenvatting (duur, gebouwde units) is een wens.

### 14. Elementen in de 3D-wereld (overlay)

Ontwerp hiervan de vorm, kleur en betekenis. De render-afdeling bouwt ze in de shader.

- **Selectiering:** eigen (groen), vijand bekeken (rood), meervoudige selectie.
- **Levensbalk** boven units en gebouwen: wanneer zichtbaar, en hoe eigen en vijandelijk verschillen.
- **Bouwvoorvertoning:** geldig of ongeldig, met het eigen bouwgebied zichtbaar tijdens het plaatsen.
- **Claimcirkel:**
  - neutraal;
  - van jou of van de vijand;
  - de held claimt (boog vult in 3 minuten);
  - betwist (aanvaller neemt over in 12 s);
  - bevroren (beide kanten aanwezig).
- **Bouwplaats en steiger** met voortgang.
- **Orderfeedback:** klikmarkering voor verplaats, aanval en verzamel, en waypoints.
- **Bereik van de held-vaardigheid** tijdens het richten.
- **Scrapbron:** hoeveel er nog in zit, en of hij exclusief is voor de eigenaar van een claim.

## Wat ik terug wil

1. Per element een ontwerp in alle genoemde toestanden, op 1280x720 en 1920x1080.
2. Een overzicht van het volledige scherm in drie situaties:
   - begin van het potje;
   - midden in een gevecht met 20 of meer units;
   - een gebouw geselecteerd met lopend onderzoek.
3. Een kleine designsystemen-pagina: kleuren voor status (beschikbaar, werkt, bezig, gevaar), teamkleuren, typografie, iconenset (onderzoek, craft, oplappen, produceren, trainen, wapens, pantser, SPECIAL) en spacing.
4. Notities waar een element interactie of animatie nodig heeft, bijvoorbeeld een melding die binnenkomt, een kaart die klaar is of een claim die betwist wordt.
