"""Демо-данные: пользователь, проект на 50 фраз и справочник регионов.

Запуск: python -m app.seed
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import select

from app.db import SyncSessionMaker
from app.models import Keyword, KeywordGroup, Project, ProjectTarget, Region, User
from app.providers.registry import get_wordstat_provider
from app.security import hash_password
from app.services.text import normalize_phrase

DEMO_EMAIL = "demo@rankpulse.ru"
DEMO_PASSWORD = "rankpulse123"

GROUPS = {
    "Коммерческие / Москва": [
        "купить пластиковые окна",
        "пластиковые окна цена",
        "заказать окна пвх",
        "окна пвх недорого",
        "остекление балкона под ключ",
        "купить окна рехау",
        "пластиковые окна с установкой",
        "окна на балкон купить",
        "стеклопакет купить",
        "двухкамерный стеклопакет цена",
        "окна пвх от производителя",
        "купить окна в москве",
        "монтаж пластиковых окон цена",
        "замена стеклопакета стоимость",
        "теплые окна купить",
        "энергосберегающие окна цена",
        "окна с ламинацией купить",
        "балконный блок купить",
        "французский балкон цена",
        "панорамное остекление цена",
    ],
    "Информационные": [
        "какие окна лучше выбрать",
        "как выбрать пластиковые окна",
        "чем отличается однокамерный от двухкамерного стеклопакета",
        "как ухаживать за пластиковыми окнами",
        "почему потеют пластиковые окна",
        "как отрегулировать пластиковое окно",
        "срок службы пластиковых окон",
        "что такое энергосберегающий стеклопакет",
        "как утеплить балкон",
        "какая фурнитура лучше для окон",
        "нужно ли разрешение на остекление балкона",
        "как измерить оконный проем",
        "чем мыть пластиковые окна",
        "как поменять уплотнитель на окне",
        "зимний и летний режим окна",
    ],
    "Брендовые": [
        "рехау окна",
        "века окна",
        "кбе окна",
        "саламандер окна",
        "монблан профиль",
        "окна велюкс",
        "профиль экспроф",
        "динал профиль",
        "новотекс окна",
        "гутвэрк окна",
        "делюкс окна",
        "форвард окна",
        "элекс окна",
        "профайн профиль",
        "гринлайн окна",
    ],
}


def seed() -> None:
    with SyncSessionMaker() as session:
        user = session.execute(select(User).where(User.email == DEMO_EMAIL)).scalar_one_or_none()
        if user is None:
            user = User(email=DEMO_EMAIL, hashed_password=hash_password(DEMO_PASSWORD))
            session.add(user)
            session.flush()
            print(f"Создан пользователь {DEMO_EMAIL} / {DEMO_PASSWORD}")

        project = session.execute(
            select(Project).where(Project.user_id == user.id, Project.domain == "okna-demo.ru")
        ).scalar_one_or_none()
        if project is None:
            project = Project(
                user_id=user.id,
                name="Окна-Демо",
                domain="okna-demo.ru",
                match_subdomains=False,
                fix_typos=True,
                schedule="daily",
                schedule_time=time(8, 0),
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectTarget(project_id=project.id, engine="yandex", region_code="213", depth=100)
            )
            print("Создан проект «Окна-Демо» (okna-demo.ru, Москва, ТОП-100)")

        added = 0
        for group_name, phrases in GROUPS.items():
            group = session.execute(
                select(KeywordGroup).where(
                    KeywordGroup.project_id == project.id, KeywordGroup.name == group_name
                )
            ).scalar_one_or_none()
            if group is None:
                group = KeywordGroup(project_id=project.id, name=group_name)
                session.add(group)
                session.flush()

            for index, phrase in enumerate(phrases):
                normalized = normalize_phrase(phrase)
                exists = session.execute(
                    select(Keyword).where(
                        Keyword.project_id == project.id,
                        Keyword.phrase_normalized == normalized,
                    )
                ).scalar_one_or_none()
                if exists is None:
                    session.add(
                        Keyword(
                            project_id=project.id,
                            group_id=group.id,
                            phrase=phrase,
                            phrase_normalized=normalized,
                            # Целевой URL задан не везде: так в отчёте видно и совпадения,
                            # и расхождение с фактически ранжируемой страницей.
                            target_url=(
                                f"https://okna-demo.ru/{group_name.split()[0].lower()}"
                                if index % 5 == 0
                                else None
                            ),
                        )
                    )
                    added += 1

        if session.execute(select(Region).limit(1)).scalar_one_or_none() is None:
            for row in get_wordstat_provider().regions_tree():
                session.add(
                    Region(
                        code=row["code"], name=row["name"], parent_code=row.get("parent_code")
                    )
                )
            print("Загружен справочник регионов")

        session.commit()
        print(f"Добавлено фраз: {added}")
        print(f"Проект: {project.id}")


def seed_history(days: int = 6) -> None:
    """Прогоняет несколько съёмов задним числом, чтобы в отчёте была динамика."""
    from app.services import checks, wordstat

    with SyncSessionMaker() as session:
        project = session.execute(
            select(Project).where(Project.domain == "okna-demo.ru")
        ).scalar_one_or_none()
        if project is None:
            print("Сначала выполните seed()")
            return
        target = checks.primary_target(session, project.id)
        keywords = checks.active_keywords(session, project.id)

        selected, _ = wordstat.select_keywords(session, project.id, only_missing=True)
        if selected:
            wordstat.collect_for_keywords(session, project, selected, target.region_code)
            print(f"Собрана частотность по {len(selected)} фразам")

        from app.providers.registry import get_serp_provider

        provider = get_serp_provider(own_domain=project.domain)
        today = datetime.now(UTC).date()
        for offset in range(days, 0, -1):
            day = today - timedelta(days=offset * 7)
            run = checks.create_run(
                session,
                project=project,
                target=target,
                scheduled_for=day,
                trigger="schedule",
                keywords_total=len(keywords),
            )
            run.status = "running"
            checks.ensure_partitions(session, day)
            for keyword in keywords:
                results = provider._serp(keyword.phrase, target.region_code, target.depth, day)
                checks.store_result(
                    session,
                    run=run,
                    target=target,
                    project=project,
                    keyword=keyword,
                    results=results,
                )
                run.keywords_done += 1
            checks.finalize_run(session, run)
            print(f"Съём за {day}: {run.keywords_done} фраз, статус {run.status}")


if __name__ == "__main__":
    seed()
    if "--history" in sys.argv:
        seed_history()
