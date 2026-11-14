# ORC Scoring

Classificações ORC (ToT/ToD, pontuação baixa RRS Apêndice A, descartes, desempates A8) do Troféu Ria Formosa.

A app tem duas versões, que partilham o mesmo código (`docs/`):

| | App no Claude | Site público (GitHub Pages) |
|---|---|---|
| Endereço | claude.ai (artifact privado) | `https://<utilizador>.github.io/orc-scoring/` |
| Editar regatas, barcos, fotos, ler folhas com o Claude | Sim | Não (só leitura) |
| Logo próprio no separador e no ecrã inicial | Não (o claude.ai decide) | Sim (`docs/img/`) |
| Dados | Base de dados do artifact | `docs/data/db.json` |

`app.js` deteta se está a correr dentro do Claude. Fora do Claude, carrega `data/db.json`, esconde os botões de edição e as fotografias, e o "Descarregar HTML" passa a usar uma descarga normal do browser.

## Publicar no GitHub Pages

1. Juntar este código ao ramo `main`.
2. No GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, ramo `main`, pasta `/docs`.
3. Ao fim de um minuto o site fica em `https://<utilizador>.github.io/orc-scoring/`. No telemóvel, "Adicionar ao ecrã principal" usa o logo de `docs/img/`.

## Atualizar os resultados do site

Continua a editar na app do Claude. Para levar os dados para o site:

1. Exportar as coleções `boats`, `classes`, `champs` e `races` da base de dados do artifact para `data-export/<coleção>/<id>.json` (num Claude Code com acesso ao artifact basta pedir "exporta os dados da app ORC Scoring para o site").
2. `node scripts/build-db.mjs` gera `docs/data/db.json`.
3. Commit e push para `main`.

## Mudar o logo

Substituir as imagens em `docs/img/` mantendo os nomes e tamanhos: `icon-64.png` (separador e cabeçalho), `apple-touch-icon.png` (iPhone, 180×180), `icon-192.png` e `icon-512.png` (Android / `manifest.json`).
