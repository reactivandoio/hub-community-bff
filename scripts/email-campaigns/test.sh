#!/bin/bash
# Testes dos scripts de scripts/email-campaigns com um gh e um openssl falsos: nada sai da máquina.
# Rodar da raiz: bash scripts/email-campaigns/test.sh
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0
ok() { echo "ok   - $1"; }
ko() { echo "FAIL - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

mkdir -p "$WORK/bin"
# gh falso: secrets em $GH_STATE/<nome>, chamadas em $GH_STATE/args.
cat > "$WORK/bin/gh" <<'SH'
#!/bin/bash
echo "$*" >> "$GH_STATE/args"
case "$1 $2" in
  "auth status") exit "${FAKE_GH_AUTH:-0}" ;;
  "api user") echo dono ;;
  "api repos/reactivandoio/hub-community-bff")
    [ "${FAKE_GH_ACCESS:-admin}" = none ] && { echo '{"message":"Not Found"}'; exit 1; }
    [ "${FAKE_GH_ACCESS:-admin}" = admin ] && echo true || echo false ;;
  "secret list") ls "$GH_STATE" | grep -v '^args$' || true ;;
  "secret set") [ -n "${FAKE_GH_FAIL:-}" ] && [ "$3" = "$FAKE_GH_FAIL" ] && exit 1; cat > "$GH_STATE/$3" ;;
  "workflow run") echo ok ;;
esac
SH
cat > "$WORK/bin/openssl" <<'SH'
#!/bin/bash
echo "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
SH
chmod +x "$WORK/bin/gh" "$WORK/bin/openssl"
export PATH="$WORK/bin:$PATH"

fresh() { export GH_STATE="$WORK/state-$1"; rm -rf "$GH_STATE"; mkdir -p "$GH_STATE"; }
val() { cat "$GH_STATE/$1" 2>/dev/null; }

# ---------- configurar.sh ----------
fresh conf
out=$(/bin/bash "$DIR/configurar.sh" 2>&1); code=$?
check "configurar: sai com 0" '[ $code -eq 0 ]'
check "configurar: grava o secret gerado, sem quebra de linha" '[ "$(val EMAIL_UNSUBSCRIBE_SECRET)" = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ]'
check "configurar: nunca mostra o secret" '! printf "%s" "$out" | grep -q 0123456789abcdef'
check "configurar: campanhas desligadas" '[ "$(val EMAIL_CAMPAIGNS_ENABLED)" = false ]'
check "configurar: cota do plano free (100/dia)" '[ "$(val EMAIL_DAILY_LIMIT)" = 100 ]'
check "configurar: reserva de 30 para códigos e transacionais" '[ "$(val EMAIL_DAILY_RESERVE)" = 30 ]'
check "configurar: não grava mais o limite antigo" '[ -z "$(val EMAIL_CAMPAIGN_DAILY_LIMIT)" ]'
check "configurar: redirect vazio como \"\"" '[ "$(val EMAIL_CAMPAIGN_REDIRECT_TO)" = "\"\"" ]'
check "configurar: Environment production do repo do BFF" 'grep -q "secret set EMAIL_CAMPAIGNS_ENABLED --env production -R reactivandoio/hub-community-bff" "$GH_STATE/args"'
check "configurar: sem --deploy não dispara deploy" '! grep -q "workflow run" "$GH_STATE/args"'
check "configurar: diz como fazer o deploy" 'printf "%s" "$out" | grep -q "gh workflow run deploy.yml"'

printf 'antigo' > "$GH_STATE/EMAIL_UNSUBSCRIBE_SECRET"
printf '5000' > "$GH_STATE/EMAIL_DAILY_LIMIT"
/bin/bash "$DIR/configurar.sh" >/dev/null 2>&1
check "configurar: não troca um secret que já existe" '[ "$(val EMAIL_UNSUBSCRIBE_SECRET)" = antigo ]'
check "configurar: mantém a cota de um plano já gravado" '[ "$(val EMAIL_DAILY_LIMIT)" = 5000 ]'
/bin/bash "$DIR/configurar.sh" --rotate >/dev/null 2>&1
check "configurar --rotate: troca" '[ "$(val EMAIL_UNSUBSCRIBE_SECRET)" != antigo ]'

fresh conf-deploy
/bin/bash "$DIR/configurar.sh" --deploy >/dev/null 2>&1
check "configurar --deploy: dispara o deploy.yml na main" 'grep -q "workflow run deploy.yml -R reactivandoio/hub-community-bff --ref main" "$GH_STATE/args"'

fresh noauth
FAKE_GH_AUTH=1 /bin/bash "$DIR/configurar.sh" >/dev/null 2>&1; code=$?
check "configurar: gh sem login para tudo e não grava nada" '[ $code -ne 0 ] && [ -z "$(ls "$GH_STATE" | grep -v args)" ]'

fresh noorg
out=$(FAKE_GH_ACCESS=none /bin/bash "$DIR/configurar.sh" 2>&1); code=$?
check "configurar: conta sem acesso à org avisa e não grava nada" '[ $code -ne 0 ] && printf "%s" "$out" | grep -q "não tem acesso" && [ -z "$(ls "$GH_STATE" | grep -v args)" ]'

fresh notadmin
out=$(FAKE_GH_ACCESS=write /bin/bash "$DIR/configurar.sh" 2>&1); code=$?
check "configurar: conta sem admin avisa e não grava nada" '[ $code -ne 0 ] && printf "%s" "$out" | grep -q "não é admin" && [ -z "$(ls "$GH_STATE" | grep -v args)" ]'

fresh badarg
/bin/bash "$DIR/configurar.sh" extra >/dev/null 2>&1; code=$?
check "configurar: recusa argumento solto" '[ $code -ne 0 ]'

# ---------- ensaio.sh ----------
fresh ensaio-sem-secret
/bin/bash "$DIR/ensaio.sh" dono@x.io >/dev/null 2>&1; code=$?
check "ensaio: sem o secret, recusa e não liga" '[ $code -ne 0 ] && [ -z "$(val EMAIL_CAMPAIGNS_ENABLED)" ]'

fresh ensaio
/bin/bash "$DIR/configurar.sh" >/dev/null 2>&1
/bin/bash "$DIR/ensaio.sh" >/dev/null 2>&1; code=$?
check "ensaio: exige o e-mail" '[ $code -ne 0 ] && [ "$(val EMAIL_CAMPAIGNS_ENABLED)" = false ]'
/bin/bash "$DIR/ensaio.sh" "nao-e-email" >/dev/null 2>&1; code=$?
check "ensaio: recusa e-mail inválido" '[ $code -ne 0 ] && [ "$(val EMAIL_CAMPAIGNS_ENABLED)" = false ]'
/bin/bash "$DIR/ensaio.sh" "a@x.io,b@y.io" >/dev/null 2>&1; code=$?
check "ensaio: recusa mais de um e-mail" '[ $code -ne 0 ]'
/bin/bash "$DIR/ensaio.sh" dono@x.io >/dev/null 2>&1; code=$?
check "ensaio: liga com o redirect" '[ $code -eq 0 ] && [ "$(val EMAIL_CAMPAIGNS_ENABLED)" = true ] && [ "$(val EMAIL_CAMPAIGN_REDIRECT_TO)" = dono@x.io ]'
check "ensaio: grava o redirect antes de ligar" '[ "$(grep -n "secret set" "$GH_STATE/args" | grep -E "REDIRECT_TO|ENABLED" | tail -n 2 | head -n 1 | grep -c REDIRECT_TO)" = 1 ]'

fresh ensaio-falha
/bin/bash "$DIR/configurar.sh" >/dev/null 2>&1
FAKE_GH_FAIL=EMAIL_CAMPAIGN_REDIRECT_TO /bin/bash "$DIR/ensaio.sh" dono@x.io >/dev/null 2>&1; code=$?
check "ensaio: se o redirect falha, não liga" '[ $code -ne 0 ] && [ "$(val EMAIL_CAMPAIGNS_ENABLED)" = false ]'

# ---------- desligar.sh ----------
fresh desligar
/bin/bash "$DIR/configurar.sh" >/dev/null 2>&1
/bin/bash "$DIR/ensaio.sh" dono@x.io >/dev/null 2>&1
secret_before=$(val EMAIL_UNSUBSCRIBE_SECRET)
/bin/bash "$DIR/desligar.sh" >/dev/null 2>&1; code=$?
check "desligar: desliga e esvazia o redirect" '[ $code -eq 0 ] && [ "$(val EMAIL_CAMPAIGNS_ENABLED)" = false ] && [ "$(val EMAIL_CAMPAIGN_REDIRECT_TO)" = "\"\"" ]'
check "desligar: mantém o secret" '[ "$(val EMAIL_UNSUBSCRIBE_SECRET)" = "$secret_before" ]'
check "desligar: não apaga secret (o deploy abortaria)" '! grep -q "secret delete" "$GH_STATE/args"'

echo
[ "$fails" -eq 0 ] && echo "Todos os testes passaram." || { echo "$fails teste(s) falharam."; exit 1; }
