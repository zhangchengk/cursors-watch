#!/usr/bin/env bash
# Ensure a stable local code-signing identity for Cursors Watch.
# Ad-hoc (`codesign --sign -`) changes CDHash every rebuild → macOS TCC
# (Desktop/Documents/…) re-prompts on every package:app:install.
# A persistent self-signed identity keeps the same designated requirement.
set -euo pipefail

IDENTITY="${CURSOR_WATCH_CODESIGN_IDENTITY:-Cursors Watch Local}"
STATE_DIR="${CURSOR_WATCH_STATE_DIR:-$HOME/.cursor-watch}"
# Prefer .keychain-db if present (newer macOS), else .keychain
KEYCHAIN_BASE="${CURSOR_WATCH_CODESIGN_KEYCHAIN_BASE:-$STATE_DIR/codesign.keychain}"
KEYCHAIN_PASS="${CURSOR_WATCH_CODESIGN_KEYCHAIN_PASS:-cursor-watch-local-codesign}"

mkdir -p "$STATE_DIR"

resolve_keychain() {
  if [ -n "${CURSOR_WATCH_CODESIGN_KEYCHAIN:-}" ]; then
    printf '%s\n' "$CURSOR_WATCH_CODESIGN_KEYCHAIN"
    return
  fi
  if [ -f "${KEYCHAIN_BASE}-db" ]; then
    printf '%s\n' "${KEYCHAIN_BASE}-db"
  elif [ -f "$KEYCHAIN_BASE" ]; then
    printf '%s\n' "$KEYCHAIN_BASE"
  else
    printf '%s\n' "$KEYCHAIN_BASE"
  fi
}

ensure_keychain() {
  local kc
  kc="$(resolve_keychain)"
  if [ ! -f "$kc" ] && [ ! -f "${KEYCHAIN_BASE}-db" ]; then
    security create-keychain -p "$KEYCHAIN_PASS" "$KEYCHAIN_BASE" >/dev/null
    kc="$(resolve_keychain)"
  fi
  security set-keychain-settings -lut 21600 "$kc" >/dev/null || true
  security unlock-keychain -p "$KEYCHAIN_PASS" "$kc" >/dev/null
  local existing
  existing="$(security list-keychains -d user | sed 's/^[[:space:]]*"//;s/"$//' | tr '\n' ' ')"
  # shellcheck disable=SC2086
  security list-keychains -d user -s "$kc" $existing >/dev/null 2>&1 || true
  printf '%s\n' "$kc"
}

identity_valid() {
  local kc="$1"
  security find-identity -v -p codesigning "$kc" 2>/dev/null | grep -F "\"$IDENTITY\"" >/dev/null
}

pick_openssl() {
  if command -v openssl >/dev/null 2>&1; then
    command -v openssl
  else
    echo "/usr/bin/openssl"
  fi
}

export_pkcs12() {
  local openssl_bin="$1" key="$2" cert="$3" out="$4" name="$5"
  if "$openssl_bin" pkcs12 -export -legacy -out "$out" -inkey "$key" -in "$cert" \
    -name "$name" -passout pass:tmp-export >/dev/null 2>&1; then
    return 0
  fi
  "$openssl_bin" pkcs12 -export -out "$out" -inkey "$key" -in "$cert" \
    -name "$name" -passout pass:tmp-export >/dev/null 2>&1
}

create_identity() {
  local kc="$1"
  local tmp openssl_bin
  tmp="$(mktemp -d)"
  openssl_bin="$(pick_openssl)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  "$openssl_bin" genrsa -out "$tmp/key.pem" 2048 >/dev/null 2>&1
  "$openssl_bin" req -new -key "$tmp/key.pem" -out "$tmp/csr.pem" \
    -subj "/CN=${IDENTITY}/O=Cursors Watch/OU=Local/C=CN" >/dev/null 2>&1
  cat >"$tmp/ext.cnf" <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF
  "$openssl_bin" x509 -req -in "$tmp/csr.pem" -signkey "$tmp/key.pem" -out "$tmp/cert.pem" \
    -days 3650 -extfile "$tmp/ext.cnf" >/dev/null 2>&1
  export_pkcs12 "$openssl_bin" "$tmp/key.pem" "$tmp/cert.pem" "$tmp/cert.p12" "$IDENTITY"

  security import "$tmp/cert.p12" -k "$kc" -P tmp-export -A \
    -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASS" "$kc" >/dev/null
  # Self-signed certs start as CSSMERR_TP_NOT_TRUSTED until trusted in this keychain.
  security add-trusted-cert -d -r trustRoot -k "$kc" "$tmp/cert.pem" >/dev/null 2>&1 || true
}

KEYCHAIN_PATH="$(ensure_keychain)"

if ! identity_valid "$KEYCHAIN_PATH"; then
  # Maybe imported but untrusted — try trust existing cert first.
  TMP_CERT="$(mktemp)"
  if security find-certificate -a -c "$IDENTITY" -p "$KEYCHAIN_PATH" >"$TMP_CERT" 2>/dev/null \
    && [ -s "$TMP_CERT" ]; then
    security add-trusted-cert -d -r trustRoot -k "$KEYCHAIN_PATH" "$TMP_CERT" >/dev/null 2>&1 || true
  fi
  rm -f "$TMP_CERT"
fi

if ! identity_valid "$KEYCHAIN_PATH"; then
  echo "Creating local codesign identity: $IDENTITY" >&2
  create_identity "$KEYCHAIN_PATH"
fi

if ! identity_valid "$KEYCHAIN_PATH"; then
  echo "error: failed to create or find codesign identity '$IDENTITY' in $KEYCHAIN_PATH" >&2
  security find-identity -p codesigning "$KEYCHAIN_PATH" >&2 || true
  exit 1
fi

# Export path for package-app.sh callers
export CURSOR_WATCH_CODESIGN_KEYCHAIN="$KEYCHAIN_PATH"
printf '%s\n' "$IDENTITY"
