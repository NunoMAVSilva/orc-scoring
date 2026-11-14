# ORC Scoring

Classificações ORC (ToT/ToD/GPH, pontuação baixa RRS Apêndice A, descartes, desempates A8).

Estrutura: **Campeonato → Prova (evento, com inscritos) → Regatas**. Uma prova única é um campeonato com uma só prova. As classificações só incluem barcos inscritos; inscritos sem resultado numa regata ficam DNC.

| Pasta | O que é |
|---|---|
| `app/` | App de gestão, publicada no Claude (edição, fotos, leitura das folhas por IA). |
| `docs/` | Site público no GitHub Pages: o mesmo código de `app/`, em modo só leitura, com `docs/data/db.json`. |
| `data-v2/` | Última exportação da base de dados da app (uma pasta por coleção). |
| `data-export/` | Cópia de segurança dos dados da versão 1 (antes da migração). |

`app.js` deteta se está dentro do Claude. Fora do Claude lê `data/db.json`, esconde edição e fotos e mostra a hora da última atualização.

## Publicar resultados no site

1. Exportar as coleções `champs`, `events`, `races`, `boats`, `classes`, `clubs` e `skippers` da base de dados do artifact ORC Scoring para `data-v2/<coleção>/<id>.json` (substituindo o conteúdo anterior).
2. `node scripts/build-db.mjs` — atualiza `docs/data/db.json` **só se os dados mudaram**.
3. Se mudou, commit e push para `main`; o GitHub Pages publica em 1–2 minutos.

## Alterar a app

Editar `app/`, testar, publicar no artifact e copiar para `docs/` (`rm -rf docs/*.js docs/*.css docs/index.html && cp app/*.js app/*.css app/index.html docs/`).

## Mudar o logo

Substituir as imagens em `app/img/` e `docs/img/` mantendo os nomes: `icon-64.png`, `apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png`.
