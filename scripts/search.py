#!/usr/bin/env python3
"""
Nyxtok TikTok search CLI.

Uses TikTokApi (playwright-based) to search TikTok by hashtag.
Outputs one JSON object per line on stdout (same format as yt-dlp --dump-json).

Usage:
    python3 search.py --hashtag AI --count 30
    python3 search.py --hashtag MachineLearning --count 10

Requirements:
    pip install TikTokApi playwright
    python -m playwright install chromium
"""

import argparse
import asyncio
import json
import sys
import logging


async def search_hashtag(tag_name: str, count: int) -> list[dict]:
    """Search TikTok by hashtag and return normalized video metadata."""
    from TikTokApi import TikTokApi

    api = TikTokApi(logging_level=logging.WARNING)
    await api.create_sessions(
        num_sessions=1,
        headless=False,
        browser="chromium",
        sleep_after=2,
    )

    results = []
    try:
        tag = api.hashtag(name=tag_name)
        async for video in tag.videos(count=count):
            v = video.as_dict
            stats = v.get("stats", {})
            author = v.get("author", {})
            hashtags = []
            for chall in v.get("challenges", []) or []:
                if isinstance(chall, dict) and chall.get("title"):
                    hashtags.append(chall["title"])

            # Build the video URL
            video_id = v.get("id", "")
            author_handle = author.get("uniqueId", "")
            url = f"https://www.tiktok.com/@{author_handle}/video/{video_id}" if video_id and author_handle else ""

            # Direct CDN URL for streaming (no download needed)
            play_addr = v.get("video", {}).get("playAddr", "") or ""

            meta = {
                "video_id": video_id,
                "creator_handle": author_handle,
                "creator_id": author.get("id", ""),
                "caption": v.get("desc", ""),
                "hashtags": hashtags,
                "view_count": stats.get("playCount", 0) or 0,
                "like_count": stats.get("diggCount", 0) or 0,
                "share_count": stats.get("shareCount", 0) or 0,
                "comment_count": stats.get("commentCount", 0) or 0,
                "duration_seconds": v.get("video", {}).get("duration", 0) or 0,
                "published_at": "",
                "thumbnail_url": v.get("video", {}).get("cover", "") or "",
                "url": url,
                "play_addr": play_addr,
            }
            results.append(meta)
    finally:
        await api.close_sessions()

    return results


async def main():
    parser = argparse.ArgumentParser(description="Search TikTok by hashtag")
    parser.add_argument("--hashtag", required=True, help="Hashtag to search (without #)")
    parser.add_argument("--count", type=int, default=30, help="Max videos to return")
    args = parser.parse_args()

    try:
        videos = await search_hashtag(args.hashtag.replace("#", ""), args.count)
        for v in videos:
            print(json.dumps(v))
    except Exception as e:
        print(f"[search.py] error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
