# RigMaster — Documento Técnico & Plano do Jogo

## 1. Visão Geral, Arquitetura & Plano do Jogo

### 1.1 Visão & Pilar Central
Simulador de condução pesada em **2D Top-Down** (Phaser 4 + Matter.js + React + TypeScript), inspirado na experiência de transporte e manobras do **Euro Truck Simulator 2 (ETS2)**, mas **sem microgestão económica/financeira**: o foco total está na **física realista de camião e atrelados, manobras de precisão, transporte de cargas especializadas e missões**.

### 1.2 Estado Atual da Arquitetura (`src/`)
- **Motor & Cenas (`scenes/`, `config.ts`, `main.ts`)**:
  - `MainScene`: simulação de condução, física Matter.js, acoplamento quinta-roda, semáforos, bombas de combustível, som sintetizado Web Audio e iluminação dinâmica WebGL (`LightsManager` + `ConeLight` + pool de emissores).
  - `EditorScene`: editor de mundo ao vivo (estradas por splines, objetos/prefabs, redimensionamento, rotação, spawn e exportação/importação JSON).
  - `MinimapScene`: cena dedicada com zoom bloqueado em `1.0` no canto superior direito.
- **Veículos & Física (`entities/`, `physics/`)**:
  - `Truck`: direção Ackermann, curva de binário diesel, consumo e reserva de combustível (`≤20%`), deslize natural sem combustível, respawn com depósito a `100%` e modos de faróis (`off` / `low` / `high`).
  - `Trailer` & `Kingpin`: atrelado standard (13.6m), pá eólica (62m), bitrem B-Double e vidro frágil, com cinemática anti-derrapagem lateral e proteção de jackknife.
- **Mundo & Sistemas (`world/`, `systems/`)**:
  - `World`, `WorldTerrain`, `WorldObjects`: ilha contínua com streaming de chunks e hitboxes estáticas.
  - `RoadNetwork`: rede vetorial por splines Hermite com largura variável, sentido único/duplo e aderência por piso (`asphalt`, `cobble`, `dirt`).
  - `LicenseSystem`, `GarageSystem`, `TimeOfDaySystem`, `TrailerManager`: progressão de licenças com exames práticos, hubs regionais com modificadores meteorológicos, períodos do dia com ciclo 24h e acoplamento livre.
- **Interface & Controlos (`App.tsx`, `components/TouchControls.tsx`)**:
  - HUD minimalista com velocímetro/marcha, notificações toast (incluindo reserva `≤20%` persistente), volante/pedais touch semi-transparentes, botões de **Médios/Máximos** e switch `D/R`.
- **Testes Automáticos (`scripts/`)**:
  - `smoke-test.mjs` (estradas, atrelado, respawn), `smoke-fuel.mjs` (consumo, aviso 20%, minimapa, deslize sem combustível, abastecimento, respawn) e `smoke-bridge.mjs` (viadutos semente, passagem inferior, grip off-road sob tabuleiro, promoção antecipada em rampa curta, contenção de guardas L1 e normalização `layer` em JSON).

### 1.3 Plano Geral & Roadmap (Prioridade Sugerida)
> *Nota: as funcionalidades abaixo refletem os objetivos globais definidos para o projeto, organizados em fases lógicas de dependência técnica.*

#### Fase A — Mundo, Infraestruturas & Sinalização
1. **Expansão do Mapa & Arquipélago**: ampliar o território com múltiplas ilhas e zonas distintas ligadas por rede rodoviária mais rica.
2. **Sistema de Pontes & Viadutos (Desníveis)**: camadas de estrada sobrepostas com gestão de altura/layer para permitir cruzamentos em desnível sem colisões entre vias.
3. **Sinalização Rodoviária Coerente**: sinais de trânsito sincronizados com os dados reais de `RoadNetwork` e `WorldObjects` (limites de velocidade, sentidos proibidos/obrigatórios, cedência de passagem, cruzamentos e placas direcionais para portos/indústrias).

#### Fase B — Transporte Marítimo, Indústrias & Missões (Loop Principal)
4. **Locais Industriais & Destinos Dedicados**: adicionar fábricas, garagens, armazéns, pedreiras, refinarias, portos e docas temáticas com geometrias de manobra variadas.
5. **Sistema de Missões / Contratos de Transporte**: entregas ponto-a-ponto entre indústrias com tipos de carga específicos, requisitos de manobra/estacionamento, danos em carga e conclusão sem foco financeiro.
6. **Transporte por Barco / Ferry Simplificado**: terminais portuários onde a manobra-chave é entrar no porto e **estacionar o conjunto dentro do barco de transporte** para atravessar entre ilhas.
7. **Progressão de Frota (Camiões Desbloqueáveis)**: múltiplos camiões com características distintas (potência, eixos, tração, chassi) conquistados ao completar missões/objetivos, desbloqueando por sua vez missões mais exigentes.

#### Fase C — Mundo Vivo (Trânsito AI)
8. **Trânsito AI Multi-Veículo**: veículos autónomos a circular ao longo da `RoadNetwork`, respeitando faixas, sentidos, pontes e estados dos semáforos:
   - Automóveis ligeiros e comerciais;
   - Outros camiões rígidos e conjuntos articulados com atrelados.

#### Fase D — Evolução Visual (Texturas 2D & Iluminação WebGL)
9. **Pipeline 2D Totalmente Texturizado**: substituir desenhos vetoriais simples por sprites e texturas detalhadas (asfalto com desgaste, bermas/passeios, terreno, edifícios industriais, água, cabines de camiões e reboques) mantendo estética 2D nítida e apelativa.
10. **Sistema de Iluminação Realista em WebGL**: iluminação dinâmica (Light2D / shaders WebGL) com faróis volumétricos, lanternas de travagem/marcha-atrás, postes de iluminação, semáforos e reflexão atmosférica ajustada a dia, noite, chuva e nevoeiro.
11. **Oclusão de Luz com Ray2D / Sombras**: raycasting 2D para bloquear e projetar sombras reais dos faróis e candeeiros contra edifícios, muros e restantes elementos do mapa.

### 1.4 Regras de Manutenção
- Manter sempre o **`agents.md`** e o **`package.json`** atualizados a cada versão.
- Validar alterações com `npm run lint`, `npm run build` e os testes `smoke-test.mjs` / `smoke-fuel.mjs` / `smoke-bridge.mjs`.

---

## 2. Histórico de Versões & Changelog

### **v2.9.0** (Versão Atual — branch main)
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
