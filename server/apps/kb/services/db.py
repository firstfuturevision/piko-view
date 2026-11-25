"""Django 의 DB 연결 위에서 SQL 을 직접 쓰기 위한 얇은 계층.

KB 의 검색 경로(FTS5 MATCH, bm25, 재귀 CTE, 벡터 BLOB)는 ORM 으로 표현하기 어려워 SQL 로 다룬다.
Django 가 관리하는 sqlite3 연결을 그대로 쓰므로 transaction.atomic() 과 같은 트랜잭션에 참여하고,
스레드마다 Django 가 연결을 따로 준다. 자리표시자는 sqlite 기본인 ? 를 쓴다.
"""
from contextlib import contextmanager

from django.db import connection, transaction


def _raw():
    connection.ensure_connection()
    return connection.connection  # sqlite3.Connection


def _rows(cur) -> list[dict]:
    if cur.description is None:
        return []
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


class DB:
    def q(self, sql: str, args=()) -> list[dict]:
        cur = _raw().cursor()
        try:
            cur.execute(sql, tuple(args))
            return _rows(cur)
        finally:
            cur.close()

    def one(self, sql: str, args=()) -> dict | None:
        rows = self.q(sql, args)
        return rows[0] if rows else None

    @contextmanager
    def tx(self):
        """트랜잭션 안에서 sqlite3 커서를 준다 (execute/executemany/lastrowid)."""
        with transaction.atomic():
            cur = _raw().cursor()
            try:
                yield cur
            finally:
                cur.close()
