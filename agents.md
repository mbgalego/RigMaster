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
├── App.tsx                 # Interface React / HUD minimalista, dock do editor e controlos
├── components/
│   └── TouchControls.tsx   # Volante rotativo (+/-270°), switch de marcha D/R e pedais táteis
├── entities/
│   ├── Truck.ts            # Trator 4x2 com física de inércia, torque diesel e pneus sem derrapagem
│   └── Trailer.ts          # Atrelados (Standard, Pá Eólica, Bitrem Lead/Pup, Vidro Sensível)
├── physics/
│   └── Kingpin.ts          # Conexão de articulação 5th-wheel, cálculo de Tail Swing e Off-tracking
├── systems/
│   ├── LicenseSystem.ts    # Gestor de Licenças de Perícia (C, CE, H, X) e temporizadores de exame
│   ├── GarageSystem.ts     # Hubs Regionais (Porto, Estaleiro, Industrial, Histórico) e biomas
│   └── TrafficLightSystem.ts # Semáforos europeus de 4 tempos com barreiras físicas de faixa
├── editor/
│   └── TilemapManager.ts   # Grelha 128x128, texturas procedurais, miniaturas e exportação JSON
└── scenes/
    ├── MainScene.ts        # Loop principal de física, áudio sintético Web Audio e câmara de condução
    └── EditorScene.ts      # Cena do editor, navegação por Pan (arrasto), Zoom global e grelha
```

---

## 2. Histórico de Versões & Changelog

### **v1.6.8** (Versão Atual)
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
