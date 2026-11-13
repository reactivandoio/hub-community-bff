# Scripts do e-mail marketing (REA-29)

Rodam numa máquina com `gh` e `openssl` (pensados para o hulk, macOS) e não tocam no servidor.
Gravam secrets no Environment `production` de `reactivandoio/hub-community-bff` no GitHub, de onde
o deploy monta o `.env` do thor. Não edite o `.env` do servidor à mão: o próximo deploy sobrescreve.

Antes de gravar, cada script confere se o `gh` está logado numa conta admin do repositório. Se
não estiver, avisa e para sem gravar nada. Nenhum script imprime o valor do secret.

| Script | O que faz |
|---|---|
| `configurar.sh [--rotate] [--deploy]` | Uma vez só: gera o `EMAIL_UNSUBSCRIBE_SECRET` com openssl (não troca um que já existe, salvo com `--rotate`, que invalida os links de descadastro já enviados), grava `EMAIL_CAMPAIGNS_ENABLED=false`, o redirect vazio e, se ainda não existirem, `EMAIL_DAILY_LIMIT=100` e `EMAIL_DAILY_RESERVE=30` (REA-26: as campanhas usam no máximo limite − reserva, contando todo e-mail do dia). |
| `ensaio.sh <e-mail> [--deploy]` | Liga as campanhas com todo e-mail redirecionado para `<e-mail>`. |
| `desligar.sh [--deploy]` | Desliga as campanhas e esvazia o redirect. |

Os valores só chegam ao BFF no próximo deploy. `--deploy` dispara o `deploy.yml` na `main`; sem
ele, o script mostra o comando. Testes: `bash scripts/email-campaigns/test.sh` (usa um `gh` falso).

Não há script para liberar o envio real para a base. Quando o dono decidir, ele mesmo roda:
`gh secret set EMAIL_CAMPAIGNS_ENABLED --env production -R reactivandoio/hub-community-bff --body true`,
com o redirect vazio, seguido de um deploy.
