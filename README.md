# Extinction Fighters

A fan-made prehistoric survival board game, inspired by the "Game of Bones" from *Dino Dana*.

Hatch one of 50 real dinosaur, pterosaur, and marine reptile species from a mystery egg, draft 3 of its 4 special ability powers, and race across a 32-space board. Survive hazards, wild dino battles, and rival players — first to the nesting ground wins, and play continues for 2nd, 3rd and 4th place.

**[Play it here](https://cmdurham.github.io/extinction-fighters/)**

## Features

- 50 species across 8 archetypes (apex predators, raptors, horned dinosaurs, armored dinosaurs, sauropods, grazers, pterosaurs, marine reptiles)
- Draft-3-of-4 power system with a one-power-per-turn limit
- Habitat-themed board with hazard, battle, and oasis spaces
- 2–4 players, any mix of human or CPU
- **3D mode** (default): an over-the-shoulder camera follows your dino along the trail through each habitat, with tumbling 3D dice and a comic title card announcing each turn — switch to the classic 2D board any time with the 🗺️/🎥 button. Styled like an animated film:
  - cel-shaded, ink-outlined world with Spider-Verse print touches (halftone shadows, colour misregistration, hand-drawn grain, animation "on twos") and anime impact frames, speed lines and comic-book sound effects
  - all 50 species sculpted procedurally with skeletons, walk cycles and species details (sails, frills, plates, feathers, wings, flippers), wearing each player's colour
  - painterly terrain, cel-shaded skies and layered background ridges for eight habitats, plus a volcano, ocean and the bone-arch nest at the finish
- A random fact about each species on hatch and on every wild encounter
- Fully offline-capable (installable as a PWA, works with no network connection)

## Tech

No build step and no external requests — everything is served from this repo and runs entirely in the browser. The game engine and 2D board live in `index.html`; the 3D view lives in `3d/` (`ink.js` — cel shading and the ink/print post-process · `dinos.js` — procedural creatures · `world.js` — the world, camera and effects), built on a vendored copy of [three.js](https://threejs.org/) r149 (`vendor/three.min.js`, MIT — see `vendor/THREE-LICENSE.txt`) and loaded only when 3D is used. Browsers without WebGL fall back to 2D automatically, and the renderer lowers its resolution on slower devices. `dev/gallery.html` (all 50 species) and `dev/tour.html` (fly the camera to any space, fire any effect) are handy for working on the visuals. See [`DESIGN.md`](DESIGN.md) for the visual design spec.

## Local development

Just open `index.html` in a browser, or serve the folder locally:

```
python3 -m http.server 8080
```

## Credits

Dinosaur silhouette icons are placeholder art. Fan project — not affiliated with or endorsed by the creators of *Dino Dana*.
