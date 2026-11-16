#!/bin/bash
# Testes de scripts/termhub/configurar.sh com um gh e um openssl falsos: nada sai da máquina.
# Rodar da raiz: bash scripts/termhub/test.sh
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fails=0
ok() { echo "ok   - $1"; }
ko() { echo "FAIL - $1"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/gh" <<'SH'
#!/bin/bash
echo "$*" >> "$GH_STATE/args"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo dono ;;
  "api repos/reactivandoio/hub-community-bff") echo true ;;
  "secret list") ls "$GH_STATE" | grep -v '^args$' || true ;;
  "secret set") cat > "$GH_STATE/$3" ;;
  "workflow run") echo ok ;;
esac
SH
cat > "$WORK/bin/openssl" <<'SH'
#!/bin/bash
echo "${FAKE_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}"
SH
chmod +x "$WORK/bin/gh" "$WORK/bin/openssl"
export PATH="$WORK/bin:$PATH"

fresh() { export GH_STATE="$WORK/state-$1"; rm -rf "$GH_STATE"; mkdir -p "$GH_STATE"; }
val() { cat "$GH_STATE/$1" 2>/dev/null; }

fresh new
out=$(bash "$DIR/configurar.sh" 2>&1)
check "grava a chave gerada" '[ "$(val TERMHUB_TOKEN_KEY)" = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ]'
check "grava TERMHUB_URL" '[ "$(val TERMHUB_URL)" = https://termhub.dev ]'
check "não mostra a chave" '! grep -q 0123456789abcdef <<<"$out"'
check "não dispara deploy sem --deploy" '! grep -q "workflow run" "$GH_STATE/args"'

FAKE_KEY=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff bash "$DIR/configurar.sh" >/dev/null 2>&1
check "mantém a chave existente" '[ "$(val TERMHUB_TOKEN_KEY)" = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ]'

out=$(FAKE_KEY=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff bash "$DIR/configurar.sh" --rotate --deploy 2>&1)
check "--rotate troca a chave e avisa" '[ "$(val TERMHUB_TOKEN_KEY)" = ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff ] && grep -q "salvar o token" <<<"$out"'
check "--deploy dispara o deploy" 'grep -q "workflow run deploy.yml" "$GH_STATE/args"'

fresh short
FAKE_KEY=abc bash "$DIR/configurar.sh" >/dev/null 2>&1
check "recusa chave curta" '[ -z "$(val TERMHUB_TOKEN_KEY)" ]'

[ "$fails" -eq 0 ] && echo "todos passaram" || { echo "$fails falharam"; exit 1; }
