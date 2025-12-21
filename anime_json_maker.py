import json
import time
import requests
from typing import Dict, Any, List

ENDPOINT = "https://graphql.anilist.co"

QUERY_ALL = """
query ($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage hasNextPage }
    media(type: ANIME, sort: ID) {
      id
      title { romaji english }
    }
  }
}
"""


def fetch_page(page: int, per_page: int) -> Dict[str, Any]:
    r = requests.post(
        ENDPOINT,
        json={"query": QUERY_ALL, "variables": {"page": page, "perPage": per_page}},
        headers={"Accept": "application/json"},
        timeout=60,
    )
    # 429 や一時エラー対策（雑にリトライ）
    if r.status_code == 429:
        print("too many requests")
        time.sleep(60)
        return fetch_page(page, per_page)
    r.raise_for_status()
    return r.json()


def build_id_title_dict(
    per_page: int = 50, sleep_sec: float = 0.7
) -> List[Dict[str, Any]]:
    page = 1
    out: List[Dict[str, Any]] = []

    while True:
        data = fetch_page(page, per_page)
        print(f"page {page}")
        p = data["data"]["Page"]
        items = p["media"]

        for it in items:
            title = it.get("title") or {}
            out.append(
                {
                    "id": it["id"],
                    "romaji": title.get("romaji") or "",
                    "english": title.get("english") or "",
                }
            )

        if not p["pageInfo"]["hasNextPage"]:
            break

        page += 1
        time.sleep(sleep_sec)

    return out


if __name__ == "__main__":
    rows = build_id_title_dict(per_page=50, sleep_sec=0.7)
    print("count:", len(rows))

    with open("anilist_anime_id_titles.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    # 例：id -> (romaji, english) にしたいなら
    id_map = {r["id"]: {"romaji": r["romaji"], "english": r["english"]} for r in rows}
    with open("anilist_anime_id_map.json", "w", encoding="utf-8") as f:
        json.dump(id_map, f, ensure_ascii=False, indent=2)

    print("saved: anilist_anime_id_titles.json, anilist_anime_id_map.json")
