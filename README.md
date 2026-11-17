# RigMaster

Simulador de condução pesada em **2D Top-Down** (Phaser 4 + Matter.js + React + TypeScript), focado em física realista de camião e atrelados, manobras de precisão em docas/portos, cargas especializadas e edição em tempo real do mundo.

---

## Funcionalidades Principais

- **Física & Articulados**: direção Ackermann progressiva sensível à velocidade, curva de binário diesel, quinta-roda (`Kingpin`), atrelados Standard (13,6 m), Pá Eólica (62 m), Carga Frágil e Bitrem (B-Double) com proteção de jackknife e cinemática anti-derrapagem.
- **Pontes & Viadutos (Desníveis Piso 0 / Piso 1)**: estradas elevadas com rampas automáticas, contenção de guardas metálicas no tabuleiro e passagem livre por baixo com transparência automática do tabuleiro.
- **Combustível & Estações de Serviço**: consumo por distância, alerta persistente de reserva (`≤ 20%`), deslize natural ao esgotar o depósito e abastecimento interativo nas bombas (`F` ou toque/clique).
- **Ciclo de Dia & Iluminação WebGL**: períodos (`Amanhecer`, `Dia`, `Entardecer`, `Noite`), ciclo 24h opcional, faróis (`off` / `médios` / `máximos`), luzes de travagem/marcha-atrás e emissores dinâmicos no mapa.
- **Progressão de Cartas & Hubs**: exames práticos (`C`, `C+E`, `H`, `X`) com avaliação de danos/colisões e zonas portuárias/industriais com meteorologia dinâmica.
- **Editor Integrado**: editor completo em tempo real para estradas vetoriais (splines Hermite, largura por secção, twist, sentido único, piso, viadutos, colar/fundir pontas e edição isolada), objetos/compostos e importação/exportação JSON.

---

## Controlos

### Condução (Teclado)
| Tecla | Ação |
| --- | --- |
| `W` / `↑` | Acelerar |
| `S` / `↓` | Travar / Marcha-atrás |
| `A` / `D` ou `←` / `→` | Virar volante |
| `Espaço` | Travão de mão |
| `F` ou clique na bomba | Abastecer (junto a uma bomba de combustível) |
| `T` | Acoplar / Desacoplar atrelado (parado) |
| `L` | Alternar faróis (`Médios` / `Máximos` / `Desligado`) |
| `R` | Repor camião no spawn (atesta combustível a 100%) |
| `M` | Mostrar / Ocultar minimapa |
| `P` | Mostrar / Ocultar hitboxes Matter.js |

Em ecrãs táteis, o HUD fornece volante analógico, pedais de acelerador/travão, seletor `D / R`, controlos de faróis e gesto de pinça para zoom.

### Editor de Mundo
- **Alternar Condução ↔ Editor**: botão **Editor / Conduzir** no cabeçalho ou tecla `Tab`.
- **Navegação**: ferramenta `Mover`, arrasto fora de alças/pontos, botão direito/meio do rato, `Espaço + arrasto`, setas direcionais, roda do rato ou arrasto/pinça com 2 dedos em ecrãs táteis.
- **Ferramenta Estrada (`Estrada`)**:
  - Toque/clique no mapa coloca vértices; toque/clique no último vértice (halo verde `✓`) ou clique direito curto termina a estrada (`Enter` também conclui; `Backspace` remove o último ponto).
  - Duplo clique numa estrada insere um ponto de controlo; `Piso 0 ↔ Piso 1 (Viaduto)`, `Colar Auto` (suspenso temporariamente com `Shift`), `Isolar Estrada`, `Colar Pontas` e `Fundir Secções`.
- **Ferramenta Objetos & Composto**: mover, rodar livre (com snap a 45°), redimensionar nos cantos, duplicar (`Ctrl+D`), copiar/colar (`Ctrl+C` / `Ctrl+V`), rodar (`R` / `Shift+R`), agrupar por marquee (`Composto`) e desfazer (`Ctrl+Z`).

---

## Scripts

```bash
# Instalar dependências
npm install

# Arrancar servidor de desenvolvimento (http://localhost:3000)
npm run dev

# Verificar tipos TypeScript
npm run lint

# Gerar build de produção (dist/)
npm run build

# Pré-visualizar build de produção
npm run preview
```

### Smoke Tests (Playwright)
Com o servidor a correr em `http://localhost:3000`:

```bash
npm run test:smoke         # Estradas no load, atrelado default e respawn
npm run test:smoke:fuel    # Consumo, reserva 20%, minimapa, deslize e abastecimento
npm run test:smoke:bridge  # Viadutos: subida/descida, passagem inferior, grip e contenção L1
```

---

## Licença

Distribuído sob a licença MIT — ver [`LICENSE`](./LICENSE).
