#!/bin/bash
# Desliga o e-mail marketing (REA-29): EMAIL_CAMPAIGNS_ENABLED=false e redirect vazio. Com a fila
# desligada nenhuma campanha começa e nenhuma é enviada; as que estavam em andamento ficam paradas
# e continuam de onde pararam quando a fila for religada. Mantém o EMAIL_UNSUBSCRIBE_SECRET.
#
# Uso: scripts/email-campaigns/desligar.sh [--deploy]
source "$(dirname "$0")/lib.sh"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; }

parse_args "$@"
[ ${#ARGS[@]} -eq 0 ] || { usage >&2; exit 1; }

require_gh

echo "Gravando em $REPO, Environment $ENVIRONMENT:"
# Desliga primeiro: se algo falhar no meio, o redirect ainda protege a base.
set_secret EMAIL_CAMPAIGNS_ENABLED false
set_secret EMAIL_CAMPAIGN_REDIRECT_TO ""

echo "Campanhas desligadas."
deploy_or_explain
