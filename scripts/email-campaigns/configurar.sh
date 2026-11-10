#!/bin/bash
# Configuração inicial do e-mail marketing (REA-29), uma vez só.
#
# Gera o EMAIL_UNSUBSCRIBE_SECRET nesta máquina com openssl e grava direto no GitHub, sem mostrar
# o valor. Também grava EMAIL_CAMPAIGNS_ENABLED=false, EMAIL_CAMPAIGN_DAILY_LIMIT=70 e
# EMAIL_CAMPAIGN_REDIRECT_TO vazio: depois disto o BFF tem tudo, mas não envia nenhuma campanha.
#
# Se o secret já existir, não troca: trocar invalida os links de descadastro já enviados.
# Para trocar mesmo assim, use --rotate.
#
# Uso: scripts/email-campaigns/configurar.sh [--rotate] [--deploy]
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; }

ROTATE=0
rest=()
for arg in "$@"; do
  case "$arg" in --rotate) ROTATE=1 ;; *) rest+=("$arg") ;; esac
done
parse_args ${rest[@]+"${rest[@]}"}
[ ${#ARGS[@]} -eq 0 ] || { usage >&2; exit 1; }

require_gh
command -v openssl >/dev/null || die "openssl não encontrado no PATH."

echo "Gravando em $REPO, Environment $ENVIRONMENT:"

if has_secret EMAIL_UNSUBSCRIBE_SECRET && [ "$ROTATE" != 1 ]; then
  echo "  EMAIL_UNSUBSCRIBE_SECRET já existe: mantido (use --rotate para trocar)."
else
  # 32 bytes aleatórios em hex: 64 caracteres sem nada que o .env precise escapar.
  secret=$(openssl rand -hex 32 | tr -d '\n')
  [ "${#secret}" -eq 64 ] || die "openssl não gerou o valor esperado."
  set_secret EMAIL_UNSUBSCRIBE_SECRET "$secret"
  secret=""
fi

set_secret EMAIL_CAMPAIGNS_ENABLED false
set_secret EMAIL_CAMPAIGN_DAILY_LIMIT 70
set_secret EMAIL_CAMPAIGN_REDIRECT_TO ""

echo "Campanhas desligadas. Para o ensaio: scripts/email-campaigns/ensaio.sh <seu e-mail>"
deploy_or_explain
