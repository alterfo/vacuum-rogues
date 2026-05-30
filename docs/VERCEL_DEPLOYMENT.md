# Деплой на Vercel

## Автоматический деплой через GitHub

### Шаг 1: Подключите репозиторий в Vercel

1. Перейдите на [vercel.com](https://vercel.com)
2. Нажмите "Add New Project"
3. Выберите "Import Git Repository"
4. Найдите ваш репозиторий `SpaceRangers`
5. Нажмите "Import"

### Шаг 2: Настройте параметры проекта

В разделе "Configure Project":

| Параметр | Значение |
|----------|----------|
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

**Примечание:** Эти значения уже настроены в `vercel.json`.

### Шаг 3: Деплой

Нажмите "Deploy" — Vercel автоматически:
- Установит зависимости
- Выполнит сборку
- Развернет приложение
- Предоставит публичный URL

## Настройка для автоматического деплоя при push в main

Vercel автоматически деплоит при каждом push в ветку `main`.

### Предварительные требования

Убедитесь, что в репозитории есть:
- `package.json` с скриптами `build` и `dev`
- `vercel.json` (уже есть в проекте)
- `dist/` в `.gitignore`

## Локальный предпросмотр

```bash
# Установите Vercel CLI
npm install -g vercel

# Запустите локальный предпросмотр
vercel dev

# Или используйте стандартный dev-сервер
npm run preview
```

## Переменные окружения

Если нужны переменные окружения:

1. В Vercel Dashboard: Project Settings → Environment Variables
2. Добавьте переменные для каждого окружения (Production, Preview, Development)
3. Переопределите в `vercel.json` если нужно

## Кастомный домен

1. Vercel Dashboard → Domains
2. Добавьте ваш домен
3. Настройте DNS по инструкциям Vercel

## Оптимизация производительности

### Кэширование статических файлов

В `vercel.json` уже настроены заголовки кэширования для `/assets/*`:

```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### Security Headers

Также настроены:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

## Troubleshooting

### Build failed

Проверьте логи в Vercel Dashboard → Deployments → [deployment] → Build Logs

Частые причины:
- Отсутствуют зависимости в `package.json`
- Ошибки TypeScript
- Неверные пути к файлам

### Service Worker не регистрируется

Service Worker работает только на HTTPS (или localhost). Vercel автоматически использует HTTPS.

### IndexedDB не доступен

IndexedDB доступен только в браузере. Убедитесь, что код не выполняется на сервере (SSR).

## Мониторинг

- **Vercel Analytics**: Включите в Dashboard → Analytics
- **Web Vitals**: Отслеживайте Core Web Vitals
- **Error Tracking**: Настройте интеграцию с Sentry

## Ссылки

- [Vercel Documentation](https://vercel.com/docs)
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [Static Site Deployment](https://vercel.com/docs/deployments/static-site-deployment)
