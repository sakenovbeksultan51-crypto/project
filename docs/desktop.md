# Запуск с рабочего стола

`TableFlow.vbs` и существующий ярлык вызывают `scripts/start-local.mjs`. Этот запуск использует отдельную сборку React и сервер Node.js с SQLite. Для него не нужны Vite dev server, Miniflare, workerd и предварительная ручная инициализация D1.

Причина изменения: прежний ярлык поднимал `vinext dev` с Cloudflare Vite plugin. В сохранённом журнале 12 ноября все три попытки завершились на `CloudflareDevEnvironment.fetchWorkerExportTypes → Miniflare.dispatchFetch → undici.fetch` с причиной `read ECONNRESET`. При этом база D1 в `.wrangler/state/v3/d1/miniflare-D1DatabaseObject` не содержала таблицы `workspaces`: даже после успешной загрузки HTML API смены отвечал 503.

## Сборка и запуск

```powershell
npm run desktop:build
npm run desktop
```

Для двойного щелчка используется тот же `TableFlow.vbs`. Проверка без открытия браузера:

```powershell
node scripts/start-local.mjs --no-browser
```

Сборка лежит в `.data/desktop-app`. Launcher вычисляет хеш исходников, стилей и зависимостей; повторная сборка нужна только после их изменения. При обновлении сборки перезапускается только собственный настольный сервер с подтверждённым PID. Проверка готовности `/api/health` подтверждает работу SQLite и версию приложения. Чужие приложения на порту 3000 не завершаются.

## Хранилище и возможности

База `.data/tableflow-local.sqlite` создаётся автоматически. При первом открытии существующие строки `workspaces` из локальной D1 копируются без перезаписи строк новой базы. Исходная D1 остаётся нетронутой. Дополнительные соединения и повторные запуски не сбрасывают данные.

Настольный сервер использует существующие обработчики `/api/workspace`, `/api/camera` и `/api/assistant`. Камера, гостевой просмотр `/watch`, YOLO, прогнозы и LLM используют тот же React-интерфейс. ONNX/WASM и модели читаются из `public` без копирования. Сервер слушает только localhost; ключи модели и исходный серверный код по HTTP не выдаются.

Исходный `vite.config.ts` и обычная сборка `npm run build` остаются для разработки и размещения сайта. Рабочий стол использует `desktop/vite.config.ts`.

## Проверки

`tests/desktop.test.ts` проверяет инициализацию и восстановление базы после перезапуска, импорт D1, API камеры и помощника, защиту файлов и записей, а также HTTP Range и MIME для WASM. Реальные модели и собранный inference worker можно проверить отдельно:

```powershell
node --experimental-vm-modules scripts/verify-desktop-worker.mjs
```
