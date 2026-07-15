"""Refresh high-level cube option distributions from MapleStory's official page.

The app maps level 121-200 items to the level-120 probability table and level
201+ items to the level-201 table.  Existing lower-level legendary contexts are
kept; this script adds every grade for the two high-level buckets used by the
equipment budget calculator.
"""

from __future__ import annotations

import concurrent.futures
import argparse
import datetime as dt
import html
import http.cookiejar
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
LEGACY_INPUT = ROOT / "cube-options.json"
OUTPUT = ROOT / "cube-options-v2.json"
BASE = "https://maplestory.nexon.com"
API = BASE + "/Guide/OtherProbability/cube/GetSearchProbList"
METHODS = {
    "black": {"item": "5062010", "offset": 0, "page": "/Guide/OtherProbability/cube/black"},
    "addi": {"item": "5062500", "offset": 10_000_000, "page": "/Guide/OtherProbability/cube/addi"},
}
GRADES = {1: "rare", 2: "epic", 3: "unique", 4: "legendary"}
GRADE_OFFSET = {grade: grade * 1_000_000 for grade in GRADES}
LEVELS = (120, 201)
USER_AGENT = "Mozilla/5.0 (compatible; maple-check probability data refresh)"


def restriction(text: str) -> tuple[str, int]:
    if text.startswith("<쓸만한 "):
        return "usable_skill", 1
    if "피격 후 무적시간" in text:
        return "after_hit_invincibility", 1
    if text.startswith("피격 시") and "데미지" in text and "무시" in text:
        return "on_hit_damage_ignore", 2
    if text.startswith("피격 시") and "무적" in text:
        return "on_hit_invincibility", 2
    return "", 0


def clean_cell(raw: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def parse_tables(source: str) -> list[list[tuple[str, float, int]]] | None:
    tables: dict[int, list[tuple[str, float]]] = {}
    for line_no, body in re.findall(
        r'<table\s+class="cube_data\s+_([123])"[^>]*>(.*?)</table>',
        source,
        flags=re.I | re.S,
    ):
        cells = [clean_cell(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", body, flags=re.I | re.S)]
        rows: list[tuple[str, float]] = []
        for i in range(0, len(cells) - 1, 2):
            text, probability = cells[i], cells[i + 1].replace("%", "").replace(",", "")
            if not text:
                continue
            try:
                rows.append((text, float(probability) / 100))
            except ValueError:
                continue
        if rows:
            tables[int(line_no)] = rows
    if len(tables) != 3:
        return None
    # 2·3번째 줄은 하위 등급 블록 뒤에 현재 등급(이탈) 블록이 첫 줄과
    # 같은 순서로 붙는다. 문구만 비교하면 두 등급에 같은 옵션명이 있을 때
    # 하위 등급까지 이탈로 잘못 표시되므로, 공식 표의 블록 경계로 구분한다.
    prime_sequence = [text for text, _ in tables[1]]
    packed: list[list[tuple[str, float, int]]] = []
    for line_no in (1, 2, 3):
        rows = tables[line_no]
        if line_no == 1:
            packed.append([(text, probability, 1) for text, probability in rows])
            continue
        prime_start = len(rows) - len(prime_sequence)
        if prime_start < 0 or [text for text, _ in rows[prime_start:]] != prime_sequence:
            raise ValueError(f"official prime option block mismatch on line {line_no}")
        packed.append([
            (text, probability, int(index >= prime_start))
            for index, (text, probability) in enumerate(rows)
        ])
    return packed


def open_session(page: str) -> str:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    req = urllib.request.Request(BASE + page, headers={"User-Agent": USER_AGENT})
    with opener.open(req, timeout=20) as response:
        response.read(1)
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in jar)


def fetch_one(task: tuple[str, int, int, int], cookies: dict[str, str]):
    method, grade, part, level = task
    config = METHODS[method]
    payload = urllib.parse.urlencode(
        {
            "nCubeItemID": config["item"],
            "nGrade": grade,
            "nPartsType": part,
            "nReqLev": level,
        }
    ).encode()
    headers = {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": BASE + config["page"],
        "Cookie": cookies[method],
    }
    for attempt in range(4):
        try:
            req = urllib.request.Request(API, data=payload, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=30) as response:
                source = response.read().decode("utf-8", errors="replace")
            return task, parse_tables(source)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(0.5 * (attempt + 1))


def linewise_json(data: dict) -> str:
    """Compact JSON with safe line boundaries for chunked apply_patch writes."""
    dump = lambda value: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    lines = ["{"]
    lines.append(f'"meta":{dump(data["meta"])},')
    lines.append(f'"parts":{dump(data["parts"])},')
    for key in ("options", "dists"):
        lines.append(f'"{key}":[')
        values = data[key]
        lines.extend(dump(value) + ("," if i + 1 < len(values) else "") for i, value in enumerate(values))
        lines.append("],")
    lines.append('"ctx":{')
    entries = sorted(data["ctx"].items(), key=lambda item: int(item[0]))
    lines.extend(
        f'{dump(key)}:{dump(value)}' + ("," if i + 1 < len(entries) else "")
        for i, (key, value) in enumerate(entries)
    )
    lines.extend(["}", "}"])
    return "\n".join(lines) + "\n"


def compact_data(data: dict) -> None:
    """Drop distributions/options no longer referenced after refreshing contexts."""
    used_dist = sorted({
        dist_index
        for indices in data["ctx"].values()
        for dist_index in indices
        if dist_index >= 0
    })
    dist_remap = {old: new for new, old in enumerate(used_dist)}
    data["dists"] = [data["dists"][old] for old in used_dist]
    for key, indices in data["ctx"].items():
        data["ctx"][key] = [dist_remap[index] if index >= 0 else -1 for index in indices]

    used_options = sorted({entry[0] for dist in data["dists"] for entry in dist})
    option_remap = {old: new for new, old in enumerate(used_options)}
    data["options"] = [data["options"][old] for old in used_options]
    for dist in data["dists"]:
        for entry in dist:
            entry[0] = option_remap[entry[0]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdout", action="store_true", help="write generated JSON to stdout")
    parser.add_argument("--output", type=pathlib.Path, help="write generated JSON to this path")
    parser.add_argument("--chunk-index", type=int, help="emit one deterministic apply-patch chunk")
    parser.add_argument("--chunk-size", type=int, default=18_000)
    args = parser.parse_args()
    data = None
    for candidate in (OUTPUT, LEGACY_INPUT):
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
            break
        except (OSError, json.JSONDecodeError):
            continue
    if data is None:
        raise RuntimeError("No usable cube option data file was found")
    options = data["options"]
    option_map = {tuple(option): index for index, option in enumerate(options)}
    dists = data["dists"]
    dist_map = {
        json.dumps(dist, ensure_ascii=False, separators=(",", ":")): index
        for index, dist in enumerate(dists)
    }
    contexts = data["ctx"]

    cookies = {method: open_session(config["page"]) for method, config in METHODS.items()}
    tasks = [
        (method, grade, part, level)
        for method in METHODS
        for grade in GRADES
        for part in range(1, 21)
        for level in LEVELS
    ]
    completed = 0
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_one, task, cookies) for task in tasks]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            completed += 1
            if completed % 40 == 0:
                print(f"fetched {completed}/{len(tasks)}", file=sys.stderr)
    for (method, grade, part, level), tables in sorted(results, key=lambda result: result[0]):
            if not tables:
                continue
            dist_indices = []
            for table in tables:
                packed = []
                for text, probability, is_prime in table:
                    group, maximum = restriction(text)
                    option_key = (text, group, maximum)
                    option_index = option_map.get(option_key)
                    if option_index is None:
                        option_index = len(options)
                        option_map[option_key] = option_index
                        options.append(list(option_key))
                    packed.append([option_index, probability, is_prime])
                dist_key = json.dumps(packed, ensure_ascii=False, separators=(",", ":"))
                dist_index = dist_map.get(dist_key)
                if dist_index is None:
                    dist_index = len(dists)
                    dist_map[dist_key] = dist_index
                    dists.append(packed)
                dist_indices.append(dist_index)
            key = METHODS[method]["offset"] + GRADE_OFFSET[grade] + part * 10_000 + level
            contexts[str(key)] = dist_indices

    compact_data(data)

    data["meta"] = {
        "source": "KMS official cube probability API",
        "retrieved": dt.date.today().isoformat(),
        "grades": "all grades for official level-120/201 contexts; legacy legendary contexts retained for lower levels",
        "note": "per-line displayed probabilities, explicit refreshed-context option-grade provenance, sequential restriction renormalization",
    }
    if args.chunk_index is not None:
        pretty = linewise_json(data)
        chunks: list[str] = []
        current: list[str] = []
        current_size = 0
        for line in pretty.splitlines():
            line_size = len(line) + 1
            if current and current_size + line_size > args.chunk_size:
                chunks.append("\n".join(current) + "\n")
                current, current_size = [], 0
            current.append(line)
            current_size += line_size
        if current:
            chunks.append("\n".join(current) + "\n")
        if args.chunk_index < 0 or args.chunk_index >= len(chunks):
            raise SystemExit(f"chunk index must be between 0 and {len(chunks) - 1}")
        print(f"__CUBE_CHUNK_BEGIN__ {args.chunk_index} {len(chunks)}")
        sys.stdout.write(chunks[args.chunk_index])
        print("__CUBE_CHUNK_END__")
        payload = ""
    else:
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.stdout and payload:
        sys.stdout.write(payload)
    elif args.chunk_index is None:
        (args.output or OUTPUT).write_text(payload, encoding="utf-8")
    print(
        f"generated {len(data['options'])} options, {len(data['dists'])} distributions, {len(data['ctx'])} contexts",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
