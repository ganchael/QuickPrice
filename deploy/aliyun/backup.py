#!/usr/bin/python3
"""Back up live SQLite through its backup API, including committed WAL data."""
import datetime
import json
import os
from pathlib import Path
import sqlite3
import subprocess

os.umask(0o077)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
destination = Path("/var/backups/quickprice") / stamp
destination.mkdir(parents=True, exist_ok=False)
found = False
for source in Path("/var/lib/quickprice/v3/d1").rglob("*.sqlite"):
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as connection:
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE name='catalogs'").fetchone():
            continue
        backup_path = destination / source.name
        subprocess.run(["/usr/bin/sqlite3", str(source), ".timeout 10000", f".backup '{backup_path}'"], check=True)
        with sqlite3.connect(str(backup_path)) as backup:
            rows = backup.execute("SELECT user_id, products_json, revision, updated_at FROM catalogs").fetchall()
        data = [dict(ownerId=row[0], products=json.loads(row[1]), revision=row[2], updatedAt=row[3]) for row in rows]
        (destination / "catalog.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        found = True
if not found:
    raise RuntimeError("No catalog database found; backup did not complete")
print(f"QuickPrice backup complete: {destination}")
