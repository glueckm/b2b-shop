#!/usr/bin/env python3
"""Einmalige Nachbearbeitung bestehender Artikelbilder im MAWA-Backend.

- Bilder mit Kantenlaenge > MAX_EDGE werden verkleinert und ersetzt.
- Fuer das erste Bild eines Artikels (_1) wird ein Vorschaubild _thumb (320 px) erzeugt.

Aufruf:  python3 scripts/backfill-images.py [--dry-run]
"""
import io
import os
import re
import sys
import json
import urllib.parse
import urllib.request

from PIL import Image

API = os.environ.get("USER_API_BASE_URL", "https://mawaapi.mangari.info")
ORIGIN = os.environ.get("APP_PUBLIC_URL", "https://mawa-shop.lovable.app")
MAX_EDGE = 1200
THUMB_EDGE = 320
QUALITY = 82
DRY = "--dry-run" in sys.argv


def request(method, path, *, data=None, headers=None, raw=False):
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("origin", ORIGIN)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=90) as res:
        body = res.read()
    return body if raw else json.loads(body or b"null")


def login():
    body = urllib.parse.urlencode(
        {"username": os.environ["MAWA_API_EMAIL"], "password": os.environ["MAWA_API_PASSWORD"]}
    ).encode()
    out = request("POST", "/v1/auth/login", data=body,
                  headers={"content-type": "application/x-www-form-urlencoded"})
    return out["access_token"]


TOKEN = login()
AUTH = {"authorization": "Bearer " + TOKEN}


def list_files():
    out = request("GET", "/v1/files?limit=500", headers=AUTH)
    rows = out if isinstance(out, list) else out.get("items", [])
    files = []
    for r in rows:
        entity = str(r.get("entity") or r.get("entity_type") or "")
        ctype = str(r.get("contentType") or r.get("content_type") or "")
        eid = r.get("entityId") or r.get("entity_id")
        if entity != "article" or not ctype.startswith("image/") or not eid:
            continue
        files.append({
            "id": str(r["id"]),
            "filename": str(r.get("filename") or r.get("name") or "bild"),
            "contentType": ctype,
            "entityId": str(eid),
        })
    return files


def download(file_id):
    return request("GET", f"/v1/files/{urllib.parse.quote(str(file_id))}?disposition=inline",
                   headers=AUTH, raw=True)


def delete(file_id):
    request("DELETE", f"/v1/files/{urllib.parse.quote(str(file_id))}", headers=AUTH)


def upload(article_id, filename, mime, data):
    boundary = "----mawa-backfill-boundary"
    parts = []
    for name, value in (("entity", "article"), ("entity_id", article_id)):
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    parts.append(
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return request("POST", "/v1/files", data=body,
                   headers={**AUTH, "content-type": f"multipart/form-data; boundary={boundary}"})


def encode(img, filename, max_edge, force_webp=False):
    w, h = img.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    png = filename.lower().endswith(".png") and not force_webp
    buf = io.BytesIO()
    if png:
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "image/png", ".png", img.size
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
    img.save(buf, format="WEBP", quality=QUALITY, method=6)
    return buf.getvalue(), "image/webp", ".webp", img.size


def thumb_name(filename):
    stem, dot, ext = filename.rpartition(".")
    return (stem + "_thumb." + ext) if dot else filename + "_thumb"


def image_no(filename):
    stem = filename.rsplit(".", 1)[0]
    if "_" in stem:
        tail = stem.rsplit("_", 1)[1]
        return tail if re.fullmatch(r"\d+", tail) else "1"
    return "1"


files = list_files()
by_article = {}
for f in files:
    by_article.setdefault(f["entityId"], []).append(f)

print(f"{len(files)} Artikelbilder bei {len(by_article)} Artikeln")
shrunk = thumbs = 0

for article_id, group in sorted(by_article.items()):
    main = [f for f in group if "_thumb" not in f["filename"].lower()]
    has_thumb = any("_thumb" in f["filename"].lower() for f in group)
    main.sort(key=lambda f: (image_no(f["filename"]), f["filename"]))

    for f in main:
        data = download(f["id"])
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception as exc:
            print(f"  ! {f['filename']}: nicht lesbar ({exc})")
            continue

        if max(img.size) > MAX_EDGE:
            new, mime, ext, size = encode(img, f["filename"], MAX_EDGE)
            if len(new) < len(data):
                base = f["filename"].rsplit(".", 1)[0]
                name = base + ext
                print(f"  ~ {f['filename']}: {img.size} {len(data)}B -> {size} {len(new)}B")
                if not DRY:
                    delete(f["id"])
                    upload(article_id, name, mime, new)
                shrunk += 1

    if main and not has_thumb:
        src = main[0]
        data = download(src["id"])
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception as exc:
            print(f"  ! Vorschau {src['filename']}: {exc}")
            continue
        new, mime, ext, size = encode(img, src["filename"], THUMB_EDGE)
        name = thumb_name(src["filename"].rsplit(".", 1)[0] + ext)
        print(f"  + Vorschaubild {name}: {size} {len(new)}B")
        if not DRY:
            upload(article_id, name, mime, new)
        thumbs += 1

print(f"Fertig: {shrunk} verkleinert, {thumbs} Vorschaubilder{' (Probelauf)' if DRY else ''}")
