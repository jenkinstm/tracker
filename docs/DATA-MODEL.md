# Схема данных

PostgreSQL 16. Все временные метки — `TIMESTAMPTZ` в UTC. Денежные значения — `BIGINT` в копейках.

## Таблицы

### users
`id uuid pk`, `email citext unique`, `hashed_password`, `is_active`, `monthly_request_limit int default 100000`, `created_at`

### projects
`id uuid pk`, `user_id fk`, `name`, `domain` (нормализованный хост без схемы и `www.`), `match_subdomains bool default false`, `fix_typos bool default true`, `schedule text` (`manual|weekly|daily`), `schedule_time time default '08:00'`, `is_active`, `created_at`

### project_targets
`id uuid pk`, `project_id fk`, `engine text` (`yandex`), `region_code text` (lr Яндекса, например `213`), `device text default 'desktop'`, `depth smallint default 100`, `lang text nullable`, `is_enabled bool default true`, `sort_order smallint`

Уникальный индекс: `(project_id, engine, region_code, device)`.

**Почему отдельная таблица, а не поля в `projects`.** Проверено по справке Topvisor 28.08.2026: глубина, тип выдачи и язык — настройки *региона внутри поисковой системы*, а не проекта. Регионов в проекте может быть сколько угодно, и мобильная выдача добавляется как тот же регион со вторым типом устройства. Плоская схема «один регион на ПС в проекте» упирается в потолок на первом же клиенте, который продвигается в Москве и Питере одновременно.

В MVP интерфейс позволяет завести одну строку (Яндекс + один регион + desktop). Схема при этом полноценная, так что расширение до нескольких регионов — работа только по фронтенду.

**Глубина в Яндексе зафиксирована на 100** (решение 28.08.2026): сотня приходит одним запросом, дальше начинается вторая сотня за отдельные деньги и без практической пользы. Валидация: для `engine='yandex'` разрешено только `depth=100`. Настройка станет живой на M9, когда придёт Google.

### wordstat_associations
`id bigserial`, `keyword_id fk`, `phrase text`, `count int`, `kind text` (`result|association`), `is_dismissed bool default false`, `collected_at timestamptz`

Заполняется **при каждом сборе частотности**: цена вызова не зависит от `numPhrases`, а повторный сбор стоит 100 ₽ за тысячу фраз, поэтому берём всё полезное с первого раза. В массовом сборе `numPhrases=100`, при точечном расширении по кнопке — 2000. Данные шумные: рядом с релевантным приходят смежные ниши и обрубки слов. `is_dismissed` — пользователь отклонил предложение, больше не показывать. Перенос фразы в `keywords` — только по явному действию человека.

### keyword_groups
`id uuid pk`, `project_id fk`, `name`, `parent_id fk nullable`, `sort_order`
Дерево неглубокое — двух уровней достаточно, не городи ltree.

### keywords
`id uuid pk`, `project_id fk`, `group_id fk nullable`, `phrase text`, `phrase_normalized text` (lower + сжатые пробелы), `target_url text nullable`, `is_active bool`, `created_at`

`target_url` — страница, которая *должна* ранжироваться по запросу, по мнению оптимизатора. Сравнивается с фактическим URL из выдачи; расхождение — сигнал, что оптимизируется не та страница. Стоит одну колонку и одно поле в отчёте, а пользы даёт много, поэтому берём в MVP.
Уникальный индекс: `(project_id, phrase_normalized)`.

### wordstat_snapshots
`id bigserial pk`, `keyword_id fk`, `region_yandex int`, `freq_base int` (широкое соответствие), `freq_exact int nullable` (в кавычках), `freq_exact_form int nullable` (`"!фраза"`), `device text default 'all'`, `collected_at timestamptz`, `provider text`

`freq_base` заполняется из `totalCount` метода `topRequests` Search API. `freq_exact` и `freq_exact_form` этот API отдать не может — операторы там не поддерживаются; поля заполняются только провайдером XMLRiver и остаются `null`, если он не подключён. Провайдер обязан писать своё имя в `provider`, иначе снимки из разных источников станут несравнимы.
Индекс: `(keyword_id, collected_at desc)`. Снимки не перезаписываем, храним историю.

### check_runs
`id uuid pk`, `project_id fk`, `target_id fk` (→ `project_targets`), `status text` (`queued|running|done|failed|partial`), `scheduled_for date`, `started_at`, `finished_at`, `keywords_total int`, `keywords_done int`, `keywords_failed int`, `cost_kopecks bigint`, `trigger text` (`manual|schedule`)

Уникальный индекс `(project_id, target_id, scheduled_for)` — обеспечивает идемпотентность повторного запуска.

### positions
`id bigserial`, `check_run_id fk`, `keyword_id fk`, `target_id fk` (→ `project_targets`), `position smallint nullable` (null = вне заданной глубины), `url text nullable` (релевантный URL из выдачи), `checked_on date`, `created_at`

**`device` заводим сразу, хотя мобильный съём в MVP не делаем.** Значение всегда `'desktop'`, в интерфейсе не показывается. Причина: добавить колонку в уникальный ключ партиционированной таблицы с накопленной историей заметно дороже, чем зарезервировать её на старте. Topvisor снимает мобильную и десктопную выдачу раздельно, так что это вопрос «когда», а не «если».

Партиционирование по `checked_on` помесячно (`PARTITION BY RANGE`). Индексы внутри партиции: `(keyword_id, checked_on desc)`, `(check_run_id)`.

Дельта к предыдущему съёму не хранится — считается оконной функцией `LAG(position) OVER (PARTITION BY keyword_id, engine ORDER BY checked_on)`.

### serp_snapshots
`id bigserial`, `check_run_id fk`, `keyword_id fk`, `target_id fk`, `results jsonb` (массив `{pos, url, domain, title}`, до 100 элементов), `checked_on date`

Сохраняем всю сотню, полученную за один запрос. Для сравнения: Topvisor хранит снимок выдачи Яндекса глубиной только ТОП-50 независимо от глубины проверки. У нас сотня приходит в том же запросе и стоит столько же, так что резать её незачем.
Партиционирование помесячно, автоудаление партиций старше 90 дней через cron-задачу. Это страховка: даёт добавить конкурентов и пересчитать историю без новых запросов к API.

### deferred_operations
`id bigserial pk`, `operation_id text unique`, `check_run_id fk`, `keyword_id fk`, `submitted_at timestamptz`, `expires_at timestamptz` (= `submitted_at + 12 часов`), `status text` (`pending|done|expired|failed`), `poll_attempts smallint`, `last_polled_at timestamptz`, `cost_kopecks bigint`

Индекс: `(status, expires_at)` — по нему работает опрашивальщик.

**Зачем отдельная таблица.** Yandex Search API хранит готовый ответ отложенного запроса ровно 12 часов, потом удаляет безвозвратно. Деньги при этом уже списаны. Держать `operation_id` только в памяти воркера нельзя: перезапуск контейнера — и оплаченные результаты потеряны.

Правила:
- Опрос ведёт отдельная периодическая задача по таблице, а не тот воркер, который ставил запрос.
- Первый опрос не раньше чем через 5 минут после отправки — раньше результата не бывает.
- `expires_at` в прошлом и `status='pending'` → `expired`, запись расхода как потерянного, переотправка, алерт в Sentry. Просроченная операция — это оплаченные и выброшенные деньги, такое должно быть видно сразу.

### regions
`code text pk` (lr Яндекса), `name text`, `parent_code text nullable`, `updated_at`

Заполняется методом `GetRegionsTree`, он единственный бесплатный в Wordstat API. Тянем один раз при развёртывании и по кнопке «обновить справочник», а не на каждый запрос.

### api_usage_log
`id bigserial`, `user_id fk`, `project_id fk nullable`, `provider text` (`yandex_search_api|xmlriver|dataforseo`), `operation text` (`serp_sync|serp_deferred|wordstat_top|wordstat_dynamics`), `requests int`, `cost_kopecks bigint`, `status text`, `error_code text nullable`, `created_at`
Индекс: `(user_id, created_at desc)`. Источник правды для экрана расходов и для лимитов.

Операции разделены по типам, потому что у них разные цены: отложенный поиск 30 ₽/1000, синхронный 488 ₽/1000, Wordstat 100 ₽/1000. Одна общая ставка на провайдера дала бы неверную себестоимость.

### provider_settings
`id uuid pk`, `user_id fk`, `provider text`, `credentials jsonb` (зашифровано ключом из `SECRET_KEY`), `price_per_1000_kopecks int`, `is_enabled bool`, `priority smallint`
Цена за 1000 хранится в БД, а не в коде: тарифы меняются, и пользователь должен уметь поправить её сам, чтобы расчёт себестоимости оставался верным.

## Ключевые запросы

**Отчёт по позициям с динамикой** — оконная функция `LAG` по `(keyword_id, engine)` с сортировкой по `checked_on`, джойн с последним `wordstat_snapshot` через `DISTINCT ON (keyword_id) ... ORDER BY collected_at DESC`.

**Медианная позиция** — середина отсортированного ряда позиций по проекту на дату; считаются только фразы, участвовавшие в проверке. Устойчивее среднего: одна фраза, вылетевшая со 2-го на 250-е место, среднее уводит, медиану почти нет. Topvisor показывает обе, и это правильно — берём тоже обе.

**Видимость проекта** — доля фраз в ТОП-3/10/50 на дату, взвешенная по частотности:
`SUM(w) FILTER (WHERE position <= 10) / SUM(w)`, где `w = COALESCE(freq_exact, freq_base, 1)`.
Fallback обязателен: если точная частотность недоступна (Search API её не отдаёт), метрика должна считаться по базовой, а не обнуляться.

Оба запроса пишем на SQLAlchemy Core или сырым SQL в `services/reports.py` — не пытайся выразить их через ORM-связи.

## Определение позиции по выдаче

Позиция — индекс первого результата, чей хост совпадает с `project.domain`.

Нормализация хоста: убрать схему, убрать `www.`, привести к нижнему регистру, отбросить порт.
Если `match_subdomains = true` — совпадением считается и `blog.example.com` для `example.com`. По умолчанию `false`.

Функцию нормализации и матчинга покрой юнит-тестами до того, как писать провайдеры: это самое частое место расхождения с Topvisor.
