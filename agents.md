# RigMaster — Documento Técnico & Plano do Jogo

## 1. Visão Geral, Arquitetura & Plano do Jogo

### 1.1 Visão & Pilar Central
Simulador de condução pesada em **2D Top-Down** (Phaser 4 + Matter.js + React + TypeScript), inspirado na experiência de transporte e manobras do **Euro Truck Simulator 2 (ETS2)**, mas **sem microgestão económica/financeira**: o foco total está na **física realista de camião e atrelados, manobras de precisão, transporte de cargas especializadas e missões**.

### 1.2 Estado Atual da Arquitetura (`src/`)
- **Motor & Cenas (`scenes/`, `config.ts`, `main.ts`)**:
  - `MainScene`: simulação de condução, física Matter.js, acoplamento quinta-roda, semáforos, bombas de combustível, som sintetizado Web Audio e ciclo dia/meteorologia.
  - `EditorScene`: editor de mundo ao vivo (estradas por splines, objetos/prefabs, redimensionamento, rotação, spawn e exportação/importação JSON).
  - `MinimapScene`: cena dedicada com zoom bloqueado em `1.0` no canto superior direito.
- **Veículos & Física (`entities/`, `physics/`)**:
  - `Truck`: direção Ackermann, curva de binário diesel, consumo e reserva de combustível (`≤20%`), deslize natural sem combustível e respawn com depósito a `100%`.
  - `Trailer` & `Kingpin`: atrelado standard (13.6m), pá eólica (62m), bitrem B-Double e vidro frágil, com cinemática anti-derrapagem lateral e proteção de jackknife.
- **Mundo & Sistemas (`world/`, `systems/`)**:
  - `World`, `WorldTerrain`, `WorldObjects`: ilha contínua com streaming de chunks e hitboxes estáticas.
  - `RoadNetwork`: rede vetorial por splines Hermite com largura variável, sentido único/duplo e aderência por piso (`asphalt`, `cobble`, `dirt`).
  - `LicenseSystem`, `GarageSystem`, `TrailerManager`: progressão de licenças com exames práticos, hubs regionais com modificadores meteorológicos e acoplamento livre.
- **Interface & Controlos (`App.tsx`, `components/TouchControls.tsx`)**:
  - HUD minimalista com velocímetro/marcha, notificações toast (incluindo reserva `≤20%` persistente), volante/pedais touch semi-transparentes e switch `D/R`.
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

### 1.4 Regras de Manutenção
- Manter sempre o **`agents.md`** e o **`package.json`** atualizados a cada versão.
- Validar alterações com `npm run lint`, `npm run build` e os testes `smoke-test.mjs` / `smoke-fuel.mjs`.

---

## 2. Histórico de Versões & Changelog

### **v2.7.2** (Versão Atual — branch main)
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
