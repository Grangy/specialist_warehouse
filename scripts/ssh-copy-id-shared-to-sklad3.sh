#!/usr/bin/env bash
# Добавить на sklad3 тот же публичный ключ, что используется для основного сервера (shared_server_key).
# Запуск с твоей машины, где есть приватный ключ ~/.ssh/shared_server_key:
#   ./scripts/ssh-copy-id-shared-to-sklad3.sh
# Потребуется один ввод пароля root на 91.215.60.44 (после смены пароля — новый).
#
# Без интерактива: вставь строку из cat ~/.ssh/shared_server_key.pub в
#   /root/.ssh/authorized_keys на сервере (консоль хостинга / сессия с паролем).
set -e
PUB="${SSH_PUBLIC_KEY:-$HOME/.ssh/shared_server_key.pub}"
HOST="${SKLAD3_HOST:-91.215.60.44}"
USER="${SKLAD3_USER:-grangy}"
PASSWORD="${SKLAD3_PASSWORD:-}"
DISABLE_FIREWALLS="${SKLAD3_DISABLE_FIREWALLS:-0}"

# Если пароль не передали явно, попробуем взять PASS из .env в корне репозитория.
# (Не печатаем пароль в лог.)
if [ -z "$PASSWORD" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ENV_FILE="$SCRIPT_DIR/../.env"
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
    if [ -n "${PASS:-}" ]; then
      PASSWORD="$PASS"
    fi
  fi
fi

if [ ! -f "$PUB" ]; then
  echo "Нет файла: $PUB"
  exit 1
fi
echo "Публичный ключ: $PUB"
echo "Куда: ${USER}@${HOST}"
echo "--- строка для ручной вставки в ~/.ssh/authorized_keys ---"
cat "$PUB"
echo "---------------------------------------------------------"

if [ -n "$PASSWORD" ]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "Нет sshpass. Установи его или запусти без SKLAD3_PASSWORD (будет интерактивно)."
    exit 1
  fi

  # Если сервер банит за попытки входа, можно временно остановить fail2ban/ufw/firewalld.
  # Используем тот же пароль (как для ssh), передаём его в sudo через stdin и выделяем TTY.
  if [ "$DISABLE_FIREWALLS" = "1" ]; then
    echo "Пробуем временно отключить fail2ban/ufw/firewalld (через sudo)."
    sshpass -p "$PASSWORD" ssh -tt -o StrictHostKeyChecking=accept-new \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      "${USER}@${HOST}" "bash -lc 'echo \"$PASSWORD\" | sudo -S -p \"\" systemctl stop fail2ban 2>/dev/null || true; echo \"$PASSWORD\" | sudo -S -p \"\" ufw disable 2>/dev/null || true; echo \"$PASSWORD\" | sudo -S -p \"\" systemctl stop firewalld 2>/dev/null || true; true'" || true
  fi

  echo "Используем пароль (через sshpass) для установки ключа без интерактива."
  KEY_B64="$(base64 < "$PUB" | tr -d '\n')"
  sshpass -p "$PASSWORD" ssh -T -o StrictHostKeyChecking=accept-new \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    "${USER}@${HOST}" "KEY_B64='$KEY_B64' bash -s" <<'REMOTE'
set -euo pipefail
KEY="$(printf '%s' "${KEY_B64:-}" | (base64 -d 2>/dev/null || base64 --decode))"
if [ -z "$KEY" ]; then
  echo "❌ Не удалось прочитать ключ (KEY пустой)"
  exit 1
fi
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"

if ! grep -qxF "$KEY" "$HOME/.ssh/authorized_keys"; then
  printf '%s\n' "$KEY" >> "$HOME/.ssh/authorized_keys"
fi
REMOTE

  echo "✅ Ключ добавлен."
  exit 0
fi

exec ssh-copy-id -i "$PUB" -o StrictHostKeyChecking=accept-new "${USER}@${HOST}"
