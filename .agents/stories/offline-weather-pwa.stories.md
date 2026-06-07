# Stories: Offline Weather PWA

Источник: `.agents/PRDs/offline-weather-pwa.prd.md`
Сгенерировано: 2026-06-07

---

## [STORY-001] Скаффолд проекта: Vite + TypeScript strict + тулинг

**Type**: Technical
**Priority**: High
**Complexity**: Small
**Phase**: 1 — UI skeleton
**Labels**: `technical`

### Description
Как разработчик, я хочу настроенный каркас проекта (Vite, TypeScript strict, ESLint, Prettier, Vitest, структура каталогов), чтобы все последующие задачи писались по единым правилам и валидировались одной командой.

### Acceptance Criteria
- [ ] Given чистый клон репозитория, when выполняю `npm install && npm run dev`, then открывается стартовая страница на dev-сервере Vite
- [ ] Given каркас проекта, when выполняю `npm run lint && npx tsc --noEmit && npm test`, then все три команды проходят без ошибок (минимум один smoke-тест существует)
- [ ] Given tsconfig, when смотрю настройки, then включён `strict: true`
- [ ] Given структура каталогов, when смотрю `src/`, then созданы каталоги `weather/`, `locations/`, `storage/`, `ui/` и точка входа `main.ts` (согласно CLAUDE.md)
- [ ] Given `.gitignore`, when проверяю, then `node_modules/`, `dist/`, `.env.local` исключены из репозитория

### Technical Notes
- `npm create vite@latest` (vanilla-ts), затем добавить ESLint + Prettier + Vitest
- Без фреймворков и лишних зависимостей — решение зафиксировано в CLAUDE.md
- npm-скрипты: `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `test`, `lint`

### Dependencies
- Blocked by: —
- Blocks: STORY-002, STORY-004

---

## [STORY-002] UI-скелет на мок-данных: карточки локаций

**Type**: Feature
**Priority**: High
**Complexity**: Medium
**Phase**: 1 — UI skeleton
**Labels**: `feature`, `ui`

### Description
Как пользователь, я хочу видеть экран с карточками всех моих локаций (текущая температура, иконка погоды, влажность, ветер), чтобы одним взглядом оценить погоду везде — и чтобы визуал можно было показать и обсудить уже сейчас.

### Acceptance Criteria
- [ ] Given мок-данные в форме реального ответа Open-Meteo (поля из спайка в PRD), when открываю приложение, then вижу 4 карточки локаций с названием, текущей температурой, иконкой погоды (WMO-код), влажностью и ветром (м/с)
- [ ] Given мобильный вьюпорт (390×844, iPhone), when открываю страницу, then вёрстка корректна: без горизонтального скролла, элементы читаемы
- [ ] Given экран с карточками, when тапаю карточку, then открывается/раскрывается детальный вид локации (заглушка под почасовку из STORY-003)
- [ ] Given UI, when смотрю любой текст, then язык — английский, рекламы и лишних элементов нет
- [ ] Given мок-слой, when смотрю код, then моки лежат отдельно и типизированы теми же типами `weather/`, что будут у реального API-клиента

### Technical Notes
- Визуальный ориентир: `examples/weather-lahti.png` (гугл-виджет)
- Типы ответа Open-Meteo завести сразу в `src/weather/` — STORY-004 переиспользует их
- Маппинг WMO weather code → иконка/описание в `src/weather/` с unit-тестами
- Рендер через `textContent`/DOM API, не `innerHTML` (CLAUDE.md → Security)
- Скриншот через agent-browser приложить к результату для демо владельцу

### Dependencies
- Blocked by: STORY-001
- Blocks: STORY-003, STORY-005

---

## [STORY-003] Детальный вид: SVG-график почасовки + прогноз на 7 дней

**Type**: Feature
**Priority**: High
**Complexity**: Medium
**Phase**: 1 — UI skeleton
**Labels**: `feature`, `ui`

### Description
Как пользователь, я хочу в детальном виде локации видеть кривую температуры с шагом 2–3 часа, осадки и прогноз на неделю (как в гугл-виджете), чтобы спланировать день и неделю.

### Acceptance Criteria
- [ ] Given мок-данные почасовки, when открываю детальный вид, then вижу SVG-кривую температуры на ~24 ч с подписями значений и времени (шаг 3 ч), как на референсе
- [ ] Given часы с осадками в мок-данных, when смотрю график/строку часов, then осадки визуально отмечены (мм и/или вероятность %)
- [ ] Given мок-данные на 7 дней, when смотрю детальный вид, then вижу строку дней недели с иконкой погоды и max/min температурой
- [ ] Given мобильный вьюпорт, when открываю график, then SVG масштабируется без обрезки и горизонтального скролла
- [ ] Given модуль построения графика, when запускаю `npm test`, then расчёт точек кривой (нормализация температур в координаты) покрыт unit-тестами

### Technical Notes
- График рукописный SVG — без chart-библиотек (CLAUDE.md)
- Чистая функция «массив (время, температура) → path/координаты» в `src/ui/` или `src/weather/` — её и тестировать
- Референс: `examples/weather-lahti.png`

### Dependencies
- Blocked by: STORY-002
- Blocks: —

---

## [STORY-004] Клиент Open-Meteo: типизированный fetch с таймаутами и ретраями

**Type**: Technical
**Priority**: High
**Complexity**: Medium
**Phase**: 2 — API integration
**Labels**: `technical`, `api`

### Description
Как разработчик, я хочу типизированный клиент Open-Meteo (forecast) с таймаутами, ретраями и изоляцией ошибок по слотам, чтобы UI получал предсказуемые данные и отказ одной локации не ломал остальные.

### Acceptance Criteria
- [ ] Given координаты локации, when вызываю `fetchForecast(lat, lon)`, then получаю типизированный объект: current + hourly (temperature, precipitation, precipitation_probability, weather_code) + daily 7 дней (max/min, precipitation_sum, weather_code), `timezone=auto`, ветер в м/с
- [ ] Given недоступная сеть или 5xx, when вызываю клиент, then выполняются ретраи с backoff 2s → 4s → 8s (макс. 3 попытки) и затем возвращается типизированная ошибка (не исключение наружу)
- [ ] Given ответ 4xx, when вызываю клиент, then ретраев нет, возвращается типизированная ошибка
- [ ] Given любой запрос, when сеть «зависает», then запрос прерывается по таймауту ~10 с (`AbortSignal.timeout`)
- [ ] Given несколько локаций, when запрашиваю их параллельно, then ошибка одной не влияет на результат остальных
- [ ] Given клиент, when запускаю `npm test`, then логика ретраев/таймаутов/парсинга покрыта тестами на мокнутом `fetch` с фикстурами реальных ответов

### Technical Notes
- Эндпоинт и параметры проверены спайком 2026-06-07 — точный URL в PRD (Open Questions → resolved)
- Перед реализацией дёрнуть эндпоинт живьём ещё раз (CLAUDE.md → Validate Before Implementing)
- Результат как discriminated union (`ok | error`), без `any`
- Фикстуры — записанные реальные ответы API

### Dependencies
- Blocked by: STORY-001
- Blocks: STORY-005, STORY-008

---

## [STORY-005] Реальные данные для дефолтных локаций из env

**Type**: Feature
**Priority**: High
**Complexity**: Small
**Phase**: 2 — API integration
**Labels**: `feature`, `api`

### Description
Как пользователь, я хочу видеть в приложении реальную погоду моих 4 дефолтных локаций, заданных через переменную окружения (не в коде репозитория), чтобы приложение стало полезным, а локации не светились в гите.

### Acceptance Criteria
- [ ] Given `VITE_DEFAULT_LOCATIONS` в `.env.local` (JSON: name, lat, lon), when открываю приложение, then карточки и детальный вид показывают реальные данные Open-Meteo для этих локаций вместо моков
- [ ] Given репозиторий, when ищу координаты/названия дефолтных локаций в закоммиченных файлах, then их нет; есть `.env.example` с фиктивным примером
- [ ] Given невалидный или отсутствующий `VITE_DEFAULT_LOCATIONS`, when собираю/открываю приложение, then понятная ошибка в консоли и пустое состояние UI (не падение)
- [ ] Given загруженные данные, when смотрю футер, then есть ссылка-атрибуция «Weather data by Open-Meteo» (требование CC-BY 4.0)
- [ ] Given одна из локаций недоступна (ошибка API), when открываю приложение, then остальные карточки отображаются нормально, у проблемной — состояние ошибки

### Technical Notes
- Парсинг и валидация env — в `src/locations/`, типизированно
- Моки из STORY-002 остаются для тестов
- Атрибуция — License requirement, не опция (CLAUDE.md → Notes)

### Dependencies
- Blocked by: STORY-002, STORY-004
- Blocks: STORY-006, STORY-007, STORY-009

---

## [STORY-006] Установка как PWA: manifest, иконки, service worker

**Type**: Feature
**Priority**: High
**Complexity**: Medium
**Phase**: 3 — PWA + offline
**Labels**: `feature`, `pwa`

### Description
Как пользователь iPhone, я хочу установить приложение на домашний экран (Add to Home Screen) и открывать его как нативное, чтобы погода была в одно касание.

### Acceptance Criteria
- [ ] Given прод-сборка (`npm run build && npm run preview`), when открываю в браузере, then manifest валиден (name, icons 192/512 + apple-touch-icon, theme-color, `display: standalone`) и service worker регистрируется
- [ ] Given Safari на iPhone, when делаю Add to Home Screen, then приложение ставится с корректной иконкой и именем и открывается standalone (без браузерного хрома)
- [ ] Given установленное PWA и включённый авиарежим, when открываю приложение, then app shell (HTML/CSS/JS) загружается из кэша service worker — статика доступна офлайн
- [ ] Given Lighthouse-проверка категории PWA на прод-сборке, when запускаю аудит, then ошибок installability нет

### Technical Notes
- `vite-plugin-pwa`, precache статики; `vite.config.ts` — hotspot-файл
- SW не работает на dev-сервере — проверять на `npm run preview` (CLAUDE.md)
- Проверка реального iPhone — defer-and-record: чек-лист владельцу, не блокер CI
- Дизайн иконки — простой и узнаваемый (солнце/облако), без сторонних ассетов с лицензионными ограничениями

### Dependencies
- Blocked by: STORY-005
- Blocks: STORY-007

---

## [STORY-007] Офлайн-кэш данных и stale-while-revalidate

**Type**: Feature
**Priority**: High
**Complexity**: Large
**Phase**: 3 — PWA + offline
**Labels**: `feature`, `pwa`, `storage`

### Description
Как пользователь, я хочу, чтобы при каждом открытии мгновенно показывались последние загруженные данные (даже офлайн) со штампом свежести, а при наличии сети данные тихо обновлялись, чтобы погода была доступна всегда.

### Acceptance Criteria
- [ ] Given ранее загруженные данные, when открываю приложение офлайн (авиарежим), then вижу все слоты с последними данными и штампом «Updated N h ago» — экран никогда не пустой
- [ ] Given открытие с сетью, when приложение стартует, then кэш рендерится мгновенно (< 2 с), параллельно уходят запросы по всем слотам, после ответа UI и кэш тихо обновляются, штамп сбрасывается
- [ ] Given приложение свёрнуто и развёрнуто (`visibilitychange`), when данные старше 30 минут и сеть есть, then запускается фоновое обновление
- [ ] Given сбой обновления (offline/5xx после ретраев), when открываю приложение, then продолжаю видеть кэш со штампом, без сообщений об ошибке поверх данных
- [ ] Given логика staleness и merge кэша, when запускаю `npm test`, then расчёт возраста данных, формат штампа и обновление кэша покрыты unit-тестами

### Technical Notes
- Слой кэша в `src/storage/`: ключ — слот/координаты, значение — последний удачный ответ + timestamp
- Хранилище: localStorage достаточно (полезная нагрузка ~десятки КБ на 6 слотов); абстрагировать, чтобы при проблемах с eviction перейти на IndexedDB
- Открытый вопрос PRD про iOS 7-day eviction проверяется здесь: чек-лист владельцу — не открывать PWA неделю, затем проверить офлайн-данные (defer-and-record)
- «Showing stale data» — нормальное состояние, не ошибка (CLAUDE.md → Error handling)

### Dependencies
- Blocked by: STORY-005, STORY-006
- Blocks: STORY-010

---

## [STORY-008] Геокодинг-автокомплит для поиска локаций

**Type**: Feature
**Priority**: Medium
**Complexity**: Medium
**Phase**: 4 — Custom slots
**Labels**: `feature`, `api`, `ui`

### Description
Как пользователь, я хочу искать любую географическую локацию через инпут с подсказками на каждой введённой букве, чтобы добавлять места поездок.

### Acceptance Criteria
- [ ] Given инпут поиска, when ввожу ≥2 символов, then под инпутом появляются подсказки (название, страна, регион) из Open-Meteo Geocoding API
- [ ] Given быстрый набор текста, when печатаю, then запросы дебаунсятся (~300 мс) и in-flight запрос отменяется при новом вводе (`AbortController`)
- [ ] Given запрос с пустым результатом, when ввожу несуществующее место, then показывается «No results» (не зависание и не ошибка)
- [ ] Given недоступная сеть, when пытаюсь искать, then понятное состояние «Search needs a connection», остальное приложение работает
- [ ] Given подсказки, when смотрю на их содержимое, then названия отрендерены как текст (`textContent`), не как HTML
- [ ] Given логика выбора подсказки, when выбираю элемент, then наружу отдаётся типизированный объект {name, lat, lon} — готовый вход для STORY-009

### Technical Notes
- Эндпоинт: `geocoding-api.open-meteo.com/v1/search?name=...&count=5&language=en` (проверен спайком)
- Известный нюанс: fuzzy-поиск слаб на коротких префиксах («Käs» не находит Käsmu в топ-5, нужно ~4+ букв) — UI просто показывает то, что вернул API, без обещаний
- Клиент геокодинга — в `src/locations/`, переиспользует паттерны fetch из STORY-004 (таймаут, типизированный результат); ретраи для автокомплита не нужны — устаревший запрос просто отменяется

### Dependencies
- Blocked by: STORY-004
- Blocks: STORY-009

---

## [STORY-009] Временные слоты: добавление, удаление, персистентность

**Type**: Feature
**Priority**: Medium
**Complexity**: Small
**Phase**: 4 — Custom slots
**Labels**: `feature`, `storage`

### Description
Как пользователь, я хочу 2 свободных слота, куда могу добавить локацию из поиска и убрать её после поездки, чтобы временно следить за погодой в местах путешествий.

### Acceptance Criteria
- [ ] Given пустой слот, when выбираю локацию из автокомплита, then слот заполняется, погода для него загружается и кэшируется наравне с дефолтными
- [ ] Given оба свободных слота заняты, when смотрю UI, then добавить третью локацию нельзя (кнопка скрыта/disabled), дефолтные слоты удалить нельзя
- [ ] Given заполненный временный слот, when удаляю его, then слот освобождается и его кэш-данные удаляются
- [ ] Given добавленный слот, when закрываю и снова открываю приложение (включая офлайн), then слот на месте с последними данными
- [ ] Given логика управления слотами, when запускаю `npm test`, then add/remove/persist покрыты unit-тестами

### Technical Notes
- Персистентность в том же `src/storage/`, что и кэш погоды (STORY-007); кастомные локации не покидают устройство (CLAUDE.md → Configuration)
- Модель слотов в `src/locations/`: `default | custom`, у custom — removable

### Dependencies
- Blocked by: STORY-005, STORY-008
- Blocks: STORY-010

---

## [STORY-010] Деплой на бесплатный статический хостинг

**Type**: Technical
**Priority**: High
**Complexity**: Small
**Phase**: 5 — Deploy
**Labels**: `technical`, `deploy`

### Description
Как владелец, я хочу, чтобы приложение автоматически деплоилось на бесплатный статический хостинг с дефолтными локациями из env-переменных хостинга, чтобы поставить PWA на iPhone и пользоваться ежедневно.

### Acceptance Criteria
- [ ] Given push в `master`, when CI/хостинг собирает проект, then прод-сборка публикуется по HTTPS-URL автоматически
- [ ] Given настройки хостинга, when смотрю конфигурацию, then `VITE_DEFAULT_LOCATIONS` задана в env хостинга, а в репозитории реальных локаций нет
- [ ] Given прод-URL на iPhone, when прохожу чек-лист владельца (Add to Home Screen → открыть → дождаться данных → авиарежим → переоткрыть), then офлайн показываются данные всех слотов со штампом свежести
- [ ] Given прод-сборка, when открываю приложение, then футер-атрибуция Open-Meteo на месте, загрузка кэшированного экрана < 2 с

### Technical Notes
- Хостинг: Netlify или Cloudflare Pages (решение PRD 2026-06-07: публичный URL — принятый компромисс)
- Деплой и реальный iPhone-тест — defer-and-record для оркестратора: финальную проверку делает владелец вручную
- Это последняя ишью — закрывает критерий успеха PRD (офлайн-тест)

### Dependencies
- Blocked by: STORY-007, STORY-009
- Blocks: —

---

## Сводка

| ID | Title | Phase | Complexity | Blocked by |
|----|-------|-------|------------|------------|
| STORY-001 | Скаффолд проекта | 1 | S | — |
| STORY-002 | UI-скелет: карточки локаций | 1 | M | 001 |
| STORY-003 | SVG-почасовка + 7 дней | 1 | M | 002 |
| STORY-004 | Клиент Open-Meteo | 2 | M | 001 |
| STORY-005 | Реальные данные из env | 2 | S | 002, 004 |
| STORY-006 | PWA: manifest + SW | 3 | M | 005 |
| STORY-007 | Офлайн-кэш + SWR | 3 | L | 005, 006 |
| STORY-008 | Геокодинг-автокомплит | 4 | M | 004 |
| STORY-009 | Временные слоты | 4 | S | 005, 008 |
| STORY-010 | Деплой | 5 | S | 007, 009 |

Параллелизация: после 001 можно вести 002/003 и 004 независимо; 008 не зависит от PWA-веток.
