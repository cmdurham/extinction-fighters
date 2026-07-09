# Extinction Fighters — Design Refresh Guide & Implementation Spec

**Status:** ready to implement · **Target file:** `index.html` (this folder)
**Executor notes:** Follow actions A0–A6 **in order**. Every action contains the complete code to paste — no improvisation needed or wanted. If an anchor string cannot be found, STOP and report; do not guess.

---

## 1. Design direction

**"Storybook jungle, modern depth."** The game already has a strong identity — dark jungle green, gold, bone, habitat-painted tiles, chunky pill buttons. We keep all of it. The refresh adds three things the current build lacks:

1. **Depth & light.** A consistent elevation system (soft shadows + a top-edge light "sheen") so panels, tiles, and cards read as physical layers sitting above a layered jungle backdrop. Tiles become raised "stepping stones." Buttons keep their press-down mechanic but gain gloss and a hover lift.
2. **Alive, not busy.** A handful of slow, subtle motions: a shimmer that sweeps the logo, a pulse on the current board tile, a springy card-draw entrance for events, a wobble on rolling dice, gentle glow behind hatching eggs, slow rotating rays behind the victory medal. Everything ≤ a few effects on screen at once, all disabled under `prefers-reduced-motion`.
3. **Rounded, friendly type.** Headings, buttons, and names switch to a rounded system font stack (`ui-rounded` / Arial Rounded MT Bold). No external fonts — the CSP forbids them and the game must stay offline-capable.

**Taste guardrails (what "not gaudy" means here):** glow opacities stay ≤ 0.65 and most sit at 0.2–0.45; animation cycles are slow (1.6s–16s); nothing bounces continuously except the existing egg bob; no rainbow gradients — every gradient is a two-or-three-stop tint/shade of an existing palette color; text contrast only goes **up**.

## 2. Hard rules for the implementer

- **Never rename or delete** any existing CSS class, keyframe, or CSS variable — the game's JS builds HTML strings that reference them.
- **Do not modify game logic.** The only JS edits permitted are the three exact string replacements in A2–A4.
- **No external resources** (fonts, images, CDNs). The CSP blocks them and offline play must keep working.
- **Do not edit existing CSS rules.** All styling changes land in the single appended override block (A1). The cascade (later rules win) is the mechanism.
- Do not reformat, re-indent, or "clean up" any other part of the file.
- The habitat tile backgrounds are set inline from JS (`tile.style.background`) — leave that mechanism alone; the override block styles around it deliberately.

## 3. Token & system reference (what A1 installs)

| Token | Value | Use |
|---|---|---|
| `--bg-deep` | `#0c1811` | bottom of the backdrop gradient |
| `--canopy` | `#2c5a3d` | top-of-screen jungle glow |
| `--elev-1/2/3` | layered rgba shadows | resting / raised / modal elevation |
| `--sheen` | `inset 0 1px 0 rgba(255,255,255,.32)` | top-edge light on raised elements |
| `--glass` / `--glass-brd` | `rgba(255,255,255,.07/.16)` | translucent panel fill / border |
| `--glow-gold` | `0 0 20px rgba(255,206,84,.45)` | active-element glow |
| `--font-round` | `ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", …` | display type |
| `--spring` | `cubic-bezier(.34,1.56,.64,1)` | playful overshoot easing |
| Radii | `--radius-s/m/l` = 10/16/22px | consistent rounding |

**Component intents** (all implemented by the A1 block — listed here so a human can review the why):

- **Backdrop:** four-layer gradient — canopy glow at top, corner shadows at bottom, vertical falloff into `--bg-deep`. Fixed attachment so scrolling content moves over a still scene.
- **Logo:** gold shimmer sweeps across the gradient text every 7s; soft gold aura via `drop-shadow` (text-shadow can't be used with clipped gradient text).
- **Buttons:** gloss sheen + hover lift (−1px, bigger shadow) + existing press-down. Variant gradients get a brighter top stop. Small buttons and variant combinations are explicitly ordered in the block to keep the cascade correct — do not reorder rules inside it.
- **Board tiles:** bevel treatment (light top inset, dark bottom inset, drop shadow) makes each habitat tile a raised stepping stone; type badges become glossy colored chips; the current player's tile pulses gold.
- **Player cards / egg cards / power picker / seats / turn bar:** glass-panel recipe (translucent gradient fill, light top border, elevation). The active player card lifts and glows; hearts get a drop shadow; charge pips turn gold.
- **Stage:** darkened "arena" with inner shadow so event cards pop against it. Event cards enter with a springy card-draw (slide up + tiny rotation settle).
- **Dice:** wobble animation while rolling (class toggled by A2/A3).
- **Log:** entries slide-fade in; scrollbars styled thin and translucent (log + board track).
- **Modal:** springy entrance, deeper elevation, gold-underlined title, blurred overlay.
- **Victory:** slow-rotating soft gold rays behind the medal, masked to a circle so it stays subtle.
- **Accessibility:** visible gold focus ring on all buttons/inputs; every animation and transition collapses under `prefers-reduced-motion: reduce`; muted-text opacity raised from .6 to .75.

---

## 4. Actions

### A0 — Preflight (safety)

1. Working directory: `/Users/chrisdurham/Dev/game-of-bones/`
2. Make a backup: `cp index.html index.design-backup.html`
3. Confirm the file contains the anchor `</style>` exactly once, and contains the A2–A4 anchor strings exactly once each (search for them verbatim). If any anchor is missing or duplicated, STOP and report.

### A1 — Append the override stylesheet

Insert the entire block below **immediately before** the closing `</style>` tag. Paste verbatim; do not reorder rules (button cascade depends on order).

```css
  /* ================================================================
     DESIGN REFRESH OVERRIDES (2026-07) — appended, never edit above.
     Later rules override earlier ones; tune values here only.
     ================================================================ */

  /* ---- tokens ---- */
  :root{
    --bg-deep:#0c1811;
    --canopy:#2c5a3d;
    --radius-s:10px; --radius-m:16px; --radius-l:22px;
    --elev-1:0 2px 10px rgba(0,0,0,.35);
    --elev-2:0 8px 22px rgba(0,0,0,.45);
    --elev-3:0 16px 40px rgba(0,0,0,.55);
    --sheen:inset 0 1px 0 rgba(255,255,255,.32);
    --glass:rgba(255,255,255,.07);
    --glass-brd:rgba(255,255,255,.16);
    --glow-gold:0 0 20px rgba(255,206,84,.45);
    --font-round:ui-rounded,"Arial Rounded MT Bold","Trebuchet MS","Segoe UI",sans-serif;
    --spring:cubic-bezier(.34,1.56,.64,1);
  }

  /* ---- layered jungle backdrop ---- */
  html,body{
    background:
      radial-gradient(ellipse 130% 55% at 50% -12%, var(--canopy) 0%, transparent 60%),
      radial-gradient(ellipse 90% 60% at 12% 108%, #10251a 0%, transparent 55%),
      radial-gradient(ellipse 90% 60% at 88% 108%, #10251a 0%, transparent 55%),
      linear-gradient(180deg, var(--bg2) 0%, var(--bg) 42%, var(--bg-deep) 100%);
    background-attachment:fixed;
  }

  /* ---- rounded display type ---- */
  h1,h2,h3,.logo,.btn,.dino-name,.pn,.ev-name,.turnbar{ font-family:var(--font-round); }
  .note{ opacity:.75; }
  .tag{ color:#d9ecdc; }

  /* ---- logo shimmer + aura ---- */
  .logo .big{
    background:linear-gradient(105deg,#fff7e0 0%,var(--bone) 35%,var(--gold) 50%,var(--bone) 65%,var(--sand2) 100%);
    background-size:220% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent;
    text-shadow:none;
    filter:drop-shadow(0 4px 0 rgba(0,0,0,.28)) drop-shadow(0 0 26px rgba(255,206,84,.22));
    animation:logoShimmer 7s linear infinite;
  }
  @keyframes logoShimmer{ from{ background-position:0% 0; } to{ background-position:-220% 0; } }

  /* ---- buttons: gloss, lift, press (order matters) ---- */
  .btn{
    border-radius:999px;
    background:linear-gradient(180deg,#63cf69 0%,#3fa746 55%,var(--green-d) 100%);
    box-shadow:var(--sheen),0 5px 0 #1b4d20,var(--elev-1);
    transition:transform .15s var(--spring),box-shadow .15s ease,filter .15s ease;
  }
  .btn.small{ box-shadow:var(--sheen),0 4px 0 #1b4d20,var(--elev-1); }
  .btn.alt{ background:linear-gradient(180deg,#7d9bab 0%,#5a7280 55%,#42545e 100%); box-shadow:var(--sheen),0 5px 0 #2c3a40,var(--elev-1); }
  .btn.gold{ background:linear-gradient(180deg,#ffe694 0%,#ffce54 45%,#dea22a 100%); box-shadow:var(--sheen),0 5px 0 #9c7414,var(--elev-1); }
  .btn:hover:not(:disabled){ filter:brightness(1.07) saturate(1.05); transform:translateY(-1px); box-shadow:var(--sheen),0 6px 0 #1b4d20,var(--elev-2); }
  .btn.alt:hover:not(:disabled){ box-shadow:var(--sheen),0 6px 0 #2c3a40,var(--elev-2); }
  .btn.gold:hover:not(:disabled){ box-shadow:var(--sheen),0 6px 0 #9c7414,var(--elev-2); }
  .btn:active:not(:disabled),.btn.small:active:not(:disabled){ transform:translateY(4px); box-shadow:var(--sheen),0 1px 0 #1b4d20,0 2px 6px rgba(0,0,0,.4); }
  .btn.alt:active:not(:disabled){ box-shadow:var(--sheen),0 1px 0 #2c3a40,0 2px 6px rgba(0,0,0,.4); }
  .btn.gold:active:not(:disabled){ box-shadow:var(--sheen),0 1px 0 #9c7414,0 2px 6px rgba(0,0,0,.4); }

  /* ---- glass panels ---- */
  .seat{
    background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.05));
    border:1px solid var(--glass-brd); border-top-color:rgba(255,255,255,.26);
    box-shadow:var(--elev-1);
  }
  .turnbar{
    background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.04));
    border:1px solid var(--glass-brd); border-top-color:rgba(255,255,255,.28);
    border-radius:var(--radius-m); box-shadow:var(--elev-1);
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  }
  .turnbar .who{ box-shadow:var(--sheen),0 2px 5px rgba(0,0,0,.35); }
  .help-btn{ transition:background .15s,transform .15s var(--spring); }
  .help-btn:hover{ background:#0007; transform:scale(1.06); }

  /* ---- board: raised stepping-stone tiles ---- */
  .track{ padding:18px 8px 24px; }
  .tile{
    border:none; border-radius:var(--radius-m);
    box-shadow: inset 0 2px 0 rgba(255,255,255,.30), inset 0 -7px 0 rgba(0,0,0,.26), 0 7px 16px rgba(0,0,0,.42);
  }
  .tile .tnum{ color:#fff; opacity:.85; }
  .tile .hab-motif{ opacity:.38; filter:saturate(.9) drop-shadow(0 2px 3px rgba(0,0,0,.3)); }
  .tile .ttype{
    background:linear-gradient(180deg,rgba(0,0,0,.32),rgba(0,0,0,.5));
    box-shadow:var(--sheen),0 3px 6px rgba(0,0,0,.45);
  }
  .t-adversity .ttype{ background:linear-gradient(180deg,#ec7a5f,#b23c2a); }
  .t-fight .ttype{ background:linear-gradient(180deg,#eda04c,#bf6a1d); }
  .t-bonus .ttype{ background:linear-gradient(180deg,#5aa8cf,#2f7396); }
  .t-start .ttype,.t-finish .ttype{ background:linear-gradient(180deg,#ffd766,#c99a2e); }
  .tile.cur{ outline:none; animation:tileGlow 1.6s ease-in-out infinite; }
  @keyframes tileGlow{
    0%,100%{ box-shadow: inset 0 2px 0 rgba(255,255,255,.30), inset 0 -7px 0 rgba(0,0,0,.26), 0 7px 16px rgba(0,0,0,.42), 0 0 0 3px var(--gold), 0 0 14px rgba(255,206,84,.35); }
    50%{ box-shadow: inset 0 2px 0 rgba(255,255,255,.30), inset 0 -7px 0 rgba(0,0,0,.26), 0 7px 16px rgba(0,0,0,.42), 0 0 0 4px var(--gold), 0 0 26px rgba(255,206,84,.65); }
  }
  .tok{ background:rgba(0,0,0,.55); }

  /* ---- player cards ---- */
  .pcard{
    background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04));
    border-radius:var(--radius-m); box-shadow:var(--elev-1);
    transition:transform .25s var(--spring),box-shadow .25s ease,border-color .2s;
  }
  .pcard.active{ transform:translateY(-3px) scale(1.02); box-shadow:var(--elev-2),var(--glow-gold); }
  .pcard .hearts{ font-size:16px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
  .charges .ab{ background:rgba(0,0,0,.28); box-shadow:inset 0 1px 2px rgba(0,0,0,.3); }
  .charges .ab .dots{ color:var(--gold); }
  .pcard.extinct{ filter:grayscale(.9); }

  /* ---- stage & event cards ---- */
  .stage{
    background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.42));
    border:1px solid rgba(255,255,255,.10); border-radius:var(--radius-l);
    box-shadow:inset 0 2px 14px rgba(0,0,0,.45),var(--elev-1);
  }
  .event-card{ animation:cardIn .45s var(--spring); }
  @keyframes cardIn{
    0%{ opacity:0; transform:translateY(16px) scale(.92) rotate(-1.5deg); }
    100%{ opacity:1; transform:translateY(0) scale(1) rotate(0); }
  }
  .ev-icon{ filter:drop-shadow(0 4px 8px rgba(0,0,0,.4)); }
  .vs .side .e{ filter:drop-shadow(0 3px 6px rgba(0,0,0,.45)); }
  .vs .mid{ color:var(--gold); text-shadow:0 2px 4px rgba(0,0,0,.5); }

  /* ---- dice ---- */
  .dice{ text-shadow:0 4px 8px rgba(0,0,0,.45); transition:transform .2s var(--spring); }
  .dice.rolling{ animation:diceWobble .45s ease-in-out infinite; }
  @keyframes diceWobble{ 0%,100%{ transform:rotate(-7deg) scale(1.04); } 50%{ transform:rotate(7deg) scale(1.12); } }

  /* ---- log & scrollbars ---- */
  .log{ background:rgba(0,0,0,.32); border:1px solid rgba(255,255,255,.08); box-shadow:inset 0 2px 8px rgba(0,0,0,.35); }
  .log div{ animation:logIn .25s ease-out; }
  @keyframes logIn{ from{ opacity:0; transform:translateX(-6px); } to{ opacity:1; transform:none; } }
  .log::-webkit-scrollbar,.track::-webkit-scrollbar{ height:10px; width:10px; }
  .log::-webkit-scrollbar-thumb,.track::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.16); border-radius:8px; }
  .log::-webkit-scrollbar-thumb:hover,.track::-webkit-scrollbar-thumb:hover{ background:rgba(255,255,255,.28); }
  .log::-webkit-scrollbar-track,.track::-webkit-scrollbar-track{ background:transparent; }

  /* ---- modal ---- */
  .modal-overlay{ backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); background:rgba(0,0,0,.62); }
  .modal-box{
    background:linear-gradient(180deg,#28493a 0%,#1c3527 100%);
    border:1px solid var(--glass-brd); border-top-color:rgba(255,255,255,.25);
    border-radius:var(--radius-l); box-shadow:var(--elev-3);
    animation:modalIn .35s var(--spring);
  }
  @keyframes modalIn{ from{ opacity:0; transform:translateY(18px) scale(.95); } to{ opacity:1; transform:none; } }
  .modal-box h2{ padding-bottom:6px; border-bottom:2px solid rgba(255,206,84,.35); }
  .modal-close{ transition:transform .15s var(--spring),background .15s; }
  .modal-close:hover{ transform:scale(1.12); background:#0008; }

  /* ---- hatch & draft ---- */
  .egg-card{
    background:linear-gradient(180deg,rgba(255,255,255,.11),rgba(255,255,255,.05));
    box-shadow:var(--elev-1);
    transition:border-color .2s,transform .25s var(--spring),box-shadow .25s;
  }
  .egg-card.active{ box-shadow:var(--elev-2),var(--glow-gold); }
  .egg-emoji{ background:radial-gradient(ellipse 60% 70% at 50% 55%,rgba(255,206,84,.22),transparent 70%); border-radius:50%; }
  #powerPicker{
    background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04));
    border-top-color:rgba(255,255,255,.25); box-shadow:var(--elev-2);
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  }
  .power-opt{
    background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.38));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
    transition:border-color .15s,transform .15s var(--spring),box-shadow .2s;
  }
  .power-opt:hover{ transform:translateY(-2px); box-shadow:var(--elev-1); }
  .power-opt.locked:hover{ transform:none; box-shadow:inset 0 1px 0 rgba(255,255,255,.08); }
  .power-opt.on{
    border-color:var(--gold);
    background:linear-gradient(180deg,rgba(255,206,84,.22),rgba(0,0,0,.30));
    box-shadow:0 0 12px rgba(255,206,84,.25);
  }
  .po-badge{ animation:pop .3s var(--spring); }

  /* ---- victory rays ---- */
  .medal{ position:relative; z-index:0; }
  .medal::before{
    content:""; position:absolute; inset:-46px; z-index:-1; border-radius:50%;
    background:
      radial-gradient(circle,rgba(255,206,84,.30) 0%,transparent 62%),
      repeating-conic-gradient(rgba(255,206,84,.14) 0deg 12deg,transparent 12deg 24deg);
    -webkit-mask-image:radial-gradient(circle,#000 30%,transparent 70%);
    mask-image:radial-gradient(circle,#000 30%,transparent 70%);
    animation:raySpin 16s linear infinite;
  }
  @keyframes raySpin{ to{ transform:rotate(360deg); } }

  /* ---- accessibility & motion safety ---- */
  button:focus-visible,input:focus-visible{ outline:3px solid var(--gold); outline-offset:2px; }
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{
      animation-duration:.01ms !important;
      animation-iteration-count:1 !important;
      transition-duration:.01ms !important;
      scroll-behavior:auto !important;
    }
  }
```

### A2 — Dice wobble hook (JS, exact replacement)

Find this exact function:

```js
  async function rollDie(){
    const el=$("dice");
    for(let i=0;i<10;i++){ el.textContent=DICE[Math.floor(rnd()*6)]; await delay(55); }
    const v=d6(); el.textContent=DICE[v-1]+" "+v; return v;
  }
```

Replace with:

```js
  async function rollDie(){
    const el=$("dice");
    el.classList.add("rolling");
    for(let i=0;i<10;i++){ el.textContent=DICE[Math.floor(rnd()*6)]; await delay(55); }
    el.classList.remove("rolling");
    const v=d6(); el.textContent=DICE[v-1]+" "+v; return v;
  }
```

### A3 — Battle-dice wobble hook (JS, exact replacement)

Find this exact function:

```js
  async function diceFlourish(){ for(let i=0;i<8;i++){ $("dice").textContent=DICE[Math.floor(rnd()*6)]+" ⚔️ "+DICE[Math.floor(rnd()*6)]; await delay(60); } }
```

Replace with:

```js
  async function diceFlourish(){ const el=$("dice"); el.classList.add("rolling"); for(let i=0;i<8;i++){ el.textContent=DICE[Math.floor(rnd()*6)]+" ⚔️ "+DICE[Math.floor(rnd()*6)]; await delay(60); } el.classList.remove("rolling"); }
```

### A4 — Raised board tokens (JS string, exact replacement)

The board tokens set their colored ring via an inline style, which overrides CSS `box-shadow`; the depth shadow must therefore ride in the same inline string. In `renderTrack()`, find:

```
'" style="box-shadow:0 0 0 3px '+p.color+'">'
```

Replace with:

```
'" style="box-shadow:0 0 0 3px '+p.color+', 0 4px 8px rgba(0,0,0,.55)">'
```

### A5 — Theme color consistency (head, exact replacement)

Find `<meta name="theme-color" content="#1f3a2a" />` and replace the content value with `#15241b` so the browser chrome matches the darker backdrop. (`manifest.webmanifest` already uses `#15241b` for `background_color` — leave it.)

### A6 — Verification (must all pass)

1. **Syntax:** extract and check the script:
   `awk '/<script>/{f=1;next} /<\/script>/{f=0} f' index.html > /tmp/gob.js && node --check /tmp/gob.js`
2. **Braces:** confirm the appended CSS block has balanced `{`/`}` counts.
3. **Visual walkthrough** (open `index.html` in a browser or the preview panel):
   - *Setup screen:* logo shimmers slowly; seat rows look like glass cards; buttons gloss and lift on hover, still press down on click; gold focus ring when tabbing.
   - *Hatch screen:* soft gold glow behind eggs; power picker is a glass panel; selected powers glow gold; hover lifts option cards.
   - *Game screen:* tiles look raised with beveled edges; habitat gradients still show (inline styles intact); type badges are glossy colored chips; current tile pulses gold; tokens have colored ring + drop shadow; active player card lifts with gold glow; dice wobble during rolls; event cards spring in; log lines slide in; track/log scrollbars are slim and translucent.
   - *Rules modal:* springs in, blurred backdrop, gold-underlined title.
   - *End screen:* slow gold rays rotate behind the medal; not overpowering.
   - *Reduced motion (optional):* with OS "reduce motion" on, no animation plays.
4. **No regressions:** play one quick 2-player game (1 human + 1 CPU) to the first battle and first hazard — all prompts, rolls, and card plays function unchanged.
5. If anything fails and can't be resolved by re-checking the pasted block: restore `index.design-backup.html` and report what failed.
