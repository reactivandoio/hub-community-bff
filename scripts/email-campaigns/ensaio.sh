#!/bin/bash
# Ensaio do e-mail marketing (REA-29): liga as campanhas com TODO e-mail redirecionado para um
# endereço só. Ninguém da base recebe nada; cada e-mail chega com "[para <destinatário>]" no
# assunto. O limite diário continua valendo (o ensaio gasta a cota do Mailgun do dia).
#
# Exige que o configurar.sh já tenha rodado. Para desligar: scripts/email-campaigns/desligar.sh
#
# Uso: scripts/email-campaigns/ensaio.sh <e-mail que recebe tudo> [--deploy]
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; }

parse_args "$@"
[ ${#ARGS[@]} -eq 1 ] || { usage >&2; exit 1; }
to="${ARGS[0]}"
printf '%s' "$to" | grep -Eq '^[^[:space:]@,;<>"]+@[^[:space:]@,;<>"]+\.[^[:space:]@,;<>"]+$' \
  || die "E-mail inválido: $to"

require_gh
has_secret EMAIL_UNSUBSCRIBE_SECRET || die "Falta o EMAIL_UNSUBSCRIBE_SECRET: rode antes scripts/email-campaigns/configurar.sh"

echo "Gravando em $REPO, Environment $ENVIRONMENT:"
# O redirect primeiro: se algo falhar no meio, as campanhas nunca ficam ligadas sem ele.
set_secret EMAIL_CAMPAIGN_REDIRECT_TO "$to"
set_secret EMAIL_CAMPAIGNS_ENABLED true

echo "Ensaio ligado: depois do deploy, todo e-mail de campanha vai para $to."
deploy_or_explain
