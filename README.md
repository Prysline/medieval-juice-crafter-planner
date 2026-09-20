# Medieval Juice Crafter Planner

A mobile-first companion planner for **Medieval Juice Crafter**.

## MVP goals

- Track the player's current stage and East Harbor customer satisfaction.
- Search customers by name, occupation, preference, or matching recipe.
- Show currently unlocked recipes that can satisfy each customer, sorted by sale price.
- Browse recipes by ingredient, effect, equipment, and name.
- Keep game data separate from matching and planning logic.
- Add no-waste batch optimization after the lookup flow is stable.

## Current data coverage

The initial dataset covers:

- East Harbor customers currently recorded from direct gameplay.
- Stage 1 lemon/orange juice recipes.
- Stage 2 seasoning-machine recipes using mint and sugar.
- Known customer satisfaction gates.
- Observed leave-home / return-village times for Ivo, Jack, and Nanette.

Unverified rules are intentionally not promoted to confirmed game data.

## Development

```bash
npm install
npm run dev
```

Verification:

```bash
npm test
npm run build
```

## Architecture

```text
src/
  data/       # verified game data
  domain/     # matching / future optimizer logic
  App.tsx     # current mobile-first MVP UI
```

Player progress is currently stored in browser `localStorage`; no backend is required for the MVP.
