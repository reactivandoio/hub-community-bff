#!/bin/bash
# Funções comuns dos scripts do e-mail marketing (REA-29). Não rode este arquivo direto.
#
# Rodam em qualquer máquina com gh e openssl (pensados para o hulk, macOS, bash 3.2); não tocam no
# servidor. Gravam secrets no Environment "production" do repositório do BFF no GitHub.
# É de lá que os workflows deploy.yml e deploy-env.yml montam o .env do thor: um .env editado à
# mão no servidor é sobrescrito no próximo deploy. O valor só chega ao BFF no próximo deploy
# (--deploy dispara um).
#
# Nunca imprimem valores: só nomes de variáveis.
set -euo pipefail

REPO="${GH_REPO:-reactivandoio/hub-community-bff}"
ENVIRONMENT="${GH_ENVIRONMENT:-production}"

die() { echo "$*" >&2; exit 1; }

# Para antes de gravar qualquer coisa se o gh não estiver logado numa conta com acesso de admin ao
# repositório (gravar secret de Environment exige admin). Uma conta corporativa (EMU) logada no
# gh não enxerga a org reactivandoio: troque com gh auth switch ou use GH_TOKEN.
require_gh() {
  local login admin
  command -v gh >/dev/null || die "gh não encontrado no PATH (no macOS: brew install gh)."
  gh auth status >/dev/null 2>&1 || die "gh não está logado. Rode gh auth login com a conta que tem acesso à org ${REPO%%/*}. Nada foi gravado."
  login=$(gh api user -q .login 2>/dev/null) || die "gh não conseguiu ler a conta logada. Rode gh auth status. Nada foi gravado."
  admin=$(gh api "repos/$REPO" -q .permissions.admin 2>/dev/null) \
    || die "A conta $login do gh não tem acesso a $REPO (org ${REPO%%/*}). Troque de conta com gh auth switch, ou rode com GH_TOKEN=\$(gh auth token --user <conta>). Nada foi gravado."
  [ "$admin" = true ] || die "A conta $login vê $REPO mas não é admin; secrets do Environment exigem admin. Nada foi gravado."
  echo "gh logado como $login, admin de $REPO."
}

# Nomes dos secrets que já existem no Environment.
secret_names() {
  gh secret list --env "$ENVIRONMENT" -R "$REPO" --json name -q '.[].name'
}

has_secret() {
  secret_names | grep -qx "$1"
}

# Grava um secret pelo stdin (o valor não vai para a linha de comando nem para o log).
# O GitHub não aceita secret vazio: vazio vira "", que o dotenv lê como vazio. Apagar o secret
# não serve, porque o deploy aborta quando o .env do servidor tem uma variável que o GitHub não tem.
set_secret() {
  local name="$1" value="$2"
  [ -n "$value" ] || value='""'
  printf '%s' "$value" | gh secret set "$name" --env "$ENVIRONMENT" -R "$REPO" >/dev/null \
    || die "  $name: falhou ao gravar."
  echo "  $name"
}

# Dispara o workflow de deploy na main (o mesmo de um push), ou diz como fazer.
deploy_or_explain() {
  if [ "${DEPLOY:-0}" = 1 ]; then
    gh workflow run deploy.yml -R "$REPO" --ref main >/dev/null || die "Não consegui disparar o deploy."
    echo "Deploy disparado. Acompanhe com: gh run list -R $REPO --workflow deploy.yml --limit 1"
  else
    echo "O BFF só lê os valores novos no próximo deploy. Para disparar agora:"
    echo "  gh workflow run deploy.yml -R $REPO --ref main"
  fi
}

# Lê --deploy dos argumentos; o resto fica em ARGS.
parse_args() {
  DEPLOY=0
  ARGS=()
  for arg in "$@"; do
    case "$arg" in
      --deploy) DEPLOY=1 ;;
      -h | --help) usage; exit 0 ;;
      -*) usage >&2; exit 1 ;;
      *) ARGS+=("$arg") ;;
    esac
  done
}
