# Extinction Fighters

A fan-made prehistoric survival board game, inspired by the "Game of Bones" from *Dino Dana*.

Hatch one of 50 real dinosaur, pterosaur, and marine reptile species from a mystery egg, draft 3 of its 4 special ability powers, and race across a 32-space board. Survive hazards, wild dino battles, and rival players — the dino that reaches the nesting ground with the most hearts wins.

**[Play it here](https://cmdurham.github.io/extinction-fighters/)**

## Features

- 50 species across 8 archetypes (apex predators, raptors, horned dinosaurs, armored dinosaurs, sauropods, grazers, pterosaurs, marine reptiles)
- Draft-3-of-4 power system with a one-power-per-turn limit
- Habitat-themed board with hazard, battle, and oasis spaces
- 2–4 players, any mix of human or CPU
- A random fact about each species on hatch and on every wild encounter
- Fully offline-capable (installable as a PWA, works with no network connection)

## Tech

Single self-contained `index.html` — no build step, no dependencies, no external requests. Runs entirely in the browser. See [`DESIGN.md`](DESIGN.md) for the visual design spec.

## Local development

Just open `index.html` in a browser, or serve the folder locally:

```
python3 -m http.server 8080
```

## Credits

Dinosaur silhouette icons are placeholder art. Fan project — not affiliated with or endorsed by the creators of *Dino Dana*.
