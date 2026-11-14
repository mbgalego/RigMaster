## 2. Histórico de Versões & Changelog

### **v2.6.6** (Versão Atual — branch main)
- **HUD simplificado**: removida velocidade + marcha do topo (sem indicadores de combustível, avisos, etc.)
- **Percentagem dentro da barra**: indicador de combustível mostra percentagem centrada dentro da barra (texto branco com sombra escura)
- **Correção: toque na bomba não abastecia**. Causa raiz: uso de (this.input as any).activePointers, que não existe (apenas um Game Config option). Isso lançava TypeError e abortava o handler de pointerup antes de chegar à lógica de abastecer.
  - Passou a usar this.input.manager.pointers.filter(pt => pt.isDown)
  - Removido filtro pointerId (null no rato bloqueava cliques)
  - Área de toque passou de um raio de 40px para um hit-test do footprint da bomba (48x110) com padding ajustado ao zoom
  - Toque numa bomba longe mostra toast "Aproxime-se da bomba para abastecer"
- **Pinch-to-zoom corrigido**: adicionado input.activePointers: 3 na config. O default do Phaser é 1 ponteiro de toque, pelo que o gesto de 2 dedos nunca podia funcionar.
- **Avisos como toast**: "SEM COMBUSTÍVEL", "Bomba por perto — toque ou F para abastecer", "JACKKNIFE" e "Carga frágil danificada" aparecem como notificações toast temporárias (edge-triggered)
- **Percentagem sem decimais**: percentagem inteira (sem casas decimais)

### **v2.5.3** (branch main)

### **v2.6.5** (feature/fuel-system)

### **v2.6.4**, v2.6.3, v2.6.2, v2.6.1
