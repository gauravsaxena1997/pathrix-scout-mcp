#!/usr/bin/env python3
"""
Usage: python instagram.py profile <username>
Outputs JSON: { username, followers, posts: [...], stats: {...} }

Requires IG_USERNAME and IG_PASSWORD env vars for authenticated requests.
Without auth, falls back to public profile scraping (limited data).
"""
import sys
import json
import os

def profile(username: str) -> dict:
    try:
        from instagrapi import Client
    except ImportError:
        return {"error": "instagrapi not installed in this venv"}

    cl = Client()

    ig_user = os.environ.get("IG_USERNAME")
    ig_pass = os.environ.get("IG_PASSWORD")

    if ig_user and ig_pass:
        try:
            cl.login(ig_user, ig_pass)
        except Exception as e:
            return {"error": f"Login failed: {str(e)}"}
    else:
        return {"error": "IG_USERNAME and IG_PASSWORD env vars not set"}

    try:
        user = cl.user_info_by_username_v1(username)
        medias = cl.user_medias(user.pk, amount=20)
    except Exception as e:
        return {"error": str(e)}

    posts = []
    for m in medias:
        posts.append({
            "id": str(m.pk),
            "shortcode": m.code,
            "caption": (m.caption_text or "")[:300],
            "likes": m.like_count,
            "comments": m.comment_count,
            "url": f"https://www.instagram.com/p/{m.code}/",
            "taken_at": m.taken_at.isoformat() if m.taken_at else "",
            "media_type": str(m.media_type),
            "video_url": str(m.video_url) if m.video_url else None,
        })

    return {
        "username": user.username,
        "followers": user.follower_count,
        "following": user.following_count,
        "posts_count": user.media_count,
        "bio": user.biography or "",
        "posts": posts,
        "stats": {
            "avg_likes": round(sum(p["likes"] for p in posts) / max(len(posts), 1)),
            "avg_comments": round(sum(p["comments"] for p in posts) / max(len(posts), 1)),
        },
    }

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: instagram.py profile <username>"}))
        sys.exit(1)

    command = sys.argv[1]
    if command == "profile":
        result = profile(sys.argv[2])
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown command: {command}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
