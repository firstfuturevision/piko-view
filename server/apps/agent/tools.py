"""도구 정의: Python 함수 + @tool → 타입 힌트와 docstring에서 JSON 스키마를 자동 생성."""
import difflib
import inspect
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, get_type_hints

from pydantic import Field, ValidationError, create_model

MAX_RESULT_CHARS = 8000


@dataclass
class Tool:
    name: str
    description: str
    fn: Callable
    args_model: type
    needs_approval: bool = False

    def definition(self) -> dict:
        schema = self.args_model.model_json_schema()
        schema.pop("title", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        return {"name": self.name, "description": self.description, "parameters": schema}


def _parse_docstring(doc: str | None) -> tuple[str, dict[str, str]]:
    """첫 부분은 도구 설명, 'Args:' 아래 '이름: 설명' 줄은 인자 설명."""
    desc, params, in_args = [], {}, False
    for line in inspect.cleandoc(doc or "").splitlines():
        s = line.strip()
        if s in ("Args:", "인자:"):
            in_args = True
        elif in_args and (m := re.match(r"(\w+)\s*(?:\([^)]*\))?:\s*(.+)", s)):
            params[m.group(1)] = m.group(2)
        elif not in_args and s:
            desc.append(s)
    return " ".join(desc), params


def tool(fn: Callable | None = None, *, name: str | None = None, needs_approval: bool = False):
    def wrap(f: Callable) -> Tool:
        hints = get_type_hints(f)
        desc, param_docs = _parse_docstring(f.__doc__)
        fields: dict[str, Any] = {}
        for p in inspect.signature(f).parameters.values():
            default = ... if p.default is inspect.Parameter.empty else p.default
            fields[p.name] = (hints.get(p.name, str), Field(default, description=param_docs.get(p.name)))
        model = create_model(f"{f.__name__}_args", **fields)
        return Tool(name or f.__name__, desc, f, model, needs_approval)

    return wrap(fn) if fn else wrap


class ToolRegistry:
    def __init__(self, tools: list[Tool] = ()):
        self._tools = {t.name: t for t in tools}

    def names(self) -> list[str]:
        return sorted(self._tools)

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def tools(self) -> list[Tool]:
        return [self._tools[n] for n in self.names()]

    def definitions(self, names: list[str] | None = None) -> list[dict]:
        # 순서를 고정해 프롬프트 캐시가 깨지지 않게 한다
        chosen = self.names() if names is None else [n for n in sorted(names) if n in self._tools]
        return [self._tools[n].definition() for n in chosen]

    def call(self, name: str, args: dict) -> str:
        """실행 결과를 문자열로 돌려준다. 오류도 예외 대신 문자열로 돌려줘 모델이 스스로 고치게 한다."""
        t = self._tools.get(name)
        if t is None:
            close = difflib.get_close_matches(name, self._tools, n=3)
            hint = f" 혹시 {', '.join(close)} 인가요?" if close else ""
            return f"오류: '{name}' 도구가 없습니다.{hint}"
        try:
            parsed = t.args_model.model_validate(args or {})
        except ValidationError as e:
            problems = "; ".join(f"{'.'.join(map(str, er['loc']))}: {er['msg']}" for er in e.errors())
            return f"오류: 인자가 올바르지 않습니다 — {problems}"
        try:
            result = t.fn(**parsed.model_dump())
        except Exception as e:
            return f"오류: {type(e).__name__}: {e}\n위 오류를 확인하고 다른 방법을 시도하세요."
        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
        return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "\n…(결과가 길어 잘렸습니다)"
