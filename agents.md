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
