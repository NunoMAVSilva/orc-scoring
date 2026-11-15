# ORC Scoring

Classificações ORC (ToT/ToD/GPH, pontuação baixa RRS Apêndice A, descartes, desempates A8).

Estrutura: **Campeonato → Prova (evento, com inscritos) → Regatas**. Um campeonato pode ter uma só prova. As classificações só incluem barcos inscritos; inscritos sem resultado numa regata ficam DNC.

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

## Regras de certificados e provas publicadas

- **Certificado usado:** o mais recente em vigor no 1.º dia da prova (o Anúncio de Regata define-o). Um certificado novo adicionado a um barco que já tem certificados vale a partir do dia seguinte à emissão, para não alterar provas já corridas.
- **Certificados antigos/atribuídos (até 2018):** no formulário *Manual* indique o *Ano do certificado*. Até 2018 o ToT barlavento/sotavento era impresso na escala antiga (675 ÷ ToD); a app converte-o para a escala atual (× 600/675, i.e. 600 ÷ ToD). Esse certificado é usado até o barco ter um certificado mais recente (do ano da competição).
- **Subclasses** (Definições do campeonato): escolha das subclasses ORC A/B/C/Sportboats, ORC Open, monotipias e *Geral A+B+C* (conjunta das subclasses A, B e C, sem Sportboats). Com *Mínimo de barcos para abrir subclasse*, as subclasses com menos barcos inscritos não abrem e não são publicadas.
- **Divisões** de um campeonato usam os certificados em vigor na data de fim do campeonato.
- **Provas publicadas ficam fechadas:** "🔒 Fechar prova" (página da prova) congela os certificados usados por cada barco e bloqueia regatas, chegadas, fotos, inscrições e skippers. Os certificados antigos continuam registados nos barcos. "Reabrir prova" pede dupla confirmação e só deve ser usado para corrigir um erro.

## Alterar a app

Editar `app/`, testar, atualizar o número `?v=` dos ficheiros em `app/index.html` (evita cache), publicar no artifact e copiar para `docs/` (`cp app/*.js app/*.css app/index.html docs/`).

## Mudar o logo

Substituir as imagens em `app/img/` e `docs/img/` mantendo os nomes: `icon-64.png`, `apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png`.
