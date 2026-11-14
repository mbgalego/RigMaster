# RigMaster - Documentação Técnica & Registo de Versões (agents.md)

Este documento centraliza a arquitetura, o estado do sistema, a especificação técnica e o histórico de versões do projeto **RigMaster** (Phaser 4 + Matter.js + TypeScript + Vite + Tailwind CSS), servindo como guia de continuidade para agentes de IA e programadores.

---

## 1. Visão Geral da Arquitetura

O **RigMaster** é um simulador 2D top-down de manobra e condução de pesados com foco em geometria de articulação realista (Tail Swing, Off-Tracking, Jackknife e 5th-wheel/Kingpin), sem economia monetária, estruturado sobre um **Sistema Híbrido de Progressão**:
1. **Mestria (Licenças de Perícia C, C+E, H, X)**: Exames práticos de geometria de manobra e doca.
2. **Território (Conquista de Hubs 0% a 100%)**: Desbloqueio de biomas, peças no editor e modificadores atmosféricos.
3. **Editor "Paint & Drive"**: Edição em grelha 128x128 com alternância instantânea para condução (tecla Tab) e exportação/importação JSON.

```
src/
├── config.ts               # Configuração do Phaser 4 e motor Matter.js
├── main.ts                 # Ponto de entrada do Phaser e exportação de instâncias de cenas
├── App.tsx                 # Interface React / HUD minimalista, dock do editor (Mover/Estrada/Objectos/Criar/Spawn) e controlos
├── components/
│   └── TouchControls.tsx   # Volante rotativo (+/-270°), switch de marcha D/R, pedais táteis e botão de acoplamento
├── entities/
│   ├── Truck.ts            # Trator 4x2 com física de inércia, torque diesel e pneus sem derrapagem
│   └── Trailer.ts          # Atrelados (Standard, Pá Eólica, Bitrem Lead/Pup, Vidro Sensível)
├── physics/
│   └── Kingpin.ts          # Conexão de articulação 5th-wheel, cálculo de Tail Swing e Off-tracking
├── world/
│   ├── World.ts            # Fachada do mundo único: seed do conteúdo, spawn, export/import JSON
│   ├── WorldTerrain.ts     # Terreno procedural por fbm-noise com seed, chunks com cache, oceano na borda
│   └── WorldObjects.ts     # Prefabs vetoriais (docas, edifícios, semáforos…), física streamed, ciclo de luzes
├── systems/
│   ├── LicenseSystem.ts    # Gestor de Licenças de Perícia (C, CE, H, X) e temporizadores de exame
│   ├── TrailerManager.ts   # Atrelados livres/estacionados nos pads, acoplamento e gating por licença
│   ├── GarageSystem.ts     # Hubs Regionais (Porto, Estaleiro, Industrial, Histórico) e meteorologia
│   └── RoadNetwork.ts      # Rede de estradas vetorial (splines Catmull-Rom, grip por piso, editável)
└── scenes/
    ├── MainScene.ts        # Loop principal de física, áudio sintético Web Audio e câmara de condução
    └── EditorScene.ts      # Editor: gestos (2 dedos/botão do meio = pan), Estrada (extender/twist), Objectos, Criar, Spawn
```

---

## 2. Histórico de Versões & Changelog

### **v2.6.0** (Versão Atual — branch `feature/fuel-system`)
- **Sistema de combustível (diesel)**: depósito de 500 L, consumo por distância, motor morre a 0 L, indicador no HUD, abastecimento com **F** junto a uma bomba.
- **Bombas e totens de preço redesenhados (2D, sem tecto)**: `gas_pump` e `price_sign` com três linhas de preço.

### **v2.5.3** (Versão Atual — `main`)
- **Estradas invisíveis no load/respawn corrigidas**: na 1.ª frame o `cam.worldView` do Phaser está **stale** (só é calculado no 1.º `preRender`) enquanto `scrollX` já está correcto — o `renderRoads` desenhava com a view em (0,0) (oceano: zero ribbons) mas **registava os marcadores** (`roadCamX/roadRenderVersion`) com o scroll correcto → o early-return bloqueava qualquer redraw até a câmara andar >4px/zoom. Fix: o view é agora **derivado do scrollX/Y + zoom** pela fórmula do próprio Phaser (`midX = scrollX + width/2; vwx = midX − (width/zoom)/2`), tornando o 1.º draw correcto e imediato.
- **Respawn/com load nascem com atrelado**: `currentVehicleConfig` default no MainScene era `'solo'` enquanto o App usa `'standard'` — no primeiro load o rig nascia tractor puro. Default passado a `'standard'` (spawn com atrelado C de origem, consistente com a UI).
- **Smoke test headless**: Playwright (devDependency) + `scripts/smoke-test.mjs` (`npm run test:smoke`) — valida sem interacção humana: estradas renderizadas no load (commandBuffer >1000 cmds), atrelado default acoplado, respawn local e após conduzir para longe. Hook de debug `window.__rig` no `MainScene.create()` para inspecção nos testes.

### **v2.5.2** (`main`)
- **Redimensionamento ancorado — refactor do mecanismo**: a v2.5.1 congelava após o 1.º evento (o canto fixo era recalculado com o tamanho inicial no frame local, cuja origem se desloca a cada frame). Agora o canto oposto é **capturado em coordenadas do mundo** no início do drag (`pinX/pinY`) e todas as medidas correm a partir dele: largura/altura = distância ponteiro↔pino no frame local, centro = ponto médio entre pino e canto extremo. Estável frame a frame, inclusive quando o ponteiro cruza o pino (a caixa vira de lado mantendo o pino fixo). `resizeCornerPos` ganhou o parâmetro `opposite`.
- **Re-acoplamento — distância reduzida 90→45px**: o raio de acoplamento automático é 30px; agora basta o trator sair ligeiramente da zona do pino (45px) após os 1.2s de arrefecimento para o atrelado desbloquear.
- **Passadeiras acima das estradas**: o crosswalk passou da camada flats (depth 1) para a camada solids (depth 3) — acima dos ribbons de estrada (depth 2). Colocar uma passadeira sobre uma estrada deixou de a esconder (era pintada por baixo do asfalto).

### **v2.5.1** (branch `feature/road-network`)
- **Redimensionamento ancorado ao canto oposto**: arrastar um canto já não cresce simetricamente a partir do centro — o canto oposto fica fixo e o objecto cresce só na direcção arrastada (o centro desloca-se metade do delta, rotacionado de volta para o mundo; overshoot além do mínimo de 20px tratado graciosamente).
- **Re-acoplamento pós-desengate fixado a sério**: o armar do lockout (`decoupleLockout`) era avaliado apenas quando já existia candidato no raio de 30px — ou seja, nunca armava (ao voltar perto, a distância era sempre < 90px). Agora `updateDecoupleLockoutArming()` corre **a cada frame** do update: após os 1.2s de arrefecimento, o atrelado desbloqueia assim que o trator passa a >90px do pino. O guard por-candidato (`decoupleLockoutArmed(t)`) ficou como verificação passiva.
- **Atrelados editáveis no editor**: novo tipo de objecto `trailer` (só dados, sem corpo estático) no catálogo, em categoria própria **"Atrelados"** (Atrelado, Vidro, Pá Eólica, Bitrem Frente, Bitrem Trás — separado dos Pads). `addTap` cria o objecto + a entidade viva (`TrailerManager.spawnObjectTrailer`, sem pup automático); Objectos permite mover/rodar/apagar (sem redimensionar) com sync vivo (`syncForObject`); os botões C/CE/H/**P**/X trocam o tipo de um atrelado colocado (respawn). Ao acoplar, o objecto de origem é removido (evita duplicados no rebuild); `rebuild()` responde também os objectos `trailer` após import JSON (`rebuildTrailers()` chamado no import).

### **v2.5.0** (branch `feature/road-network`)
- **Re-acoplamento pós-desengate corrigido**: após desengatar, o atrelado ficava bloqueado no pino e o acoplamento automático agarrava-o de volta no mesmo frame. Novo guard `decoupleLockout` — o atrelado desengatado só volta a ser acoplável depois de 1.2s de arrefecimento **e** do trator se afastar (pino > 90px do engate, re-armado uma única vez). Aplica-se ao atrelado principal e ao pup do bitrem (guard no ramo pup usando `getLeadRearHitch`); `coupleTrailer`/`couplePup` limpam o lockout.
- **Zoom no telemóvel (modo condução)**: pinch-to-zoom com 2 dedos no canvas (factor por evento clampado 0.85–1.18), botões +/− de zoom no HUD (`adjustZoom(factor)`, limites 0.45–1.8, ignorados no modo editor) e **zoom default responsivo** — ecrãs pequenos começam mais afastados (`clamp(min(w/900, h/620), 0.5, 1.0)`), acabando o "zoom demasiado elevado" de origem no telemóvel.
- **Menu do editor em réguas**: os banners flutuantes ao centro foram substituídos por uma **régua horizontal scrollable** que sai da barra esquerda para a direita (`top-14 left-[60px]`, borda colorida por ferramenta). Ferramentas simples = 1 linha (estado + opções como chips `shrink-0`); o **Criar tem 2 linhas** — 1.ª linha com categorias (Edifícios, Docas, Atrelados, Bases, Piso, Barreiras) e 2.ª linha com os objectos da categoria activa; mudar de categoria auto-selecciona o 1.º objecto. Catálogo reorganizado em `CREATE_CATALOG`.

### **v2.4.3** (branch `feature/road-network`)
- **Fim da penetração de paredes em marcha-atrás**: o seguidor cinemático do atrelado (`followHitch`) passou a ser consciente de obstáculos — detecta a traseira dentro de um corpo estático (`computeTailBlocked`, pontos de teste no centro+quinas da traseira) e nesse caso: mata a velocidade imposta no sentido bloqueado, salta o puxão longitudinal (que era o `setPosition` que atravessava a parede) e o snap de emergência (agora só >60px de erro real = reset).
- **Puxão longitudinal limitado** a ±2px/frame (antes era proporcional sem teto — outro vector de penetração).
- **O trator pára quando o atrelado está bloqueado**: clamp da velocidade do trator no sentido de empurrão enquanto `trailer.tailBlocked` — o conjunto trava como um real em vez de continuar a compactar.
- **Desengate no sítio**: removido o teleporte de estacionamento (`kingpinDist + 45` px) da `decoupleTrailer` — era o "salto para trás através de obstáculos". O atrelado fica exactamente onde está; é o trator que avança (a chapa do nariz assenta na faixa aberta da roda quinta, sem sobreposição de colisores). Velocidade residual zerada antes de congelar em estático.

### **v2.4.2** (branch `feature/road-network`)
- **Captura de doca cobre os dois tipos de doca**: o assistente agora também cobre as portas do **Armazém Docas** (`warehouse_docks`) — antes só funcionava no Muro Docas, e o deslize continuava na fachada lisa do edifício. Geometria: portões uniformemente espaçados, meia-boca 30px, face da parede como topo.
- **Engage mais firme**: kill da componente de aproximação 26px antes do topo (toque suave, sem penetração), travagem lateral do trator enquanto capturado (a máquina cinemática deixava de empurrar), caminhar da traseira de volta ao eixo da baia (passo limitado 1.5px/frame) e esquadrejamento mais firme (±0.57°/frame).

### **v2.4.1** (branch `feature/road-network`)
- **Assistente de captura de doca**: com o atrelado engatado e a traseira dentro da boca de uma baia do `dock_wall`, a velocidade de rastejo activa o "agarre dos pneus traseiros" — amortece o bamboleio lateral/yaw, puxa suavemente para o eixo da baia (±15° de tolerância) e absorve o impacto nos topes de borracha. Causa: o seguidor cinemático do pino (`followHitch`) sobrepõe-se ao solver de contactos e a traseira deslizava de lado nas faces dos brutaços.
- Geometria das baias partilhada (`WorldObjects.dockWallBays`) entre a física (corpos dos brutaços/topes) e o assistente — um só ponto de verdade para boca/pier.

### **v2.4.0** (branch `feature/road-network`)
- **Elementos de construção no editor (catálogo Criar)**:
  - **Base Alcatrão** e **Base Terra** (`pad_asphalt`/`pad_dirt`): bases planas de pátio redimensionáveis, sem colisão (alcatrão com juntas de dilatação e granulado; terra com sulcos de pneus e gravilha).
  - **Muro Docas** (`dock_wall`): parede sólida com N baias de descarga (`params.docks`, default 3, boca de 76px) — brutaços de alvenaria + tope de estiva dentro de cada baia + faixa de serviço com borda amarela e pilaretes. Física multi-corpo (os brutaços são corpos individuais; a boca das baias fica aberta para o camião entrar às-costas).
  - **Armazém Docas** (variante `warehouse_docks`): armazém logístico com portões de descarga na fachada sul (`params.docks`, default 5), montantes listrados e plataformas de cais.
  - **Teto de duas águas** (variante `gabled` do edifício).
- **Pads de atrelado completos**: a marcação do `parking_pad` passou a ser amarela (tipo-codificada: C=amarelo, CE=verde, H=azul, X=vermelho) com silhueta do atrelado (bitrem = 2 caixas), linha de paragem no nariz, entrada hachurada e chevrons — desenhada para servir de futuro ponto de captura/chegada.
- **Catálogo Criar com os 4 atrelados**: Pad C / Pad CE / Pad H / Pad X (tamanhos calibrados por tipo; o atrelado nasce estacionado no pad ao entrar em jogo via `TrailerManager`).
- **Ângulo do pad respeitado**: `TrailerManager.spawnAt(x, y, tipo, ângulo)` usa o ângulo do pad (nose = −y local); o pup do bitrem nasce atrás da traseira na direcção certa. Pads seeded mantêm nose-sul.
- **Editar tipo de atrelado**: painel OBJECTO mostra botões C/CE/H/X quando o objecto selecionado é um pad (troca o tipo sem apagar).
- **Pátio de docas no seed**: base de alcatrão + muro de docas (3 baias) + 3 pads C no parque industrial de demonstração; base de terra no estaleiro (NE).
- Redimensionáveis: + `pad_asphalt`, `pad_dirt`, `dock_wall` (pads de atrelado mantêm tamanho fixo por tipo).

### **v2.3.2** (branch `feature/road-network`)
- **Nariz do atrelado já não invade a cabine**: a saliência do nariz além do pino (kingpin) foi reduzida de 30px para **14px** (18 no porta-pá eolico, 14 no bitrem) — a chapa do nariz cobre apenas a zona da roda quinta, como num semi real. Antes o nariz cobria metade do trator e as quinas do nariz chegavam a colidir com a *zona sólida frontal* do trator durante a articulação (empurrões visíveis).
- Valores sincronizados em todos os acoplamentos (spawn, acoplamento manual, pup do bitrem), no `Trailer.kingpinDist` (detoção de acoplamento/blocker) e no debug do `Kingpin` (pin agora derivado do `trailerOffset` real, não hardcoded).

### **v2.3.1** (branch `feature/road-network`)
- **Rotunda agora aparece (bug de render)**: o caso de desenho tinha ficado no layer *flats* (depth 1) enquanto o routing a mandava para *solids* (depth 3) — resultado: invisível sob as ribbons das estradas, **com colisor circular invisível**. O desenho foi movido para `drawSolid`.
- **Escala adaptada ao camião** (trator 96×48, atrelados até 310px):
  - Lugares de estacionamento: 64px → **100px**; carros 44×20 → **64×28** (com parasóis/pára-vidas).
  - Rotunda default 260 → **420** (ilha ≈94px de raio — manobrável mas visível).
  - Ruas do parque: 110 → **140px**; passadeiras 36×170.
  - Armazém logístico default 700×280 → **900×420**; nave 380×280 → **420×360**; catálogo actualizado.
  - Parque de demonstração re-plantado (oeste do hub Industrial): conectores 140px, rotunda 420 no cruzamento W, armazém 900×420 + nave 400×360, três parques com carros (2 a norte da rua, 1 a sudoeste), passadeiras na arterial. Todos os afastamentos verificados contra arteriais/bermas.

### **v2.3.0** (branch `feature/road-network`)
- **Parques industriais ao estilo da foto de referência:**
  - **Novas variantes de edifício**: `warehouse_big` (armazém logístico — tecto plano cinzento-claro com juntas de painel, faixa de clarabóia e unidades HVAC) e `shed` (nave industrial — tecto branco com linhas de crista paralelas).
  - **Carros estacionados nos parques**: `parking_lot` desenha viaturas determinísticas (por objecto + lugar, ~75% de ocupação, paleta variada, em duas filas ao longo do corredor central; `params.cars: false` desactiva).
  - **Rotunda**: prefab circular com faixa de circulação (chevrons anti-horário, trânsito à direita), cordão e ilha ajardinada. Só a **ilha central é sólida** (corpo circular Matter) — a faixa de circulação é transitável. Renderiza na camada **solids (depth 3)** para ficar acima das ribbons no cruzamento.
  - **Passadeira**: prefab plano de zebras (listras ao longo da estrada, repetidas atravessando a faixa), redimensionável/rotável.
  - **Parque industrial de demonstração no seed** (SE, junto à Zona Industrial, sul da arterial y=9216): dois conectores de acesso com passadeiras, rua interior, rotunda no cruzamento, armazém logístico 700×280 + nave 380×280 viradas à rua, e dois parques de funcionários com carros. Editável como tudo o resto (apagar/estender/mexer).

### **v2.2.1** (branch `feature/road-network`)
- **Fim dos spikes/dobras nas estradas (foto do utilizador)**: o sampler passou de Catmull-Rom **uniforme** (que ultrapassa e dobra a faixa quando os pontos têm espaçamento irregular ou ângulos fechados) para **Hermite cúbica com tangentes de diferença finita e parametrização por comprimento de corda** (comportamento chordal) — a curva nunca ultrapassa o traçado; em reversões quase exactas desacelera até zero (cúspide limpa). Tangentes por ponto rodadas pelo twist individual (não interpolado ao longo do span).
- **Guarda de cúspides no renderizador**: quads de faixa e traços de linha central com tangentes quase opostas (dot < 0.2) são saltados — não há mais "bowties"/setas a apontar para fora da estrada.
- **Consistência total entre pegas e curva**: `pointNormal`/`pointTangent`/`baseTangentAngle`/`extendHandlePos` usam agora exactamente a mesma direcção que os samples da curva (a pega de largura, o knob de twist e a pega de extensão assentam na tangente real).
- **Pega de rotação dos objectos corrigida**: tinha o sinal do X invertido (girava em espelho relativamente ao objecto); agora gira solidária com o objecto e foi **muito reduzida** (ponto rosa de 3.5px, a 20px da borda).

### **v2.2.0** (branch `feature/road-network`)
- **Estradas — adições curtas e marcação:**
  - **Espaçamento mínimo entre pontos de controlo (56px)**: ao mover/estender, o ponto é repelido dos vizinhos até à distância mínima — fim dos loops/folds do Catmull-Rom em segmentos curtos (o comportamento estranho das pequenas extensões). Toques para desenhar também exigem ≥24px do ponto anterior.
  - **Tracejado central consistente**: as linhas centrais são desenhadas por **comprimento de arco exacto** (traço 26px / espaço 22px interpolados dentro de cada amostra, independentemente do espaçamento irregular dos samples) — tracejado uniforme em curvas e nas transições entre spans.
  - **Estradas de sentido único**: flag `oneWay` por estrada (botão **⇄ 2 Sentidos / → 1 Sentido** no painel; default aplicável a estradas novas) — **sem tracejado central**, com **chevrons amarelos** de direcção a cada ~420px. Serializada no JSON.
- **Objectos — edição imediata e pegas directas:**
  - **Criar → Objectos automático**: colocar um objecto com a ferramenta Criar muda logo para a ferramenta Objectos (dock do App sincroniza por polling) — mover/rodar/redimensionar de imediato.
  - **Rotação livre**: pega **rosa** acima do objecto (no referencial local) — arrastar roda à vontade (fim dos passos fixos de 15°; a tecla R mantém-se como atalho para ±15°).
  - **Redimensionamento**: 4 **pegas quadradas brancas** nos cantos (tipos redimensionáveis: muro, entrada, parque, edifício, barreira, contentores, doca, cobertura de posto, silo, grua) — arrastar escala a partir do centro (mín. 20px). `WorldObjects.resizeObject` refresca os colisores das pegadas antiga e nova.
  - Colisores continuam a acompanhar rotação/redimensionamento (reconstrução de chunks nas mutações).

### **v2.1.0** (branch `feature/road-network`)
- **Editor de gestos (touch + rato unificados):**
  - **2 dedos = sempre pan/zoom**, em qualquer ferramenta: um gesto de dois dedos **cancela** qualquer acção de ferramenta pendente ou drag em curso (os dados editados mantêm-se). Pinos fazem zoom, arrasto faz pan.
  - **Modelo de gestos geral**: o "toque" não executa nada imediatamente — no primeiro movimento significativo (>12px de ecrã) o gesto classifica-se: se começou sobre algo editável (pega da estrada, pega de largura, knob de tangente, objecto) vira **drag da ferramenta**; caso contrário vira **pan** (arrastar no vazio = viajar). Soltar sem mover = **toque** (executa a acção de clique da ferramenta: colocar ponto, selecionar, spawn, criar objecto).
  - **Rato**: arrastar no vazio com qualquer ferramenta faz pan; **botão do meio** (e direito) continuam a fazer pan sempre; Space+drag mantém-se.
  - Desenho de estradas por toques (tap-tap-tap), duplo toque termina/inserção — mesmo comportamento em touch e rato.
- **Novos objectos de construção + ferramenta "Criar":**
  - Novos prefabs em `WorldObjects`: **`wall`** (muro de alvenaria, sólido, rotável), **`entrance`** (laje de entrada/acesso a edifício, plana, sem colisão, com soleira de porta), **`parking_lot`** (parque de estacionamento plano com lugares pintados e corredor central, sem colisão).
  - Nova ferramenta **Criar (dock, violeta)**: catálogo em banner — Muro, Entrada, Parque, Garagem, Edifício, Barreira, Contentores, Doca — toque/click no mapa coloca o objecto (já selecionado, pronto a ajustar em "Objectos").
- **Correcção: hitbox física acompanha as edições de objectos:**
  - `moveObject`/`rotateObject`/`remove`/`add` **reconstruem agora os corpos Matter** de todos os chunks activos tocados pelo AABB do objecto (`refreshSolidBodiesAround`, incluindo objectos grandes que atravessam fronteiras de chunk) — antes o colisor ficava na posição antiga ao mover ("hitbox fantasma").
- **Manipulação avançada de estradas:**
  - **Extensão**: pegas verdes "+" nas duas pontas das estradas abertas — arrastar cria um novo ponto de controlo nessa extremidade e estica a estrada.
  - **Rotação de tangente por ponto (twist)**: cada ponto tem um **knob violeta** ao longo da direcção da faixa — arrastar roda a **direcção da estrada naquele ponto** (±60° máx.), criando curvas assimétricas e ajustes de alinhamento. Interpolada ao longo dos spans no `sampleRoad` (tangente analítica rodada); `pointNormal`/largura/pega de largura seguem o twist. Serializado no JSON (graus), interpolação na inserção de pontos, botões −/±5°/"Reta" no painel.
- `tsc --noEmit` e `npm run build` OK; física de veículos/acoplamento/exames intactos.

### **v2.0.1** (branch `feature/road-network`)
- **Correcções de performance (mundo v2.0 degradava progressivamente):**
  - **Fuga de memória real (a "piora progressiva")**: o `Truck` registava um listener `collisionstart` no mundo Matter e o `destroy()` **nunca o removia** — cada respawn (tecla R, início de exame, troca de veículo) acrescentava mais um listener que mantinha o camião velho em memória e re-processava **todas** as colisões do mundo (o `Trailer` já fazia `off` correctamente; o `Truck` não). Agora o handler é guardado e removido no destroy.
  - **Render de prefabs deixou de ser por frame**: todas as frames reconstruíam centenas de comandos Graphics (edifícios, docas, postes…). Agora as camadas estáticas (flats/solids) só são redesenhadas quando a câmara anda >24px, muda de zoom, ou o mundo é editado (`objects.version`); os **semáforos** (animação) vivem numa `Graphics` própria (depth 4) redesenhada por frame — poucos e baratos.
  - **Terreno: criação de chunks orçamentada**: ao cruzar fronteiras de chunk vários chunks (~10ms cada) eram pintados no mesmo frame (soluços). Agora existe uma **fila** e no máximo **1 chunk é pintado por frame**.
  - **Postes de luz já não são muros invisíveis**: estavam a 66px do eixo arterial (estrada tem meia-largura 64px) — o colisor de 16px invadia a berma e provocava colisões/rebotes constantes ao conduzir na via. Movidos para 100px do eixo com colisor 12px.

### **v2.0.0** (branch `feature/road-network`)
- **FIM DAS TILES — Mundo único procedural "Ilha Atlântica" (sem mundos separados):**
  - **Arquitectura nova**: o mundo é **uma ilha gigante delimitada por oceano** (13824×10240 px, cantos arredondados com linha de costa ondulada por ruído — baías e penínsulas na banda costeira). A grelha de tiles 128px, o atlas `TILE_DEFINITIONS`, a paleta, os presets (Academia/Porto) e o `TilemapManager` foram **eliminados por completo**. Novo módulo `src/world/`:
    - **`WorldTerrain.ts`** — terreno procedural por **fbm value-noise com seed determinística**, pintado por **chunks 1024px** (canvas 512² escalado ×2, cache LRU com evicção + guarda: em zoom-out extremo só desenha a imagem **overview** da silhueta da ilha, calculada uma vez). Biomas por região + ruído: oceano profundo/água rasa, praia de areia, relva, floresta (árvores determinísticas, sem colisão), campos agrícolas com sulcos, betão urbano/industrial manchado, calçada histórica. `landPatches` garantem terra nos hubs costeiros (Porto NW, Estaleiro NE, Industrial SE, Histórico SW — todos encostados à costa).
    - **`WorldObjects.ts`** — **camada de prefabs vetoriais** (substitui todos os tiles de conteúdo): `dock`, `parking_pad` (spawn de atrelados), `jersey_barrier`, `building` (warehouse/garage/archway/church), `container_stack`, `crane`, `silo`, `gas_pump`/`gas_canopy`/`price_sign`, `lamp`, `sign`, `traffic_light`, `exam_dock` (temporário). Física **streamed por chunks 2048px** (corpos estáticos Matter materializados só perto do camião, igual ao sistema de tiles antigo); docas registam `dockZones`; pads expõem `parkingPads`. **Semáforos**: ciclo europeu de 4 fases portado para o sistema (verde 7.5s → âmbar 1.5s → vermelho 7.5s → vermelho+âmbar 1.5s; grupos alternados coordenados — sem barreiras de faixa nos cruzamentos abertos da rede vetorial). Render em **Graphics flats (depth 1) + solids (depth 3)** — docas/pads sob as estradas, edifícios/sinais/luzes acima; culling por grelha espacial 1024px.
    - **`World.ts`** — fachada única: terreno + objectos + rede de estradas + spawn + **seed do conteúdo** (grelha viária vetorial 6×5 arteriais, ruas em S urbanas, rota rural demo asfalto→terra, 4 hubs com docas/gruas/stacks/silos/igreja, 4 parques de atrelados junto aos hubs reais, percursos de exame com jersey, 2 postos de combustível, ~60 edifícios determinísticos com validação de distância à estrada, postes ao longo das arteriais, semáforos em metade dos cruzamentos). **Export/import JSON = seed + estradas + objectos** (poucos KBs, sem grelha RLE).
  - **Exames nos sítios reais**: os presets de exame deixaram de existir — a doca alvo é **snap à estrada vetorial mais próxima** (`RoadNetwork.query` devolve agora ponto projectado + tangente) e é colocada como **doca temporária** no acostamento (desaparece no fim do exame). Percursos de prática (corredores/slalom/baía estreita com jersey) vivem permanentemente junto aos locais de exame. Lógica de exames (C, C+E, H, X) intacta.
  - **Editor de objectos**: dock passa a 4 ferramentas — **Mover / Estrada / Objectos / Spawn**. A ferramenta **Objectos** cumpre o requisito de edição total: clicar seleciona (contorno amarelo rotacionado), arrastar **move qualquer prefab**, **R/Shift+R roda ±15°**, Del/botão apaga; painel flutuante mostra tipo+ângulo com botões ⟲/⟳/Apagar. Ferramenta **Spawn** reposiciona o spawn no mapa (marcador ciano sempre visível no editor). Catálogo de peças e borracha **removidos** (nada é pintado; tudo se edita).
  - **Restaurar Ilha Original** (menu) substitui os presets; `MainScene.reseedWorld()` refaz seed + atrelados.
  - **Minimapa** redesenhado: silhueta real da ilha (amostragem do terreno) + oceanos, centerlines vetoriais, docas (âmbar), pads (rosa), edifícios/silos (ardósia); refresco por `world.version` (bump em qualquer edição).
  - `TrailerManager.rebuild(pads)` recebe coordenadas de mundo (fim dos tiles `trailer_parking_*`); `TrafficLightSystem` e `TilemapManager` **apagados**; `GarageSystem.getUnlockedTiles` removido (a paleta já não existe).
  - Física do camião/atrelados, acoplamento, Kingpin, hubs, meteorologia, áudio e licenças **intactos** — eram sistemas, não tiles.

### **v1.9.0** (branch `feature/road-network`)
- **Fase 1 da nova arquitectura "mundo aberto": rede de estradas vetorial por splines:**
  - **Novo sistema `src/systems/RoadNetwork.ts`**: estradas são splines **Catmull-Rom** sobre o terreno de tiles — pontos de controlo livres (sem snapping à grelha), **largura por ponto** (a estrada pode afinar de asfalto largo a caminho de terra degradado) e **piso por estrada** (`asphalt` 1.0 / `cobble` 0.88 / `dirt` 0.68 de grip; fora de estrada 0.55). Sem corpos de física — estrada é onde se conduz; só obstáculos colidem.
  - **Totalmente editável em runtime** (requisito chave: ao contrário do editor de tiles, tudo o que já está no mapa se pode mexer): clicar numa estrada **seleciona-a** (contorno ciano + pegas quadradas), arrasta uma pega para mover o ponto, arrasta o corpo para **mover a estrada inteira**, botões de piso/largura atuam na seleção, Del/botão apaga. Desenhar: clicar adiciona pontos, **Enter ou duplo clique termina**, Esc cancela, Backspace remove o último ponto (com botões touch no painel). Tolerâncias de hit-test em coordenadas de ecrã (independentes do zoom).
  - **Edição fina**: **duplo clique no corpo da estrada insere um ponto de controlo nesse sítio** (largura interpolada do segmento); cada ponto tem uma **pega circular laranja** a meia-largura, perpendicular à estrada — arrastar essa pega ajusta a **largura dessa secção** (interpola suavemente para os vizinhos); os botões −/+ de largura atuam no **ponto selecionado** (pega activa a amarelo), na estrada inteira, ou no default de estradas novas.
  - **Renderizador de ribbons** (`MainScene.renderRoads`): quads perpendiculares à tangente com largura interpolada, cores por piso (terra com variação de tom para textura "esborracada"), linhas de berma + tracejado central amarelo (asfalto), redraw só quando a rede muda ou a câmara se move >4px, com culling ao viewport. As ribbons ficam **acima** dos tiles e **abaixo** dos veículos (depth 2).
  - **Grip integrado no camião** (`Truck.roadGrip`, multiplicativo com o grip atmosférico): consulta espacial por hash de segmentos (células 1024px) a cada frame — asfalto adere, terra escorrega, fora de estrada ainda mais; afeta aderência lateral e direção.
  - **Estrada demo no mapa procedural**: rota rural a sudoeste — sai do cruzamento (45,32) das ruas curvas, 6 curvas amplas com contra-curvas, asfalto 150→96px, a continuar como **terra degradada 92→56px** até ao sudeste. `carveRoadCollisions` limpa tiles sólidos sob as ribbons (demo/importadas nunca atravessam edifícios).
  - **Persistência**: `MapDataJSON.roads` (v3 implícita); export inclui a rede, import carrega-a (mapas antigos sem estradas → rede limpa); presets (Academia/Porto) fazem reset/seed por mapa; estradas desenhadas nas **estradas de tiles**.
  - **Minimapa**: centerlines das estradas vetoriais desenhadas por cima dos tiles (escala por largura real).
  - UI: novo botão **Estrada** na dock do editor (azul), painel flutuante com piso/largura/terminar/retroceder/apagar e estado vivo (polling 60ms via `getRoadUIState`).

### **v1.8.0** (branch `feature/map-graphics`)
- **Melhorias gráficas do mapa + semáforos realistas (mão direita):**
  - **Semáforos reescritos** (`TrafficLightSystem`): um sinal por **aproximação** (4 por cruzamento sinalizado), colocado **2 tiles antes do cruzamento**, no passeio do **lado direito da via que controla** (tráfego pela direita), virado para os veículos que se aproximam. Derivação automática a partir do `road_intersection` mais próximo (janela de 8 tiles) — pintar um `traffic_light` no passeio basta; fallback legado mantido para colocações fora de modelo.
  - **Barra de travagem por faixa** (52px) em vez de barra de via inteira: faixa este/oeste-center 92 vs near 36; cabeço do sinal vertical (N/S) ou horizontal (E/W) com offset em direcção à faixa; corpos (poste + barreira) materializados por proximidade como antes.
  - Colocação procedural: `placeApproachLight` nos 4 quadrantes (N-bound passeio este a sul, S-bound oeste a norte, E-bound sul a oeste, W-bound norte a este), a correr **antes** dos postes de luz (que só pintam em `sidewalk` livre); cruzamentos com rotunda ficam sem sinais.
  - **Rotundas de 3 tamanhos** (`roundabout_s/m/l` — pincéis compostos 3×3/5×5/7×7, `setTile` faz *stamp* via `placeRoundabout`): ilha **circular perfeita** (relva sólida + monumento central), anel com arco anular **posicional** (ids `roundabout_r{R}_x{dx}_y{dy}` gerados por loop — cada tile cruza um segmento diferente do anel), marcações de **aproximação radial** nos tiles axiais (linhas de faixa, tracejado até ao ponto de cedência, triângulos de cedência). Sub-tiles `hidden` fora da paleta.
  - **Estradas curvas**: `road_wave_h/v` — curva suave "cosse hump" com tangente horizontal nos limites do tile ( junção sem kink com rectas), desenhada por 3 strokes (guias, asfalto, tracejado).
  - **Postos de combustível**: `gas_canopy` (cobertura translúcida com vigas/pilares), `gas_pump` (ilha de betão com 2 bombas, colisor 26×100), `gas_price_sign` (totem de preços). Nova categoria de paleta **`service`**. 2 postes no mapa procedural (quadrante Porto + sul-central).
  - **Garagens com veículos estacionados**: `building_garage_a/b/c` — baía aberta com silhueta de camião+atrelado / atrelados / baía vazia com paletes e empilhadora; ~40% dos quarteirões decorativos do mapa procedural passaram a ser garagens.
  - Rua curva secundária no mapa procedural (onda em bloco entre arteriais 24..40/27..45 com junções em T); jersey barrier movido para não colidir.
  - `regionClear` trata `roundabout_*`/`gas_pump` como bloqueantes; `isRoad` aceita tiles de rotunda; minimapa/herança de atlas estáveis (tiles novos **apensos no fim** do `TILE_DEFINITIONS` — índices de mapas gravados não mudam).

### **v1.7.9**
- **Editor: lista de desbloqueio completada:**
  - `getUnlockedTiles()` cobria só 23 dos 35 tiles da paleta — ficavam **sempre trancados** (mesmo com todos os hubs a 100%): cruzamento com passadeiras, passeio, passadeira de peões, semáforo, poste de iluminação, os 3 sinais de trânsito e **os 4 parques de atrelados** (adicionados na v1.7.0 e nunca registados na lista).
  - Infra-estrutura padrão (grelha viária, mobiliário urbano, parques) passou a fazer parte da lista base; as peças de bioma (doca/estaleiro/industrial/histórico) continuam gated pelo hub dominado. Dominação total = paleta completa (35/35).

### **v1.7.8**
- **"Dominar Todos os Hubs" passou a ter efeito visível:**
  - Diagnóstico: o botão funcionava (barras a 100%, contratos concluídos, estado gravado) mas **nada mudava no jogo** — os "sinais néon" prometidos no texto do modal nunca tinham sido implementados (`neonColorHex` era dados mortos) e os tiles desbloqueados só aparecem no editor.
  - Novo **`drawHubSigns`** no MainScene: cada hub dominado a 100% ergue o seu **sinal néon** junto ao bioma no mapa procedural (PORTO/ESTALEIRO/INDUSTRIAL/HISTÓRICO) — poste + painel com barras néon na cor do hub + halo pulsante no solo + rótulo. Hubs não dominados não têm sinal; dominar faz os sinais aparecerem de imediato.
  - Clicar em "Dominar Todos os Hubs" mostra agora um **toast verde** de confirmação.
- Nota: os sinais existem no mapa "Região Metropolitana Procedural" (o único com os 4 biomas de hub); noutros mapas ficam sem sinais.

### **v1.7.7**
- **Auditoria de Desbloqueio (Licenças + Hubs) — correcções:**
  - **Bug crítico (exames a falhar à nascença):** `updateExam` recebia os contadores de colisões **acumulados de vida** (o corpo do trator é reutilizado entre resets e nunca zera `collisionCount`) — bastava uma colisão antes do exame para o C+E/X (limite 0) falharem no primeiro frame com "Limite de colisões ultrapassado". Agora o `syncExamTarget` captura uma **baseline** no arranque do exame e só as colisões **durante** o exame contam.
  - **Ré do exame H passou a ser imposta:** `requireReverse` era configuração morta. `updateExam` recebe `isReversing`, grava `reversedDuringExam` e a doca só conta o tempo de 1.5s se a manobra de ré já tiver ocorrido (o exame H exige entrada em ré).
  - **Meteorologia gated pelos hubs:** a barra rápida dos modificadores mostrava os 4 botões sempre activos — Chuva/Nevoeiro/Noturno ficam agora desativados (🔒) sem o hub correspondente dominado; `handleSetWeather` valida contra `getUnlockedModifiers()`.

### **v1.7.6**
- **Zona Frontal Sólida do Trator (foto-modelo completo):**
  - Novo `frontBody` no trator: cobre o trator **exceto a faixa traseira de 45px** (quinta roda), categoria `0x0020`, colide **apenas com corpos de atrelado**. A cabine já não consegue atravessar a zona frontal do atrelado — a interseção permitida é exactamente **nariz-do-atrelado × faixa-traseira-do-camião** (rectângulos vermelhos da foto de referência), a qualquer ângulo.
  - O proxy é dinâmico e sincronizado a cada frame (`syncFrontBody`); as correcções de resolução de contacto são **transferidas para o corpo principal** (clamp 8px/frame) — a cabine "encosta" fisicamente ao atrelado em vez de atravessá-lo.
- **Acoplamento Pup (lead→pup) restaurado:**
  - Causa: desde a v1.7.3 o raio de zona era 30px, mas o contacto físico lead↔pup dá-se a ~43px (dois corpos completos) — geometricamente inalcançável; funcionava na v1.7.4 só pelo toggle de máscara.
  - Correcção pelo modelo de zonas: corpos de atrelado livres deixam de colidir entre si (`mask 0x0021` = obstáculos + zona frontal do trator) — o lead desliza por baixo do nariz do pup até ao pino, como o trator faz com um lead. Raio de volta a 30px, assentamento suave (sem snap).
  - O **bloqueador** de atrelados livres passa a colidir também com corpos de atrelado (`mask 0x0006`): um atrelado acoplado a varrer o meio/traseira de outro continua bloqueado — só a faixa do nariz é atravessável.
- Limpo: sem toggles de máscara, sem estados; todas as zonas são geometria fixa desde o spawn.

### **v1.7.5**
- **Corredor de Passagem por Zonas Geométricas (corpo-bloqueador):**
  - Modelo real da quinta roda (foto de referência): a interseção permitida é o rectângulo **nariz-do-atrelado × traseira-do-camião**. O corpo do atrelado deixa de colidir com o trator (máscara `0x0005`) — o corredor fica **sempre aberto no nariz, a qualquer ângulo**, sem toggles de máscara nem histerese (a abordagem v1.7.4 deixava passar a traseira em ângulos raros).
  - Novo **corpo-bloqueador** (`blockerBody`) por atrelado: rect estático que cobre a caixa **exceto a zona do nariz** (`blockerDepth = nariz−kingpin+30px`), categoria `0x0008`, máscara `0x0002` (só trator) — é ele que bloqueia o trator no meio/traseira do atrelado. Ao acoplar desliga-se (`setBlockerActive(false)`); ao desacoplar religa-se e ressincroniza. A traseira do camião fica ~10px de folga do bloqueador no assentamento completo do pino.
  - Trator passa a máscara `0x0009` (obstáculos + bloqueadores). Acoplamento do pup: raio de zona alargado de 30→50px (o contacto lead↔pup dá-se a ~43px, acima do corredor possível entre dois corpos completos — acopla no contacto, antes da colisão).
  - Removidos `updateTrailerPassUnder`/`passUnder` (v1.7.4). Sem estados, sem pops: o bloqueador é sólido desde o spawn.

### **v1.7.4**
- **Hitbox por Zona (substituída pela v1.7.5):** toggles dinâmicos de máscara por aproximação ao pino — falhava em ângulos raros, deixando a traseira passar por baixo em qualquer zona.

### **v1.7.3**
- **Acoplamento Automático por Posição (sem botão):**
  - Acoplar deixa de exigir clique: `updateAutoCoupling` corre a cada frame e, quando o engate do trator fica **na zona do kingpin** (≤30px do pino, ângulos alinhados ±28°), faz as validações habituais — se possível, acopla de imediato com toast verde; se não, envia **um único** toast de erro por entrada na zona (âmbar 🔒 licença em falta, ou ciano ℹ️ "Ralentiza para engatar" acima de 6 km/h). O botão 🔗 passa a servir **só para desacoplar** (vermelho quando parado; âmbar passante quando bloqueado) — tecla C idem.
- **Hitboxes: Traseira Passa por Baixo do Atrelado:**
  - Atrelados livres perdem o bit do trator na máscara (`0x0007→0x0005`): a traseira do camião desliza **por baixo** do atrelado até o engate alcançar o pino (o desenho do atrelado fica por cima, como na realidade). Sem colisão física já não há bloqueio na zona de engate; o contacto físico deixou de ser necessário e o rastreio `collisionstart/collisionend` foi removido.
- **Correção: Duplo Disparo nos Botões Táteis:**
  - Causa do "acopla e desacopla instantaneamente": os handlers disparavam em `onPointerDown` **e** `onClick` (dois eventos por toque). O botão de acoplamento e o travão de mão (P) ficam apenas com `onPointerDown` — o (P) também era duplo-alternado e nunca pegava.

### **v1.7.2**
- **Nova Mecânica de Engate por Contacto Físico (sem "saltos"):**
  - O botão 🔗 só fica ativo quando o trator está **fisicamente em contacto** com a placa de engate do atrelado (recuou sobre ele). Novo rastreio de contacto corpo-a-corpo no `MainScene` via `collisionstart/collisionend` (pares com labels `truck*`/`trailer*`).
  - O engate já **não teleporta** o atrelado: ele fica exatamente onde foi engatado e o ajuste suave do kingpin (correção longitudinal/lateral por frame) assenta-o com um movimento de apenas alguns pixeis — o "clunk" físico do engate. Novo `settleTrailerOntoHitch` garante que o erro fica dentro da banda suave (≤25px) com um único ajuste mínimo, evitando o snap de descontinuidade do `followHitch`.
  - Máscaras: atrelados estacionados `0x0003→0x0007` (colidem também com outros atrelados) e atrelado acoplado `0x0001→0x0005` — permite contacto físico dianteiro↔pup no bitrem (o pup também exige contacto); o trator continua a nunca colidir com o atrelado acoplado.
- **Feedback Apenas por Toasts, e Só em Tentativa:**
  - Removido o banner inferior persistente. Notificações aparecem **apenas no topo** (toasts empilháveis, auto-dismiss 2,8s) quando o jogador **tenta** engatar: sucesso (verde ✅), bloqueado por licença (âmbar 🔒), ou orientação (ciano ℹ️ — "Recue até encostar o pino…", "Pare totalmente…"). Sem tentativa, nenhuma notificação — o estado lê-se só na cor do botão 🔗 (ciano pulsante / vermelho / âmbar).

### **v1.7.1**
- **Correção: Atrelado Estacionado Desenhado ao Contrário:**
  - Causa: o corpo Matter nascia com ângulo π (nariz a sul) mas o container de desenho ficava com rotação 0 — visualmente o atrelado mostrava o nariz a norte e as rodas para o parque, e o engate parecia acontecer **do lado errado** (na traseira com rodas). `TrailerManager.spawnAt` sincroniza agora o container via `setPosition(x, y, π)` após a criação (lead e pup) — o nariz desenhado coincide com o kingpin físico.
- **HUD: Toasters + Botão Ícone junto ao (P):**
  - Notificações de acoplamento passam a **toasts** empilháveis no topo-centro (auto-dismiss 2,8s), disparadas por um contador `coupling.noticeSeq` (permite repetir a mesma mensagem em ações consecutivas).
  - A indicação de acoplamento no TouchControls passou a **botão circular ícone-only (🔗)** colocado **junto ao travão de mão (P)**, sem texto: ciano pulsante (acoplar disponível), vermelho (desacoplar), âmbar (bloqueado por licença). O banner contextual de fundo mantém-se para o prompt/bloqueio.

### **v1.7.0**
- **Nova Feature: Acoplamento de Atrelados (Desacoplar / Recoplar em Condução Livre):**
  - `systems/TrailerManager.ts` (novo): detém todos os atrelados **livres** do mapa (estacionados nos parques ou abandonados após desacoplamento). Atrelados estacionados são corpos **estáticos** (não empurráveis); ao acoplar tornam-se dinâmicos com o filtro de colisão do conjunto (`group −1, mask 0x0001`) e ao desacoplar congelam de novo onde ficaram, prontos a reacoplar.
  - **Parques de Atrelados**: 4 novos tiles `trailer_parking_c / _ce / _h / _x` (categoria `parking`, não-sólidos, textura procedural com baia tracejada, silhueta e badge da classe) — cada um gera um atrelado estacionado com o nariz voltado a sul (o trator recua para a frente dele; o parque H gera também o pup atrás). Presets e mapa procedural recebem parques: spawn+Porto+Estaleiro+Industrial+Histórico+pátio central, Academia (4 classes) e Porto Oceânico (4 classes); helper `placeTrailerPad` garante a aproximação livre a sul.
  - **Mecânica (tecla `C` / botão 🔗 no HUD e TouchControls)**: candidato válido = ponto de engate do trator a ≤85px do kingpin do atrelado com ângulos alinhados (±28°) e conjunto parado (<3 km/h). O desacoplamento estaciona o atrelado a `kingpinDist+45px` para trás antes de restaurar a máscara de colisão (evita empurrão por sobreposição). No bitrem, o pup sai primeiro e entra em último; o pup só acopla à quinta roda traseira do dianteiro.
  - **Gating por licença**: C→standard, C+E→pá eólica, H→bitrem (par), X→vidro frágil; prompt HUD mostra `🔒 requer licença X` quando bloqueado.
  - **Colisões**: máscara do trator 4x2 `0x0001→0x0005` para poder empurrar atrelados livres (cat 0x0004); atrelados livres usam `group 0, mask 0x0003` (colidem com trator e obstáculos, não entre si).
  - **HUD**: telemetria `coupling { prompt, blocked, coupledName, notice }` com banner inferior-centro, botão tátil dedicado e pontos brancos dos atrelados livres no minimapa. Editor ganha o separador de categoria "parking".
  - **Condução livre começa solo** (`currentVehicleConfig 'solo'`); os exames continuam a gerar o conjunto completo automaticamente (`spawnVehicleRig`) — inalterados.

### **v1.6.9**
- **Correção: Z-Order das Rodas do Trator (dianteiras vs. traseiras):**
  - Dianteiras direcionais voltaram a desenhar-se **por baixo** da carroçaria (parcialmente escondidas, geometria original 8×20 em ±(hw+1)), via `wheelGraphics`; os duplos traseiros 4x2 mantêm-se **por cima** da carroçaria via novo `rearWheelsGraphics` (interior ±(hw−3), exterior saliente ±(hw+5)), ambos com rotação manual por trig (sem transforms de canvas).

### **v1.6.8**
- **Correção: Par Duplo Traseiro Legível:**
  - Causa: a carroçaria era desenhada por cima das rodas no container, escondendo o pneu interior do par — só o exterior aparecia (uma "roda única" muito saliente). `wheelGraphics` passou a desenhar **sobre** `cabGraphics`; os dois pneus de cada lado são agora visíveis (interior encostado à carroçaria em ±(hw−3), exterior saliente 9px em ±(hw+5)), 8×24 px com separação por contorno.

### **v1.6.7**
- **Correção: Rodas do Trator Invisíveis (Phaser 4):**
  - `drawWheels` redesenhava as rodas a cada frame com `save()/translateCanvas()/rotateCanvas()/restore()` — sob o renderer do Phaser 4 o estado de transformação não sobrevivia de forma fiável a `clear()` por frame, e as rodas deixavam de aparecer (as luzes, desenhadas no mesmo ciclo sem transforms, apareciam). As rodas são agora desenhadas com cantos rodados manualmente (trig) e um detalhe de cubo; dianteiras 9×22 salientes, duplos traseiros 10×26 salientes.

### **v1.6.6**
- **Correção de Profundidade do Acoplamento:**
  - O atrelado desenhava-se **por baixo** do trator (`depth 9` vs `10`), escondendo a traseira do camião e a quinta roda. Os atrelados passam a `depth 11` (o pup do bitrem a `12`, acima do dianteiro) — o atrelado aparece agora corretamente **por cima** da traseira do trator.
- **Pneus Duplos Traseiros Mais Visíveis:**
  - Cada pneu do eixo 4x2 alargado para 10×26 px, com o exterior saliente 10px além da borda da carroçaria (antes 8px) — claramente visível em qualquer zoom.

### **v1.6.5**
- **Eixo Trator Traseiro 4x2 com Pneus Duplos:**
  - `Truck.drawWheels`: o eixo traseiro passa a desenhar **2 pneus de cada lado** (interior encostado à carroçaria + exterior saliente), largura 8px cada, tocando-se em ±hw — visual fiel a um trator 4x2, com as rodas traseiras agora claramente salientes como as dianteiras direcionais.

### **v1.6.4**
- **Luzes de Reversão em Todos os Atrelados:**
  - `Trailer` agora guarda `isReversing` (espelho do estado do conjunto, calculado em `followHitch` via vHitchLong) e desenha lâmpadas de reversão brancas idênticas às do trator, coladas aos stops traseiros, com lente apagada discreta. Aplica-se a todos os tipos (standard, long_cargo, bitrem dianteiro/traseiro, frágil).

### **v1.6.3**
- **Luzes de Marcha Atrás Simplificadas (ajuste ao pedido):**
  - Removidos os cones de luz; as lâmpadas de reversão são agora dois círculos brancos sólidos (raio 5, como os stops acesos) colados aos stops traseiros (±16 px), com estado apagado discreto (cinza) quando a marcha atrás não está engatada.

### **v1.6.2**
- **Luzes de Marcha Atrás (Brancas) no Trator:**
  - Substituição dos dois pontinhos brancos por lâmpadas de reversão reais: halo branco + núcleo incandescente (estilo das luzes de travão) e dois feixes de flood light brancos projetados para trás da cabeça tratora, ativados por `isReversing` (vLong < -2 px/s).
- **HUD: Indicador de Semáforo Removido:**
  - Eliminado o widget de 3 lâmpadas do HUD superior (estado do semáforo próximo). Campo `trafficLight` removido da telemetria do `MainScene` e o método `getNearestLight` do `TrafficLightSystem` (órfão) removido.

### **v1.6.1**
- **Minimapa HUD do Mapa Completo:**
  - Vista geral no canto superior direito em coordenadas de ecrã (`scrollFactor 0`), rasterizada a 2 px/tile: base desenhada numa textura canvas apenas quando `mapVersion` muda (pintura/import/preset = 1 redraw); overlay por frame com retângulo da câmara ativa (condiz em modo condução e editor, câmaras sincronizadas por frame), marcador seta do camião e marcador pulsante ciano da doca do exame.
  - Escala adaptativa (~26% da menor dimensão do ecrã, clamp 0.5–1.6x); reposiciona-se em resize. Custo por frame constante: um retângulo da vista, uma seta e um círculo.
  - Alternável com a tecla `M` (desktop). O editor ignora paint/erase quando o pointer está sobre o minimapa (`isPointerOverMinimap`) para não pintar tiles escondidos por baixo dele.
  - `TilemapManager.mapVersion` (contador incrementado em `setTile`/`afterGridReplaced`) como sinal de invalidez.

### **v1.6.0**
- **Mapas 20x Maiores (108×80 tiles = 8.640 tiles, 13.824×10.240 px) com Performance Constante:**
  - Renderização nativa por Tilemap do Phaser: todas as texturas procedurais são marcadas num único *atlas* (`tile_atlas`) e o terreno usa um `TilemapLayer` com *culling* automático por câmara — o custo de desenho é proporcional aos tiles visíveis, não ao tamanho do mapa.
  - **Física por chunks (streaming):** corpos Matter estáticos só existem nos chunks (8×8 tiles) num raio de 2 chunks do camião (`updateActiveChunks`); fora do raio, sólidos são apenas dados na grelha. Chunks são reavaliados apenas quando o camião muda de centro de chunk.
  - **Semáforos com proximidade:** `rebuild` é data-only para o mapa todo; `updateProximity` materializa/desmaterializa corpos (poste + barreira) e desenha apenas sinais a <2560px do camião (reavaliado a cada 256px movidos).
  - Novo mapa default **procedural determinístico** (seed fixa): grelha de artérias com cruzamentos, passadeiras, passeios, ~30 semáforos alternate, postes/sinais, e 4 biomas de hub (Porto, Estaleiro, Zona Industrial, Centro Histórico). Presets Academia e Porto reescalados para o novo tamanho.
  - DOCAs de exame passam a ser **snap à estrada mais próxima** (`findExamDockPlacement`, busca em anéis) — coordenadas autorais podem calhar em edifícios/água em mapas grandes; a posição snapada é o alvo real (marcador visível e validação de passagem).
  - Export/import JSON com **run-length encoding** (`gridRLE`, v2) — ficheiros ~100x menores em mapas grandes; o import continua a aceitar v1 (grelha densa) e valida/repara tiles desconhecidos.
  - Zoom mínimo do editor reduzido para 0.04 (mapa completo cabe em telemóveis).

### **v1.5.1**
  - `cancelExam()` agora reseta `isPassed`/`isFailed`/`failReason` — o modal de resultado de exame fecha ao clicar "Continuar" (antes ficava aberto para sempre).
- **Correção do Offset do Editor (Clique ≠ Posição de Pintura):**
  - Causa raiz: `MainScene` e `EditorScene` tinham câmaras independentes (a principal seguia o camião e mantinha os *bounds* do mapa) — a grelha/sede do cursor eram desenhadas com uma câmara e os tiles renderizados com outra, e o Phaser re-centrava a câmara principal sempre que a vista ultrapassava os bounds.
  - Entrar no editor passa a ser um *handoff* sem salto: a câmara do editor começa exatamente onde a de condução estava (em volta do camião, zoom ~100%), eliminando a vista de "minimapa". Os *bounds* da câmara principal são removidos em modo editor (e repostos ao sair) para o sync por frame ser exato.
  - Edita-se diretamente o mapa real onde o camião está; **[Ver Tudo]** (`fitEntireMap`) mantém-se para enquadrar o mapa inteiro. `handlePaintPointer` calcula o tile diretamente do pointer (taps em touch deixam de usar posição obsoleta).
- **Correção do Fluxo de Exames (Auto-bloqueio e Doca-Alvo):**
  - Iniciar um exame já não é bloqueado pelo próprio gate de licença: `handleSelectVehicle` recebe `force` e o exame atribui o veículo diretamente (C+E, H e X voltam a ser alcançáveis).
  - A validação de acostagem usa apenas a `targetDock` do exame (raio + tolerância angular próprios), a doca-alvo é pintada fisicamente no arranque do exame (com limpeza de vizinhos sólidos) e assinalada com marcador pulsante "DOCA DO EXAME".
  - Aprovação exige manter alinhamento **1.5s contínuos** na doca (`dockHoldTimer`), com progresso visível no banner ("A alinhar… X.Xs / 1.5s").
- **Desempenho e Fugas de Memória:**
  - `TilemapManager.setTile` atualiza apenas os corpos de colisão do tile pintado (deixa de reconstruir o mapa inteiro por peça); o `TrafficLightSystem` só é reconstruído quando um semáforo é adicionado/removido.
  - Semáforos re-renderizam apenas em mudança de estado (deixa de haver `renderAll` a 60 fps).
  - Fuga de listener `collisionstart` do atrelado eliminada (handler removido em `Trailer.destroy()`).
- **Correções Menores:**
  - HUD lê `isReversing` da telemetria (elimina janela de crash `getMainScene()?.truck.isReversing`).
  - Partículas de chuva usam o delta real do frame (deixa de ser fixo `0.016`).
  - `setPointerCapture` nos pedais (acelerador/travão deixam de encravar se o dedo/rato sair do botão).
  - Limpeza de código morto (`Kingpin.constraint`, `isPinching`, campos não usados de `TruckConfig`, imports não usados em `App.tsx`, classes Tailwind inexistentes `scrollbar-*`/`animate-in`).
  - `package.json`: nome corrigido para `rigmaster`.

### **v1.5.0**
- **Barra Lateral à Esquerda com Menus Deslizantes (Slide-Out):**
  - Substituição da janela flutuante por um dock lateral de 56px (`w-14`) com acesso direto a Pintar, Mover (Pan), Borracha, Spawn, Ver Tudo e Zoom.
  - Catálogo de peças desdobra-se para a direita em gaveta deslizante (`flyout`) com abas de categorias e scroll vertical suave (`overflow-y-auto`), fechável com `[X]`.
- **Zoom Global do Mapa Inteiro:**
  - Limite de zoom expandido para `0.12 - 1.8`, permitindo visualizar o mapa completo de 3072×2304 em qualquer ecrã (incluindo telemóveis).
  - Botão **[Ver Tudo]** (`fitEntireMap`) calcula o fator de escala ideal e enquadra o mapa inteiro.
- **Pan / Viagem Fluida pelo Mapa (Rato e Touch):**
  - Ferramenta dedicada `Mover (Pan)` com suporte a arrastar com 1 dedo (touch) ou clique esquerdo.
  - Suporte a arrasto com botão direito do rato, botão do meio ou barra de Espaço.
  - Suporte a gesto de pinça (*pinch-to-zoom*) com 2 dedos em ecrãs táteis.
- **Miniaturas Gráficas Reais no Catálogo:**
  - Todas as peças exibem a miniatura gráfica procedural real (`TILE_THUMBNAILS`) com indicador de colisão sólida.

### **v1.4.0**
- **Semáforos de Trânsito Europeus (`TrafficLightSystem.ts`):**
  - Máquina de estados de 4 fases: Verde (7.5s) ➔ Amarelo (2.5s) ➔ Vermelho (7.5s) ➔ Vermelho+Amarelo (1.5s).
  - Sincronização coordenada de cruzamentos (Fase 0 vs Fase 1) para avenidas perpendiculares.
  - Barreira física de colisão na faixa de paragem (`obstacle_traffic_stop_barrier`) ativada no vermelho e desativada no verde.
  - Modelo visual realista em escala reduzida (`16x42 px`) com 3 óticas distintas e palas anti-reflexo curvadas no lancil do passeio.
  - Mini-semáforo no HUD superior junto ao velocímetro ao aproximar de cruzamentos.
- **Correção Multi-Touch no Volante e Mudança de Sentido:**
  - Migração de `onClick` para `onPointerDown` com `touch-action: none` nos botões `[D]`, `[R]` e travão `(P)`, permitindo manobrar e mudar de marcha em simultâneo com zero latência.

### **v1.3.0**
- **Refinamento Crítico da Articulação e Fim do Deslize Lateral:**
  - Eliminação do bloqueio mecânico artificial em marcha para a frente (o atrelado endireita-se livremente puxado pelo 5th wheel).
  - Limite de contacto físico ajustado para 95° restrito apenas à marcha-atrás.
  - Micro-estabilização do pino-mestre por decomposição longitudinal e rotação sobre o eixo traseiro sem deslocamento lateral dos pneus.
  - Aumento da massa e atrito (trator: 65, atrelados: 85-120, atrito borracha/asfalto: 0.8).

### **v1.2.0**
- **Mobiliário Urbano e Infraestrutura de Estradas:**
  - Alargamento das estradas para 112px de pavimento asfaltado com lancis de granito.
  - Adição de calçadas/passeios de betão com piso tátil, passadeiras zebradas para peões.
  - Postes de iluminação pública com hitboxes circulares e halo de luz.
  - Sinais de trânsito regulamentares com hitboxes dedicadas: STOP, Cedência de Passagem, Limite 30.

### **v1.1.0**
- **Comandos Táteis Ergonómicos:**
  - Volante de manobra rotativo aumentado em 20% com rotação contínua de +/-270° (540° lock-to-lock).
  - Visual semi-transparente minimalista para maximizar a visibilidade da pista.
  - Switch compacto de sentido `[ D | R ]` e botão circular de travão de estacionamento `(P)`.
  - Pedais compactos de travão e acelerador com resposta analógica progressiva.
  - Correção do travão em marcha-atrás (atua como travão de serviço absoluto em D e R).
  - Calibração do velocímetro físico: 1 km/h ≈ 4.5 px/s.

### **v1.0.0**
- **Lançamento Inicial da Base Modular (Phaser 3 + Matter.js + Vite):**
  - Implementação do Trator 4x2 e atrelados articulados.
  - Conexão Kingpin com cálculo de Tail Swing e Off-Tracking.
  - Sistema de Licenças de Perícia (C, C+E, H, X) e Garagens Regionais (Porto, Estaleiro, Industrial, Histórico).
  - Motor de áudio sintetizado em Web Audio API (ronco diesel do motor e apito de marcha-atrás).
  - Exportação e importação de mapas em JSON puro.

---

## 3. Diretrizes de Manutenção para Agentes de IA

1. **Atualização Obrigatória do `agents.md`:**
   - Sempre que forem introduzidas novas funcionalidades, correções de física ou alterações na arquitetura, incrementar a versão e registar os detalhes na secção **Changelog**.
2. **Física e Cinemática:**
   - Nunca aplicar velocidades puras em pixels/segundo sem multiplicar pelo delta time (`dt`) nas chamadas `setVelocity` e `setAngularVelocity` do Matter.js.
   - Em marcha para a frente, manter a rotação do atrelado livre; bloqueios mecânicos só devem atuar em marcha-atrás sob ângulos extremos de jackknife (> 90°).
3. **Interface e Ecrãs Pequenos:**
   - Assegurar que o HUD e os menus mantêm comportamento responsivo em ecrãs móveis (a partir de 360px de largura).
   - Manter a barra lateral do editor recolhida ou expansível para não obstruir o campo visual do utilizador.
4. **Verificação de Compilação:**
   - Executar sempre `compile_applet` e `lint_applet` em conjunto após modificações para garantir 0 erros de TypeScript e sintaxe.
