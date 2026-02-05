# CapyCode Sandbox API

Отдельный сервер для работы с E2B sandbox. Деплоится на Railway/Render где нет ограничения 10 секунд.

## Деплой на Railway (рекомендуется)

1. Зайдите на https://railway.app и создайте аккаунт
2. Нажмите "New Project" → "Deploy from GitHub repo"
3. Выберите этот репозиторий и папку `sandbox-api`
4. Добавьте переменную окружения:
   - `E2B_API_KEY` = ваш ключ

Railway автоматически задеплоит сервер и даст вам URL.

## Деплой на Render

1. Зайдите на https://render.com
2. New → Web Service
3. Подключите репозиторий
4. Root Directory: `sandbox-api`
5. Build Command: `npm install`
6. Start Command: `npm start`
7. Добавьте Environment Variable: `E2B_API_KEY`

## Локальный запуск

```bash
cd sandbox-api
npm install
npm start
```

Сервер запустится на http://localhost:3001

## API Endpoints

- `GET /` - Health check
- `POST /sandbox/create` - Создать sandbox
- `POST /sandbox/upload` - Загрузить файлы
- `POST /sandbox/exec` - Выполнить команду
- `POST /sandbox/expo-start` - Запустить Expo
- `POST /sandbox/expo-status` - Статус Expo
- `POST /sandbox/expo-stop` - Остановить Expo
- `DELETE /sandbox/:id` - Удалить sandbox
