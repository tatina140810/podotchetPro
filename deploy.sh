#!/usr/bin/env bash
# PodotchetPRO deploy: rsync кода и фронта на hetzner-bot, рестарт сервиса, smoke-test.
#
# Использование:
#   ./deploy.sh           # обычный деплой (код + фронт + миграции + рестарт)
#   ./deploy.sh --no-build   # пропустить сборку фронта (если уже собран)
#   ./deploy.sh --backend-only  # только бэкенд + миграции, без фронта
#
# Безопасность (уроки Volt-Pos):
#   - rsync с --exclude .venv, не --delete для backend (venv на сервере локальный)
#   - bcrypt 4.0.1 закреплён в requirements.txt
#   - после рестарта проверяем /health, при ошибке — exit 1

set -euo pipefail

REMOTE="hetzner-bot"
REMOTE_BASE="/root/PodotchetPRO"
WEB_ROOT="/var/www/podotchetpro"
SERVICE="podotchetpro.service"
HEALTH_URL="https://podotchetpro.com/health"

DO_BUILD=true
BACKEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=false ;;
    --backend-only) BACKEND_ONLY=true; DO_BUILD=false ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

echo "==> 1/5 Pre-flight checks"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$REMOTE" 'echo ok' >/dev/null
echo "    SSH ok"

# Защита от случайного rsync пустой папки
if [ ! -f backend/main.py ]; then
  echo "ERROR: backend/main.py не найден — wrong cwd?"; exit 1
fi

if [ "$BACKEND_ONLY" = false ] && [ "$DO_BUILD" = true ]; then
  echo "==> 2/5 Building frontend"
  (cd frontend && npm install --silent && npm run build)
fi

echo "==> 3/5 Rsync backend"
rsync -avz --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '*.pyc' \
  --exclude 'uploads/' --exclude '*.db' --exclude '.env' \
  backend/ "$REMOTE:$REMOTE_BASE/backend/"

# Сверка структуры (memory: deploy_safety) — после rsync должны быть main.py, models.py, routers/
ssh "$REMOTE" "test -f $REMOTE_BASE/backend/main.py && test -d $REMOTE_BASE/backend/routers && test -d $REMOTE_BASE/backend/alembic" \
  || { echo "POST-RSYNC CHECK FAILED: критичные файлы отсутствуют на сервере"; exit 1; }
echo "    backend rsync ok"

if [ "$BACKEND_ONLY" = false ]; then
  echo "==> 4/5 Rsync frontend dist"
  rsync -avz --delete frontend/dist/ "$REMOTE:$WEB_ROOT/"
  ssh "$REMOTE" "test -f $WEB_ROOT/index.html" \
    || { echo "POST-RSYNC CHECK FAILED: $WEB_ROOT/index.html отсутствует"; exit 1; }
  echo "    frontend rsync ok"
fi

echo "==> 5/5 Server-side: pip install + alembic + restart"
ssh "$REMOTE" "set -e
  cd $REMOTE_BASE/backend
  if [ ! -d .venv ]; then
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip --quiet
  fi
  .venv/bin/pip install -q -r requirements.txt
  .venv/bin/alembic upgrade head
  systemctl restart $SERVICE
  systemctl is-active $SERVICE
"

echo "==> Smoke test $HEALTH_URL"
sleep 2
HEALTH=$(curl -fsS "$HEALTH_URL" || echo "FAIL")
echo "    response: $HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' || { echo "HEALTH CHECK FAILED"; exit 1; }

echo "==> ✓ Deploy complete"
