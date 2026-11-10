# RigMaster - Documentação Técnica & Registo de Versões (agents.md)

Este documento centraliza a arquitetura, o estado do sistema, a especificação técnica e o histórico de versões do projeto **RigMaster** (Phaser 3 + Matter.js + TypeScript + Vite + Tailwind CSS), servindo como guia de continuidade para agentes de IA e programadores.

---

## 1. Visão Geral da Arquitetura

O **RigMaster** é um simulador 2D top-down de manobra e condução de pesados com foco em geometria de articulação realista (Tail Swing, Off-Tracking, Jackknife e 5th-wheel/Kingpin), sem economia monetária, estruturado sobre um **Sistema Híbrido de Progressão**:
1. **Mestria (Licenças de Perícia C, C+E, H, X)**: Exames práticos de geometria de manobra e doca.
2. **Território (Conquista de Hubs 0% a 100%)**: Desbloqueio de biomas, peças no editor e modificadores atmosféricos.
3. **Editor "Paint & Drive"**: Edição em grelha 128x128 com alternância instantânea para condução (tecla Tab) e exportação/importação JSON.

```
src/
├── config.ts               # Configuração do Phaser 3 e motor Matter.js
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

### **v1.5.0** (Versão Atual)
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
