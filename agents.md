## 2. Histórico de Versões & Changelog

### **v2.6.6** (Versão Atual — branch main)
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
