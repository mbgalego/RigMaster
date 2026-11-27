# RigMaster — Full Code Review Report

**Date:** 2026-11-27  
**Branch:** main (commit d7197bf)  
**Scope:** Complete codebase review (TypeScript/Phaser 4 game)

---

## Executive Summary

RigMaster is an ambitious top-down truck simulator with:
- **Vector road network** (Catmull-Rom splines with taper, bridges, guardrails)
- **Procedural island terrain** with elevation, biomes, and paintable surfaces
- **Full physics simulation** (Matter.js) for truck/trailer articulation, jackknife, off-tracking
- **Career progression** (licenses, reputation, certificates, fleet unlocks)
- **Map editor** (roads, objects, terrain painting, intersections with auto signals)
- **Mission system** with dynamic routing and rating
- **Dynamic weather** and **time-of-day** systems

The codebase is **well-architected** with clear separation of concerns, good TypeScript typing, and thoughtful systems design. However, there are **significant technical debt areas** that will impede scaling, stability, and maintainability.

> **Update 2026-11-27 (commit d7197bf):** Recent PR brought performance optimizations (collision routing O(1), debug physics conditional, MinimapScene cleanup). These address some memory/performance concerns but **do not resolve the architectural debt** identified below.

---

## Critical Issues (🔴 Must Fix)

### 1. Massive God Component: `MainScene.ts` (3,400+ lines)
**Problem:** Single scene class handles rendering, physics, input, UI telemetry, missions, exams, weather, audio, trailer coupling, editor sync, and more. Violates SRP completely.

**Impact:** 
- Impossible to unit test in isolation
- High cognitive load for any change
- Risk of regressions when modifying one subsystem
- 100ms polling interval in `App.tsx` creates tight coupling

**Fix:** Split into:
- `DriveScene` (core gameplay)
- `ExamScene` (license exams)
- `MissionScene` (mission logic)
- `WorldRenderer` (rendering pipeline)
- `PhysicsSystem` (Matter.js coordination)
- `InputManager` (unified input handling)

---

### 2. `App.tsx` — 1,400+ lines with Excessive State
**Problem:** Single React component manages 50+ `useState` hooks, 15+ modals, massive telemetry polling loop (100ms), and manual canvas pointer event isolation.

**Specific Issues:**
- `telemetry` object (60+ fields) rebuilt every 100ms via string-key comparison
- 12 `useEffect` hooks for toast notifications (edge-triggered but fragile)
- Manual `pointerEvents` toggling on canvas is error-prone
- All modals coupled to single component — no portal/stack management

**Fix:** 
- Extract `GameHUD` component with its own telemetry subscription
- Use React Context for game systems access
- Implement modal stack with `react-modal` or custom portal
- Move toast system to dedicated hook/context

---

### 3. Singleton Pattern Abuse (15+ Singletons)
**Problem:** Every system (`LicenseSystem`, `GarageSystem`, `ReputationSystem`, `RoadNetwork`, `IntersectionSystem`, `WeatherSystem`, `TimeOfDaySystem`, `MissionSystem`, `TrailerManager`, `SpriteRegistry`, `TruckCatalog`, `DamageSystem`) uses singleton pattern.

**Impact:**
- Impossible to run parallel tests
- Global state leaks between test runs
- Hard to reset for editor "Cancel" or mission restart
- `resetInstanceForTest()` helpers indicate known testing pain

**Fix:** 
- Dependency injection via constructor or React Context
- Provide `SystemRegistry` interface for test mocking
- Keep singletons only for truly global resources (e.g., `SpriteRegistry` asset manifest)

---

### 4. No Automated Test Suite
**Problem:** Only smoke tests via Playwright (`scripts/smoke-*.mjs`). No unit tests, no integration tests, no CI.

**Impact:** 
- Refactoring any core system (physics, damage, coupling) is high-risk
- No regression detection for license exams, mission rating, truck unlocks
- Smoke tests are slow, flaky, and only test happy paths

**Fix:** 
- Add Vitest for unit tests (pure functions: `DamageSystem`, `RoadNetwork` geometry, `Kingpin` math, `TruckCatalog` stats)
- Add integration tests for mission flow, license exams, fleet swaps
- GitHub Actions CI pipeline

---

### 5. Physics/Render Coupling & Frame-Rate Dependencies
**Problem:** Several systems use `dt` incorrectly or assume 60fps:

```typescript
// Truck.ts:1051 - Framerate-independent slip decay (matches old per-frame value at 60 fps)
this.vLat *= Math.pow(1.0 - lateralDamping, dt * 60);

// Trailer.ts:555
const dt = Math.max(Math.min(delta / 1000, 0.033), 0.001);

// Kingpin.ts:98 - tailSwingOffsetPx uses angularVelocity * 20 (magic number)
```

**Impact:** Simulation diverges at different frame rates; 120Hz displays behave differently.

**Fix:** 
- Use fixed timestep accumulator for physics
- All rates in SI units (per second), never per-frame
- Remove `dt * 60` hacks

---

### 6. Memory Leaks in Editor/Chunk System
**Problem:** `StaticWorldChunks` creates `RenderTexture` pool but:
- `rtPool` never shrinks (only grows to `MAX_CACHE=56`)
- `scratches` Graphics objects never destroyed on scene shutdown
- `TileMaskCanvas` canvases in `WorldTerrain` never released

> **PARCIALMENTE RESOLVIDO (d7197bf):** `MinimapScene` agora tem cleanup correto no `shutdown` (remove listeners, destrói textures). `StaticWorldChunks` e `WorldTerrain` continuam com leaks.

**Fix:** Implement `destroy()` in all managers; call from `MainScene.shutdown`.

---

## High-Priority Issues (🟠 Should Fix)

### 7. Magic Numbers Throughout
**Examples:**
```typescript
// MainScene.ts:161
private static readonly REPAIR_BAY_RADIUS = 160;
// Kingpin.ts:98
const tailSwingOffsetPx = angularVelocity * this.rearOverhang * 20;
// RoadNetwork.ts:140
const SHOULDER_PX = 14;
// DamageSystem.ts:162
export const MIN_TRUCK_DAMAGE_SPEED_PXS = 22;
```

**Fix:** Centralize in `config.ts` or `constants.ts` with documentation.

---

### 8. Inconsistent Error Handling
- Some `localStorage` calls wrapped in try/catch, others not
- Phaser texture loading errors only logged via `console.warn`
- No error boundaries in React; crashes white-screen the game

**Fix:** 
- Unified `StorageService` with fallback
- React Error Boundary wrapping `App`
- Structured error reporting (Sentry-ready)

---

### 9. `RoadNetwork` Rebuild Thrashing
**Problem:** Every point move/width change/twist calls `rebuildIndex()` which:
- Rebuilds entire spatial grid (O(n) segments)
- Re-samples all roads
- Rebuilds bridge caches
- Triggers `IntersectionSystem.rebuild()`

**Impact:** Editor lag on complex road networks (100+ roads).

**Fix:**
- Incremental spatial index updates
- Debounce rebuilds (batch edits)
- Dirty flags per road instead of full rebuild

---

### 10. Intersection System Complexity
**Problem:** `IntersectionSystem.ts` (1,066 lines) handles:
- Node detection (crossings, T-junctions, bridge portals)
- Phase computation
- Traffic light placement with collision-free marching
- STOP/Yield sign generation
- Road marking alignment

**Issues:**
- `computeArmControlPlacements` is 200+ lines with nested loops
- No unit tests for geometry correctness
- Magic constants (`TL_STOP_OFFSET=132`, `TL_SHOULDER_MARGIN=28`)

**Fix:** Split into `IntersectionDetector`, `PhaseCalculator`, `SignalPlacer`, `SignPlacer`.

---

### 11. Asset Loading Race Conditions
**Problem:** `SpriteRegistry.preload()` loads 80+ textures sequentially. `hasTexture()` checks `getSourceImage()` but:
- No loading state exposed to UI
- `MainScene.create()` assumes all textures ready
- Missing textures fall back silently (hard to debug)

**Fix:** 
- Asset manifest with loading progress events
- Development-mode assertion for required assets
- Lazy-load non-critical assets (hub banners, certificate badges)

---

### 12. Save/Load Data Integrity
**Problem:** Multiple localStorage keys with ad-hoc parsing:
- `rigmaster_licenses`, `rigmaster_hubReputation`, `rigmaster_certificates`, `rigmaster_certificateProgress`, `rigmaster_truckFleet`, `rigmaster_activeTruckId`, `rigmaster_gameMode`, `rigmaster_garages`, `rigmaster_weather_dynamic_v1`, `rigmaster_world_draft`

**Issues:**
- No schema versioning/migration
- Corrupt data silently ignored (try/catch swallow)
- No backup/export for players

**Fix:** 
- Single `SaveManager` with versioned schema (Zod/Valibot)
- Migration functions between versions
- Export/import JSON for cloud save / backup

---

## Medium-Priority Issues (🟡 Improve)

### 13. TypeScript Configuration Gaps
```json
// tsconfig.json
"noEmit": true,
"skipLibCheck": true,
```
- No `strictNullChecks` (implied by strict but not explicit)
- No `noUncheckedIndexedAccess` (arrays accessed without bounds checks)
- `allowImportingTsExtensions` + `noEmit` suggests Vite-only build — OK but limits tooling

---

### 14. Phaser 4 Specific Issues
- `MatterJS.BodyType` used as `any` — no proper types installed
- `this.scene.matter.world.on('collisionstart', ...)` listeners never cleaned up in all paths
- `Graphics` objects created in loops (e.g., `drawHubSigns` per frame) — should reuse
- `RenderTexture` pool in `StaticWorldChunks` doesn't handle device loss

> **MELHORADO (d7197bf):** Novo sistema de routing de colisão em `Trailer.ts` usa `WeakMap` + listener único por mundo físico, eliminando listeners duplicados por trailer. `config.ts` agora tem `debugPhysics` condicional (desliga debug Matter.js quando não necessário — grande ganho de performance).

---

### 15. Input Handling Fragmentation
- `MainScene`: keyboard, wheel, pinch, pointerup for pumps/bays/trucks
- `EditorScene`: separate pointerdown/move/up with gesture state machine
- `TouchControls.tsx`: separate touch state
- `Truck.touchInput`: separate object

**Fix:** Unified `InputManager` with action mapping (steer, throttle, brake, interact).

---

### 16. Telemetry Polling Inefficiency
**App.tsx:912-992:** 100ms interval builds massive string key for change detection, copies entire telemetry object.

**Fix:** 
- Event-driven updates from `MainScene` (Phaser events → React via callback)
- Or use `requestAnimationFrame` synced with Phaser update
- Diff only changed fields (immer or manual)

---

### 17. Terrain Paint Performance
`WorldTerrain.erasePaintAt()` densifies strokes and runs RDP simplification on every erase. For large erase operations this is O(n²).

**Fix:** Spatial index for paint strokes; batch erases.

---

### 18. Mission System Edge Cases
- `acceptMission` starts in 'transit' if trailer already coupled — but doesn't verify trailer is at correct pickup bay
- `updateActiveMission` reverts to 'pickup' on decouple but doesn't guide player back to trailer
- No mission timeout handling (abandoned missions stuck in state)

---

### 19. License Exam Exploits
- Exam C: Can drive solo truck to dock (no trailer check in `updateExam`)
- Exam X: Weather forced to rain but player can wait for clear weather by pausing
- No anti-cheat for time limit (tab switch pauses Phaser but not exam timer)

---

### 20. Sandbox/Career State Bleed
`ReputationSystem` maintains parallel `sandboxFleet`/`careerFleet` but:
- `evaluateTruckUnlocks()` only runs on Career rep changes
- Sandbox unlocks all trucks but Career unlocks persist if switched back
- `syncActiveTruckState` called from `MainScene` but uses `gameMode` check

---

## Low-Priority / Nice-to-Have (🟢)

### 21. Code Style Inconsistencies
- Mixed `const`/`let` for constants
- Some `Phaser.Math.Clamp` vs `Math.min/max`
- Portuguese comments mixed with English (consistent but may hinder contributors)
- JSDoc present on some systems, absent on others

---

### 22. Bundle Size
- `lucide-react` imports 140+ icons in `App.tsx` — tree-shaking works but large import list
- All Phaser plugins loaded even if unused
- No code splitting for Editor (loads only when Tab pressed)

---

### 23. Accessibility
- No keyboard navigation for modals (Escape works but not Tab trapping)
- Color-blind unsafe palette (red/green for brake/reverse, stop/yield)
- No screen reader labels on canvas

---

### 24. Performance Profiling Missing
- No `performance.mark` / `measure` in hot paths
- No FPS/memory HUD in dev mode
- `StaticWorldChunks.getStats()` exists but not exposed

---

### 25. Documentation Gaps
- `agents.md` referenced but not in repo
- No architecture decision records (ADRs)
- Complex algorithms (Catmull-Rom, Kingpin, Intersection marching) lack inline math comments

---

### 26. [PONTO ADICIONADO] Collision Listener Leak Risk (Parcialmente Corrigido)
**Problema:** `Truck.setupCollisions()` regista `collisionstart` no `Matter.world` mas o cleanup só acontece no `shutdown` da scene. Se o truck for destruído/recriado (ex: `spawnVehicleRig` durante exame), o handler antigo permanece ativo.

> **PARCIALMENTE MELHORADO (d7197bf):** `Trailer.ts` migrou para router único (`WeakMap<World, Router>`) com `handleCollisionPair` interno — elimina listeners duplicados. `Truck.ts` ainda usa padrão antigo.

**Fix:** Migrar `Truck` para mesmo padrão de router centralizado; ou garantir `off('collisionstart')` no `destroy()` do truck.

---

### 27. [PONTO ADICIONADO] Kingpin Mechanical Lock Hardcoded
**Problema:** `Kingpin.ts:88-93` trava o ângulo do trailer em ré acima de `mechanicalLockDeg` (95°) via `setAngle` direto no body Matter.js. Isto **ignora a física** e pode causar:
- Tunneling se o trailer for forçado contra obstáculo
- Jitter visual (ângulo salta entre frames)
- Inconsistência com o resto da simulação (forças não propagam)

**Fix:** Implementar como constraint Matter.js com limite de ângulo (revolute constraint com limits) ou força de mola restauradora, não `setAngle` direto.

---

### 28. [PONTO ADICIONADO] Telemetry Key String Allocation
**Problema:** `App.tsx:924-941` constrói string chave gigante (`telKey`) a cada 100ms com concatenação de dezenas de campos. Cria pressão de GC desnecessária.

**Fix:** Usar objeto estruturado + comparação shallow (ex: `fast-deep-equal` ou comparação manual de campos-chave) em vez de string serialization.

---

### 29. [PONTO ADICIONADO] EditorScene Tool State Sync Fragility
**Problema:** `EditorScene` expõe 15+ getters públicos (`getRoadUIState`, `getObjectUIState`, `getTerrainUIState`) que o `App.tsx` polleia via `setInterval`. Qualquer mudança no estado interno do editor requer atualização manual em múltiplos locais (UI state, React state, serialização).

**Fix:** Event emitter unificado no `EditorScene` (`on('toolChange')`, `on('selectionChange')`) → React subscreve uma vez.

---

### 30. [PONTO ADICIONADO] WorldTerrain Chunk Invalidation Race
**Problema:** `WorldTerrain.invalidateRegion()` chama `ensureChunk()` imediatamente para chunks visíveis, mas `ensureChunk()` é assíncrono (bake em background). Se o jogador mover câmara rápido, chunks podem ser invalidados/re-baked múltiplas vezes ou fora de ordem.

**Fix:** Queue de invalidation com debounce; `updateView` processa queue sequencialmente.

---

## Architecture Diagram (Current)

```
┌─────────────────────────────────────────────────────────────┐
│                      App.tsx (React)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ 50+ useState│  │ 15+ Modals  │  │ 100ms Polling Loop  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ initGame(container)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MainScene.ts (Phaser)                    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ Truck   │ │ Trailer │ │ Kingpin │ │ World   │ │ 15+   │ │
│  │ Entity  │ │ Entity  │ │ Physics │ │ Systems │ │ Singletons│ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommended Refactoring Roadmap

### Phase 1: Stabilization (2-3 weeks)
1. Add Vitest + CI pipeline
2. Unit test `DamageSystem`, `RoadNetwork` geometry, `Kingpin`, `TruckCatalog`
3. Extract `SaveManager` with schema validation
4. Add React Error Boundary + structured error logging

### Phase 2: Decoupling (3-4 weeks)
1. Split `MainScene` → `DriveScene` + `ExamScene` + `MissionScene`
2. Replace singletons with `SystemRegistry` (DI container)
3. Extract `GameHUD` React component with event-driven telemetry
4. Unified `InputManager` for all input paths

### Phase 3: Editor & Performance (2-3 weeks)
1. Incremental `RoadNetwork` rebuilds
2. `StaticWorldChunks` memory leak fixes
3. Debounced terrain paint operations
4. Asset loading progress + lazy-load non-critical assets

### Phase 4: Polish (Ongoing)
1. Mission system edge cases
2. License exam anti-cheat
3. Accessibility improvements
4. Performance profiling HUD

---

## Files by Risk Level

| Risk | Files |
|------|-------|
| 🔴 Critical | `src/scenes/MainScene.ts`, `src/App.tsx`, `src/systems/*.ts` (singletons) |
| 🟠 High | `src/systems/RoadNetwork.ts`, `src/systems/IntersectionSystem.ts`, `src/world/WorldTerrain.ts`, `src/world/WorldObjects.ts` |
| 🟡 Medium | `src/entities/Truck.ts`, `src/entities/Trailer.ts`, `src/physics/Kingpin.ts`, `src/systems/MissionSystem.ts`, `src/scenes/EditorScene.ts` |
| 🟢 Low | `src/components/*.tsx`, `src/systems/SpriteRegistry.ts`, `src/systems/TruckCatalog.ts` |

---

## Recent Improvements (commit d7197bf)

| Item | Status | Details |
|------|--------|---------|
| Trailer collision routing | ✅ **RESOLVIDO** | `WeakMap<World, Router>` + listener único O(1) por mundo físico |
| Debug physics conditional | ✅ **RESOLVIDO** | `config.ts:38` — `debug: isDebug ? {...} : false` |
| MinimapScene cleanup | ✅ **RESOLVIDO** | `shutdown` handler remove listeners, destrói textures |
| Matter.js debug draw | ✅ **MELHORADO** | Desligado por defeito → grande ganho performance |

> Estes são **otimizações incrementais bem-vindas**, mas **não substituem** o roteiro de refactoring arquitetural (Fases 1-4).

---

## Conclusion

RigMaster is a **technically impressive project** with deep simulation mechanics and a polished editor. The codebase demonstrates strong domain knowledge and good TypeScript practices. However, the **architectural debt** (god components, singletons, no tests) will increasingly slow development and increase bug risk as features grow.

**Priority:** Invest in test infrastructure and component extraction before adding major new systems. The current velocity is sustainable for 1-2 developers but not for a team or long-term maintenance.

---

*Generated by automated code review. Review manually before acting on critical items. Items marked **[PONTO ADICIONADO]** were identified in this review pass and not present in the original report.*