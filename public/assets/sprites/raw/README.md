# Pasta de Entrada — Sprites Brutas (Chroma Key)

Podes colocar aqui as imagens geradas externamente (ou fazer upload diretamente no chat).
O agente encarrega-se de remover o chroma key (`#FF00FF` ou `#00FF00`) com *despill*, recortar à *bounding box* exata, confirmar a orientação (frente para cima) e mover o PNG final para a respetiva subpasta em `public/assets/sprites/` (`tiles/`, `vehicles/trucks/`, `vehicles/trailers/`, `vehicles/traffic/`, `buildings/`, `props/`).

Consulta `docs/TEXTURE_PROMPTS.md` para todos os prompts prontos a copiar e `agents.md` (§1.5) para a especificação técnica completa.
