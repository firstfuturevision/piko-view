/** 새 문서를 쓸 때 보이는 문서 작성 표준 안내 */
export default function DocStandardGuide() {
  return (
    <details className="mb-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-sm text-slate-600" open>
      <summary data-tip="문서에 꼭 넣을 네 부분입니다. 눌러서 접거나 펼칩니다" className="cursor-pointer font-semibold text-blue-800">문서 작성 표준</summary>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
        <li><b>제목</b> — 내용을 한 줄로 알 수 있게 (예: "분기 회의 일정 정리")</li>
        <li><b>문서의 필요성</b> — 왜 이 문서가 필요한지, 누가 읽는지</li>
        <li><b>본문</b> — 사실과 근거. 다른 문서는 <code>[[문서 제목]]</code>으로 연결</li>
        <li><b>결론</b> — 결정된 것과 다음 할 일</li>
      </ul>
      <p className="mt-1.5 text-xs text-slate-400">
        저장하기 전에 내용이 비슷한 문서가 있으면 알려 드립니다. 이미 있다면 새로 만들기보다 그 문서를 고쳐 주세요.
      </p>
    </details>
  )
}
