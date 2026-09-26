import os
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from psycopg.rows import dict_row

DSN = os.environ.get("DATABASE_URL", "postgresql://app:app@localhost:54394/printreg")
SECRET = os.environ.get("JWT_SECRET", "print-register-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)
USERS = {
    "printer": {"role": "writer", "password_hash": pwd.hash("print123456")},
    "checker": {"role": "reader", "password_hash": pwd.hash("check123456")},
}


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id serial PRIMARY KEY,
    sheet text NOT NULL,
    cyan_mm double precision NOT NULL,
    magenta_mm double precision NOT NULL,
    status text NOT NULL,
    verdict text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS filter_schemes (
    id serial PRIMARY KEY,
    name text NOT NULL,
    prefix text NOT NULL DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS filter_scheme_history (
    id serial PRIMARY KEY,
    action text NOT NULL,
    scheme_id integer,
    scheme_name text NOT NULL,
    prefix text NOT NULL DEFAULT '',
    actor text NOT NULL,
    created_at timestamptz NOT NULL
);
"""


class LoginIn(BaseModel):
    username: str
    password: str


class JobIn(BaseModel):
    sheet: str
    cyan_mm: float
    magenta_mm: float


class SchemeIn(BaseModel):
    name: str
    prefix: str = ""


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="无效令牌") from exc
    if payload.get("sub") not in USERS:
        raise HTTPException(status_code=401, detail="无效令牌")
    return {"username": payload["sub"], "role": payload.get("role")}


def require_writer(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "writer":
        raise HTTPException(status_code=403, detail="仅印刷员可送复核")
    return user


app = FastAPI(title="印刷套准复核台")


@app.on_event("startup")
def startup():
    with connect() as conn:
        conn.execute(SCHEMA)
        n = conn.execute("SELECT COUNT(*) AS n FROM jobs").fetchone()["n"]
        if n == 0:
            now = datetime.now(timezone.utc)
            conn.execute(
                """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, verdict, reason, created_by, created_at)
                   VALUES
                   ('封面-01', 0.05, -0.04, 'pending', '', '', 'printer', %s),
                   ('内页-09', 0.40, 0.02, 'pending', '', '', 'printer', %s)""",
                (now, now),
            )
        conn.commit()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "print-register-review"}


@app.post("/api/auth/login")
def login(body: LoginIn):
    user = USERS.get(body.username.strip())
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode({"sub": body.username.strip(), "role": user["role"], "exp": exp}, SECRET, algorithm="HS256")
    return {"access_token": token, "username": body.username.strip(), "role": user["role"]}


@app.get("/api/jobs")
def list_jobs(prefix: str = "", _user: dict = Depends(current_user)):
    # 过滤在服务端做：strpos(sheet, prefix) = 1 即“以前缀开头”，空前缀恒真返回全部
    with connect() as conn:
        return conn.execute(
            """SELECT id, sheet, cyan_mm, magenta_mm, status, verdict, reason, created_by
               FROM jobs
               WHERE strpos(sheet, %s) = 1
               ORDER BY id DESC""",
            (prefix,),
        ).fetchall()


@app.post("/api/jobs", status_code=202)
def enqueue(body: JobIn, user: dict = Depends(require_writer)):
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, created_by, created_at)
               VALUES (%s, %s, %s, 'pending', %s, %s)
               RETURNING id, sheet, status, verdict""",
            (body.sheet.strip(), body.cyan_mm, body.magenta_mm, user["username"], datetime.now(timezone.utc)),
        ).fetchone()
        conn.commit()
    return row


def write_history(conn, action: str, scheme_id: int, name: str, prefix: str, actor: str):
    conn.execute(
        """INSERT INTO filter_scheme_history (action, scheme_id, scheme_name, prefix, actor, created_at)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (action, scheme_id, name, prefix, actor, datetime.now(timezone.utc)),
    )


@app.get("/api/filter/schemes")
def list_schemes(_user: dict = Depends(current_user)):
    with connect() as conn:
        return conn.execute(
            "SELECT id, name, prefix, created_by, created_at FROM filter_schemes ORDER BY id"
        ).fetchall()


@app.post("/api/filter/schemes", status_code=201)
def create_scheme(body: SchemeIn, user: dict = Depends(current_user)):
    name = body.name.strip()
    prefix = body.prefix.strip()
    if not name:
        raise HTTPException(status_code=422, detail="方案名不能为空")
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO filter_schemes (name, prefix, created_by, created_at)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, prefix, created_by, created_at""",
            (name, prefix, user["username"], datetime.now(timezone.utc)),
        ).fetchone()
        write_history(conn, "create", row["id"], name, prefix, user["username"])
        conn.commit()
    return row


@app.delete("/api/filter/schemes/{scheme_id}")
def delete_scheme(scheme_id: int, user: dict = Depends(current_user)):
    with connect() as conn:
        row = conn.execute(
            "SELECT id, name, prefix, created_by FROM filter_schemes WHERE id = %s",
            (scheme_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="方案不存在")
        if user["role"] != "writer" and row["created_by"] != user["username"]:
            raise HTTPException(status_code=403, detail="只读账号不能删别人的方案")
        conn.execute("DELETE FROM filter_schemes WHERE id = %s", (scheme_id,))
        write_history(conn, "delete", row["id"], row["name"], row["prefix"], user["username"])
        conn.commit()
    return {"ok": True, "deleted": row["name"]}


@app.get("/api/filter/history")
def list_history(_user: dict = Depends(current_user)):
    with connect() as conn:
        return conn.execute(
            """SELECT id, action, scheme_id, scheme_name, prefix, actor, created_at
               FROM filter_scheme_history
               ORDER BY id DESC"""
        ).fetchall()
