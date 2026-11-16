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
  - `smoke-test.mjs` (estradas, atrelado, respawn) e `smoke-fuel.mjs` (consumo, aviso 20%, minimapa, deslize sem combustível, abastecimento, respawn).

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
- Validar alterações com `npm run lint`, `npm run build` e os testes `smoke-test.mjs` / `smoke-fuel.mjs`.

---

## 2. Histórico de Versões & Changelog

### **v2.8.8** (Versão Atual — branch main)
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
