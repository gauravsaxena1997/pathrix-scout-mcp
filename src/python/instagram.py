#!/usr/bin/env python3
"""
Usage:
  python instagram.py profile <username>
  python instagram.py search <query> [--limit N]

Outputs JSON to stdout.
Requires SCOUT_IG_USERNAME and SCOUT_IG_PASSWORD env vars (burner account).
"""
import sys
import json
import os

def _get_client():
    from instagrapi import Client
    cl = Client()
    username = os.environ.get("SCOUT_IG_USERNAME") or os.environ.get("IG_USERNAME")
    password = os.environ.get("SCOUT_IG_PASSWORD") or os.environ.get("IG_PASSWORD")
    if not username or not password:
        raise RuntimeError("SCOUT_IG_USERNAME and SCOUT_IG_PASSWORD not set")
    cl.login(username, password)
    return cl

def _map_media(m) -> dict:
    return {
        "id": str(m.pk),
        "shortcode": m.code,
        "caption": (m.caption_text or "")[:400],
        "likes": m.like_count or 0,
        "comments": m.comment_count or 0,
        "url": f"https://www.instagram.com/p/{m.code}/",
        "publishedAt": m.taken_at.isoformat() if m.taken_at else "",
        "author": m.user.username if m.user else "",
        "mediaType": str(m.media_type),
    }

def profile(username: str) -> dict:
    try:
        cl = _get_client()
    except ImportError:
        return {"error": "instagrapi not installed"}
    except RuntimeError as e:
        return {"error": str(e)}

    try:
        user = cl.user_info_by_username_v1(username)
        medias = cl.user_medias(user.pk, amount=20)
    except Exception as e:
        return {"error": str(e)}

    posts = [_map_media(m) for m in medias]
    return {
        "username": user.username,
        "followers": user.follower_count,
        "following": user.following_count,
        "postsCount": user.media_count,
        "bio": user.biography or "",
        "posts": posts,
        "stats": {
            "avgLikes": round(sum(p["likes"] for p in posts) / max(len(posts), 1)),
            "avgComments": round(sum(p["comments"] for p in posts) / max(len(posts), 1)),
        },
    }

def search(query: str, limit: int = 20) -> list:
    try:
        cl = _get_client()
    except ImportError:
        return [{"error": "instagrapi not installed"}]
    except RuntimeError as e:
        return [{"error": str(e)}]

    results = []
    try:
        # Search by hashtag (strip # if present)
        tag = query.lstrip("#").replace(" ", "")
        medias = cl.hashtag_medias_top(tag, amount=limit)
        results = [_map_media(m) for m in medias]
    except Exception:
        pass

    # Fallback: recent medias for the hashtag if top returned nothing
    if not results:
        try:
            tag = query.lstrip("#").replace(" ", "")
            medias = cl.hashtag_medias_recent(tag, amount=limit)
            results = [_map_media(m) for m in medias]
        except Exception as e:
            return [{"error": str(e)}]

    return results[:limit]

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(json.dumps({"error": "Usage: instagram.py profile|search <arg> [--limit N]"}))
        sys.exit(1)

    command = args[0]
    arg = args[1]
    limit = 20
    if "--limit" in args:
        idx = args.index("--limit")
        try:
            limit = int(args[idx + 1])
        except (IndexError, ValueError):
            pass

    if command == "profile":
        print(json.dumps(profile(arg)))
    elif command == "search":
        print(json.dumps(search(arg, limit)))
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
