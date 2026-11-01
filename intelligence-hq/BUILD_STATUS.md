# Build status (keep short; update as work lands)

Approved references: exterior = oceanfront sunset plaza; interior = industrial loft (both in Lance's ChatGPT library).

## Done (2026-10-31)
- Exterior `web/src/scene/Oceanfront.tsx`: sunset sky + ocean shader, islands, yacht, beach, palms, wet LED plaza,
  lit fountain, two fire-pit lounges, Safe Bet Coffee with umbrellas, SUV, outdoor pool table, "One Mission. Total
  Domination." bridge screen, Longevity tower (dog portrait slot, Empire Expansion sign, Badgwell Stock Exchange), bull, logo mat.
- Building + interior `web/src/scene/Loft.tsx`: loft shell (concrete floor, ducts, beams, pendants, ocean window wall),
  two upper storeys with balconies, facade logo sign + live command screen, interior logo wall + live command wall,
  lounge, pool table, SUV, bar with red neon, ping-pong, values board, logo rug. Front doors are clickable (Enter HQ).
- Desks `HQScene.tsx` Workstation: wood desk pods, 3 monitors (live status, task, tools, hand-off team), plaque, chair,
  the agent's floating round bot. Water pipes under the ceiling carry real hand-offs.
- Camera: Plaza, Outside, Enter HQ (fly-through the doors), Command wall, Executive desk, Lounge; click a bot to focus.
- Shared textures `screens.ts`; props `props.tsx`. Removed `CampusWorld.tsx` (old mountain campus).
- Tests: backend 49/49, e2e 6/6 (e2e now uses "Enter HQ"), typecheck clean.

## Honest gaps
- Real AI work needs a model key on the server (`HQ_LLM_PROVIDER` + `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`). Until then
  agents run the full loop with the simulated provider and every screen says "Simulated".
- Google Business Profile, Search Console, Joist, market data: not connected; screens say so.
- Dog portrait: drop a photo at `web/public/dog.jpg` (shows a paw until then).
- Third-party brands from the reference (Starbucks, Ford Bronco) are replaced with a generic café and SUV.

## Next
1. Add the model key and run one objective end to end with real output.
2. Read-only Search Console / GBP connectors feeding the command wall.
3. Executive control center polish: owner controls docked to the Command wall view.
