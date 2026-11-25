import mimetypes
import os

from django.http import FileResponse

# 브라우저가 열면 스크립트를 실행할 수 있는 형식
ACTIVE_CONTENT_TYPES = {
    'text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml', 'application/xml', 'text/javascript',
    'application/javascript',
}


def serve_document_file(file, download: bool) -> FileResponse:
    """업로드 파일 응답. 기본은 inline, download=True 면 첨부 다운로드.
    올린 HTML·SVG 가 이 주소에서 스크립트를 실행하지 못하도록 inline 으로 열 때는 CSP sandbox 로 격리한다."""
    filename = os.path.basename(file.name)
    resp = FileResponse(file.open('rb'), as_attachment=download, filename=filename)
    resp['X-Content-Type-Options'] = 'nosniff'
    content_type = (mimetypes.guess_type(filename)[0] or '').lower()
    if not download and content_type in ACTIVE_CONTENT_TYPES:
        resp['Content-Security-Policy'] = 'sandbox'
    return resp
