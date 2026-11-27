# RigMaster — Documento Técnico & Plano do Jogo

## 1. Visão Geral, Arquitetura & Plano do Jogo

### 1.1 Visão & Pilar Central
Simulador de condução pesada em **2D Top-Down** (Phaser 4 + Matter.js + React + TypeScript), inspirado na experiência de transporte e manobras do **Euro Truck Simulator 2 (ETS2)**, mas **sem microgestão económica/financeira**: o foco total está na **física realista de camião e atrelados, manobras de precisão, transporte de cargas especializadas e missões**.

### 1.2 Estado Atual da Arquitetura (`src/`)
- **Motor & Cenas (`scenes/`, `config.ts`, `main.ts`, TypeScript `strict: true`)**:
  - `MainScene`: simulação de condução, física Matter.js, acoplamento quinta-roda, semáforos, bombas de combustível, baias de reparação em garagens, faíscas/fumo de impacto, limpeza determinística de entidades no `shutdown` e iluminação dinâmica WebGL (`LightsManager` + `ConeLight` + pool de emissores), delegando áudio, clima visual e exames a serviços dedicados.
  - `EditorScene`: editor de mundo ao vivo (estradas por splines com reconstrução diferida de interseções durante arraste, objetos/prefabs, pintura livre de terreno, redimensionamento, rotação, spawn, exportação/importação JSON e sincronização push-based `subscribeUI` com a UI).
  - `MinimapScene`: cena dedicada com zoom bloqueado em `1.0` no canto superior direito.
- **Veículos & Física (`entities/`, `physics/`)**:
  - `Truck`: 6 modelos reais (`Iveco Daily 4×2`, `Scania R 4×2`, `MAN TGX 6×4`, `Volvo FH 6×4`, `Scania R 8×4`, `Volvo FH16 8×4`) com visuais distintos por cabina/eixos, direção Ackermann, curva de binário diesel, consumo e reserva de combustível (`≤20%`), deslize natural sem combustível, respawn com depósito e integridade a `100%`, modos de faróis (`off` / `low` / `high` + `AUTO`), desgaste progressivo (`engine`, `brakes`, `tires`), aquecimento térmico dos travões (`brakeHeat` com fade `>55%` e penalização a frio nos discos cerâmicos), 4 slots de sidegrades físicos (`engine`, `brakes`, `suspension`, `tires`) e estado de danos localizado por subsistema (`engine`, `steering`, `chassis`, `lights` com modo de emergência `≤15%`, desvio subtil de direção e degradação visual/óptica).
  - `Trailer`, `Kingpin` & `kingpinMath`: 14 tipos de semi-reboques organizados pelas 4 licenças existentes (`C`, `C+E`, `H`, `X`), incluindo **cisternas** (Leite/Alimentar, Petróleo/Combustível ADR, Líquidos Perigosos ADR e Bitrem Cisterna Dupla) e **especializados** (Standard 13.6m, Frigorífico, Porta-Contentores ISO 40ft, Pá Eólica 62m, Prancha Pesada com Escavadora, Florestal/Toros, Bitrem Standard e Vidro Óptico), com integridade estrutural (`trailerHealth`), resistência de rolamento progressiva, integridade de carga (`cargoHealth`) por perfil de fragilidade/oscilação de líquidos (*slosh*), desgaste contínuo em jackknife/curva brusca/terra batida, cinemática anti-derrapagem lateral e batente mecânico progressivo suave (`kingpinMath.ts`) com amortecimento angular em marcha-atrás.
- **Mundo & Sistemas (`world/`, `systems/`)**:
  - `World`, `WorldTerrain`, `WorldObjects`, `StaticWorldChunks`, `WorldLightPools`: ilha contínua com streaming de chunks, *dirty-chunk batching* gradual (até 2 chunks/frame sem *flicker* ao pintar terreno), hitboxes estáticas e deteção de baias de reparação (`repairBays`) em todas as oficinas (`variant: 'garage'`).
  - `DamageSystem`: física de impacto por velocidade normal em `px/s` com tolerância de estacionamento (`<22 px/s` = zero dano), classificação por zona de impacto (`front`/`side`/`rear`) e perfis de sensibilidade de carga (`CARGO_PROFILES`).
  - `RoadNetwork` & `IntersectionSystem`: rede vetorial por splines Hermite com largura variável, sentido único/duplo, camadas de viaduto (`layer: 0 | 1`), aderência por piso (`asphalt`, `cobble`, `dirt`), reconstrução diferida de cruzamentos durante edição (`deferIntersections`) e deteção/sinalização automática de interseções do mesmo nível.
  - `WeatherSystem`, `WeatherRenderer` & `TreeWindFilter`: simulação meteorológica dinâmica com frentes de chuva, nevoeiro e trovoada, renderização atmosférica dedicada (sombras de nuvens, bancos de neblina, recorte iluminado pelos faróis, chuva inclinada pelo vento e relâmpagos ramificados) e shader WebGL de vento nas copas.
  - `AudioEngine`: motor procedural Web Audio isolado (motor diesel, travões pneumáticos, colisões, chuva e trovões atrasados pela distância).
  - `ExamController`: gestão dedicada das docas de exame, marcadores visuais e modificadores climáticos temporários dos exames práticos.
  - `SaveManager`: persistência unificada e versionada (`SAVE_SCHEMA_VERSION = 1`) em `localStorage`, mantendo compatibilidade retroativa com as chaves `rigmaster_*` e oferecendo exportação/importação JSON validada.
  - `TruckCatalog`, `ReputationSystem`, `MissionSystem`, `ParkedTruckManager`, `SpriteRegistry`: progressão regional sem dinheiro nem temporizadores de espera, reputação nos 5 hubs (`Porto Comercial`, `Estaleiro Logístico`, `Zona Industrial Sul`, `Centro Histórico`, `Serra dos Ventos`), 6 certificados de especialização baseados em mestria, missões por hub + editor de missões personalizadas (com suporte ao risco `storm`) e avaliação `S/A/B/C × risco`, frota estacionada fisicamente no mundo com troca presencial (`≤160 px`, parado, tecla `T`) preservando todo o estado do camião anterior, e modo **Sandbox** isolado do `localStorage` de Carreira.
  - `LicenseSystem`, `GarageSystem`, `TimeOfDaySystem`, `TrailerManager`: progressão de licenças com exames práticos, hubs regionais com modificadores meteorológicos, períodos do dia com ciclo 24h e acoplamento livre com orientação visual/GPS ao desengatar atrelados de missão.
- **Interface, Hooks & Controlos (`App.tsx`, `hooks/`, `components/`)**:
  - `hooks/useGameTelemetry.ts`: ponte de telemetria React com *snapshot cloning* e comparador *shallow* para evitar re-renders desnecessários a 10 Hz.
  - `GameHUD.tsx` & `ErrorBoundary.tsx`: HUD extraído com velocímetro/marcha, integridade (visível quando `<100%`), aviso térmico de travões (`≥45%`), indicador `SANDBOX`, banner de missão ativa, modal acessível de resumo de missão, botão contextual de troca física (`T`) e reparação (`🔧` / tecla `E`), notificações toast, `TouchControls.tsx` e barreira de erros React (`ErrorBoundary`) com recuperação segura.
  - Modais dedicados (com fecho universal por `Escape` e restauro de foco): `MissionsModal.tsx`, `FleetGarageModal.tsx`, `WorkshopUpgradesModal.tsx`, `TruckPreviewStage.tsx`, `WorldMapModal.tsx`, `GaragesModal.tsx`, `LicensesModal.tsx`, `JsonMapModal.tsx` e `MissionEditorModal.tsx`.
- **Testes Automáticos (`scripts/`)**:
  - **Unitários (`npm test` — 49 testes)**: `test-phase1-systems.ts` (`npm run test:phase1`, 19 testes de catálogo, reputação, certificados, isolamento Sandbox e temporizador de doca) e `test-core-systems.ts` (`npm run test:core`, 30 testes de `RoadNetwork`, `IntersectionSystem`, `DamageSystem`, `WeatherSystem`, `TimeOfDaySystem`, `MissionSystem`, resiliência `localStorage`, `deferIntersections`, `useGameTelemetry`, `kingpinMath` e `SaveManager`).
  - **Smoke E2E (Playwright)**: `smoke-test.mjs`, `smoke-fuel.mjs`, `smoke-bridge.mjs`, `smoke-damage.mjs`, `smoke-trailers.mjs`, `smoke-progression.mjs` e `smoke-traffic-lights.mjs`.

### 1.3 Plano Geral & Roadmap (Prioridade Sugerida)
> *Nota: as funcionalidades abaixo refletem os objetivos globais definidos para o projeto, organizados em fases lógicas de dependência técnica.*

#### Fase A — Mundo, Infraestruturas & Sinalização
1. **Expansão do Mapa & Arquipélago**: ampliar o território com múltiplas ilhas e zonas distintas ligadas por rede rodoviária mais rica.
2. **Sistema de Pontes & Viadutos (Desníveis)**: camadas de estrada sobrepostas com gestão de altura/layer para permitir cruzamentos em desnível sem colisões entre vias.
3. **Sinalização Rodoviária Coerente**: sinais de trânsito sincronizados com os dados reais de `RoadNetwork` e `WorldObjects` (limites de velocidade, sentidos proibidos/obrigatórios, cedência de passagem, cruzamentos e placas direcionais para portos/indústrias).

#### Fase B — Transporte Marítimo, Indústrias & Missões (Loop Principal)
4. **Locais Industriais & Destinos Dedicados**: adicionar fábricas, garagens, armazéns, pedreiras, refinarias, portos e docas temáticas com geometrias de manobra variadas.
5. **Sistema de Missões / Contratos de Transporte**: entregas ponto-a-ponto entre indústrias com tipos de carga específicos, requisitos de manobra/estacionamento, aproveitamento do sistema de danos/integridade já implementado no camião/atrelado/carga e conclusão sem foco financeiro.
6. **Transporte por Barco / Ferry Simplificado**: terminais portuários onde a manobra-chave é entrar no porto e **estacionar o conjunto dentro do barco de transporte** para atravessar entre ilhas.
7. **Progressão de Frota (Camiões Desbloqueáveis)**: múltiplos camiões com características distintas (potência, eixos, tração, chassi) conquistados ao completar missões/objetivos, desbloqueando por sua vez missões mais exigentes.

#### Fase C — Mundo Vivo (Trânsito AI)
8. **Trânsito AI Multi-Veículo**: veículos autónomos a circular ao longo da `RoadNetwork`, respeitando faixas, sentidos, pontes e estados dos semáforos:
   - Automóveis ligeiros e comerciais;
   - Outros camiões rígidos e conjuntos articulados com atrelados.

#### Fase D — Evolução Visual (Texturas 2D, Iluminação WebGL & Menus Gráficos)
9. **Pipeline 2D Totalmente Texturizado**: substituir desenhos vetoriais simples por sprites e texturas detalhadas (asfalto com desgaste, bermas/passeios, terreno, edifícios industriais, água, cabines de camiões e reboques) mantendo estética 2D nítida e apelativa.
10. **Sistema de Iluminação Realista em WebGL**: iluminação dinâmica (Light2D / shaders WebGL) com faróis volumétricos, lanternas de travagem/marcha-atrás, postes de iluminação, semáforos e reflexão atmosférica ajustada a dia, noite, chuva e nevoeiro.
11. **Oclusão de Luz com Ray2D / Sombras**: raycasting 2D para bloquear e projetar sombras reais dos faróis e candeeiros contra edifícios, muros e restantes elementos do mapa.
12. **Evolução Visual dos Menus & Interface Gráfica (Fase D5)**: elevar o acabamento visual de todos os modais e painéis (Frota, Oficina, Missões, Tipologias, Hubs/Garagens e Licenças/Certificados), enriquecendo-os com **itens gráficos dedicados** (perfis laterais *sideview* dos camiões e atrelados, ilustrações de upgrades mecânicos, emblemas de certificados/cartas e postais dos hubs) que não só elevam a estética como funcionam como **guia visual imediato** para o jogador identificar cada veículo, carga ou destino no mundo.

### 1.4 Regras de Manutenção
- Manter sempre o **`agents.md`** e o **`package.json`** atualizados a cada versão ou fase concluída (arquitetura, testes e changelog sempre sincronizados com o código real).
- Validar alterações com `npm run lint` (`tsc --noEmit` em modo `"strict": true`), `npm run build`, `npm test` (`test:phase1` + `test:core`) e as 7 suites smoke: `smoke-test.mjs`, `smoke-fuel.mjs`, `smoke-bridge.mjs`, `smoke-damage.mjs`, `smoke-trailers.mjs`, `smoke-progression.mjs` e `smoke-traffic-lights.mjs`.

---

### 1.5 Pipeline de Texturas & Sprites 2D (Especificação Oficial — Fase D)

Esta secção define o contrato técnico e artístico completo para a migração gradual de gráficos vetoriais (`Phaser.Graphics`) para **sprites e texturas 2D geradas externamente pelo utilizador**, garantindo coerência visual, alinhamento exato com a física Matter.js e ganho real de performance (GPU batching + cache `StaticWorldChunks`).

> **Catálogo completo de prompts prontos a copiar:** ver **`docs/TEXTURE_PROMPTS.md`** (mantém o estado `[ ] Pendente` / `[x] Integrado` de cada asset).

#### 1.5.1 Direção Artística & Regras Técnicas Obrigatórias
- **Perspetiva**: estritamente **Top-Down Ortográfico a 90°** (câmara perpendicular ao chão, *zero* perspetiva isométrica, *zero* inclinação 3/4, *zero* fuga de paredes).
- **Estilo**: semi-realista limpo e nítido inspirado em **ETS2 / simuladores logísticos europeus modernos** (pintura ligeiramente desgastada, painéis metálicos, relevo subtil por *ambient occlusion* interno, cores saturadas equilibradas — sem aspeto *cartoon/pixel-art* nem fotorrealismo ruidoso).
- **Iluminação neutra (SEM sombras projetadas no chão)**: os sprites NÃO devem ter sombras compridas nem reflexos direcionais fortes cozidos na imagem; o motor já aplica ciclo dia/noite 24h, faróis WebGL, candeeiros e sombras de nuvens dinâmicas.
- **Orientação canónica de veículos**: **frente sempre a apontar para CIMA (Norte / 12h / `-Y`)** — pára-choques/cabina no topo da imagem, traseira/farolins na base. Alinha 1:1 com `angle = 0` em `Truck.ts` e `Trailer.ts`.
- **Elementos que permanecem dinâmicos no motor** (NÃO desenhar ligados/ativos na sprite):
  - Feixes de faróis, luzes de travão/marcha-atrás acesas e piscas (renderizados por `Truck.ts`/`Trailer.ts` para respeitar danos ópticos e WebGL `ConeLight`);
  - Rodas dianteiras giratórias do trator (os tratores usam a sprite da carroçaria/chassis com as cavas frontais limpas ou rodas discretas alinhadas, enquanto `wheelGraphics` anima o esterço Ackermann).
- **Escala & Resolução Alvo**:
  - **Sprites de veículos/objetos**: resolução alvo **4×** face aos pixéis do mundo Matter.js (ex.: trator `40×88` mundo → sprite recortada `160×352 px` ou maior mantendo a proporção exata `width : length`; o motor ajusta com `setDisplaySize(worldW, worldH)`).
  - **Tiles contínuos (*seamless*) de terreno/estrada**: **`512×512 px`** PNG **sem fundo chroma key** (preenchimento total de ponta a ponta, 100% *tileable* em X e Y, sem vinheta nem gradientes).

#### 1.5.2 Norma de Chroma Key & Processamento de Transparência
Como o gerador externo de imagens produz fundos opacos, todos os sprites com recorte transparente seguem esta regra fixa de **Chroma Key**:
1. **Chroma Key Padrão — Magenta Puro `#FF00FF` (`rgb(255, 0, 255)`)**: usar em **quase todos os sprites** (camiões azuis/vermelhos/amarelos/verdes, atrelados, edifícios, árvores, rochas, contentores, bombas, trânsito). Evita contaminação de cor com folhagem verde ou tintas metálicas.
2. **Chroma Key Alternativo — Verde Néon `#00FF00` (`rgb(0, 255, 0)`)**: usar **exclusivamente** em sprites cuja pintura contenha **roxo, violeta ou rosa** (`scania_r_8x4` roxo, `bitrem_pup` roxo/magenta, ou carros AI roxos/rosa).
3. **Sem Chroma Key (Full-Bleed Seamless)**: todas as texturas de superfície repetível (*tiles* de asfalto, calçada, terra, relva, floresta, areia, rocha alpina, água, betão).
4. **Protocolo de limpeza (para qualquer agente)**:
   - O utilizador pode enviar as imagens brutas no chat ou colocá-las em `public/assets/sprites/raw/`.
   - Ao receber uma sprite bruta com chroma key, o agente DEVE processá-la (via script Node/Canvas/Sharp `scripts/process-sprites.mjs` a criar na primeira integração) com:
     1. Remoção do chroma key por distância de matiz/cor + **despill** nos pixéis de borda (remove auréola magenta/verde);
     2. Recorte automático (*auto-trim*) à *bounding box* opaca + margem limpa de `2 px` e verificação de orientação (**frente para cima**);
     3. Validação visual obrigatória da transparência sobre fundo escuro (`#0c0f17`) e claro antes de integrar;
     4. Gravação do PNG final em `public/assets/sprites/<categoria>/<id>.png` e atualização do estado `[x]` em `docs/TEXTURE_PROMPTS.md`.

#### 1.5.3 Estrutura de Pastas Oficial (`public/assets/sprites/`)
```text
public/assets/sprites/
├── raw/                      # Uploads brutos com chroma key (entrada temporária / arquivo)
├── tiles/                    # Tiles seamless 512×512 (full-bleed, sem chroma key)
│   ├── road_asphalt.png
│   ├── road_cobble.png
│   ├── road_dirt.png
│   ├── pad_concrete.png
│   ├── terrain_grass.png
│   ├── terrain_forest.png
│   ├── terrain_sand.png
│   ├── terrain_alpine_rock.png
│   ├── terrain_alpine_summit.png
│   └── terrain_water.png
├── vehicles/
│   ├── trucks/               # 6 tratores oficiais (frente p/ cima)
│   │   ├── iveco_daily_4x2.png     (mundo 36×76)
│   │   ├── scania_r_4x2.png        (mundo 38×82)
│   │   ├── man_tgx_6x4.png         (mundo 40×88)
│   │   ├── volvo_fh_6x4.png        (mundo 40×90)
│   │   ├── scania_r_8x4.png        (mundo 42×96 — chroma #00FF00)
│   │   ├── volvo_fh16_8x4.png      (mundo 42×98)
│   │   └── menu/             # Perfis laterais sideview p/ Menus (frente p/ ESQUERDA, maxH=320)
│   │       ├── iveco_daily_4x2_sideview.png
│   │       ├── scania_r_4x2_sideview.png
│   │       ├── man_tgx_6x4_sideview.png
│   │       ├── volvo_fh_6x4_sideview.png
│   │       ├── scania_r_8x4_sideview.png   (chroma #00FF00)
│   │       └── volvo_fh16_8x4_sideview.png
│   ├── trailers/             # 14 atrelados/cisternas (frente p/ cima)
│   │   ├── standard.png            (mundo 46×220)
│   │   ├── reefer.png              (mundo 46×220)
│   │   ├── container.png           (mundo 46×220)
│   │   ├── tanker_milk.png         (mundo 46×220)
│   │   ├── long_cargo.png          (mundo 46×310)
│   │   ├── flatbed_heavy.png       (mundo 48×275)
│   │   ├── timber.png              (mundo 46×255)
│   │   ├── tanker_fuel.png         (mundo 46×248)
│   │   ├── bitrem_lead.png         (mundo 46×155)
│   │   ├── bitrem_pup.png          (mundo 46×155 — chroma #00FF00)
│   │   ├── bitrem_tanker_lead.png  (mundo 46×155)
│   │   ├── bitrem_tanker_pup.png   (mundo 46×155)
│   │   ├── fragile_glass.png       (mundo 46×220)
│   │   ├── tanker_hazmat.png       (mundo 46×225)
│   │   └── menu/             # (Futuro Fase D5) Perfis laterais / ícones de atrelados p/ Missões & Tipologias
│   └── traffic/              # Futuro Trânsito AI (Fase C — frente p/ cima)
│       ├── car_compact.png         (mundo 24×48)
│       ├── car_sedan.png           (mundo 26×54)
│       ├── van_delivery.png        (mundo 28×62)
│       └── truck_rigid.png         (mundo 34×84)
├── buildings/                # Telhados top-down 90° (chroma #FF00FF)
│   ├── warehouse_big.png
│   ├── warehouse_docks.png
│   ├── shed.png
│   ├── garage.png
│   ├── warehouse.png
│   ├── gabled.png
│   ├── church.png
│   └── convenience_store.png
├── props/                    # Elementos de cenário (chroma #FF00FF)
│   ├── container_base.png    # Contentor ISO neutro/branco (permite tint por cor no motor)
│   ├── tree_deciduous_1.png
│   ├── tree_deciduous_2.png
│   ├── pine_alpine_1.png
│   ├── pine_alpine_2.png
│   ├── rock_outcrop.png
│   ├── log_pile.png
│   ├── wind_turbine_rotor.png
│   └── gas_canopy.png
└── ui/                       # (Futuro Fase D5) Itens gráficos para menus (upgrades, hubs, certificados/cartas)
    ├── upgrades/             # Ilustrações de motor, travões, suspensão e pneus (Oficina)
    ├── hubs/                 # Postais/emblemas dos 5 hubs regionais (Missões & Garagens)
    └── badges/               # Emblemas de cartas (C, CE, H, X) e 6 certificados de mestria
```

#### 1.5.4 Plano de Integração Faseado (com Fallback Vetorial Seguro)
> **Regra de ouro de integração:** o motor NUNCA deve quebrar se uma textura ainda não tiver sido fornecida. Cada sprite/tile é carregada de forma segura (`MainScene.preload` / manifesto de texturas) e **só substitui o desenho vetorial quando a textura existe no `TextureManager`**; caso contrário, mantém automaticamente o desenho vetorial atual como *fallback*.

- **Fase D1 — Superfícies Base (`tiles/`) & Frota de 6 Camiões (`vehicles/trucks/`)**:
  1. Criar o utilitário de processamento chroma-key (`scripts/process-sprites.mjs`) e o registo central de sprites (`src/systems/SpriteRegistry.ts`).
  2. Integrar `tiles/` em `WorldTerrain.ts` e `RoadNetwork.ts` (cozidos em `StaticWorldChunks` `1024×1024` → **0 ms extra por frame**).
  3. Substituir `cabGraphics` de `Truck.ts` por `Phaser.GameObjects.Image` com a sprite do trator (mantendo rodas frontais giratórias, luzes dinâmicas e sobreposição subtil de danos/fumo).
- **Fase D2 — 14 Atrelados & Cisternas (`vehicles/trailers/`)**:
  1. Substituir o corpo estático de `Trailer.ts` por `Phaser.GameObjects.Image` escalado às dimensões físicas exatas (`width × length`), preservando acoplamento quinta-roda, luzes traseiras e indicador de carga/danos.
- **Fase D3 — Edifícios, Contentores & Natureza (`buildings/`, `props/`)**:
  1. Integrar telhados, contentores ISO (com *tint* automático para as 7 cores), árvores, pinheiros alpinos, rochas, pilhas de toros e rotor das torres eólicas dentro do pipeline de chunks (`StaticWorldChunks` / `WorldObjects`).
- **Fase D4 — Sprites de Trânsito AI (`vehicles/traffic/`)**:
  1. Carregar os 4 veículos base (com *tint* de pintura variada no motor para multiplicar a variedade visual sem aumentar memória de textura) como arranque direto da **Fase C — Trânsito AI**.
- **Fase D5 — Melhoria Visual Geral dos Menus & Itens Gráficos de UI (`vehicles/*/menu/`, `ui/`)**:
  1. **Objetivo**: modernizar e dar identidade visual a todos os modais e ecrãs do jogo (*Frota*, *Oficina*, *Missões*, *Tipologias*, *Garagens/Hubs* e *Licenças/Certificados*), substituindo cartões puramente textuais por **apresentações limpas com palco gráfico** que ajudam o jogador a reconhecer visualmente cada camião, atrelado, peça ou destino no mapa.
  2. **Regras técnicas dos gráficos de menu**:
     - **Perfis laterais (*sideview*) de veículos**: perfil ortográfico lateral puro, **frente voltada para a ESQUERDA**, cores exatamente idênticas às sprites top-down do jogo, processados via `scripts/process-sprites.mjs --maxH=320 --pad=4` (chroma `#FF00FF`, ou `#00FF00` para pinturas roxas como `scania_r_8x4`).
     - **Manifesto sem 404 & fallback automático**: registar apenas ficheiros fisicamente presentes em `SpriteRegistry.ts` (ex.: `TRUCK_SIDEVIEW_SPRITES` + `SpriteRegistry.getTruckMenuPreview()`). Enquanto um item gráfico de menu ainda não tiver sido fornecido, a UI mostra automaticamente a sprite top-down real rodada (ou um *fallback* vetorial/SVG limpo em `onError`), sem nunca gerar imagens quebradas nem pedidos HTTP 404.
     - **Direção estética dos modais**: palco de estúdio escuro com iluminação subtil na cor do veículo, sombra de contacto no chão, sem excesso de etiquetas/cápsulas (*zero-pill*) sobre a arte, tipografia tabular (`tabular-nums`), barras de telemetria limpas e adaptação fluida em desktop e mobile.
  3. **Roadmap de menus gráficos**:
     - **Menu da Frota & Oficina (`TruckPreviewStage.tsx`)**: perfis laterais dos 6 tratores (**`6/6` concluídos — 100%**).
     - **Menu de Missões & Tipologias (`5.2.1`)**: perfis laterais/ilustrações dos 14 atrelados e cisternas + insígnias dos 6 certificados (prompts prontos em `docs/TEXTURE_PROMPTS.md`).
     - **Oficina Mecânica (`5.2.2`)**: ilustrações técnicas para os 4 slots de upgrades (*Motor*, *Travões*, *Suspensão*, *Pneus*).
     - **Hubs, Garagens & Licenças (`5.2.3`)**: postais/ilustrações dos 5 hubs regionais e insígnias das cartas (`C`, `C+E`, `H`, `X`).

---

## 2. Histórico de Versões & Changelog

### **v2.25.0** (Versão Atual — branch main)
- **Auditoria Completa de Código & Plano de Correções P0–P4 (Estabilidade, TypeScript Estrito, Performance & Modularização)**:
  - **P0 — Correções Críticas de Bugs & Estabilidade**:
    - Suporte completo ao risco meteorológico `'storm'` nas missões personalizadas (`MissionSystem.ts`, `MissionEditorModal.tsx`) com bónus de risco `+0.25`.
    - Correções de segurança de estado, sanitização de dados e estabilidade de execução nos sistemas centrais.
  - **P1 — Integridade de Dados, Memória & Cobertura de Testes**:
    - Proteção contra `localStorage` corrompido em `GarageSystem.ts` e `LicenseSystem.ts`.
    - Extração do motor Web Audio procedural para `AudioEngine.ts` e decomposição dos modais de `App.tsx` (`GaragesModal.tsx`, `LicensesModal.tsx`, `JsonMapModal.tsx`, `MissionEditorModal.tsx`).
    - Criação da suite de testes unitários `scripts/test-core-systems.ts` e do script unificado `npm test`.
  - **P2 — TypeScript `"strict": true` em Todo o Projeto**:
    - Ativação de `"strict": true` em `tsconfig.json` com eliminação total de erros de nulabilidade, tipos implícitos e assinaturas em todo o código-fonte e testes.
  - **P3 — Performance, Ciclo de Vida & Resiliência de UI**:
    - Criação de `ErrorBoundary.tsx` (envolve a árvore React em `main.tsx`), `hooks/useGameTelemetry.ts` (clonagem e diffing *shallow* para suprimir re-renders redundantes do HUD) e extração de `components/GameHUD.tsx`.
    - Limpeza explícita de `pupKingpin`, `pupTrailer`, `kingpin`, `trailer` e `truck` no `shutdown` de `MainScene.ts`.
    - Otimização do Editor: reconstrução diferida de cruzamentos (`deferIntersections` em `RoadNetwork.ts`) durante arraste de estradas e sincronização push-based (`subscribeUI`/`emitUIState`) em `EditorScene.ts`.
  - **P4 — Física Suave, Terreno sem *Flicker*, Modularização Final, Persistência Versionada & UX**:
    - `physics/kingpinMath.ts` + `Kingpin.ts`: substituição do clamp angular rígido por um batente mecânico progressivo suave em marcha-atrás (com teto de segurança `+6°` e amortecimento de velocidade angular) sem bloquear recuperação para a frente.
    - `world/WorldTerrain.ts`: *dirty-chunk batching* em `invalidateRegion()`/`updateView()` (máx. 2 chunks visíveis recalculados atomicamente por frame, eliminando *flicker* branco e picos de latência ao pintar terreno).
    - `systems/WeatherRenderer.ts` & `systems/ExamController.ts`: extração completa da renderização atmosférica/relâmpagos e do controlador de docas de exame de `MainScene.ts`.
    - `systems/SaveManager.ts`: serviço de persistência unificado com schema versionado (`SAVE_SCHEMA_VERSION = 1`), retrocompatível com as chaves `rigmaster_*`, e exportação/importação JSON validada (integrado em `LicenseSystem` e `GarageSystem`).
    - UX & Acessibilidade (`App.tsx`, `GameHUD.tsx`, `MainScene.ts`): `Escape` fecha qualquer modal (incluindo resumo de missão e inputs focados) com restauro automático do foco anterior, atributos `role="dialog"` / `aria-modal="true"`, e preservação do alvo GPS + aviso claro ao desengatar um atrelado durante uma missão ativa.

### **v2.24.0** (branch main)
- **Pacote Urbano & Cívico — 12 Novas Texturas Top-Down de Edifícios de Cidade (`public/assets/sprites/buildings/`, `SpriteRegistry.ts`, `docs/TEXTURE_PROMPTS.md`)**:
  - **Residencial (6 sprites PNG RGBA)**: `house_traditional` (Casa Tradicional), `house_townhouse` (Casas Geminadas), `villa_classic` (Vivenda Tradicional), `villa_modern` (Vivenda Moderna c/ deck e piscina), `apartment_block` (Prédio Residencial) e `apartment_modern` (Prédio Moderno).
  - **Serviços Públicos & Comércio (6 sprites PNG RGBA)**: `fire_station` (Quartel de Bombeiros com torre e 3 baias vermelhas), `police_station` (Esquadra da Polícia PSP), `hospital` (Hospital com heliporto `H` e cruz médica), `school` (Escola), `supermarket` (Supermercado) e `town_hall` (Câmara Municipal com torre de relógio e escadaria).
- **Acessos a Garagem, Estacionamento Exterior & Placas Cívicas (`WorldObjects.ts`)**:
  - Novo renderizador de placas frontais transitáveis (`drawBuildingApron` na camada `flats`, aderência de asfalto em `pavedGripAt`, bloqueio de árvores em `hasTreeBlockerAt`, extensão automática de chunks em `rebuildIndex` e colisão física apenas na pegada do edifício):
    - **Vivendas & Casas c/ Garagem (`params.garageAccess`)**: acesso pavimentado em betão alinhado à ala de garagem, jardim frontal com sebe e caminho de acesso à porta principal.
    - **Prédios c/ Garagem e/ou Estacionamento Exterior (`params.garageAccess`, `params.exteriorParking`)**: rampa de garagem subterrânea com muros guia e grelha de drenagem, parque de estacionamento exterior asfaltado com lugares pintados, lugar reservado a mobilidade reduzida e carros estacionados — combináveis individualmente ou em conjunto no mesmo edifício.
    - **Placas de Emergência**: zona amarela zebrada de saída rápida nos Bombeiros, lugares reservados com carro-patrulha na Polícia e baia de Urgência com ambulância no Hospital.
- **Editor & Bairro Urbano no Mapa (`App.tsx`, `EditorScene.ts`, `rigworld.json`)**:
  - Duas novas categorias dedicadas no catálogo do Editor — **Cidade** (15 variantes pré-configuradas de casas, vivendas e prédios com/sem garagem e estacionamento) e **Cívico** (Bombeiros, Polícia, Hospital, Escola, Supermercado, Câmara Municipal, Igreja e Arco) — e interruptores de 1 clique no inspetor do objeto selecionado (`Acesso a Garagem` e `Estacionamento Exterior`).
  - Nova zona urbana completa povoada em `rigworld.json` ao longo das avenidas `rd_10`, `rd_1` e `rd_2` junto ao Centro Histórico com todas as 12 tipologias de edifícios.

### **v2.23.0** (branch main)
- **Pisos de Estações de Serviço com Acessos em Funil (`WorldObjects.ts`, `StaticWorldChunks.ts`, `WorldLightPools.ts`)**:
  - `gas_canopy` promovido para `ROAD_OVERLAY_TYPES` com nova camada Canvas2D texturada `roadFlatTex` (acima das estradas e abaixo dos sólidos), garantindo fusão perfeita em alcatrão sem costuras nem rebordos nas ligações à via.
  - Geometria paramétrica (`getGasCanopyCore`) com **entrada de 1 via que abre suavemente em funil (curvas Bézier)** para as pistas das bombas (`PESADOS` / `LIGEIROS`) e **converge novamente numa única via de saída**, mantendo compacta a zona das bombas, com ilha separadora ajardinada, guias tracejadas curvas, setas de fluxo e legendas auto-endireitadas.
  - Adaptação nativa para estradas em **todos os 4 lados + passante**: `accessSide: 'right' | 'left' | 'top' | 'bottom' | 'through'`, com cobertura aérea (`prop_gas_canopy`) e iluminação noturna centradas exatamente sobre o núcleo das bombas.
- **Postos de Estradas Secundárias (1 Bomba + Pequena Casa de Apoio)**:
  - Novo estilo `stationStyle: 'secondary'` compacto com 1 bomba central ladeada por 2 pistas de acesso em funil e cobertura reduzida.
  - Nova variante de edifício `fuel_kiosk` com sprite PNG top-down dedicada (`/assets/sprites/buildings/fuel_kiosk.png`, registada em `SpriteRegistry.ts`) representando uma pequena casa de apoio/pagamento de estrada secundária.
- **Editor & Mapa do Mundo (`src/App.tsx`, `EditorScene.ts`, `rigworld.json`)**:
  - Catálogo **Serviços** do Editor expandido com os 10 pisos de estações de serviço (5 Autoestrada + 5 Secundário 1B para Direita/Esquerda/Acima/Abaixo/Passante) + `Casa Apoio Posto`, e seletor rápido no inspetor do objeto selecionado para alternar tipo e lado da estrada num clique.
  - Áreas de Serviço A1 (Estação 1 `right` e Estação 2 `top`) atualizadas com os novos pisos em funil sem lages excessivas, Posto da Serra (`rd_44`) convertido em posto secundário 1B com casa de apoio, e 2 novos postos secundários adicionados no mapa (`rd_1` estrada à esquerda e `rd_9` estrada abaixo).

### **v2.22.0** (branch main)
- **Fase D5.2 Concluída — 33 Ilustrações Gráficas de Menus & Interface (`public/assets/sprites/`, `SpriteRegistry.ts`, `MissionsModal.tsx`, `WorkshopUpgradesModal.tsx`, `App.tsx`, `docs/TEXTURE_PROMPTS.md`)**:
  - **14 Perfis Laterais (*Sideview*) de Atrelados & Cisternas (`vehicles/trailers/menu/*_sideview.png`)**: criados e recortados em RGBA transparente (`--maxH=240`, orientados à esquerda em estilo estúdio ETS2 coerente com os 6 camiões) para todos os 14 atrelados do jogo (`standard`, `reefer`, `container`, `tanker_milk`, `long_cargo`, `flatbed_heavy`, `timber`, `tanker_fuel`, `bitrem_lead`, `bitrem_pup`, `bitrem_tanker_lead`, `bitrem_tanker_pup`, `fragile_glass`, `tanker_hazmat`). Integrados nos cartões de contratos do `MissionsModal` e no seletor de *Tipologia de Veículo & Carga* em `App.tsx`.
  - **4 Ilustrações Técnicas da Oficina (`ui/upgrades/upgrade_*.png`)**: bloco motor V8 turbo, disco ventilado com pinça vermelha, suspensão pneumática *air-ride* e roda/pneu pesado 10 pernos (`--maxH=256`). Integrados nos separadores de categoria e no painel de destaque técnico do `WorkshopUpgradesModal`.
  - **5 Postais Panorâmicos dos Hubs Regionais (`ui/hubs/hub_*.jpg`, `640×360`)**: cabeçalhos panorâmicos dedicados para *Porto Atlântico*, *Estaleiro Logístico*, *Polo Industrial*, *Centro Histórico* e *Serra dos Ventos*, integrados tanto no modal **Hubs & Garagens** (`App.tsx`) como na faixa de contexto do hub selecionado no **Quadro de Missões** (`MissionsModal.tsx`).
  - **10 Emblemas Metálicos de Cartas & Certificados (`ui/badges/*.png`, `--maxH=192`)**: 4 brasões de licença (`C`, `C+E`, `H`, `X`) integrados no modal **Sistema de Licenças** e 6 medalhas de especialização (`ADR_Basic`, `Heavy_Combo`, `Precision_Dock`, `Night_Ops`, `Offroad_Master`, `Fragile_Expert`) integradas no separador **Certificados** do `MissionsModal`, com destaque luminoso quando conquistados.

### **v2.21.0**
- **Áreas de Serviço Expandidas no Formato Aveiras de Cima — A1 Brisa (`rigworld.json`, `WorldObjects.ts`, `MainScene.ts`)**:
  - **Estação 1 (Norte, paralela à arterial N-S `x=3456`)**: ampliado o pavimento de manobra para `1220×940 px` + placa de saída norte `580×370 px` com rampas de entrada e saída amplas e suaves (`rd_35`, `rd_36`, `rd_37`), libertando `>450 px` de pista desimpedida antes e depois da cobertura (`gas_canopy`) para alinhamento direito de conjuntos articulados e bitrens, removendo parques que obstruíam a entrada das pistas, e criando 2 baias passantes (`pull-through`) de estacionamento TIR a oeste junto à loja e restaurante.
  - **Estação 2 (Sul, paralela à arterial E-O `y=7168`)**: redesenhada de raiz no traçado linear paralelo à autoestrada inspirado na Área de Serviço de Aveiras de Cima (A1): novas rampas curvas de entrada (`rd_50`) e saída (`rd_51`), mega-plataforma asfaltada `1660×1220 px`, zona de abastecimento paralela (`angle: 90°`) com `~490 px` de aproximação oeste e `~810 px` de saída este livres, loja de conveniência e restaurante alinhados ao centro, parques de ligeiros nas laterais e fila dedicada de **5 baias de pesados TIR + 1 baia passante para Bitrem** com corredor de manobra contínuo a sul. Hit-test de toque nas bombas em `MainScene.ts` atualizado para suportar bombas rodadas a qualquer ângulo.
- **Trovoada no Sistema de Tempo Dinâmico (`WeatherSystem.ts`, `GarageSystem.ts`, `MainScene.ts`, `MinimapScene.ts`, `WorldMapModal.tsx`, `App.tsx`)**:
  - **Células de Trovoada Dinâmicas (`kind: 'storm'`)**: adicionadas células convectivas móveis de trovoada ao simulador meteorológico (`WeatherSystem.ts`), com rajadas de vento reforçadas (`+65%` que animam as copas das árvores com maior intensidade), chuva torrencial inclinada, piso ainda mais escorregadio (`surfaceGrip 0.40`), ativação automática dos faróis e modo fixo **Trovoada** desbloqueável (Hub *Serra dos Ventos* / livre em Sandbox).
  - **Relâmpagos, Raios Ramificados & Trovões Web Audio (`MainScene.ts`)**: relâmpagos realistas de duplo pulso que iluminam instantaneamente o céu e a paisagem WebGL (incluindo à noite), raios ramificados ocasionais na periferia superior e trovões sintetizados proceduralmente em Web Audio com atraso realista pela distância (`0,22–2,1 s`), reverberação grave e onda sub-bass.
  - **Radar & HUD (`MinimapScene.ts`, `WorldMapModal.tsx`, `App.tsx`)**: células de trovoada destacadas em índigo/violeta com símbolo de relâmpago ⚡ no Minimapa e no Mapa Estratégico (`M`), ícone `CloudLightning` no indicador meteorológico do HUD e botão dedicado `Trovoada` nos modificadores de ambiente.

### **v2.20.0**
- **Áreas de Serviço Inspiradas na A1 (Brisa) & Novas Texturas (`SpriteRegistry.ts`, `WorldObjects.ts`, `WorldLightPools.ts`, `rigworld.json`, `App.tsx`)**:
  - **4 Novas Texturas 2D Top-Down de Alta Fidelidade (`public/assets/sprites/`)**: adicionadas texturas próprias com recorte transparente RGBA em estilo ilustrado coerente com o telhado (`prop_gas_canopy`) e a loja (`building_convenience_store`) para:
    - **Bombas de Combustível (`prop_gas_pump`)**: ilha oval em betão com lancil amarelo/preto, pilaretes tubulares duplos, dispensador duplo branco/esmeralda, mangueiras de Gasóleo/AdBlue/Gasolina 95, terminal multibanco, extintor e balde limpa-vidros.
    - **Totem Indicador de Preços (`prop_price_sign`)**: monólito metálico com topo esmeralda, 4 painéis digitais LED (`E5`, `E10`, `B7`, `LPG`) e ícones de serviço (camião, café, restauração).
    - **Restaurante / Área de Restauração (`building_restaurant`)**: cobertura moderna com clarabóia central, extratores/HVAC e esplanada exterior em madeira com mesas e guarda-sóis, igualmente disponível na paleta do Editor.
    - **Ilha de Ar / Água / Aspirador (`prop_air_water`)**: plataforma com pilaretes, coluna digital de ar/água e aspirador industrial.
  - **Iluminação Noturna Automática nos Totens de Preços (`WorldLightPools.ts`, `WorldObjects.ts`)**: `price_sign` registado como emissor luminoso nativo, acendendo ao entardecer/noite com halo esmeralda no asfalto (`r = 210 px`), sobreposição auto-iluminada (*unlit*) da face LED para dígitos perfeitamente legíveis no escuro e *bloom* âmbar suave.
  - **Piso de Abastecimento `PESADOS` vs `LIGEIROS` & Espaço Real para Manobras de Articulados (`WorldObjects.ts`, `rigworld.json`)**:
    - O piso do posto (`gas_canopy`) passa a usar textura real de asfalto com marcações rodoviárias nítidas **`PESADOS`** (amarelo + pictograma de camião articulado) e **`LIGEIROS`** (branco/azul + pictograma de automóvel) visíveis nas zonas de aproximação norte e sul fora da projeção do telhado.
    - Reorganizadas as estações Norte, Sul e Serra em `rigworld.json` no formato completo das Áreas de Serviço da Brisa na A1: pistas amplas (`130–175 px` livres entre ilhas de bomba) para manobras confortáveis de conjuntos articulados, zona de abastecimento, loja de conveniência, restaurante com esplanada, parques de ligeiros e baias longas para pesados TIR à volta, ponto de ar/água e iluminação perimetral.

### **v2.19.3**
- **Câmara Dinâmica com Antecipação de Trajetória (*Look-Ahead*) em Condução (`MainScene.ts`)**:
  - **Deslocação Suave na Direção do Movimento**: durante a condução, a câmara antecipa suavemente a estrada à frente (deslocando o camião no sentido contrário ao movimento até `~26%` da área visível, limitado a `300×240 px` no mundo, calibrado para velocidades de cruzeiro de camião `1,5–38 km/h` e adaptado automaticamente ao zoom e ao formato desktop/telemóvel). Em marcha-atrás aplica uma antecipação controlada (`65%`) para abrir visibilidade traseira durante manobras.
  - **Recentrar Automático & Suave ao Parar**: abaixo de `1,5 km/h`, o desvio da câmara decai com suavização exponencial independente de FPS (`k = 2,4/s`) até centrar novamente no camião, com *reset* limpo ao entrar/sair do Editor, no respawn e na troca de conjunto, mantendo o recorte de visibilidade do nevoeiro alinhado com o camião.

### **v2.19.2**
- **Animação de Vento Ultra-Leve em 100% das Árvores (`TreeWindFilter.ts`, `WorldTerrain.ts`, `WorldObjects.ts`, `MainScene.ts`)**:
  - **Shader WebGL GPU para Florestas Procedurais (`FilterTreeWind`)**: todas as camadas de copas `terrain_canopy_*` passam a ser agrupadas num único `canopyContainer` (`depth 13.8`) com um único *filter pass* WebGL em coordenadas contínuas do mundo (`0 ms` de CPU por árvore, `~0,1 ms` na GPU, zero costuras entre *chunks* `1024×1024`), aplicando rajadas suaves e ondulação orgânica sincronizadas com o vetor/velocidade do vento e a chuva do `WeatherSystem` (limitadas a `1,6–3,6 px` para manter as copas centradas sobre os troncos sólidos; desligado automaticamente no Editor e em zoom `< 0.25`).
  - **Oscilação Orgânica nos Pinheiros Individuais (`WorldObjects.renderPineCanopies`)**: os sprites em *pool* GPU de `pine_tree` (e grupos `compound`) oscilam suavemente na direção do vento com fase espacial por posição `(x, y)` (desvio de copa, torção subtil e respiração de escala, sem *draw calls* extra e desativado no Editor).
- **Correção & Afinação do Sistema de Tempo — Meteorologia Dinâmica & Ciclo Dia/Noite (`WeatherSystem.ts`, `TimeOfDaySystem.ts`, `MainScene.ts`)**:
  - **Meteorologia Dinâmica (`WeatherSystem.ts`, `MinimapScene.ts`, `WorldMapModal.tsx`, `App.tsx`)**: removido o bloqueio silencioso em `localStorage` (`rigmaster_weather_dynamic_v1=0`) que deixava a meteorologia dinâmica permanentemente desligada após escolher *Limpo* em sessões anteriores; corrigido o *bug* de respawn em que novas frentes expiravam antes de atravessar o centro/leste da ilha; aumentada a velocidade de deslocação sinóptica (`~54 px/s`, `maxLifeSec = 480–680 s`) e adicionada uma frente de chuva a oeste do eixo central (`rain-central-approach`, mantendo o spawn central 100% seco em `t=0`). Reforçado o contraste visual das frentes de chuva/nevoeiro no **Mapa Estratégico** (com barra de estado/vento ao vivo e reativação num clique) e no **Minimapa** (preenchimento + contorno nítido) e adicionado interruptor direto de **Meteorologia Dinâmica** no Menu principal.
  - **Ciclo Dia/Noite 24h (`TimeOfDaySystem.ts`, `MainScene.ts`)**: ajustada a cadência de 24h de `24 min` para **`12 minutos reais`** (`30 s = 1 hora` de jogo, arranque às `11:02`), adicionados *keyframes* de tarde quente (`15:36`) e hora dourada (`17:31`) e afinado o limiar de ativação da iluminação WebGL para transições de luz visíveis e contínuas ao longo de uma sessão normal de condução.

### **v2.19.1**
- **Colisões Exclusivas nos Troncos de Todas as Árvores (`WorldTerrain.ts`, `WorldObjects.ts`, `World.ts`)**:
  - **Árvores & Florestas Procedurais (incluindo Florestas Pintadas no Editor)**: cada árvore gerada em `WorldTerrain.paintDetail()` regista o seu tronco real (`~4.5–7.5 px` de raio físico no mundo, alinhado 1:1 com o tronco desenhado no solo) numa grelha de sub-células `256×256`. O motor cria/destrói automaticamente colisores estáticos circulares Matter.js (`obstacle_tree_trunk`, `COLLISION_CAT.GROUND_OBS`) apenas numa bolha local `5×5` (`1280×1280 px`) em torno do camião — mantendo ~15–45 corpos ativos a custo ~`0.00 ms/frame`, deixando **toda a copa aérea 100% atravessável**, e removendo instantaneamente os troncos ao pintar betão/asfalto/terra por cima no Editor (`invalidateRegion`).
  - **Pinheiros & Prefabs Compostos (`WorldObjects.ts`)**: refinado o colisor circular de tronco em `pine_tree` (`Math.max(7, min(w,h) * 0.14)`, ~`10 px` num pinheiro de `72×72` deixando a copa de `36 px` livre) e corrigido o construtor de colisores de objetos `compound` para gerar igualmente colisores circulares de tronco/mastro/rocha em vez de retângulos cheios da copa.
- **Correção Completa & Evolução Visual do Nevoeiro Atmosférico (`MainScene.ts`, `WeatherSystem.ts`)**:
  - **Causa Raiz Corrigida**: o `fogVignetteSprite` anterior usava uma escala demasiado ampla (`max(W,H) * 1.75`) que empurrava a parede densa da máscara (`0.54..1.0`) para fora do ecrã, deixando apenas `2%–10%` de opacidade quase impercetível no viewport; além disso, à noite o `tint` escuro (`0x1e293b`) misturava-se de forma invisível com a escuridão noturna.
  - **Nevoeiro Volumétrico Visível de Dia e de Noite**: máscara `fog_cutout_mask` (`512×512`) reconstruída em branco puro com dimensionamento compensado ao zoom, curva de visibilidade percetual (`fogRaw^0.72`), véu central subtil + parede de neblina densa em torno do campo de visão, interpolação suave de cor dia→luar noturno (`(224,234,244)` → `(82,102,126)`), deslocamento frontal da bolsa de visibilidade quando os faróis (Médios/Máximos) estão ligados, **6 bancos de neblina orgânicos à deriva com o vento** (`fog_wisp_puff`, ocultos no Editor) e planalto interior alargado nas células regionais de nevoeiro (`smoothstep(0.32, 1.0)`) para correspondência imediata entre o mapa meteorológico e o mundo.

### **v2.19.0**
- **Pintura Livre de Terreno no Editor (`WorldTerrain.ts`, `World.ts`, `EditorScene.ts`, `MainScene.ts`, `MinimapScene.ts`, `App.tsx`)**:
  - **Pincel de Terreno Arbitrário (`Terreno`)**: nova ferramenta no Editor para pintar livremente (clique para carimbo circular ou arraste contínuo) qualquer uma das **10 texturas contínuas (`512×512`)** do jogo — *Betão / Parque*, *Alcatrão*, *Calçada*, *Terra Batida*, *Areia / Praia*, *Relva / Prado*, *Floresta*, *Rocha Alpina*, *Granito / Cume* e *Água / Lago* — com raio ajustável (`24–360 px`, presets rápidos e teclas `[` / `]`) e borda **Suave** (4 passos de atenuação) ou **Nítida**.
  - **Corte Automático de Costa & Água (`clipWater`, ativo por omissão)**: durante o *bake* dos chunks, as pinceladas em terra são automaticamente mascaradas contra a linha de costa (`coastMetric ≥ 40`), evitando que pátios de betão, alcatrão, calçada ou terra transbordem para dentro de lagos ou do oceano (com opção no painel para desativar quando desejado, e livre ao pintar *Água*).
  - **Borracha Cirúrgica (`X`) & Desfazer (`Ctrl+Z`)**: o modo *Apagar* apaga carimbos e divide polilinhas pintadas exatamente na zona rasurada sem afetar o resto do traço; todas as ações (pintar, apagar, limpar tudo) integram na pilha de *Undo*, *Cancelar Sessão*, rascunho automático (`localStorage`) e exportação/importação JSON (`terrainPaints`, compactado por simplificação Ramer–Douglas–Peucker e 100% retrocompatível com mapas anteriores).
  - **Zero Lag & Re-Bake Localizado (`invalidateRegion`)**: pré-visualização instantânea a 60 FPS durante o arraste; ao largar o rato, apenas os 1–4 chunks `1024×1024` tocados são recalculados imediatamente (sem piscar nem travar o mapa).
  - **Física, Vegetação & Minimapa Sincronizados**: conduzir fora de estrada sobre zonas pintadas aplica a aderência real do material (`Alcatrão 100%`, `Betão 98%`, `Calçada 92%`, `Terra 68%`, `Areia 58%`, `Água 45%`), superfícies pavimentadas/terra/rocha/água limpam automaticamente as árvores procedurais (enquanto pintar *Floresta* faz nascer árvores aéreas reais), e todas as zonas pintadas surgem sincronizadas no Minimapa GPS.

### **v2.18.8**
- **Fase D4 (4/4 Trânsito AI) + Fase D5.1 (6/6 Sideviews de Camiões) Concluídas a 100% + Prompts Fase 5.2 (`SpriteRegistry.ts`, `docs/TEXTURE_PROMPTS.md`, `public/assets/sprites/vehicles/traffic/`, `public/assets/sprites/vehicles/trucks/menu/`)**:
  - **4 Sprites Base de Trânsito AI Processadas (`#FF00FF` → RGBA PNG)**: `car_compact.png` (`160×320`), `car_sedan.png` (`146×320`), `van_delivery.png` (`128×320`) e `truck_rigid.png` (`145×384`), orientadas a Norte em tons neutros prontas para tintagem GPU e pré-carregadas via `SpriteRegistry` (`TRAFFIC_ASSET_KEYS`) para o arranque da **Fase C — Trânsito AI**.
  - **Últimos 2 Perfis Laterais da Frota (`iveco_daily_4x2_sideview.png`, `scania_r_4x2_sideview.png`)**: completam **6/6 (100%)** dos tratores com ilustração lateral de estúdio nos modais *Frota* e *Oficina*.
  - **Prompts Fase 5.2 Completos (`docs/TEXTURE_PROMPTS.md`)**: adicionados todos os prompts prontos a copiar para os **14 perfis laterais de atrelados/cisternas** (`5.2.1`), **4 ilustrações técnicas da Oficina Mecânica** (`5.2.2`), **5 postais de Hubs Regionais** e **10 emblemas de Cartas/Certificados** (`5.2.3`).
- **Altura Real de Árvores & Pinheiros sobre os Camiões (`WorldObjects.ts`, `WorldTerrain.ts`, `World.ts`, `MainScene.ts`)**:
  - **Pinheiros (`pine_tree`)**: sombra projetada e tronco de madeira alinhado com o colisor físico ficam cozidos no solo (`depth 3`), enquanto a copa (`prop_pine_alpine_1`/`2`) passa a renderizar em pool GPU **por cima dos camiões e atrelados (`depth 13.9`, abaixo de viadutos `16`)** com transparência suave (`1.0 → 0.68`) apenas quando a cabina entra diretamente sob os ramos.
  - **Árvores & Florestas Procedurais (`WorldTerrain.ts` + `World.ts`)**: separação entre sombra+tronco no chunk de terreno (`depth 0`) e camada aérea transparente `terrain_canopy_*` (`depth 13.8`, `0 ms/frame`, alocada apenas em chunks com árvores) protegida por validação espacial de estradas, viadutos, pátios e edifícios (`hasTreeBlockerAt` + `RoadNetwork.query`) para que nenhuma árvore nasça sobre vias ou telhados.
- **Luzes Automáticas por Luminosidade & Meteorologia (`Truck.ts`, `MainScene.ts`, `App.tsx`, `TouchControls.tsx`)**:
  - Novo sensor crepuscular e meteorológico com histerese (`autoHeadlights`, ativo por omissão): liga automaticamente os **Médios** quando a luminosidade ambiente baixa (entardecer/noite/madrugada) ou sob chuva/nevoeiro denso, e desliga em dia claro, preservando integralmente todos os controlos manuais (`L`, botão Médios e botão Máximos).
  - Novo botão compacto **`AUTO`** (`data-testid="btn-auto-lights"`, atalho `Shift+L`) junto aos botões de Médios e Máximos no HUD.

### **v2.18.7**
- **Fase D3.2 Concluída a 100% (9/9 Props, Vegetação, Rochas, Contentores, Torres Eólicas & Coberturas de Postos) (`SpriteRegistry.ts`, `StaticWorldChunks.ts`, `WorldTerrain.ts`, `WorldObjects.ts`, `MainScene.ts`, `docs/TEXTURE_PROMPTS.md`, `public/assets/sprites/props/`)**:
  - **9 Sprites de Props Processadas (`#FF00FF` → RGBA PNG)**: recortadas via `scripts/process-sprites.mjs` com *despill* fino anti-magenta nas copas das 4 árvores e centragem exata do cubo do rotor (`512×512`, pivô exato em `(256, 256)` sem oscilação) para `container_base.png`, `tree_deciduous_1.png`, `tree_deciduous_2.png`, `pine_alpine_1.png`, `pine_alpine_2.png`, `rock_outcrop.png`, `log_pile.png`, `wind_turbine_rotor.png` e `gas_canopy.png`.
  - **Florestas, Pinhal Alpino & Encostas Rochosas Texturizadas a `0 ms/frame` (`WorldTerrain.ts`)**: `paintDetail()` passa a estampar as sprites rodadas aleatoriamente com sombra projetada subtil (árvores frondosas em prados/florestas, pinheiros alpinos na Serra dos Ventos e afloramentos graníticos nas encostas rochosas) diretamente no *bake* único de cada chunk de terreno.
  - **Props Estáticos Cozidos em `StaticWorldChunks` (`WorldObjects.ts`)**: `container_stack` (tintagem *multiply* em cache para todas as 8 cores de contentor ISO com rotação automática), `log_pile` (pilhas de toros na serraria), `rock_outcrop` (com espelhamento determinístico para variedade natural) e `pine_tree` (alternância determinística das 2 variantes com rotação única) cozidos a custo `0 ms/frame` com sombra pela silhueta alfa.
  - **Rotores Eólicos Animados & Coberturas Inteligentes de Postos (`WorldObjects.ts`, `MainScene.ts`)**: rotores `wind_turbine_rotor.png` em pool GPU sincronizados com iluminação WebGL e sombra rotativa dedicada no solo; coberturas `gas_canopy.png` sobrepostas acima dos veículos/bombas (`depth 17.5`) com **transparência automática por proximidade** (`0.96 → 0.22`) quando o jogador entra sob a pala para abastecer (e `0.42` em modo Editor), mantendo pistas e bombas 100% legíveis.
  - **Marco Fase D3 a 100%**: todas as **47 texturas de mundo** (`10/10` terreno/estradas + `6/6` tratores + `14/14` atrelados + `8/8` edifícios + `9/9` props/natureza) integradas com fallback vetorial automático.

### **v2.18.6**
- **Fase D3.1 Concluída a 100% (8/8 Telhados de Edifícios Texturizados a Custo `0 ms/frame`) (`SpriteRegistry.ts`, `StaticWorldChunks.ts`, `WorldObjects.ts`, `MainScene.ts`, `docs/TEXTURE_PROMPTS.md`, `public/assets/sprites/buildings/`)**:
  - **8 Sprites de Coberturas Processadas (`#FF00FF` → RGBA PNG `maxH=512`)**: recortadas via `scripts/process-sprites.mjs` e validadas em fundo escuro/claro `warehouse_big.png`, `warehouse_docks.png`, `shed.png`, `garage.png`, `warehouse.png`, `gabled.png`, `church.png` e `convenience_store.png`.
  - **Camada Reutilizável `solidTex` em `StaticWorldChunks.ts` (`0 ms/frame`)**: todos os edifícios texturizados são cozidos uma única vez nos `RenderTexture` `1024×1024` de cada chunk (com reamostragem `high`, iluminação WebGL completa, atualização instantânea no Editor e suporte preparado para os próximos props da Fase D3.2).
  - **Sombra de Silhueta Real & Alinhamento Inteligente (`WorldObjects.ts`)**: sombra projetada consistente para Sudeste respeitando o recorte alfa exato (incluindo a planta em cruz da `church.png` e as palas de cobertura), rotação automática `+90°` em edifícios verticais (`h > w`) para evitar distorção de telhas/clarabóias, preservação dos elementos funcionais externos (baias de serviço e pilaretes em `garage`, niveladores/batentes em `warehouse_docks` e pilaretes em `convenience_store`) e fallback vetorial automático para `archway` ou vistas de emergência.

### **v2.18.5**
- **Fase D5 (Lote 1) — Perfis Laterais (*Sideview*) no Menu da Frota & Oficina + Plano Visual de Menus (`SpriteRegistry.ts`, `TruckPreviewStage.tsx`, `FleetGarageModal.tsx`, `WorkshopUpgradesModal.tsx`, `agents.md`, `docs/TEXTURE_PROMPTS.md`)**:
  - **4 Perfis Laterais Processados (`public/assets/sprites/vehicles/trucks/menu/`)**: removidos fundos chroma key (`#FF00FF` magenta e `#00FF00` verde para o `scania_r_8x4`) via `scripts/process-sprites.mjs --maxH=320 --pad=4` e validados em fundo escuro e claro para `man_tgx_6x4_sideview.png`, `volvo_fh_6x4_sideview.png`, `scania_r_8x4_sideview.png` e `volvo_fh16_8x4_sideview.png`.
  - **Novo Componente `TruckPreviewStage.tsx` & Manifesto Sem 404 (`SpriteRegistry.ts`)**: palco de estúdio com iluminação ambiente subtil na cor da cabina, linha de piso e sombra de contacto realista; camiões com *sideview* (`4/6`) exibem o perfil lateral completo e os restantes (`iveco_daily_4x2`, `scania_r_4x2`) recorrem automaticamente à sprite top-down 2D rodada para a esquerda com *fallback* seguro em `onError`.
  - **Menu da Frota (`FleetGarageModal.tsx`) & Oficina (`WorkshopUpgradesModal.tsx`)**: cartões redesenhados com palco visual *full-bleed* no topo (ajudando o jogador a identificar de imediato o camião certo no mapa), tratamento visual suave para camiões bloqueados mantendo legibilidade total, barras compactas de combustível/estado mecânico e pré-visualização do camião ativo no topo do comparador físico da Oficina.
  - **Plano Oficial de Evolução Visual de Menus (Fase D5)**: documentado em `agents.md` (§1.3 e §1.5) e adicionada a secção Fase D5 em `docs/TEXTURE_PROMPTS.md` com os prompts prontos para os 2 perfis laterais em falta (`iveco_daily_4x2` e `scania_r_4x2`).

### **v2.18.4**
- **Fase D2 Concluída a 100% (14/14 Atrelados & Cisternas) — Frota Integralmente Texturizada em 2D (`SpriteRegistry.ts`, `docs/TEXTURE_PROMPTS.md`, `public/assets/sprites/vehicles/trailers/`)**:
  - Recortadas via `scripts/process-sprites.mjs` (magenta `#FF00FF`), validadas em fundo escuro/claro e integradas as últimas 4 sprites da frota de reboques: `bitrem_tanker_lead.png` (bitrem cisterna da frente com quinta-roda traseira), `bitrem_tanker_pup.png` (bitrem cisterna traseiro em inox/turquesa), `fragile_glass.png` (porta-vidros óticos com painéis translúcidos em cavalete A) e `tanker_hazmat.png` (cisterna química pressurizada ADR com gaiola reforçada amarela).
  - **Marco Fase D1 + D2 a 100%**: todas as **30 texturas base de superfície e frota** (`10/10` *tiles* contínuos + `6/6` tratores + `14/14` semi-reboques e cisternas) estão integradas no motor com fallback vetorial automático.

### **v2.18.3**
- **Fase D1 Concluída a 100% & Fase D2 (10/14 Atrelados) — Processamento Chroma-Key & Integração de 13 Novas Sprites de Veículos (`SpriteRegistry.ts`, `docs/TEXTURE_PROMPTS.md`, `public/assets/sprites/vehicles/`)**:
  - **Frota Completa de 6/6 Camiões Tratores (100% Fase D1)**: recortadas via `scripts/process-sprites.mjs` (magenta `#FF00FF` e verde `#00FF00` para `scania_r_8x4`), validadas em fundo escuro/claro e integradas `man_tgx_6x4.png`, `volvo_fh_6x4.png`, `scania_r_8x4.png` e `volvo_fh16_8x4.png` — ativas tanto no camião conduzido (`Truck.ts`, incluindo duplo eixo direcional nos `8×4`) como na frota estacionada no mundo (`ParkedTruckManager.ts`).
  - **9 Novos Semi-Reboques & Cisternas (10/14 Fase D2)**: recortadas e integradas `reefer.png`, `container.png`, `tanker_milk.png`, `long_cargo.png` (pá eólica), `flatbed_heavy.png` (prancha com escavadora), `timber.png` (toros florestais), `tanker_fuel.png` (cisterna ADR), `bitrem_lead.png` (com quinta-roda traseira) e `bitrem_pup.png` (chroma verde `#00FF00`), mantendo fallback vetorial automático apenas para os 4 atrelados ainda pendentes (`bitrem_tanker_lead`, `bitrem_tanker_pup`, `fragile_glass`, `tanker_hazmat`).

### **v2.18.2**
- **Fase D1 (Lote 3) — Conclusão 10/10 dos Tiles Seamless de Terreno, Estradas & Pátios (`SpriteRegistry.ts`, `WorldTerrain.ts`, `StaticWorldChunks.ts`, `WorldObjects.ts`, `MainScene.ts`, `docs/TEXTURE_PROMPTS.md`)**:
  - **7 Novas Texturas Convertidas (`512×512` PNG) & Registadas**: `tiles/pad_concrete.png`, `tiles/terrain_sand.png`, `tiles/terrain_forest.png`, `tiles/terrain_alpine_rock.png`, `tiles/terrain_alpine_summit.png`, `tiles/road_cobble.png` e `tiles/road_dirt.png` (completando **100%** dos 10 *tiles* base da Fase D1).
  - **Biomas Completos em `WorldTerrain.ts` (custo `0 ms/frame`)**: composição por *bitmask* de células num único `tileMaskCanvas` reutilizável para praias costeiras (`terrain_sand`), falésias alpinas (`terrain_alpine_rock`), solo de floresta e pinhal alpino (`terrain_forest`), encostas rochosas (`terrain_alpine_rock`), planalto do cume (`terrain_alpine_summit`, preservando relevo NW e curvas de nível de `60m`), pátios portuários/industriais/urbanos (`pad_concrete` com velatura escura de alto contraste) e pavimento histórico em calçada (`road_cobble`).
  - **Estradas & Pátios Texturizados em `StaticWorldChunks.ts`, `MainScene.ts` e `WorldObjects.ts`**: generalizado `fillTexturedRoadRibbon` para todas as superfícies rodoviárias (`asphalt`, `cobble` e `dirt`) e adicionado *scratch* dedicado para superfícies planas (`dock`, `parking_pad`, `pad_asphalt`, `pad_dirt` e `parking_lot`) com rotação alinhada ao objeto, mantendo marcações vetoriais nítidas por cima e fallback vetorial automático.

### **v2.18.1**
- **Fase D1/D2 (Lote 2) — Processador Chroma-Key & Primeiros Sprites de Veículos (`scripts/process-sprites.mjs`, `SpriteRegistry.ts`, `Truck.ts`, `Trailer.ts`, `ParkedTruckManager.ts`, `docs/TEXTURE_PROMPTS.md`)**:
  - **Utilitário Reutilizável de Recorte (`scripts/process-sprites.mjs`)**: remoção de chroma key em 2 fases (`#FF00FF` magenta e `#00FF00` verde néon) com deteção de aberturas interiores do chassi, *despill* anti-auréola nas bordas, recorte automático (*auto-trim*) com margem limpa, redimensionamento Lanczos e geração de folha de validação em fundo escuro/claro.
  - **Camiões 2D (`iveco_daily_4x2.png`, `scania_r_4x2.png`)**: integrados em `Truck.ts` (trator ativo) e `ParkedTruckManager.ts` (frota estacionada) com sombra de contacto no chão, rodas dianteiras giratórias Ackermann por baixo dos guarda-lamas, iluminação dinâmica WebGL (`setLighting`), sobreposição de danos estruturais, faróis/stop/marcha-atrás dinâmicos e fallback vetorial automático para os restantes 4 modelos.
  - **Atrelado Standard 13.6m (`standard.png`)**: integrado em `Trailer.ts` alinhado 1:1 à caixa de colisão física (`46×220`) e ao acoplamento quinta-roda, com sombra de contacto, iluminação WebGL e farolins traseiros dinâmicos (mantendo fallback vetorial nos restantes 13 atrelados).

### **v2.18.0**
- **Fase D1 (Lote 1) — Infraestrutura `SpriteRegistry` & Primeiras 3 Texturas Seamless 2D (`SpriteRegistry.ts`, `WorldTerrain.ts`, `StaticWorldChunks.ts`, `MainScene.ts`, `docs/TEXTURE_PROMPTS.md`)**:
  - **Registo Central com Fallback Vetorial (`SpriteRegistry.ts`)**: criado o manifesto central `AVAILABLE_SPRITES` com pré-carregamento seguro em `MainScene.preload()` e tratamento resiliente de falhas (`loaderror`), mantendo fallback vetorial automático para qualquer textura ainda pendente.
  - **Terreno Texturizado a Custo Zero por Frame (`WorldTerrain.ts`)**: convertidas para `512×512` PNG e integradas `tiles/terrain_water.png` (oceano profundo + batimetria costeira turquesa subtil em águas rasas) e `tiles/terrain_grass.png` (prados, transição suave em solo florestal e preservação integral do sombreamento direcional NW nas encostas da Serra dos Ventos), cozidas uma única vez por chunk `1024×1024` com alinhamento perfeito entre fronteiras.
  - **Estradas de Asfalto Texturizadas (`StaticWorldChunks.ts`, `MainScene.ts`)**: integrada `tiles/road_asphalt.png` via buffer Canvas2D reutilizável cozido nos `RenderTexture` de `StaticWorldChunks` (polígonos contínuos alinhados em coordenadas de mundo sem linhas entre segmentos, velatura subtil de alcatrão escuro e definição de berma, preservando 100% nítidas as marcações rodoviárias amarelas/brancas, setas de sentido único e aclives alpinos por cima).

### **v2.17.0**
- **Sistema Meteorológico Regional Dinâmico & Sombras de Nuvens (`WeatherSystem.ts`, `MainScene.ts`, `WorldMapModal.tsx`, `MinimapScene.ts`, `App.tsx`, `scripts/smoke-progression.mjs`)**:
  - **Frentes Meteorológicas Móveis (`WeatherSystem.ts`)**: simulação contínua de células regionais de **chuva**, **nevoeiro** e **nuvens** a deslocarem-se sobre a ilha segundo um vento atlântico predominante com variação orgânica, ciclo de vida suave (*fade-in/fade-out* e regeneração a barlavento), microclima de altitude na **Serra dos Ventos** (`> 260 m` mais cobertura nublada e vento; `> 420 m` névoa subtil de cume), neblina costeira suave ao amanhecer (`05:15–07:45`) e **memória de pavimento molhado** (*road wetness*, secagem progressiva em ~25s após sair de uma frente de chuva) com redução contínua da aderência (`1.0 → 0.48`).
  - **Sombras de Nuvens no Chão sem Obstrução (`MainScene.ts`)**: pool de 5 sombras de nuvens orgânicas em espaço de mundo com *frustum culling* (`cloud_shadow_puff`, `128×128`, `depth: 14`, opacidade máxima `0.29` modulada pela luz solar do dia) em deriva contínua com o vento, deixando zonas soalheiras nítidas entre nuvens sem nunca tapar a estrada nem os veículos; chuva inclinada pelo vento e nevoeiro com **recorte radial nítido centrado no camião** (`fog_cutout_mask`, `depth: 19`) com compensação automática de `cam.zoom` (`1 / zoom`) para cobrir 100% do ecrã de ponta a ponta em qualquer nível de zoom.
  - **Radar Meteorológico & Nuvens no Mapa Estratégico e Minimapa (`WorldMapModal.tsx`, `MinimapScene.ts`, `App.tsx`)**: vista superior em tempo real das nuvens, frentes de chuva e bancos de nevoeiro no **Mapa Estratégico (`M`)** com botão de alternância do radar, overlay discreto de chuva/nevoeiro no **Minimapa local**, ícone compacto de chuva/nevoeiro junto ao relógio do HUD (apenas quando ativo) e botão **Dinâmico** na barra de ambiente (mantendo 100% compatibilidade com os presets manuais e a chuva forçada do **Exame X**).

### **v2.16.1**
- **Isolamento de Teclado em Inputs, Zoom/Pan no Mapa Estratégico & Minimapa Local (`Truck.ts`, `MainScene.ts`, `EditorScene.ts`, `App.tsx`, `WorldMapModal.tsx`, `MinimapScene.ts`, `scripts/smoke-progression.mjs`)**:
  - **Correção de captura de teclado no Editor de Missões e restantes campos de texto**: desativada a captura global (`enableCapture = false`) em `W/A/S/D/Space/Shift/Setas` em `Truck.ts` e `EditorScene.ts` (removendo também a chamada `createCursorKeys()` por frame no `EditorScene.update()`), adicionada guarda `isTypingInInput()` em todos os atalhos `keydown-*` de `MainScene.ts` e suspensão automática dos plugins de teclado do Phaser em `App.tsx` sempre que qualquer modal ou campo `<input>`/`<textarea>`/`<select>` tem foco.
  - **Zoom & Pan no Mapa Estratégico (`WorldMapModal.tsx`)**: mantém vista completa de todo o mundo a `100%` (`1×`), adicionando zoom suave até `500%` (`5×`) por roda do rato centrada no cursor, gesto de pinça em ecrãs táteis, botões dedicados (`−`, `%`, `+`, **Centrar no Camião**, **Ver Tudo**), arraste panorâmico limitado aos limites do mundo, escala adaptativa de etiquetas/ícones (`1 / zoom^0.65`) e mapa base de terreno de maior resolução (`520 px`).
  - **Minimapa de Raio Local Escalável (`MinimapScene.ts`)**: substituída a projeção de todo o mundo por uma janela local dedicada de `6.4 km × 6.4 km` (raio de `3.2 km`) centrada no camião (ou na câmara em modo Editor) a partir da textura em cache de alta nitidez (`minimap_base` → `minimap_view`), garantindo leitura nítida de estradas e cruzamentos independentemente da futura expansão do mapa, com setas direcionais fixas na borda para objetivos de missão/exame fora da janela local.

### **v2.16.0**
- **Fase 2 — Editor Simples de Missões Personalizadas (`MissionSystem.ts`, `World.ts`, `MainScene.ts`, `MissionEditorModal.tsx`, `MissionsModal.tsx`, `App.tsx`, `scripts/smoke-progression.mjs`)**:
  - **Motor de Missões Personalizadas (`MissionSystem.ts`)**: `MissionTemplate` estendido com `isCustom` e `targetDockId` (garantindo ligação fiável à doca exata mesmo que novas docas sejam adicionadas); CRUD completo (`getCustomMissions`, `setCustomMissions`, `upsertCustomMission`, `deleteCustomMission`), integração transparente nas consultas e aceitação de missões (preservando intactas todas as 25 missões oficiais) e calculador automático de estatísticas sugeridas (`computeSuggestedMissionStats` por distância, carga, terra batida e período noturno).
  - **Persistência Integrada no JSON do Mundo (`World.ts`)**: `customMissions` guardado e restaurado automaticamente em `World.exportJSON()` / `World.loadData()`, garantindo persistência imediata no rascunho local do Editor (`localStorage`), no sistema de Undo (`Ctrl+Z`), no botão **Cancelar** da sessão do Editor e na Exportação/Importação JSON.
  - **Spawn Seguro de Atrelados em HUBs Personalizados (`MainScene.ts`)**: `ensureMissionPickupTrailer()` pesquisa agora `parking_pad`s dentro de todo o `regionRadius` do HUB de origem e, caso um HUB criado pelo jogador ainda não tenha baías, gera posições de fallback afastadas do mastro do `hub_sign` (preferindo espaço livre junto à primeira doca), garantindo missões imediatamente jogáveis.
  - **Modal «Editor de Missões» (`MissionEditorModal.tsx`, `App.tsx`, `MissionsModal.tsx`)**: acessível diretamente pela barra lateral do Editor (**Missões**) e pelo atalho **Missões deste HUB** no Inspetor de Sinal de HUB; permite criar, editar, duplicar e apagar rotas entre quaisquer HUBs (oficiais ou personalizados) com seleção de doca real de destino, tipo de atrelado/carta automática, trator mínimo, opções de rota de terra/noturna, botão **Auto** para reputação/tempo e pré-visualização em tempo real de distância, risco e prémios `S/A/B`; `MissionsModal` atualiza ao vivo e identifica rotas criadas pelo jogador com etiqueta **Personalizada**.

### **v2.15.0**
- **Fase 1 — Sinais de HUB Editáveis & HUBs Dinâmicos (`WorldObjects.ts`, `GarageSystem.ts`, `ReputationSystem.ts`, `World.ts`, `MainScene.ts`, `EditorScene.ts`, `MinimapScene.ts`, `App.tsx`, `WorldMapModal.tsx`, `MissionsModal.tsx`, `FleetGarageModal.tsx`, `rigworld.json`, `scripts/smoke-progression.mjs`)**:
  - **Novo objeto editável `hub_sign` (Sinal de HUB)**: totem arquitetónico e painel néon físico sempre visível no mapa (estado nítido permanente para todos os HUBs — incluindo **Serra dos Ventos** — e halo pulsante extra com luz noturna reforçada quando dominado a `100%`), totalmente selecionável, movível, duplicável e apagável no Editor (`Serviços → Sinal de HUB`).
  - **5 Sinais de HUB Oficiais em `rigworld.json` (`version: 7`)**: colocados em posições livres de obstáculos e estradas para **Porto Comercial**, **Estaleiro Logístico**, **Zona Industrial Sul**, **Centro Histórico** e **Serra dos Ventos** (`wo_445..wo_449`), com migração automática em `World.restoreDraft()` para rascunhos locais anteriores.
  - **HUBs Dinâmicos dirigidos pelo Mapa**: `HubId` generalizado para `string`, `GarageSystem.syncFromWorld()` atualiza ao vivo as coordenadas, nome, sigla, cor, raio de cobertura e associa dinamicamente as **Docas** (`dock`) e **Oficinas** (`garage`) por proximidade dentro do raio; criar um novo **Sinal de HUB** no Editor regista automaticamente um novo HUB dinâmico em `GarageSystem`, `ReputationSystem`, `WorldMapModal`, `MissionsModal`, `FleetGarageModal` e `MinimapScene`.
  - **Inspetor de Sinal de HUB & Pré-visualização de Raio no Editor**: ao selecionar um `hub_sign` no Editor, desenha-se o círculo de cobertura no mapa e o painel lateral permite editar **Nome**, **Sigla (Badge)**, **Cor** e **Raio de cobertura**, mostrando em tempo real quantas **Docas**, **Baías** e **Oficinas** estão ligadas ao HUB (com proteção contra atalhos de teclado durante a escrita nos campos de texto).

### **v2.14.0**
- **Continuidade Completa da Montanha & Mapa Estendido Orgânico (`WorldTerrain.ts`, `World.ts`, `MinimapScene.ts`, `WorldMapModal.tsx`, `rigworld.json`, `scripts/smoke-progression.mjs`)**:
  - **Maciço Alpino 360° sem cortes abruptos**: margem Noroeste ampliada para `WORLD_MIN_X = -6144`, `WORLD_MIN_Y = -5120`, permitindo que o cume de `640m` desça naturalmente pelas novas encostas **Crista Norte** e **Contraforte Ocidental** até pinhais costeiros, falésias rochosas e mar aberto em redor de todo o cabo.
  - **Linha de Costa 100% Orgânica & Contrafortes Norte/Oeste**: removidos os recortes retangulares artificiais (`landPatches` NW) e substituídos por união orgânica contínua (`smoothMax`) ligando a **Serra dos Ventos** aos novos **Montes do Norte** (descendo suavemente até ao **Estaleiro Logístico**) e à **Costa Atlântica Oeste** (descendo suavemente até ao **Centro Histórico**), com pequenos ilhéus rochosos nas baías exteriores e preservação absoluta a `0m` de toda a ilha original.
  - **2 Novas Estradas Panorâmicas & Cenário Alpino**: adicionadas `rd_48` (**Estrada Panorâmica do Norte**, ligando a base da Serra pelos Montes do Norte diretamente ao Estaleiro Logístico, com sinalização de subida/descida acentuada e **Miradouro Montes do Norte**) e `rd_49` (**Estrada Costeira do Atlântico**, ligando a Via Costeira Oeste pelas colinas atlânticas ao Centro Histórico, com **Miradouro do Atlântico**), enriquecidas com pinheiros alpinos e afloramentos graníticos (`rigworld.json` promovido para `version: 6` com migração automática de rascunhos locais).
  - **Mapa Estratégico & Minimapa Fiéis ao Relevo Real**: `WorldMapModal.tsx` renderiza agora a silhueta costeira, águas rasas, relevo de altitude e curvas de nível diretamente a partir de `WorldTerrain` (substituindo elipses fixas), e o minimapa/visão geral exibem a nova costa orgânica e falésias alpinas com `1:1` de coerência.

### **v2.13.3**
- **HUD Superior Mais Limpo, Sinais de Subida/Descida Acentuada & Calibração de Declive (`App.tsx`, `WorldObjects.ts`, `WorldTerrain.ts`, `MainScene.ts`, `World.ts`, `rigworld.json`)**:
  - Removido o indicador duplicado de integridade/dano do trator no HUD superior (já visível no HUD inferior), libertando espaço horizontal na barra do topo.
  - Adicionadas duas novas variantes de sinalização rodoviária europeia (A2b `steep_uphill` — *Subida Acentuada* e A2a `steep_downhill` — *Descida Acentuada*), desenhadas com triângulo vermelho de perigo, cunha inclinada e seta direcional de alto contraste, disponíveis também no catálogo **Trânsito** do Editor.
  - Calibrada a escala de leitura de declive alpino (`WorldTerrain.ALPINE_GRADE_SCALE = 0.42`) para valores rodoviários realistas (`7%–18%` na Serpentina e Picada Florestal, `0%` em patamares planos).
  - Colocados 14 sinais de subida/descida acentuada ao longo das bermas reais da **Serra dos Ventos** (subida da Serraria, Serpentina da Serra e Picada Florestal) com `0` sobreposições OBB/SAT e migração automática em `World.restoreDraft()` (`version: 5`).

### **v2.13.2**
- **Binário de Marcha-Atrás Reduzida & Retenção em Declive (`Truck.ts`, `scripts/smoke-progression.mjs`)**:
  - Corrigida a perda de marcha-atrás ao descer inclinações acentuadas na Serra dos Ventos: a marcha-atrás (tanto tecla `S` como caixa `R` nos controlos táteis) passa a modelar relação curta de binário reduzido (*crawler*), vencendo sempre a gravidade da rampa mesmo com atrelados pesados e mantendo velocidade controlada e progressiva a recuar encosta acima.
  - Adicionada reserva de binário de 1.ª velocidade reduzida em subidas íngremes para a frente (evitando estagnação com cargas pesadas) e retenção de travão de serviço parado em inclinações (*hill-hold*).

### **v2.13.1**
- **Migração Automática de Rascunhos Antigos (`World.ts`, `rigworld.json`, `scripts/smoke-progression.mjs`)**:
  - Corrigido o cenário em que navegadores com um rascunho de editor guardado em `localStorage` (`rigmaster_world_draft` anterior à expansão Noroeste) carregavam apenas o terreno montanhoso sem as estradas, hub, posto de abastecimento, serraria e torres eólicas da **Serra dos Ventos**.
  - `rigworld.json` promovido para `version: 4` e `World.restoreDraft()` passa a fundir automaticamente as 6 estradas e todos os objetos oficiais da Serra dos Ventos em rascunhos legados (preservando eventuais edições na ilha principal).
  - `World.endEditorSession()` passa a gravar `localStorage` apenas quando houve alterações efetivas na sessão de editor, evitando fixar snapshots obsoletos ao abrir/fechar o Editor sem editar.
  - Adicionado acesso asfaltado dedicado (`wo_385`) entre a estrada da Serraria (`rd_44`) e o Posto de Combustível da Serra (`wo_313`/`wo_314`).

### **v2.13.0**
- **Expansão Montanhosa Noroeste — 5.º Hub Regional «Serra dos Ventos» (`WorldTerrain.ts`, `World.ts`, `StaticWorldChunks.ts`, `WorldObjects.ts`, `Truck.ts`, `GarageSystem.ts`, `ReputationSystem.ts`, `MissionSystem.ts`, `MainScene.ts`, `MinimapScene.ts`, `WorldMapModal.tsx`, `EditorScene.ts`, `App.tsx`, `rigworld.json`)**:
  - **Mapa alargado para Noroeste sem alterar RigWorld existente**: espaço negativo `[-5120..13824, -4096..10240]` preservando integralmente todas as 38 estradas e 258 objetos originais da ilha; ligação dupla livre de obstáculos pelo Corredor Norte (`rd_42` a partir de `rd_2`) e pela Via Costeira Oeste (`rd_43` a partir de `rd_8`).
  - **Relevo 2D de Montanha & Física de Rampa**: campo contínuo de altitude (`0m` plano na ilha original → patamar plano de `210m` na Serraria → crista e planalto do Cume a `640m`), sombreamento direcional de encostas (hillshading NW), curvas de nível topográficas de `60m`, biomas alpinos (floresta de coníferas, rocha de encosta, granito de altitude), setas subtis de aclive desenhadas nas estradas inclinadas, leitura compacta de altitude/declive no HUD e física longitudinal de gravidade em `Truck.ts` (perda de embalo e maior consumo a subir, aceleração e aquecimento extra de travões a descer, retenção em travão de mão).
  - **Zona de Madeireiros / Serraria (`210m`)**: serração industrial, 8 pilhas de toros (`log_pile`), doca dedicada (`wo_301`), Oficina da Serra (`wo_310`), Posto de Combustível, 4 baías universais e atrelados florestais livres (`timber`).
  - **Parque Eólico do Cume (`640m`)**: acesso por serpentina alpina asfaltada com curvas largas (`rd_45`, `w=124px` apta para pás eólicas de 62m) ou picada florestal em terra batida (`rd_47`), anel panorâmico de serviço (`rd_46`), 6 torres eólicas gigantes animadas (`wind_turbine`) com rotores giratórios de 3 pás, sombras móveis e farolins vermelhos de aviação, subestação elétrica e 2 docas de cume (`wo_302` Cume Norte, `wo_303` Subestação).
  - **Progressão, Missões, Mapa Estratégico & Editor**: 5.º hub `serra` totalmente integrado em `GarageSystem`, `ReputationSystem` e `MissionSystem` (+5 novas missões de montanha, totalizando 25 missões); minimapa e `WorldMapModal` atualizados com curvas topográficas e ícones de torres eólicas; 4 novos prefabs alpinos disponíveis no Editor (`Torre Eólica`, `Pilha de Toros`, `Afloramento Rochoso`, `Pinheiro Alpino`).

### **v2.12.6**
- **Menus e Modais Otimizados para Ecrãs Pequenos (Mobile Portrait/Landscape):**
  - `MissionsModal`: cabeçalho empilhado em `<sm` (`flex-col sm:flex-row`) com botão fechar alinhado ao título e seletor segmentado `Missões | Certificados` em largura total; barra de filtros de hubs convertida para faixa horizontal deslizável numa única linha em mobile (`overflow-x-auto`) libertando >65% da altura útil para a lista de missões; barra de contexto compacta e botões de ação em largura total (`w-full sm:w-auto`).
  - `FleetGarageModal`: cabeçalho responsivo empilhado com `Mapa da Frota` em largura total em ecrãs estreitos e cartões com ações `flex-wrap` sem transbordo horizontal.
  - `WorkshopUpgradesModal`: cabeçalho e faixa de estado mecânico adaptados a ecrãs estreitos, grelha fixa de 4 colunas (`grid-cols-4`) para os separadores `Motor | Travões | Suspensão | Pneus` e botão `Instalar` em largura total em mobile.
  - `WorldMapModal`: corpo com scroll vertical em mobile (`overflow-y-auto lg:overflow-hidden`) com mapa limitado a `max-h-[52dvh]` e painel lateral/legenda empilhados sem corte.
  - Modais em `App.tsx` (Conclusão de Missão, Licenças, Garagens/Meteorologia e Exportar/Importar JSON): altura máxima `max-h-[92dvh]`, espaçamento compacto (`p-2 sm:p-4`), barra rápida meteorológica com quebra de linha controlada (`flex-wrap`) e rodapés empilhados em ecrãs pequenos.

### **v2.12.5**
- **Incorporação do Mapa Oficial Editado de RigWorld (`rigworld.json`, `WorldObjects.ts`, `World.ts`, `scripts/smoke-trailers.mjs`, `scripts/smoke-bridge.mjs`, `scripts/smoke-progression.mjs`)**:
  - **Novo traçado oficial de RigWorld**: integradas todas as 38 estradas e 6 viadutos elevados (`rd_22`, `rd_25`, `rd_28`, `rd_30`, `rd_32`, `rd_39` com nós rodoviários a Norte e Centro + ligação ao Porto Comercial), os novos terminais logísticos compostos no Porto Comercial (`wo_280`) e Centro-Oeste (`wo_281`), docas portuárias ampliadas (`wo_1..wo_5`), plataforma asfaltada (`wo_282`), nova iluminação e posto de combustível atualizado.
  - **Suporte nativo a baías universais dentro de compostos (`WorldObjects.ts`)**: `parkingPads` decompõe agora objetos `compound` (tal como `repairBays`), tornando as 8 baías dos novos terminais compostos elegíveis para spawn automático de atrelados de missão.
  - **Normalização & zero sobreposições**: todas as 19 baías convertidas para baías universais sem ligação a atrelados (`asphalt`/`concrete`/`hazard`/`clean`), 2 sobreposições legadas (`wo_40..41` vs `wo_98`) corrigidas e os 14 atrelados soltos (todas as 12 famílias + ambos os `pup`) distribuídos com 0 sobreposições OBB/SAT contra os 86 sólidos e os 6 camiões da frota.
  - **Reposição oficial (`World.ts`)**: `reseed()` (*Restaurar RigWorld Original*) limpa o rascunho local e recarrega o ficheiro oficial `rigworld.json` em vez da semente procedural antiga.

### **v2.12.4** (branch main)
- **Renomeação Oficial do Mapa para RigWorld (`rigworld.json`, `World.ts`, `WorldMapModal.tsx`, `MissionSystem.ts`, `App.tsx`, `scripts/test-phase1-systems.ts`)**:
  - Ficheiro oficial do mapa renomeado de `ilha_atlantica.json` para `rigworld.json` e todas as referências na interface, missões, mapa estratégico e testes atualizadas de *Ilha Atlântica* para **RigWorld** (com migração automática de `name` em rascunhos locais guardados em `localStorage` sem perder edições do utilizador).
  - Adicionado botão **Copiar JSON** no modal de Importar/Exportar JSON (junto a *Descarregar .json* com prefixo `rigworld_*.json`) para facilitar a exportação e integração de mapas editados no Editor.

### **v2.12.3** (branch main)
- **Baías de Estacionamento Universais (`WorldObjects.ts`, `TrailerManager.ts`, `MainScene.ts`, `EditorScene.ts`, `MinimapScene.ts`, `App.tsx`, `ilha_atlantica.json`, `scripts/smoke-trailers.mjs`)**:
  - **Desacoplamento total de cartas e tipologias**: todos os `parking_pad` passam a ser baías universais compatíveis com qualquer semi-reboque ou bitrem, sem ligação a `params.trailer`, sem cores por carta e sem silhuetas fixas.
  - **4 estilos gráficos puramente visuais**: `asphalt` (*Baía Asfalto*), `concrete` (*Baía Betão*), `hazard` (*Baía Segurança*) e `clean` (*Baía Longa / Moderna*), com guias subtis de alinhamento central; editáveis no Editor via catálogo **Baías**, redimensionáveis diretamente nas pegas de canto (`RESIZABLE_TYPES`) e com seletor de estilo visual no inspetor.
  - **Atrelados livres independentes & spawn inteligente de missões**: `TrailerManager.rebuild()` deixa de gerar atrelados automaticamente a partir de `parking_pad`s e instancia apenas objetos independentes `'trailer'` no mapa (14 atrelados livres em `ilha_atlantica.json`, cobrindo todas as 12 famílias + ambos os `pup` de bitrem e deixando baías universais vazias em todos os hubs). Ao aceitar uma missão, `ensureMissionPickupTrailer()` procura primeiro uma `parking_pad` universal livre no hub de origem (priorizando comprimento adequado e proximidade com verificação de folga) para alinhar o atrelado diretamente na baía, respeitando baías movidas ou criadas no Editor.
  - **Invalidação completa da cache GPU no Editor (`MainScene.ts`)**: `StaticWorldChunks` e camadas suspensas monitorizam `world.version + world.objects.version`, garantindo atualização visual imediata ao mover, rodar, redimensionar ou trocar o estilo de qualquer objeto no Editor.

### **v2.12.2** (branch main)
- **Otimização de Desempenho para Ecrãs Grandes & Iluminação Contínua de Candeeiros (`StaticWorldChunks.ts`, `WorldLightPools.ts`, `RoadNetwork.ts`, `WorldObjects.ts`, `WorldTerrain.ts`, `MainScene.ts`, `config.ts`, `scripts/smoke-test.mjs`)**:
  - **Cache GPU em Chunks (`StaticWorldChunks.ts`)**: todas as camadas vetoriais estáticas do solo (`flats`, estradas `layer: 0`, `roadFlats` e `solids`) passam a ser rasterizadas uma única vez em `RenderTexture`s de `1024×1024` com *mipmap* WebGL e *pooling* LRU (`MAX_CACHE = 56`), substituindo a reconstrução e submissão CPU de dezenas de milhares de comandos `Graphics` por alguns *quads* texturizados por frame; invalidação imediata ao editar no Editor (`roadNetwork.version` / `world.objects.version`) e pré-carregamento com margem *lookahead* de `200 px`.
  - **Cache de Splines & Viadutos Estáticos (`RoadNetwork.ts`, `MainScene.ts`)**: `getRoadSamples()` e `getRoadBounds()` colocam em cache as amostras Hermite e limites por `roadNetwork.version`; viadutos (`bridgeShadowGraphics`, `bridgeRoadGraphics` e `rampBaseGraphics` em `depth 3.5`) reconstroem apenas quando a rede rodoviária é alterada, e não em cada movimento da câmara.
  - **Camadas Leves com Baixa Frequência de Redraw (`WorldObjects.ts`, `MainScene.ts`)**: `lightsGraphics` (semáforos), `overheadGraphics` (braços de candeeiros) e `overheadLightsGraphics` (lâmpadas emissivas) só redesenham em mudança de fase/edição ou deslocação `> 200 px` (com modulação de opacidade por `setAlpha(lampFactor)` sem limpar geometria); decomposição de compostos (`compound`) adicionada também à recolha de emissores/luzes.
  - **Iluminação Sem Pop-In de Candeeiros em Qualquer Zoom (`WorldLightPools.ts`, `config.ts`)**: substituído o antigo pool WebGL de 4 slots (que ligava/desligava candeeiros bruscamente ao aproximar em zooms baixos) por um sistema *batched* em `BlendModes.ADD` com textura radial suave partilhada (iluminação uniforme no pavimento em `depth 4.2` + reflexo subtil sobre cabines/atrelados em `depth 14.2` para **todos** os candeeiros, bombas, coberturas de combustível, semáforos e neons de hubs visíveis + margem offscreen de `420 px`). `render.maxLights` reduzido de `8` para `4` (exclusivo para faróis, stops e marcha-atrás do camião), cortando para metade o custo do shader `Light2D` em ecrãs 1080p/1440p/4K.
  - **Correção de Terreno Noturno (`WorldTerrain.ts`)**: `overviewImg` mantém sempre `setLighting(this.lightingEnabled)` sincronizado, eliminando quadrados cinzentos não iluminados durante o streaming de chunks à noite em zoom baixo.

### **v2.12.1** (branch main)
- **Persistência Real, Fecho de Exploits & Dimensões Físicas por Camião (`ReputationSystem.ts`, `MissionSystem.ts`, `Truck.ts`, `ParkedTruckManager.ts`, `MainScene.ts`, `MissionsModal.tsx`, `WorkshopUpgradesModal.tsx`, `WorldObjects.ts`, `App.tsx`)**:
  - **Persistência contínua do camião ativo**: restauro via `applyFleetState()` no boot quando existe frota guardada, autosave a cada `5s`, *flush* em `pagehide`/`visibilitychange` e sincronização imediata ao reparar, abastecer, repor ou concluir missões.
  - **Isolamento rigoroso Carreira ↔ Sandbox**: `evaluateTruckUnlocks()` avalia exclusivamente `careerReputation`/`careerCertificates`, impedindo qualquer contaminação de desbloqueios ao arrancar em Sandbox e voltar para Carreira.
  - **Integridade de desgaste e missões**: seleção direta em *Menu → Tipologia de Veículo* restringida exclusivamente ao modo Sandbox (na Carreira os atrelados são acoplados fisicamente nos parques ou missões); `spawnVehicleRig()` preserva dano/desgaste (reparação explícita apenas ao iniciar exames); tecla `R` bloqueada durante missões ativas em Carreira e convertida em **reboque de emergência** em condução livre na Carreira (reposiciona na estrada mais próxima com pequeno custo de combustível `-5 L`, ou junto à bomba mais próxima quando sem combustível, mantendo todos os danos, desgaste e integridade da carga; reposição completa a 100% mantida em Sandbox e exames); atrelados soltos danificados nunca são curados ao aceitar missões; `acceptMission()` impede substituição silenciosa de missão ativa; `Precision_Dock` mede tempo real na zona da doca (`≤520 px`, reset `>600 px`, sem fallback `30s`).
  - **Dimensões físicas reais por modelo**: `Truck` e `ParkedTruckManager` aplicam `width`, `length`, `wheelbase` e `hitchOffsetY` reais de `TRUCK_CATALOG` com reconstrução dos corpos Matter.js.
  - **Polimento UI, Ciclo 24h & Higiene**: duração do ciclo automático 24h ajustada para `24 min` reais (`1 min` real = `1 h` de jogo); `MissionsModal` sincroniza o separador com `currentHubId` ao abrir; `WorkshopUpgradesModal` suporta pré-visualização por toque em ecrãs táteis; limpeza de `resetTelemetry()` / `missionCollisionTracker` em trocas/spawns; remoção de código morto `truck_parked`; script `npm run test:phase1` adicionado e todas as 7 suites verdes.

### **v2.12.0** (branch main)
- **Sistema de Progressão por Reputação Regional, Certificados, Frota Física, Sidegrades & Missões (`TruckCatalog.ts`, `ReputationSystem.ts`, `MissionSystem.ts`, `ParkedTruckManager.ts`, `GarageSystem.ts`, `Truck.ts`, `MainScene.ts`, `MinimapScene.ts`, `WorldObjects.ts`, `App.tsx`, `components/MissionsModal.tsx`, `components/FleetGarageModal.tsx`, `components/WorkshopUpgradesModal.tsx`, `components/WorldMapModal.tsx`)**:
  - **Reputação Regional & 20 Missões Distintas por Hub**: cada um dos 4 hubs existentes (*Porto Comercial*, *Estaleiro Logístico*, *Zona Industrial Sul*, *Centro Histórico*) oferece 5 contratos distintos coerentes com a sua especialização, filtrados automaticamente por licença, configuração de eixos do trator ativo, certificados e reputação; a conclusão calcula `baseRep × rating (S=1.5 / A=1.2 / B=1.0 / C=0.7) × risco` sem dinheiro nem espera.
  - **6 Certificados de Especialização**: `ADR_Basic` (3 cisternas combustível A+ sem reparar), `Heavy_Combo` (5 bitrens A+ alinhamento `≤3°`), `Precision_Dock` (10 docas consecutivas `≤1.5°` / `≤45s`), `Night_Ops` (5 missões 22h–06h A+), `Offroad_Master` (3 rotas de terra A+ sem jackknife) e `Fragile_Expert` (3 vidro/ADR rating S com `cargoHealth ≥95%`).
  - **Frota Física de 6 Camiões & Troca Presencial**: `Iveco Daily 4×2`, `Scania R 4×2`, `MAN TGX 6×4`, `Volvo FH 6×4`, `Scania R 8×4` e `Volvo FH16 8×4`, todos com posições iniciais validadas por OBB/SAT (`0` colisões com sólidos/pads). Camiões desbloqueados aparecem fisicamente no mundo (`ParkedTruckManager`) com colisor sólido no piso respetivo e halo de proximidade; trocar (`T` ou clique/botão a `≤160 px`, parado `≤3 km/h`) desacopla atrelados no local e estaciona o camião anterior preservando posição, upgrades, desgaste, danos e combustível.
  - **Upgrades como Sidegrades Físicos Reais**: 4 slots (`Motor`, `Travões`, `Suspensão`, `Pneus`) instaláveis em baias de oficina (ou em qualquer local no modo Sandbox) com compromissos físicos reais (binário vs consumo/desgaste, fade térmico vs eficiência a frio nos cerâmicos, estabilidade em carga pesada vs vazio, aderência terra/chuva vs asfalto) e comparador numérico em tempo real.
  - **Modo Sandbox Isolado**: alternador **Carreira ↔ Sandbox** no Menu desbloqueia imediatamente todos os 6 camiões, 20 missões, upgrades livres e troca remota sem contaminar o `localStorage` da Carreira.
  - **Interface Completa & Mapa Estratégico (`M`)**: novos modais *Missões & Certificados*, *Frota & Garagem*, *Oficina de Upgrades* e *Mapa Estratégico* vetorial (atalho `M`), banner de missão ativa, ecrã de resumo pós-missão, aviso térmico de travões (`≥45%`) e marcadores de frota/missão no minimapa (`MinimapScene`).
  - **Compatibilidade Vite 8 Preview (`vite.config.ts`)**: adicionado `allowedHosts: true` em `server` e `preview` para pré-visualização remota sem `403 Forbidden`.
  - **Testes Automáticos (`scripts/smoke-progression.mjs`, `scripts/test-phase1-systems.ts`)**: novo script `npm run test:smoke:progression` cobrindo folga OBB/SAT da frota, reputação, certificados, spawn/troca física, física de sidegrades, reparação, isolamento do Sandbox, persistência e todos os modais interativos da UI.

### **v2.11.0** (branch main)
- **Expansão de Frota: Cisternas & Novos Semi-Reboques Especializados (`Trailer.ts`, `DamageSystem.ts`, `TrailerManager.ts`, `LicenseSystem.ts`, `MainScene.ts`, `WorldObjects.ts`, `ilha_atlantica.json`, `App.tsx`)**:
  - **Cisternas para Líquidos Variados**:
    - `tanker_milk` (**Classe C**, inox polido, `46×220`, 95t): Cisterna Leite / Alimentar com bocas de inspeção e passadiço superior.
    - `tanker_fuel` (**Classe C+E**, branco/vermelho combustível com placas ADR `30 / 1203`, `46×248`, 118t, 3 eixos): Cisterna Petróleo / Combustível ADR.
    - `bitrem_tanker_lead` + `bitrem_tanker_pup` (**Classe H**, duplo tanque `2×155px`, 62t cada): Bitrem Cisterna Dupla para Combustível com acoplamento em 2 quintas rodas compatíveis exclusivamente entre si.
    - `tanker_hazmat` (**Classe X**, amarelo/laranja perigosos com losangos ADR e válvulas reforçadas, `46×225`, 105t, `isFragile = true`): Cisterna Líquidos Perigosos ADR com tolerância reduzida a impactos e G lateral.
  - **Novos Atrelados Especializados (Não-Cisternas)**:
    - `reefer` (**Classe C**, `46×220`, 90t): Frigorífico 13.6m com unidade ThermoKing frontal, frisos de frio e depósito inferior.
    - `container` (**Classe C**, `46×220`, 92t): Porta-Contentores ISO 40ft sobre chassis esquelético com travas *twist-lock* e nervuras onduladas.
    - `flatbed_heavy` (**Classe C+E**, `48×275`, 135t, 3 eixos): Prancha Pesada em aço/madeira transportando uma escavadora hidráulica de rastos amarrada com correntes e rampas traseiras.
    - `timber` (**Classe C+E**, `46×255`, 115t, 3 eixos): Florestal / Toros de Madeira com fueiros laterais de aço e feixes de troncos empilhados.
  - **Física, Dano, Mapa & Editor**:
    - Perfis próprios em `CARGO_PROFILES` calibrados por tipo (ex.: limiar de força lateral G reduzido nas cisternas para simular oscilação de líquidos/*slosh*).
    - **Colisões entre atrelados (`CollisionLayers.ts`, `Trailer.ts`, `Truck.ts`, `MainScene.ts`)**: máscaras Matter.js atualizadas (`TRAILER_COUPLED_*` / `TRAILER_PARKED_*` / `TRAILER_PARKED_PUP_*`) com filtro por identidade do próprio conjunto (`isOwnRigBody`), resposta de ricochete via `truck.vLong` e deteção `computeTailBlocked()` no plano do pára-choques traseiro, impedindo atravessamentos sem bloquear o corredor de engate da quinta roda (incluindo `bitrem_lead` / `bitrem_tanker_lead` em `bitrem_pup` / `bitrem_tanker_pup`).
    - Todas as variantes integradas na progressão das 4 cartas existentes (`C`, `CE`, `H`, `X`), distribuídas pelos parques do mapa (`WorldObjects.ts` / `ilha_atlantica.json`) com silhuetas e cores por carta nos `parking_pad`, e selecionáveis tanto no **Menu → Tipologia de Veículo** como no catálogo **Atrelados** / **Pads** e inspetor do Editor; validado por `npm run test:smoke:trailers` (`scripts/smoke-trailers.mjs`).
  - **Auditoria & Robustez (Física, Danos, Exames & Mapa)**:
    - **Reparação atómica (`MainScene.ts`)**: `tryRepair()` partilha `findReachableRepairBay()` (`REPAIR_BAY_RADIUS = 160 px`, piso `0` obrigatório) pelas 3 vias (`E`, botão `🔧`, toque na baia), valida velocidade viva (`|vLong|/4.5 <= 3 km/h`) sem nunca travar o camião antes da validação e limpa `peakGForce`/`maxGForce`.
    - **Integridade de Exames (`LicenseSystem.ts`, `MainScene.ts`, `App.tsx`)**: troca manual de veículo e reposição (`R`) bloqueadas durante exame ativo; `examCollisionBaseline` sincronizado em cada spawn; **Exame H (Bitrem)** inclui o `pupTrailer` em colisões, *jackknife* (limite `65°`), alinhamento de doca e telemetria com temporizador de *jackknife* em segundos (`>= 2.0s`); **Exame X** aplica e restaura chuva automaticamente, calibra o acelerómetro com `PX_PER_G = 159`, falha acima de `1.2g` e exibe **G-Meter** ao vivo no banner de exame.
    - **Física, Dano & Mapa (`DamageSystem.ts`, `Truck.ts`, `Trailer.ts`, `TrailerManager.ts`, `WorldObjects.ts`, `ilha_atlantica.json`)**: `dt` limitado a `[0.001, 0.05]s`; limiares de curva lateral recalibrados (`78–122 px/s²`) e ângulo de teclado a alta velocidade aumentado (`0.68`); `pupTrailer` usa o próprio `CARGO_PROFILES`; `rollingDragFactor` afeta aceleração/velocidade máxima; dano de direção reduz resposta; desgaste em terra/fora-de-estrada cobre terra (`roadGrip <= 0.70`); toques sem dano não contam como colisão e respeitam `cooldown`; `resetTelemetry()` explícito e deduplicação completa no HUD; preservação de dano de atrelados soltos ao sair do editor (`rebuild(pads, true)`); cores dos `parking_pad` unificadas via `LICENSE_COLORS_HEX`; pads `wo_34..37` e `wo_40..42` reposicionados sem sobreposições sólidas (validado por lint OBB/SAT em `smoke-trailers.mjs`).

### **v2.10.0** (branch main)
- **Sistema Realista de Danos, Desgaste & Reparação em Garagem (`DamageSystem.ts`, `Truck.ts`, `Trailer.ts`, `WorldObjects.ts`, `World.ts`, `MainScene.ts`, `TouchControls.tsx`, `App.tsx`)**:
  - **Modelo de integridade em 3 camadas**:
    - **Camião (`truck.damage`)**: subsistemas independentes (`engine`, `steering`, `chassis`, `lights`) com índice ponderado (`overall`: 35% motor, 25% direção, 25% chassi, 15% luzes) e tendência lateral subtil (`steerPull`).
    - **Estrutura do Atrelado (`trailer.trailerHealth`)**: integridade estrutural/eixos que aumenta gradualmente o arrasto de rolamento (`rollingDragFactor`) quando danificada.
    - **Carga (`trailer.cargoHealth`)**: perfis de sensibilidade por tipo de atrelado (`CARGO_PROFILES` para `standard`, `long_cargo`, `bitrem_lead`, `bitrem_pup` e `fragile_glass`), mantendo o alias retrocompatível `fragileHealth`.
  - **Física de colisão por velocidade normal (`px/s`) & zona de impacto**:
    - Calculada a velocidade real de impacto ao longo da normal de contacto (`computeNormalImpactSpeedPxS` com `cooldown` de `200ms`); toques lentos de estacionamento ou encosto em doca (`< 22 px/s` / `< ~4.9 km/h`) aplicam **0% de dano** no camião e carga.
    - Classificação local do contacto (`front` / `side` / `rear` + lado esquerdo/direito): colisões frontais castigam mais motor/faróis, laterais afetam direção/chassi e introduzem um ligeiro desvio (`steerPull`), e traseiras afetam chassi/acoplamento.
  - **Consequências mecânicas, visuais e de condução**:
    - Degradação progressiva de binário e velocidade máxima com o desgaste do motor; abaixo de `15%` entra em **modo de emergência** (torque e velocidade reduzidos) com som de motor a falhar e fumo de capô (`engine < 40%`).
    - Riscos/amolgadelas visíveis na pintura da cabine (`<80%` e `<45%`) e dano independente por farol (`leftLight` / `rightLight`) e luzes traseiras (`rearLights`: stops/presença e marcha-atrás no camião e nos atrelados): perda gradual entre `45–74%`, falha intermitente entre `25–44%` e corte completo das luzes WebGL e das lentes abaixo de `25%`.
    - Desgaste contínuo em condução abusiva: *jackknife* sustentado (`> 0.6s`), curvas a alta velocidade com G lateral elevado e condução rápida em terra batida/fora de estrada afetam `trailerHealth` e `cargoHealth`.
  - **Baias de Reparação nas Oficinas (`garage`) sem microgestão financeira**:
    - `WorldObjects.repairBays` expõe as baias frontais de todos os edifícios `building` com `variant: 'garage'` (incluindo os integrados em compostos), com destaque pulsante ao aproximar (`≤ 160 px`).
    - Parado na oficina (`≤ 3 km/h`), premir **`E`**, tocar na baia no mapa ou no botão **`🔧`** repara o camião (`100%`) e a estrutura do atrelado (`100%`), **preservando os danos já sofridos na carga** até ao fim da viagem; o respawn (`R`) repõe tudo a `100%` para testes e exames limpos.
  - **Feedback áudio/visual e HUD minimalista**:
    - Faíscas de impacto, fumo de motor, tremor de câmara proporcional, áudio sintetizado (embate metálico, vidro frágil, chave de oficina) e avisos *edge-triggered* sem poluir o ecrã quando tudo está a `100%`.
  - **Otimização de Renderização & HUD**:
    - `updateWebGLLighting()` ativa o pipeline shader WebGL apenas quando `lampFactor >= 0.08`, o ambiente escurece significativamente ou há chuva/nevoeiro (evitando o custo do shader `Light2D` durante horas diurnas limpas fora do pico `12:30`), `maxLights` ajustado para `8` (`MAX_WORLD_LIGHTS = 4`), cache de `repairBays` por `WorldObjects.version` com marcação estática movida para `solidsGraphics`, margem de *eviction* do terreno reduzida para `±1` chunk, *dirty-tracking* em `pumpGraphics`/`impactGraphics`/`weatherGraphics`/rodas/luzes e deduplicação do *polling* de telemetria em `App.tsx`.
  - **Teste automático (`scripts/smoke-damage.mjs`)**: novo script `npm run test:smoke:damage` integrado na bateria de validação.

### **v2.9.0** (branch main)
- **Sistema de Pontes & Viadutos / Desníveis (`CollisionLayers.ts`, `RoadNetwork.ts`, `IntersectionSystem.ts`, `Truck.ts`, `Trailer.ts`, `TrailerManager.ts`, `MainScene.ts`, `MinimapScene.ts`, `EditorScene.ts`, `App.tsx`)**:
  - **Camada vertical por estrada (`layer: 0` Solo vs `layer: 1` Viaduto)**: estradas elevadas cruzam sobre vias e objectos no solo sem gerar nós de intersecção a meio do vão (`IntersectionSystem`), enquanto as extremidades das rampas ligam normalmente à malha de piso `0`.
  - **Rampas automáticas e histerese de portal**: `RoadNetwork.sampleBridgeRoad()` cria automaticamente rampas de entrada/saída nos dois extremos (`rampLen = min(180px, 32% * totalLen)`, aviso de ponte curta `< 260px`) e `resolveVehicleElevation()` verifica o centro e os extremos dianteiro/traseiro do veículo garantindo que camiões/atrelados que passam por baixo nunca saltam para o tabuleiro, entrando suavemente assim que o pára-choques entra no portal (`z <= 0.28`).
  - **Camadas visuais (`depth`) & transparência de passagem inferior**: a base das rampas junto ao solo (`z < 0.28`) renderiza em `rampBaseGraphics` (`depth: 2.6`, abaixo dos veículos do piso 0) enquanto o tabuleiro e sombras elevadas (`z >= 0.28`) renderizam em `bridgeShadowGraphics` (`depth: 15`) e `bridgeRoadGraphics` (`depth: 16`) acima dos veículos e candeeiros do solo (`depth: 10..14.5`). Todo o conjunto acoplado (camião + atrelados) sobe em bloco para `depth: 20..22` assim que qualquer unidade inicia a subida, eliminando qualquer corte visual na entrada da rampa. Quando o camião circula no piso `0` por baixo de um viaduto, o tabuleiro fica suavemente translúcido (`alpha ~ 0.42`) para manter o conjunto visível.
  - **Física e barreiras isoladas por camada (`CollisionLayers.ts`)**: máscaras de bits Matter.js separam colisões do Piso 0 (`GROUND_OBS`, `TRUCK_L0`, `TRAILER_L0`) e do Piso 1 (`BRIDGE_RAIL`, `TRUCK_L1`, `TRAILER_L1`). Paredes laterais das rampas (`RAMP_WALL`) contêm ambos os pisos e guardas metálicas do tabuleiro (`BRIDGE_RAIL`) retêm apenas o Piso 1, deixando o vão livre por baixo (sem interferir com sensores de marcha-atrás `tailBlocked` no solo).
  - **Atrelados & Acoplamento por camada**: atrelados soltos e acoplados acompanham a própria camada vertical (`layer`, `elevationZ`), e o acoplamento quinta-roda (`TrailerManager.findCouplable`) só permite engate no mesmo piso.
  - **Editor & Minimapa**: botão **Solo (Piso 0) ↔ Viaduto (Piso 1)** na ferramenta Estrada com pré-visualização diferenciada de rampas/tabuleiro e contorno de viadutos no minimapa (`MinimapScene`); adicionados 2 viadutos semente (`rd_21` Norte E–O e `rd_22` Sul E–O) em `ilha_atlantica.json` / `World.ts`.
  - **Estabilidade, Tipagem & Higiene (v2.9.0)**: promoção antecipada para camada 1 em rampas curtas (`maxZ >= 0.94`), retorno de `OFFROAD_GRIP` na camada 0 sob vãos elevados, normalização de `layer` (`0 | 1`) em `fromJSON`/`addRoad`, `TrailerManager` tipado com `MainScene`, `group: 0` inicial em atrelados estacionados, `pushUndo` adiado para mutações reais, cache de `canWeldRoadEnds` por `(version, roadId)` e remoção de casts `as any` e dependências não usadas; adicionados `README.md`, `LICENSE` (MIT) e `scripts/smoke-bridge.mjs`.
- **Criação Intuitiva de Estradas em Touch e Rato (`EditorScene.ts`, `App.tsx`)**:
  - **Desenho contínuo por pontos com arrasto de ajuste**: tocar/clicar coloca vértices, e arrastar qualquer vértice da estrada pendente (`roadDrag.kind = 'pendingPoint'`) ajusta-o em tempo real com encaixe magnético (`Colar Auto`) e tolerância ampliada em ecrãs táteis.
  - **Navegação sem interromper o desenho**: arrastar fora dos pontos pendentes (1 dedo/botão esquerdo) ou usar pinça/arrasto com 2 dedos desloca a câmara preservando `pendingRoad` intacta; em touch, o segmento fantasma de *hover* estático é suprimido para evitar linhas erráticas.
  - **Conclusão rápida no mapa**: o último ponto colocado (com `≥ 2` vértices) exibe halo esmeralda (`✓`) e termina a estrada num único toque/clique (ou anula se houver apenas `1` vértice); no rato, um clique direito curto (`≤ 8px`) termina/anula imediatamente enquanto arrastar com o botão direito mantém o *pan* suave da câmara (menu de contexto suprimido sobre o canvas).
- **Precisão e "Colar" Automático no Editor de Estradas (`RoadNetwork.ts`, `EditorScene.ts`, `App.tsx`)**:
  - **Prioridade e isolamento da estrada selecionada**: `tryStartRoadDrag`, `roadTap`, `hitTestHandle(..., filterRoadId)` e `insertPoint(..., preferredRoadId)` priorizam rigorosamente os manipuladores e a faixa da estrada selecionada (`selectedRoad`) com tolerâncias limitadas ao zoom, removendo o bloqueio de arrasto junto a nós de intersecção (`IntersectionSystem`).
  - **Edição Isolada (`🔒 Isolar Estrada`) e Seleção em Sobreposições (`⇄ Alternar`)**: botão de bloqueio mantém a edição estritamente confinada à estrada selecionada sem capturar nem alterar vias adjacentes; quando há múltiplas secções sobrepostas/próximas (`hitTestRoadAll`), o botão `⇄ Alternar (i/N)` percorre-as sem interferências.
  - **Colar Automático (`🧲 Colar Auto`), Colar Pontas (`🧲 Colar Pontas`) e Fundir Secções (`🔗 Fundir Secções`)**: encaixe magnético ao desenhar ou arrastar pontos para extremidades/portais livres, pontos de controlo, eixos de splines vizinhas (junções em T) e continuação reta/alinhamento H/V (suspenso temporariamente com `Shift`); `weldRoadEndpoints()` cola pontas soltas à via adjacente igualando largura e tangente C1; `mergeAdjacentRoads()` funde duas secções abertas compatíveis numa única spline contínua com suporte completo de `Desfazer (Ctrl+Z)`.
- **Fidelidade Visual dos Sinais de Trânsito & Diferenciação dos Edifícios (`WorldObjects.ts`, `App.tsx`)**:
  - **Sinais de trânsito fiéis às descrições**: `STOP` redesenhado como octógono vermelho com rebordo branco e letras `"STOP"` legíveis (corrigido do antigo disco de sentido proibido); `Limite 50` com dígitos nítidos `"50"` dentro do anel vermelho (corrigido do antigo glifo `"H"`); `Cedência` como triângulo invertido branco com orla vermelha equilibrada; `Proibido Estacionar` com disco azul, orla vermelha e faixa diagonal `\`; `Peões` como placa azul quadrada com triângulo branco, passadeira e silhueta nítida; ícones correspondentes atualizados no catálogo `Trânsito`.
  - **Gráficos distintos por variante de edifício**: cada tipo na categoria `Edifícios` passa a ter cobertura, paleta e detalhes arquitetónicos próprios (`warehouse_big` com painéis solares e HVAC, `warehouse_docks` com cobertura clara, faixa âmbar de cais e extratores, `shed` em chapa ondulada com pórticos e cumeeira translúcida, `garage` com faixa oficina âmbar, ventoinhas e múltiplas baias de portão com pilaretes, `warehouse` como terraço urbano com caixa de escadas/AC, `gabled` em telha cerâmica terracota de 2 águas com cumeeira e chaminé, `church` em calcário cruciforme com torre sineira e cruz dourada, e `archway` em cantaria com pilares laterais e vãos abobadados).
- **Melhoria Visual dos Restantes Objetos Industriais, Portuários e de Serviço (`WorldObjects.ts`)**:
  - **`silo` & `crane`**: silo industrial com sapata em betão, cobertura cónica de 12 nervuras, cúpula de carga e escada com gaiola amarela; pórtico portuário com carris/bogies, vigas e pernas treliçadas, cabina envidraçada e *spreader* suspenso.
  - **`container_stack`**: deteção automática de orientação (`w >= h` vs `h > w`), alternância de profundidade em pilhas, cantoneiras ISO *twist-lock*, nervuras onduladas luz/sombra e barras de tranca das portas.
  - **`gas_canopy`, `gas_pump`, `convenience_store`, `air_water`, `price_sign` & `entrance_gas`**: removido o teto superior do posto (`drawOverhead` volta a renderizar apenas luminárias de rua); `gas_canopy` (em `PAVED_SURFACE_TYPES`, aderência `1.0`) passa a desenhar uma superfície realista em alcatrão (`0x1e2634`) com baias/zonas de abastecimento pintadas, setas direcionais, passadeira pedonal, grelha de drenagem e tampas de tanques subterrâneos; `gas_pump` refinado com lancil chanfrado, pilaretes duplos, terminal multibanco, mangueiras curvas e extintor; nova variante `convenience_store` (loja de conveniência com testa esmeralda/âmbar, portas envidraçadas, clarabóia, arca de gelo/lixo e condensadores no topo) e nova ilha `air_water` (Ar / Água / Aspirador) integradas nas duas estações do mapa e no catálogo **Serviços**.
  - **`dock`, `wall` & `jersey_barrier`**: cais com juntas, defensas de borracha, nivelador e cabeços de amarração; muros com pilares espaçados; barreiras New Jersey chanfradas com juntas modulares e refletores âmbar.

### **v2.8.9** (branch main)
- **Interceções, entradas e desvios com cor da estrada na categoria Piso (`WorldObjects.ts`, `MainScene.ts`, `EditorScene.ts`, `App.tsx`)**:
  - Novos prefabs pavimentados com a cor exata do asfalto da estrada (`0x1e2634`), bermas (`0x3a4457`), tracejado amarelo (`0xfacc15`) e marcações brancas (`0xe2e8f0`):
    - **Entradas retas (`road_entry`)**: `Entrada Estrada (1 Faixa)`, `Entrada Estrada (2 Faixas)` e `Entrada Estrada c/ Ilha` (separador central).
    - **Entradas em Y (`road_entry_y`)**: `Entrada Y (1 Faixa)` e `Entrada Y (2 Faixas)` com ilha separadora triangular e dois ramos afunilados.
    - **Desvios / Estacionamentos laterais (`road_turnout`)**: `Desvio Lateral (Baia)`, `Estac. Paralelo (Berma)`, `Estac. Perpendicular (90°)`, `Estac. Diagonal (45°)` e `Estac. Diagonal Camiões`.
  - **Camada `roadFlatsGraphics` (`depth: 2.4`)**: renderizados logo acima das estradas (`depth: 2`) e abaixo de passadeiras/sólidos (`depth: 3`) e veículos (`depth: 10+`), cobrindo de forma limpa a linha lateral da estrada onde encostam, mantendo redimensionamento livre (`RESIZABLE_TYPES`), suporte em compostos (`compound`) e aderência de asfalto (`pavedGripAt`).
  - Removidas do catálogo **Piso** as antigas entradas em Y (`Entrada em Y` verde e vermelha), mantendo compatibilidade de leitura caso existam em rascunhos gravados.
- **Restauro automático do rascunho em browser storage (`World.ts`, `App.tsx`)**:
  - Ao arrancar, o `World` verifica automaticamente `localStorage` (`rigmaster_world_draft`) e restaura o mapa guardado sem pedir confirmação prévia (removido o banner `Restaurar`/`Descartar`).
  - Quando o mapa é restaurado a partir do browser storage, o HUD exibe um toaster temporário (`~4s`) a informar o jogador (`"Mapa restaurado a partir do browser storage"`).
- **Atrito e resistência de rolamento por piso (`WorldObjects.ts`, `Truck.ts`)**:
  - A base de **Alcatrão (`pad_asphalt`)**, passadeiras (`crosswalk`), docas de exame (`exam_dock`), rotundas e restantes prefabs pavimentados partilham exatamente a mesma aderência e resistência de rolamento (`1.0`) que uma estrada de asfalto; `pad_dirt` corresponde a estrada de terra (`0.68`).
  - Indexação espacial multi-célula em `WorldObjects.rebuildIndex()` garante que bases de alcatrão redimensionadas (`> 2048px`) ou agrupadas em `compound` mantêm aderência `1.0` em toda a sua área.
  - Em `Truck.ts`, pisos menos aderentes (`cobble`, `dirt`, fora de estrada) aplicam maior resistência de rolamento e menor velocidade de ponta, mantendo o alcatrão (`1.0`) idêntico à estrada.

### **v2.8.8** (branch main)
- **Objectos compostos por marquee (`compound`) — redesign completo**:
  - **Nova ferramenta "Composto" na toolbar** (roxa): arrasta um rectângulo à volta dos objectos colocados no mapa e **tudo o que ficar dentro (centro dentro do rectângulo) torna-se UM único objecto composto** — os originais são absorvidos. Overlay mostra a marquee e destaca em violeta os objectos que vão ser capturados.
  - **Renderização por decomposição (`WorldObjects.ts`)**: o composto já não desenha rectângulos genéricos — cada parte é renderizada com o seu visual real (`drawSolid`/`drawFlat`) na camada certa, com culling por parte, mantendo a ordenação z dos flats. Mover/rodar o composto transforma as partes em bloco.
  - **Física por parte**: os colliders estáticos passam a ser um corpo por parte sólida (flats como pads/docas não colidem; rotundas mantêm só a ilha sólida) — bater contra um composto corresponde ao que se vê.
  - **Editar partes**: com um composto selecionado, arrastar um novo rectângulo **acrescenta** os objectos capturados como partes; na lista do flyout, `×` **extrai** a parte de volta ao mapa como objecto solto.
  - **Variação**: duplica o composto como um novo objecto independente (o original fica intacto).
  - **Desagrupar**: devolve todas as partes ao mapa como objectos soltos nas posições absolutas.
  - Modelo de dados simplificado: partes com posição/ângulo relativos ao **centro** do composto (`params.parts`, serializado em JSON); caixa `w/h` = bbox das partes (hit-test/seleção). Atrelados, semáforos e compostos existentes nunca são capturados.
  - Integração com o undo por sessão e com o Cancelar (restaura tudo); removida a categoria "Compostos" do catálogo (compostos vazios já não fazem sentido).

### **v2.8.6** (branch main)
- **Editor: toolbar por categorias, duplicar/copiar/colar e catálogo completo**:
  - **Toolbar lateral (`App.tsx`)**: as categorias do Criar (Edifícios, Docas, Atrelados, Pads, Bases, Piso, Barreiras, Contentores, Trânsito, Industrial, Serviços) passaram a ter o seu próprio botão na barra lateral, que roda verticalmente (scroll cima/baixo com `overflow-y-auto`); ao clicar numa categoria, o submenu rola para a direita numa posição **fixa no topo** da toolbar (não segue o botão quando a barra rola) mostrando as subopções; a régua passa a mostrar o estado (`CRIAR · <categoria>: <objecto>`).
  - **Duplicar / Copiar / Colar (`EditorScene.ts`)**: `duplicateSelectedObject()` (clone adjacente, entidade de atrelado respawnda), `copySelectedObject()` / `pasteClipboard()` (cola na posição do rato) com botões na régua dos Objectos e atalhos `Ctrl+D` / `Ctrl+C` / `Ctrl+V` (com guarda `e.repeat` + debounce de 150ms contra o duplo evento de teclado do Phaser 4).
  - **Catálogo completo**: todos os tipos do motor agora criáveis — `crane`, `silo`, `gas_pump`, `gas_canopy`, `price_sign`, `lamp`, `sign`, `traffic_light`, variantes de edifício (`gabled`, `church`, `archway`) e pads `bitrem_pup`.
  - **Sinais de trânsito (`WorldObjects.ts`)**: novas variantes do tipo `sign` desenhadas — `yield` (triângulo invertido), `speed` (disc limite 50), `no_parking` (disc azul com barra) e `pedestrian` (placa azul de peões) — para além do `stop`.
  - **Contentores**: paleta de variantes `container_stack` expandida (blue, red, green, rust, orange, yellow, white, teal) e catálogo com contentores individuais + pilhas grandes.
  - **Edifícios com docas funcionais**: `building` variante `warehouse_docks` passa a gerar uma zona de doca virtual em frente a cada porta (rotacionada com o edifício) no getter `dockZones` — os triggers de acoplamento/exame já os reconhecem como docas normais.
- **Undo (Ctrl+Z / botão Desfazer)**: `EditorScene` mantém um stack de snapshots (`toJSON`) antes de cada mutação de objetos (colocar, apagar, duplicar, colar, rotacionar, mover/redimensionar via drag, tipo de atrelado de pad). `undo()` restaura o snapshot, recria as entidades vivas dos atrelados e incrementa a versão. Botão no flyout vertical de Objectos (desactivado quando o stack está vazio) e atalho `Ctrl+Z`.
- **Snap de rotação (Shift+S / botão Snap ON/OFF)**: ao rodar um objecto com o knob rosa, o ângulo salta para múltiplos de 45° quando o ponteiro fica dentro de 12° deles (activo por padrão). Útil para alinhar objectos com a malha viária.
- **Undo por sessão (botão Desfazer abaixo do PAN / Ctrl+Z)**: `EditorScene` guarda um snapshot do mundo completo antes de cada mutação (colocar, apagar, duplicar, colar, rotacionar, mover/redimensionar via drag, tipo de atrelado de pad). O botão Desfazer (na toolbar, abaixo do PAN) desfaz uma operação de cada vez; desactiva-se quando o stack está vazio.
- **Cancelar sessão (botão no final da toolbar)**: descarta TODAS as alterações feitas na sessão de editor e restaura o mundo ao estado de entrada (não grava).
- **Auto-save só no fim da sessão**: removido o autosave de 2s do `World.update()`. Ao sair do editor (qualquer forma), as alterações são gravadas automaticamente para `localStorage` (draft), a menos que o utilizador use o botão Cancelar (que restaura e não grava).

### **v2.8.5** (branch main)
- **Candeeiros de rua visíveis de dia & Semáforos com fases opostas (Passo 1)**:
  - **Candeeiros (`WorldObjects.ts` / `MainScene.ts`)**: redesenhados com base metálica, sombra projetada, braço saliente orientado para a faixa (`angle`) e luminária clara com difusor visível durante o dia; lâmpada noturna emissiva e ponto de luz WebGL alinhados na ponta da luminária (`WorldObjects.getLampBulbPos()`), evitando cruzamentos transversais. Braço, luminária (`overheadGraphics`, `depth: 14`) e brilho noturno (`overheadLightsGraphics`, `depth: 14.5`) renderizados acima do camião e dos atrelados para que o conjunto passe por baixo da luminária mantendo a base e a hitbox no solo.
  - **Semáforos (`WorldObjects.ts`)**: corrigido o bug em `seedWorld` que atribuía o mesmo `group` a todos os semáforos do cruzamento; eixos Norte-Sul (`group 0`) e Este-Oeste (`group 1`) passam a alternar em fases opostas com `1.0s` de intervalo de segurança todo-vermelho (`TL_ALL_RED = 1000ms`), colocados seletivamente apenas nos `7` cruzamentos arteriais principais e rodados conforme a direção da via.

### **v2.8.4** (branch main)
- **Menu do HUD sempre acima dos Touch Controls e com scroll adaptado a ecrãs pequenos**:
  - Elevado o `<header>` de `z-30` para `z-50` (resolvendo o contexto de empilhamento que fazia o dropdown ficar literalmente atrás dos `TouchControls` `z-30` e dos toasts `z-40`) e os modais de ecrã inteiro para `z-[60]`;
  - Adicionado backdrop (`z-40`) ao abrir o Menu para fechar ao tocar fora e impedir toques acidentais nos pedais por baixo;
  - Ajustada a viewport para `h-dvh` e o dropdown do menu para `max-h-[calc(100dvh-4.25rem)] max-w-[calc(100vw-1rem)] overscroll-contain touch-pan-y`, garantindo scroll vertical suave no telemóvel sem nunca sair do ecrã ou ficar tapado pelos controlos táteis.

### **v2.8.3** (branch main)
- **Bloqueio do menu de contexto nativo nos pedais táteis (telemóvel)**: corrigido o problema em que manter apenas o acelerador (`ACEL.`) ou travão (`TRAVÃO`) pressionado continuamente abria o menu do browser:
  - Listeners nativos `touchstart` (`{ passive: false }`) e `contextmenu` no volante e pedais (`TouchControls.tsx`) mantendo `PointerEvents` (`onPointerDown`/`onPointerUp`) intactos;
  - `onContextMenu` / `onDragStart` suprimidos, conteúdo interno dos pedais com `pointer-events-none select-none` e regras globais em `index.css` (`-webkit-touch-callout: none`, `user-select: none`, `overscroll-behavior: none`, mantendo `input`/`textarea` selecionáveis).

### **v2.8.2** (branch main)
- **Direção progressiva e sensível à velocidade para teclado (`Truck.ts`)**: substituído o salto linear instantâneo de teclado por uma curva progressiva + limite de ângulo dependente da velocidade (`keyboardSteer`):
  - **Precisão em linha reta / velocidade de estrada**: micro-toques em `A`/`D` ou `←`/`→` aplicam correções finas sem oscilação exagerada e regressam suavemente ao centro;
  - **Manobras preservadas**: parado, em marcha lenta (`≤35 px/s`) ou em marcha-atrás mantém `100%` do ângulo máximo de viragem (`0.56 rad`) e resposta rápida para manobras apertadas e contra-esterço ágil;
  - Volante tátil (`touchInput.steer`) mantém controlo analógico direto.

### **v2.8.1** (branch main)
- **Luz de marcha-atrás radial (sem cone)**: substituída a luz cónica traseira da marcha-atrás (`addConeLight`) por uma luz pontual radial (`addLight`, igual no comportamento à luz de travagem/stops), em branco nítido (`0xf8fafc`), ligeiramente mais intensa e com maior alcance (`radius: 185`, `intensity: 0.75 + lampFactor * 1.60`, `z: 62`) do que os stops (`radius: 155`, `intensity: 0.55 + lampFactor * 1.15`, `z: 55`).

### **v2.8.0** (branch main)
- **Iluminação Real em WebGL (Phaser 4 `LightsManager`)**: substituído o antigo overlay preto plano e círculos estáticos por iluminação dinâmica nativa em WebGL (`this.lights.enable()` + `.setLighting(true)` no terreno, estradas, edifícios, veículos e atrelados):
  - **Faróis cónicos nativos (`addConeLight`)**: dois feixes frontais com alcances e aberturas diferenciadas entre médios e máximos e lanternas radiais de presença/travagem e marcha-atrás no veículo ou atrelado mais recuado;
  - **Pool dinâmica de emissores do mapa (`MAX_WORLD_LIGHTS = 6`, 10 luzes totais WebGL)**: candeeiros de rua, semáforos dinâmicos (vermelho/amarelo/verde), coberturas/bombas de combustível e letreiros de hubs iluminam as superfícies reais em redor quando visíveis.
- **Períodos do Dia (`TimeOfDaySystem`)**: novos períodos suaves com interpolação de cor ambiente (`Amanhecer`, `Dia`, `Entardecer`, `Noite`) + relógio e opção **Ciclo Automático 24h** disponíveis em `Menu → Período do Dia`.
- **Controlos de Faróis no HUD (`Médios` e `Máximos`)**: adicionados dois botões dedicados com simbologia ISO logo acima dos botões de desengate/travão de mão e imediatamente à esquerda do mostrador de combustível (também suportada a tecla `L`).

### **v2.7.3** (branch main)
- **HUD de condução mais limpo (zoom movido para Definições)**: removidos os botões flutuantes de zoom (`+`/`-`) do HUD em modo condução (onde roda do rato e gesto de pinça já funcionam nativamente) e adicionado um **slider de Zoom da Câmara** dentro de `Menu → Definições` sincronizado com a câmara ativa.

### **v2.7.2** (branch main)
- **Combustível a 100% no respawn**: `resetVehicleToSpawn` (tecla `R`, botão Repor Camião ou início de exame) passa a atestar o depósito a `100%` e sincroniza `_lastBodyX`/`_lastBodyY` em `Truck.setPosition` para evitar consumo fantasma após teleporte.

### **v2.7.1** (branch main)
- **Toaster de reserva (≤20%) persistente e visível durante toda a reserva**: o aviso de combustível baixo (`⛽ Combustível na reserva (XX% ≤ 20%) — abasteça numa bomba`) deixa de desaparecer ao fim de 3 segundos e mantém-se visível enquanto o tanque estiver entre `1%` e `20%`, desaparecendo automaticamente ao abastecer ou ao atingir `0%` (altura em que passa para o aviso de motor desligado).

### **v2.7.0** (branch main)
- **Minimapa em cena própria (`MinimapScene`) com zoom bloqueado em `1.0`**: deixa de escalar e derivar quando o zoom da câmara muda no modo Condução ou Editor, mantendo tamanho fixo (`150×150 px`) e posição fixa no topo à direita. Os botões de zoom (`+`/`-`) em modo condução foram reposicionados ao lado do minimapa para não o cobrir.
- **Aviso de combustível baixo aos 20%**: o alerta toast (`Combustível baixo (≤20%) — abasteça numa bomba`) passa a surgir aos 20% de combustível em vez de esperar pelos 0%, e a barra de combustível pisca a vermelho a partir dos ≤20%.
- **Deslize natural sem combustível e motor silenciado**: removida a paragem abrupta (`return` antecipado em `Truck.update`) quando `isOutOfFuel === true` — o camião perde torque de aceleração e desliza gradualmente até parar (tal como ao soltar o acelerador), mantendo direção funcional e silenciando o áudio do motor (`engineGain -> 0`).
- **Atrelado mantém-se acoplado sem combustível**: ao manter o ciclo completo de cinemática de `Truck.update`, `vx`/`vy`/`omega` atualizam suavemente durante o deslize até 0, impedindo o atrelado de se soltar ou continuar a avançar com a velocidade antiga.

### **v2.6.9** (branch main)
- **Removido botões duplicados do topo**: show/ocultar Touch e volume/mute foram removidos do HUD superior — ficam agora apenas no menu Definições.
- **Removido "RIGMASTER"** do cabeçalho superior — o primeiro botão à esquerda é agora o alternar modo (Editor/Condução).
- **Velocidade no HUD** não ocupa 2 linhas em ecrãs pequenos (`whitespace-nowrap`).
- **Botão "Drive" renomeado para "Editor"** (alternar modo Condução/Editor).
- **Minimapa com tamanho fixo** no canto superior direito — não muda de tamanho com o zoom da câmara nem com redimensionamento da janela.
- **Novo menu "Definições"** no dropdown: volume/mute + opção de ocultar a parte Touch do HUD.
- **Opção "Néon Wireframe" renomeada para "Mostrar hitbox (P)"** no menu.

### **v2.6.6** (branch main)
- **HUD simplificado**: removido do topo as barras de combustível, preço €/L, bomba por perto, abastecer, sem combustível, jackknife e carga frágil. Fica apenas velocidade + marcha.
- **Percentagem dentro da barra**: indicador de combustível mostra percentagem centrada dentro da barra (texto branco com sombra escura para legibilidade).
- **Correção: toque na bomba não abastecia em ecrã touch**. Causa raiz: uso de `(this.input as any).activePointers`, que **não existe** (é apenas um Game Config option). Isso lançava `TypeError` e abortava o handler de `pointerup` antes de chegar à lógica de abastecer.
  - Passou a usar `this.input.manager.pointers.filter(pt => pt.isDown)`
  - Removido filtro `pointerId` (no rato é `null`, o que bloqueava todos os cliques)
  - Área de toque passou de um raio de 40px para um hit-test do footprint da bomba (48×110) com padding ajustado ao zoom
  - Toque numa bomba longe mostra toast "Aproxime-se da bomba para abastecer"
- **Pinch-to-zoom corrigido**: adicionado `input.activePointers: 3` na config. O default do Phaser é 1 ponteiro de toque, pelo que o gesto de 2 dedos nunca podia funcionar.
- **Avisos como toast**: "SEM COMBUSTÍVEL", "Bomba por perto — toque ou F para abastecer", "JACKKNIFE" e "Carga frágil danificada" aparecem como notificações toast temporárias (edge-triggered, aparecem na transição).
- **Percentagem sem decimais**: percentagem inteira (sem casas decimais).
- **Barra de combustível nos touch controls**: fica logo acima do switch de marcha (D/R), empilhada verticalmente, para caber em ecrãs de telemóvel.
- **Highlight de bomba só quando perto**: o anel verde pulsante só aparece quando o camião está dentro da range de abastecimento (≤110px).
- **Sons de abastecimento**: som de fluído a correr durante o abastecimento + "clunk" no fim.
- **smoke-fuel.mjs**: testa toque/clique real na bomba + verifica ausência de erros JS.

### **v2.5.3** (branch main)
- Estradas visíveis no load/respawn, rig default com atrelado, smoke test headless

### **Older versions**
- v2.5.2: resize ancorado ao pino mundial, re-lock 45px, passadeiras acima das estradas
- v2.5.1: resize ancorado ao canto, re-acoplamento fixado, atrelados editáveis no editor
- v2.5.0: re-lock pós-desengate, zoom no telemóvel (pinça+botões+default responsivo), réguas do editor
