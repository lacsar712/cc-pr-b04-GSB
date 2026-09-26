"""印张过滤服务端方案验收。

流程对应用户验收口径：
投封面与内页各一笔 -> 保存方案甲（前缀「封面」）-> 只见封面行 ->
切回空前缀两行都在 -> checker 不能删别人的方案但能用方案、翻履历、
管自己的方案 -> 删掉方案甲后履历里同时留有保存与删除记录。
"""
import os

import psycopg
from fastapi.testclient import TestClient

TEST_DSN = "postgresql://app:app@localhost:54394/printreg_test"

# 必须在 import api 之前指定，api 在导入时读取 DSN
admin = psycopg.connect("postgresql://app@localhost:54394/postgres", autocommit=True)
admin.execute("DROP DATABASE IF EXISTS printreg_test")
admin.execute("CREATE DATABASE printreg_test")
admin.close()
os.environ["DATABASE_URL"] = TEST_DSN

from api import app  # noqa: E402


def login(client, username, password):
    res = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert res.status_code == 200
    return res.json()["access_token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


with TestClient(app) as client:
    printer = login(client, "printer", "print123456")
    checker = login(client, "checker", "check123456")

    # 清掉启动种子，保证计数精确（服务端过滤本身不依赖此步）
    with psycopg.connect(TEST_DSN) as conn:
        conn.execute("TRUNCATE jobs, filter_schemes, filter_scheme_events RESTART IDENTITY")
        conn.commit()

    # 1. 投封面与内页各一笔
    r1 = client.post(
        "/api/jobs",
        headers=auth(printer),
        json={"sheet": "封面-01", "cyan_mm": 0.05, "magenta_mm": -0.04},
    )
    assert r1.status_code == 202
    r2 = client.post(
        "/api/jobs",
        headers=auth(printer),
        json={"sheet": "内页-09", "cyan_mm": 0.40, "magenta_mm": 0.02},
    )
    assert r2.status_code == 202

    all_rows = client.get("/api/jobs", headers=auth(printer)).json()
    assert {r["sheet"] for r in all_rows} == {"封面-01", "内页-09"}, all_rows

    # 2. 保存方案甲，前缀为「封面」
    r = client.post(
        "/api/filter/schemes",
        headers=auth(printer),
        json={"name": "方案甲", "prefix": "封面"},
    )
    assert r.status_code == 201, r.text
    scheme_a = r.json()
    assert scheme_a["prefix"] == "封面"
    assert scheme_a["created_by"] == "printer"
    scheme_a_id = scheme_a["id"]

    # 3. 应用方案甲：服务端只返回封面行（不是浏览器藏行）
    r = client.get("/api/jobs?prefix=封面", headers=auth(printer))
    rows = r.json()
    assert [row["sheet"] for row in rows] == ["封面-01"], rows
    assert all(row["sheet"].startswith("封面") for row in rows)

    # 4. 切回空前缀：两行都在
    rows = client.get("/api/jobs?prefix=", headers=auth(printer)).json()
    assert {row["sheet"] for row in rows} == {"封面-01", "内页-09"}, rows
    # 不带参数等价于空前缀
    rows2 = client.get("/api/jobs", headers=auth(printer)).json()
    assert {row["sheet"] for row in rows2} == {"封面-01", "内页-09"}

    # 5. 只读账号 checker 不能删别人的方案
    r = client.delete(f"/api/filter/schemes/{scheme_a_id}", headers=auth(checker))
    assert r.status_code == 403, r.text
    # 方案仍在
    names = {s["name"] for s in client.get("/api/filter/schemes", headers=auth(checker)).json()}
    assert "方案甲" in names

    # 6. checker 能用别人的方案过滤，也能翻履历
    rows = client.get("/api/jobs?prefix=封面", headers=auth(checker)).json()
    assert [row["sheet"] for row in rows] == ["封面-01"]
    events = client.get("/api/filter/events", headers=auth(checker)).json()
    assert any(e["scheme_name"] == "方案甲" and e["action"] == "create" for e in events)

    # 7. checker 可以保存并删除自己的方案
    r = client.post(
        "/api/filter/schemes",
        headers=auth(checker),
        json={"name": "方案乙", "prefix": "内页"},
    )
    assert r.status_code == 201, r.text
    scheme_b_id = r.json()["id"]
    r = client.delete(f"/api/filter/schemes/{scheme_b_id}", headers=auth(checker))
    assert r.status_code == 200, r.text

    # 8. printer 删掉方案甲
    r = client.delete(f"/api/filter/schemes/{scheme_a_id}", headers=auth(printer))
    assert r.status_code == 200, r.text
    names = {s["name"] for s in client.get("/api/filter/schemes", headers=auth(printer)).json()}
    assert "方案甲" not in names

    # 9. 履历留删改记录：方案甲的保存与删除都在，方案乙的增删也在
    events = client.get("/api/filter/events", headers=auth(printer)).json()
    a_create = [e for e in events if e["scheme_name"] == "方案甲" and e["action"] == "create"]
    a_delete = [e for e in events if e["scheme_name"] == "方案甲" and e["action"] == "delete"]
    assert len(a_create) == 1 and a_create[0]["actor"] == "printer"
    assert len(a_delete) == 1 and a_delete[0]["actor"] == "printer"
    b_create = [e for e in events if e["scheme_name"] == "方案乙" and e["action"] == "create"]
    b_delete = [e for e in events if e["scheme_name"] == "方案乙" and e["action"] == "delete"]
    assert len(b_create) == 1 and b_create[0]["actor"] == "checker"
    assert len(b_delete) == 1 and b_delete[0]["actor"] == "checker"

    # 10. 边界：重名 409、空名 400、删除不存在 404、未登录 401
    client.post(
        "/api/filter/schemes", headers=auth(printer), json={"name": "方案丙", "prefix": ""}
    )
    r = client.post(
        "/api/filter/schemes", headers=auth(printer), json={"name": "方案丙", "prefix": "x"}
    )
    assert r.status_code == 409
    r = client.post(
        "/api/filter/schemes", headers=auth(printer), json={"name": "   ", "prefix": ""}
    )
    assert r.status_code == 400
    r = client.delete("/api/filter/schemes/9999", headers=auth(printer))
    assert r.status_code == 404
    assert client.get("/api/filter/schemes").status_code == 401
    assert client.get("/api/filter/events").status_code == 401

    # 11. 空前缀方案也可保存，应用后返回全部
    r = client.post(
        "/api/filter/schemes", headers=auth(printer), json={"name": "方案空", "prefix": ""}
    )
    assert r.status_code == 201
    rows = client.get("/api/jobs?prefix=", headers=auth(printer)).json()
    assert len(rows) == 2

print("ALL ACCEPTANCE CHECKS PASSED")
