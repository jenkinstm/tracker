"""Отчёты по позициям.

Запросы написаны на сыром SQL намеренно: дельта считается оконной функцией LAG, а
видимость — агрегатом с FILTER. Через ORM-связи это не выражается, а попытка выразить
даёт N+1 на десяти тысячах фраз.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Вес фразы в метрике видимости. Fallback обязателен: Search API точную частотность
# не отдаёт, и без него метрика обнулилась бы вместо того, чтобы считаться по базовой.
WEIGHT_SQL = "COALESCE(f.freq_exact, f.freq_base, 1)"

_FREQ_CTE = """
freq AS (
    SELECT DISTINCT ON (ws.keyword_id)
           ws.keyword_id, ws.freq_base, ws.freq_exact, ws.collected_at
    FROM wordstat_snapshots ws
    JOIN keywords k2 ON k2.id = ws.keyword_id
    WHERE k2.project_id = :project_id
    ORDER BY ws.keyword_id, ws.collected_at DESC
)
"""

_RANKED_CTE = """
ranked AS (
    SELECT p.keyword_id,
           p.checked_on,
           p.position,
           p.url,
           LAG(p.position) OVER w  AS prev_position,
           LAG(p.checked_on) OVER w AS prev_checked_on
    FROM positions p
    JOIN keywords k1 ON k1.id = p.keyword_id
    WHERE k1.project_id = :project_id
      AND p.target_id = :target_id
      AND p.checked_on <= :checked_on
    WINDOW w AS (PARTITION BY p.keyword_id, p.target_id ORDER BY p.checked_on)
)
"""


async def latest_check_date(
    session: AsyncSession, project_id: uuid.UUID, target_id: uuid.UUID, on_or_before: date | None
) -> date | None:
    sql = """
        SELECT MAX(p.checked_on)
        FROM positions p
        JOIN keywords k ON k.id = p.keyword_id
        WHERE k.project_id = :project_id AND p.target_id = :target_id
          AND (CAST(:on_or_before AS date) IS NULL OR p.checked_on <= CAST(:on_or_before AS date))
    """
    result = await session.execute(
        text(sql),
        {"project_id": project_id, "target_id": target_id, "on_or_before": on_or_before},
    )
    return result.scalar_one_or_none()


async def report_rows(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    target_id: uuid.UUID,
    checked_on: date | None,
    group_id: uuid.UUID | None = None,
    query: str | None = None,
    change: str | None = None,
    page: int = 1,
    size: int = 100,
) -> tuple[list[dict], int, date | None]:
    """Строки отчёта с дельтой к предыдущему съёму.

    change: up | down | top10 | lost | none — фильтр по динамике.
    """
    params: dict = {
        "project_id": project_id,
        "target_id": target_id,
        "checked_on": checked_on,
        "group_id": group_id,
        "query": f"%{query.lower()}%" if query else None,
    }

    where = ["k.project_id = :project_id"]
    if group_id:
        where.append("k.group_id = :group_id")
    if query:
        where.append("k.phrase_normalized LIKE :query")

    having = {
        "up": "AND r.position IS NOT NULL AND r.prev_position IS NOT NULL "
        "AND r.position < r.prev_position",
        "down": "AND r.prev_position IS NOT NULL "
        "AND (r.position IS NULL OR r.position > r.prev_position)",
        "top10": "AND r.position IS NOT NULL AND r.position <= 10",
        "top3": "AND r.position IS NOT NULL AND r.position <= 3",
        "lost": "AND r.position IS NULL",
    }.get(change or "", "")

    base = f"""
    WITH {_RANKED_CTE}, {_FREQ_CTE}
    SELECT k.id AS keyword_id,
           k.phrase,
           g.name AS group_name,
           f.freq_base,
           r.position,
           r.prev_position,
           r.prev_checked_on,
           r.url,
           k.target_url,
           COUNT(*) OVER () AS total_rows
    FROM keywords k
    LEFT JOIN ranked r ON r.keyword_id = k.id AND r.checked_on = :checked_on
    LEFT JOIN freq f ON f.keyword_id = k.id
    LEFT JOIN keyword_groups g ON g.id = k.group_id
    WHERE {" AND ".join(where)} {having}
    ORDER BY (r.position IS NULL), r.position NULLS LAST, k.phrase
    LIMIT :limit OFFSET :offset
    """
    params["limit"] = size
    params["offset"] = (page - 1) * size

    rows = (await session.execute(text(base), params)).mappings().all()
    total = rows[0]["total_rows"] if rows else 0

    previous_date: date | None = None
    items: list[dict] = []
    for row in rows:
        position = row["position"]
        previous = row["prev_position"]
        if row["prev_checked_on"] and previous_date is None:
            previous_date = row["prev_checked_on"]
        delta = previous - position if (position is not None and previous is not None) else None
        url = row["url"]
        target_url = row["target_url"]
        items.append(
            {
                "keyword_id": row["keyword_id"],
                "phrase": row["phrase"],
                "group_name": row["group_name"],
                "freq_base": row["freq_base"],
                "position": position,
                "previous_position": previous,
                "delta": delta,
                "url": url,
                "target_url": target_url,
                "url_mismatch": bool(url and target_url and _same_page(url, target_url) is False),
            }
        )
    return items, int(total), previous_date


def _same_page(left: str, right: str) -> bool:
    """Сравниваем URL без схемы, www и хвостового слеша: расхождение должно быть значимым."""

    def clean(value: str) -> str:
        value = value.strip().lower()
        for prefix in ("https://", "http://"):
            if value.startswith(prefix):
                value = value[len(prefix) :]
        if value.startswith("www."):
            value = value[4:]
        return value.split("#")[0].rstrip("/")

    return clean(left) == clean(right)


async def summary(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    target_id: uuid.UUID,
    checked_on: date | None,
) -> dict:
    """Средняя и медианная позиции показываются обе.

    Медиана устойчива к единичным вылетам, среднее их усиливает — одна цифра врёт.
    """
    sql = """
        SELECT COUNT(*) AS keywords,
               COUNT(*) FILTER (WHERE p.position <= 3)  AS in_top3,
               COUNT(*) FILTER (WHERE p.position <= 10) AS in_top10,
               COUNT(*) FILTER (WHERE p.position <= 50) AS in_top50,
               COUNT(*) FILTER (WHERE p.position IS NULL) AS out_of_depth,
               AVG(p.position) AS average_position,
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.position) AS median_position
        FROM positions p
        JOIN keywords k ON k.id = p.keyword_id
        WHERE k.project_id = :project_id AND p.target_id = :target_id
          AND p.checked_on = :checked_on
    """
    row = (
        await session.execute(
            text(sql),
            {"project_id": project_id, "target_id": target_id, "checked_on": checked_on},
        )
    ).mappings().one_or_none()
    if row is None or not row["keywords"]:
        return {
            "checked_on": checked_on,
            "keywords": 0,
            "in_top3": 0,
            "in_top10": 0,
            "in_top50": 0,
            "out_of_depth": 0,
            "average_position": None,
            "median_position": None,
        }
    return {
        "checked_on": checked_on,
        "keywords": int(row["keywords"]),
        "in_top3": int(row["in_top3"] or 0),
        "in_top10": int(row["in_top10"] or 0),
        "in_top50": int(row["in_top50"] or 0),
        "out_of_depth": int(row["out_of_depth"] or 0),
        "average_position": round(float(row["average_position"]), 1)
        if row["average_position"] is not None
        else None,
        "median_position": round(float(row["median_position"]), 1)
        if row["median_position"] is not None
        else None,
    }


async def visibility(
    session: AsyncSession, *, project_id: uuid.UUID, target_id: uuid.UUID, limit: int = 60
) -> list[dict]:
    """Доля фраз в ТОП-3/10/50 по датам съёмов, взвешенная по частотности."""
    sql = f"""
    WITH {_FREQ_CTE}
    SELECT p.checked_on,
           SUM({WEIGHT_SQL}) AS weight_total,
           SUM({WEIGHT_SQL}) FILTER (WHERE p.position <= 3)  AS w3,
           SUM({WEIGHT_SQL}) FILTER (WHERE p.position <= 10) AS w10,
           SUM({WEIGHT_SQL}) FILTER (WHERE p.position <= 50) AS w50
    FROM positions p
    JOIN keywords k ON k.id = p.keyword_id
    LEFT JOIN freq f ON f.keyword_id = p.keyword_id
    WHERE k.project_id = :project_id AND p.target_id = :target_id
    GROUP BY p.checked_on
    ORDER BY p.checked_on DESC
    LIMIT :limit
    """
    rows = (
        await session.execute(
            text(sql), {"project_id": project_id, "target_id": target_id, "limit": limit}
        )
    ).mappings().all()

    points = []
    for row in reversed(rows):
        total = float(row["weight_total"] or 0)
        if total <= 0:
            # Ни одной фразы с весом — метрику не считаем, а не делим на ноль.
            points.append(
                {"checked_on": row["checked_on"], "top3": 0.0, "top10": 0.0, "top50": 0.0}
            )
            continue
        points.append(
            {
                "checked_on": row["checked_on"],
                "top3": round(float(row["w3"] or 0) / total * 100, 2),
                "top10": round(float(row["w10"] or 0) / total * 100, 2),
                "top50": round(float(row["w50"] or 0) / total * 100, 2),
            }
        )
    return points
