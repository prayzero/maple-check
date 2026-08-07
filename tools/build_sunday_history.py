"""Build a format-validated local snapshot of historical Sunday Maple events.

The upstream community archive consolidates official Nexon announcements from
the first Sunday Maple event onward.  This script intentionally snapshots the
public data so the PWA does not depend on a third-party API at runtime.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import pathlib
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "sunday-history.json"
SOURCE_API = "https://maplessunday.onrender.com/api/sunday/history/all"
SOURCE_PAGE = "https://www.maplessunday.com/calendar"
SOURCE_POST = "https://www.inven.co.kr/board/maple/2304/47579"
SOURCE_LEGACY_POST = "https://www.inven.co.kr/board/maple/2304/20563"
OFFICIAL_ARCHIVE = (
    "https://maplestory.nexon.com/News/Event/Closed"
    "?search=%EC%8D%AC%EB%8D%B0%EC%9D%B4"
)
OFFICIAL_FIRST = "https://archive.maplestory.nexon.com/News/Update/478?p=27"
OFFICIAL_LATEST = "https://maplestory.nexon.com/News/Event/1368"
FIRST_EVENT = dt.date(2017, 3, 12)
CONTINUOUS_START = dt.date(2023, 2, 19)
OFFICIAL_CONFIRMATIONS = {
    "2017-03-12": {
        "officialUrl": OFFICIAL_FIRST,
        "officialVerified": True,
        "officialTitle": "썬데이 메이플 최초 시행",
        "extraBenefits": ["리부트 드롭률 2배"],
    },
    "2026-07-26": {
        "officialUrl": "https://maplestory.nexon.com/News/Event/1365",
        "officialVerified": True,
        "officialTitle": "스페셜 썬데이 메이플",
        "officialDetails": [
            "트레저 헌터 경험치 3배",
            "룬 재등장·재사용 대기시간 15분 → 10분, 룬 경험치 +100%",
            "콤보킬 구슬 경험치 +300%",
            "몬스터파크 추가 경험치 +250% (총 400%, 익스트림 제외)",
            "사냥으로 획득하는 솔 에르다 2배",
        ],
    },
    "2026-08-02": {
        "officialUrl": "https://maplestory.nexon.com/News/Event/1367",
        "officialVerified": True,
        "officialTitle": "스페셜 썬데이 메이플",
        "officialDetails": [
            "잠재능력·에디셔널 잠재능력 재설정 시 등급 상승 확률 2배",
            "어빌리티 재설정 비용 50% 할인",
        ],
        "extraBenefits": ["미라클 타임", "어빌리티 반값"],
        "benefitsComplete": True,
    },
    "2026-08-09": {
        "officialUrl": OFFICIAL_LATEST,
        "officialVerified": True,
        "officialTitle": "스페셜 썬데이 메이플",
        "officialDetails": [
            "접속 시간 2분마다 솔 에르다 조각 교환권 1개 누적 (최대 90개)",
            "누적 접속 시간 2시간 달성 시 솔 에르다 조각 교환권 10개 추가 지급",
            "누적 접속 시간 3시간 달성 시 솔 에르다 1개 추가 지급",
            "사냥으로 획득하는 솔 에르다 3배",
            "몬스터파크 추가 경험치 +250% (총 400%, 익스트림 제외)",
        ],
        "extraBenefits": ["솔에르다 타임", "솔에르다 3배", "몬스터파크"],
        "benefitsComplete": True,
    },
}
DATE_CORRECTIONS = {
    # The community API has this Monday date; the official grouped notice lists
    # the corresponding Sunday benefit on 2024-03-31.
    "2024-04-01": "2024-03-31",
}
BENEFIT_LABEL_CORRECTIONS = {
    "트레져 헌터": "트레저 헌터",
}


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; maple-check history refresh)"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def split_benefits(summary: str) -> list[str]:
    return list(dict.fromkeys(
        BENEFIT_LABEL_CORRECTIONS.get(item.strip(), item.strip())
        for item in summary.split(",")
        if item.strip()
    ))


def sunday_week_of_year(value: dt.date) -> int:
    return ((value - dt.date(value.year, 1, 1)).days // 7) + 1


def gap_bucket(gap: int) -> int:
    if gap <= 2:
        return 0
    if gap <= 4:
        return 1
    if gap <= 8:
        return 2
    if gap <= 13:
        return 3
    if gap <= 26:
        return 4
    return 5


def smooth(prior: float, strength: float, successes: float, total: float) -> float:
    return (strength * prior + successes) / (strength + total)


def prepare_sundays(records: list[dict]) -> list[dict]:
    prepared = []
    for record in sorted(records, key=lambda row: row["date"]):
        if record["kind"] != "sunday":
            continue
        value = dt.date.fromisoformat(record["date"])
        prepared.append({
            "date": value,
            "week": sunday_week_of_year(value),
            "season": (value.month - 1) // 3,
            "benefitList": record["benefits"],
            "benefits": set(record["benefits"]),
        })
    return prepared


def forecast_benefit(
    prepared: list[dict],
    benefit: str,
    target: dt.date,
    half_life: float = 78,
) -> dict:
    hit_rows = []
    week_count = recent_count = recent_weeks = 0
    last_observed_date = None
    recent_weight = recent_hits = recent_weight_square = 0.0
    calendar_weight = calendar_hits = 0.0
    target_week = sunday_week_of_year(target)
    target_season = (target.month - 1) // 3

    for record in prepared:
        if record["date"] >= target:
            break
        week_count += 1
        last_observed_date = record["date"]
        age = max(0, round((target - record["date"]).days / 7))
        weight = 2 ** (-age / half_life)
        hit = 1 if benefit in record["benefits"] else 0
        if hit:
            hit_rows.append(record)
        if age <= 52:
            recent_weeks += 1
            recent_count += hit
        recent_weight += weight
        recent_weight_square += weight * weight
        recent_hits += weight * hit

        direct_distance = abs(target_week - record["week"])
        week_distance = min(direct_distance, 52 - min(52, direct_distance))
        week_kernel = math.exp(-0.5 * (week_distance / 3) ** 2)
        season_similarity = 1 if record["season"] == target_season else 0.15
        similarity = 0.5 * season_similarity + 0.5 * week_kernel
        calendar = weight * similarity
        calendar_weight += calendar
        calendar_hits += calendar * hit

    p_frequency = (len(hit_rows) + 0.5) / (week_count + 1)
    p_recent = smooth(p_frequency, 4, recent_hits, recent_weight)
    p_calendar = smooth(p_recent, 12, calendar_hits, calendar_weight)

    continuous_hits = [
        record for record in hit_rows
        if record["date"] >= CONTINUOUS_START
    ]
    exposure = [0] * 6
    success = [0] * 6
    for index in range(1, len(continuous_hits)):
        gap = round((continuous_hits[index]["date"] - continuous_hits[index - 1]["date"]).days / 7)
        if gap <= 0:
            continue
        for at_risk in range(1, gap + 1):
            bucket = gap_bucket(at_risk)
            exposure[bucket] += 1
            if at_risk == gap:
                success[bucket] += 1

    last_date = hit_rows[-1]["date"] if hit_rows else None
    current_gap = round((target - last_date).days / 7) if last_date else None
    observed_gap = (
        round((last_observed_date - last_date).days / 7)
        if last_date and last_observed_date else 0
    )
    if last_date and last_date >= CONTINUOUS_START:
        for at_risk in range(1, observed_gap + 1):
            exposure[gap_bucket(at_risk)] += 1
    bucket = gap_bucket(max(1, current_gap)) if current_gap is not None else 5
    p_gap = (
        smooth(p_recent, 12, success[bucket], exposure[bucket])
        if len(hit_rows) >= 4 else p_recent
    )
    probability = max(0.001, min(
        0.95,
        0.15 * p_frequency +
        0.50 * p_recent +
        0.20 * p_calendar +
        0.15 * p_gap,
    ))
    return {
        "probability": probability,
        "pFrequency": p_frequency,
        "recentCount": recent_count,
        "recentWeeks": recent_weeks,
    }


def build_backtest(records: list[dict], cutoff: dt.date) -> dict:
    prepared = [
        record for record in prepare_sundays(records)
        if record["date"] <= cutoff
    ]
    targets = prepared[-52:]
    evaluated = top1_hits = baseline_top1_hits = 0
    top3_hits = baseline_top3_hits = 0
    top3_label_hits = baseline_top3_label_hits = actual_label_count = 0
    brier_total = baseline_brier_total = 0.0
    brier_count = 0

    for target in targets:
        actual = set(target["benefits"])
        known_candidates: dict[str, None] = {}
        for record in prepared:
            if record["date"] >= target["date"]:
                break
            for benefit in record["benefitList"]:
                known_candidates.setdefault(benefit, None)
        if not actual or not known_candidates:
            continue

        ranked = [
            {
                "benefit": benefit,
                **forecast_benefit(prepared, benefit, target["date"]),
            }
            for benefit in known_candidates
        ]
        ranked.sort(key=lambda item: (-item["probability"], item["benefit"]))
        top3 = ranked[:3]
        baseline_top3 = sorted(
            ranked,
            key=lambda item: (-item["pFrequency"], item["benefit"]),
        )[:3]
        hit_count = sum(item["benefit"] in actual for item in top3)
        baseline_hit_count = sum(item["benefit"] in actual for item in baseline_top3)
        top3_hits += int(hit_count > 0)
        baseline_top3_hits += int(baseline_hit_count > 0)
        top1_hits += int(bool(top3) and top3[0]["benefit"] in actual)
        baseline_top1_hits += int(
            bool(baseline_top3) and baseline_top3[0]["benefit"] in actual
        )
        top3_label_hits += hit_count
        baseline_top3_label_hits += baseline_hit_count
        actual_label_count += len(actual)

        for item in ranked:
            outcome = 1 if item["benefit"] in actual else 0
            brier_total += (item["probability"] - outcome) ** 2
            baseline_brier_total += (item["pFrequency"] - outcome) ** 2
            brier_count += 1
        for unseen_actual in actual:
            if unseen_actual in known_candidates:
                continue
            brier_total += 1
            baseline_brier_total += 1
            brier_count += 1
        evaluated += 1

    return {
        "cutoffDate": cutoff.isoformat(),
        "weeks": evaluated,
        "top1Rate": top1_hits / evaluated if evaluated else 0,
        "baselineTop1Rate": baseline_top1_hits / evaluated if evaluated else 0,
        "top3Rate": top3_hits / evaluated if evaluated else 0,
        "baselineTop3Rate": baseline_top3_hits / evaluated if evaluated else 0,
        "precisionAt3": top3_label_hits / (evaluated * 3) if evaluated else 0,
        "recallAt3": top3_label_hits / actual_label_count if actual_label_count else 0,
        "baselineRecallAt3": (
            baseline_top3_label_hits / actual_label_count
            if actual_label_count else 0
        ),
        "averageBenefits": actual_label_count / evaluated if evaluated else 0,
        "brier": brier_total / brier_count if brier_count else 0,
        "baselineBrier": (
            baseline_brier_total / brier_count
            if brier_count else 0
        ),
    }


def build_snapshot(source: dict) -> dict:
    raw_history = source.get("history")
    if not isinstance(raw_history, list) or not raw_history:
        raise ValueError("history must be a non-empty list")

    seen_dates: set[str] = set()
    records: list[dict] = []
    today = dt.date.today()
    for raw in raw_history:
        if not isinstance(raw, dict):
            raise ValueError("history row must be an object")
        original_date = str(raw.get("date", "")).strip()
        date_text = DATE_CORRECTIONS.get(original_date, original_date)
        event_date = dt.date.fromisoformat(date_text)
        confirmation = OFFICIAL_CONFIRMATIONS.get(date_text)
        # Future community rows are not treated as observations until an
        # official source has been manually attached and verified.
        if event_date > today and not confirmation:
            continue
        if event_date < FIRST_EVENT:
            raise ValueError(f"record predates the first event: {date_text}")
        if date_text in seen_dates:
            raise ValueError(f"duplicate history date: {date_text}")
        seen_dates.add(date_text)

        summary = str(raw.get("eventSummary", "")).strip()
        benefits = split_benefits(summary)
        if confirmation:
            benefits = list(dict.fromkeys(
                benefits + confirmation.get("extraBenefits", [])
            ))
        if not benefits:
            raise ValueError(f"record has no benefits: {date_text}")

        record = {
            "date": date_text,
            "kind": "sunday" if event_date.weekday() == 6 else "special-day",
            "mainEvent": str(raw.get("mainEvent", "")).strip(),
            "benefits": benefits,
        }
        if confirmation:
            record.update({
                key: value
                for key, value in confirmation.items()
                if key != "extraBenefits"
            })
        records.append(record)

    # The community archive can lag behind a newly published official notice.
    # Keep manually verified official Sundays in the snapshot immediately,
    # including an announced event that is still a few days in the future.
    for date_text, confirmation in OFFICIAL_CONFIRMATIONS.items():
        if date_text in seen_dates:
            continue
        event_date = dt.date.fromisoformat(date_text)
        benefits = list(dict.fromkeys(confirmation.get("extraBenefits", [])))
        if not benefits:
            raise ValueError(f"official-only record has no benefits: {date_text}")
        record = {
            "date": date_text,
            "kind": "sunday" if event_date.weekday() == 6 else "special-day",
            "mainEvent": confirmation.get("officialTitle", ""),
            "benefits": benefits,
        }
        record.update({
            key: value
            for key, value in confirmation.items()
            if key != "extraBenefits"
        })
        records.append(record)
        seen_dates.add(date_text)

    records.sort(key=lambda row: row["date"], reverse=True)
    benefit_names = sorted({
        benefit
        for row in records
        for benefit in row["benefits"]
    })
    sunday_count = sum(row["kind"] == "sunday" for row in records)
    special_count = len(records) - sunday_count
    coverage_end = dt.date.fromisoformat(records[0]["date"])
    calendar_sunday_count = ((coverage_end - FIRST_EVENT).days // 7) + 1
    sunday_dates = {
        dt.date.fromisoformat(row["date"])
        for row in records
        if row["kind"] == "sunday"
    }
    cursor = CONTINUOUS_START
    while cursor <= coverage_end:
        if cursor not in sunday_dates:
            raise ValueError(f"continuous model window has a missing Sunday: {cursor}")
        cursor += dt.timedelta(days=7)

    retrieved = dt.date.today()
    return {
        "meta": {
            "retrieved": retrieved.isoformat(),
            "coverageStart": records[-1]["date"],
            "coverageEnd": records[0]["date"],
            "recordCount": len(records),
            "sundayCount": sunday_count,
            "specialDayCount": special_count,
            "calendarSundayCount": calendar_sunday_count,
            "missingSundayCount": calendar_sunday_count - sunday_count,
            "continuousStart": CONTINUOUS_START.isoformat(),
            "benefitCount": len(benefit_names),
            "sourceApi": SOURCE_API,
            "sourcePage": SOURCE_PAGE,
            "sourcePost": SOURCE_POST,
            "sourceLegacyPost": SOURCE_LEGACY_POST,
            "officialArchive": OFFICIAL_ARCHIVE,
            "officialFirst": OFFICIAL_FIRST,
            "officialLatest": OFFICIAL_LATEST,
            "note": (
                "Community-maintained snapshot of publicly announced Nexon events. "
                "It does not claim complete official coverage; missing calendar weeks "
                "are unknown, not negative observations."
            ),
        },
        "backtest": build_backtest(records, retrieved),
        "benefits": benefit_names,
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=OUTPUT)
    parser.add_argument(
        "--input",
        type=pathlib.Path,
        help="read a previously downloaded API response instead of using the network",
    )
    args = parser.parse_args()

    if args.input:
        source = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        source = fetch_json(SOURCE_API)
    snapshot = build_snapshot(source)
    args.output.write_text(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        "generated "
        f"{snapshot['meta']['recordCount']} records "
        f"({snapshot['meta']['coverageStart']}..{snapshot['meta']['coverageEnd']})"
    )


if __name__ == "__main__":
    main()
