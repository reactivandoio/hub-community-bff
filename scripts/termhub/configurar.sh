#!/bin/bash
# Configuração da IA do e-mail marketing (REA-51), uma vez só.
#
# Gera o TERMHUB_TOKEN_KEY (32 bytes, hex) nesta máquina com openssl e grava direto no GitHub, sem
# mostrar o valor. É a chave com que o BFF criptografa o token do termhub de cada admin no banco.
# Grava também TERMHUB_URL (https://termhub.dev) se ainda não existir. Sem a chave, a tela de
# configuração de IA avisa que o servidor não está pronto e nada é salvo.
#
# Se a chave já existir, não troca: trocar faz os tokens já salvos deixarem de abrir (cada admin
# precisa colar o token de novo). Para trocar mesmo assim, use --rotate.
#
# Uso: scripts/termhub/configurar.sh [--rotate] [--deploy]
source "$(dirname "$0")/../email-campaigns/lib.sh"

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

if has_secret TERMHUB_TOKEN_KEY && [ "$ROTATE" != 1 ]; then
  echo "  TERMHUB_TOKEN_KEY já existe: mantida (use --rotate para trocar)."
else
  key=$(openssl rand -hex 32 | tr -d '\n')
  [ "${#key}" -eq 64 ] || die "openssl não gerou o valor esperado."
  set_secret TERMHUB_TOKEN_KEY "$key"
  key=""
  [ "$ROTATE" = 1 ] && echo "  Chave trocada: cada admin precisa salvar o token do termhub de novo."
fi

if has_secret TERMHUB_URL; then
  echo "  TERMHUB_URL já existe: mantido."
else
  set_secret TERMHUB_URL "https://termhub.dev"
fi

deploy_or_explain
