"""파일 → (제목, Markdown 본문) 변환과 구조 단위 조각화.

어떤 형식이든 KB 안에서는 Markdown 한 가지로 다룬다.
  - md/txt: 원문 그대로 (맨 앞 '# 제목' 줄은 제목으로 뺀다)
  - docx: 제목 스타일 → ##, ###…, 목록 → '- ', 표 → Markdown 표
  - xlsx/csv: 시트마다 '## 시트명' + Markdown 표
  - pdf: 쪽마다 '## N쪽' + 추출한 글
"""
import csv
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

SUPPORTED = {".md", ".txt", ".pdf", ".docx", ".xlsx", ".csv"}
MAX_CHARS = 900


@dataclass
class Section:
    heading: str
    text: str


@dataclass
class Chunk:
    ord: int
    heading: str
    text: str


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp949"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace")


# ------------------------------------------------------------------ 파일 → Markdown
def extract(path: Path) -> tuple[str, str]:
    """(제목, Markdown 본문). 본문에는 제목 줄이 없다."""
    ext = path.suffix.lower()
    if ext not in SUPPORTED:
        raise ValueError(f"지원하지 않는 형식입니다: {ext}")
    if ext in (".md", ".txt"):
        return take_title(read_text(path), path.stem)
    if ext == ".pdf":
        return path.stem, _pdf(path)
    if ext == ".docx":
        return _docx(path)
    if ext == ".xlsx":
        return path.stem, _xlsx(path)
    return path.stem, md_table(list(csv.reader(read_text(path).splitlines())))


def take_title(text: str, default: str) -> tuple[str, str]:
    """글 맨 앞의 '# 제목' 줄을 제목으로 떼어 낸다. 없으면 default."""
    text = text.replace("\r\n", "\n")
    m = re.match(r"\s*#\s+(.+?)\s*#*\s*(?:\n|$)", text)
    if m:
        return m.group(1).strip(), text[m.end():].strip()
    return default, text.strip()


def _cell(v) -> str:
    return "" if v is None else str(v).strip().replace("|", "\\|").replace("\r\n", "<br>").replace("\n", "<br>")


def md_table(rows: list[list]) -> str:
    rows = [[_cell(c) for c in r] for r in rows if any(_cell(c) for c in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header = [h or f"열{i + 1}" for i, h in enumerate(rows[0])]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _pdf(path: Path) -> str:
    from pypdf import PdfReader

    pages = [(p.extract_text() or "").strip() for p in PdfReader(str(path)).pages]
    pages = [(i, t) for i, t in enumerate(pages, 1) if t]
    if len(pages) == 1:
        return pages[0][1]
    return "\n\n".join(f"## {i}쪽\n\n{t}" for i, t in pages)


def _docx(path: Path) -> tuple[str, str]:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    doc = Document(str(path))
    title, out = doc.core_properties.title or path.stem, []
    for el in doc.element.body.iterchildren():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(el, doc)
            text = p.text.strip()
            style = p.style.name if p.style is not None else ""
            if not text:
                continue
            if style == "Title":
                title = text
            elif m := re.match(r"(?:Heading|제목)\s*(\d)", style):
                out.append("#" * min(int(m.group(1)) + 1, 6) + " " + text)  # 문서 제목이 # 이므로 한 단계 내린다
            elif "List Number" in style or "번호" in style:
                out.append(f"1. {text}")
            elif "List" in style or "글머리" in style:
                out.append(f"- {text}")
            else:
                out.append(text)
        elif tag == "tbl":
            out.append(md_table([[c.text for c in r.cells] for r in Table(el, doc).rows]))
    return title, "\n\n".join(out)


def _xlsx(path: Path) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(str(path), read_only=True, data_only=True)
    try:
        sheets = [(ws.title, md_table([list(r) for r in ws.iter_rows(values_only=True)])) for ws in wb.worksheets]
    finally:
        wb.close()
    sheets = [(n, t) for n, t in sheets if t]
    if len(sheets) == 1:
        return sheets[0][1]
    return "\n\n".join(f"## {n}\n\n{t}" for n, t in sheets)


# ------------------------------------------------------------------ Markdown → 조각
_MD_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def split_markdown(text: str) -> list[Section]:
    """제목(#) 계층을 따라 섹션으로 나눈다. heading은 '가 > 나' 형태의 경로."""
    stack: list[tuple[int, str]] = []
    sections, buf, in_code = [], [], False

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append(Section(" > ".join(n for _, n in stack), body))
        buf.clear()

    for line in text.splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
        m = None if in_code else _MD_HEADING.match(line)
        if not m:
            buf.append(line)
            continue
        flush()
        level = len(m.group(1))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, m.group(2)))
    flush()
    return sections


def chunk(sections: list[Section], max_chars: int = MAX_CHARS) -> list[Chunk]:
    """섹션 경계를 넘지 않고, 문단 → 줄 → 문장 순으로 쪼개 max_chars 이하로 묶는다."""
    out: list[Chunk] = []
    for s in sections:
        for piece in _pack(_blocks(s.text, max_chars), max_chars):
            out.append(Chunk(len(out), s.heading, piece))
    return out


def chunk_markdown(body: str) -> list[Chunk]:
    return chunk(split_markdown(body))


def _is_table(lines: list[str]) -> bool:
    return len(lines) >= 2 and all(l.lstrip().startswith("|") for l in lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[1])


def _blocks(text: str, max_chars: int):
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if not block:
            continue
        if len(block) <= max_chars:
            yield block
            continue
        lines = block.splitlines()
        if _is_table(lines):  # 긴 표는 행 묶음마다 머리글을 반복해 조각만 봐도 열 의미를 알 수 있게 한다
            head, rows, cur = lines[:2], lines[2:], []
            for r in rows:
                if cur and len("\n".join(head + cur + [r])) > max_chars:
                    yield "\n".join(head + cur)
                    cur = []
                cur.append(r)
            if cur:
                yield "\n".join(head + cur)
            continue
        units = lines if len(lines) > 1 else re.split(r"(?<=[.!?])\s+", block)
        for u in units:
            while len(u) > max_chars:
                yield u[:max_chars]
                u = u[max_chars:]
            if u.strip():
                yield u


def _pack(blocks, max_chars: int):
    buf = ""
    for b in blocks:
        if buf and len(buf) + len(b) + 2 > max_chars:
            yield buf
            buf = ""
        buf = f"{buf}\n\n{b}" if buf else b
    if buf:
        yield buf


def content_hash(title: str, body: str) -> str:
    return hashlib.sha256(f"{title}\x00{body}".encode()).hexdigest()
