import { useSearchParams } from 'react-router-dom'
import DocStandardGuide from '../../components/DocStandardGuide'
import { DOC_STANDARD_BODY } from '../../lib/docTemplates'
import { useKB } from './useKB'
import KBEditor from './KBEditor'

/** 새 문서도 같은 문서 모양에서 편집 상태로 시작한다. */
export default function KBNewPage() {
  const { byId, ancestorIds, go } = useKB()
  const [params] = useSearchParams()
  const requested = params.get('parent')
  const parent = requested && byId[requested] ? requested : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-5 sm:px-8 sm:py-6">
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-slate-400">
        <span>지식 베이스</span>
        {parent &&
          [...ancestorIds(parent), parent].map((a) => (
            <span key={a} className="flex items-center gap-1">
              <span>/</span>
              <span>{byId[a].title}</span>
            </span>
          ))}
        <span>/</span>
        <span className="text-slate-600">새 문서</span>
      </div>
      <p className="mb-2 text-sm text-slate-500">📄 {parent ? `'${byId[parent].title}'의 하위 문서` : '최상위 문서'}</p>
      <DocStandardGuide />
      <KBEditor
        key={parent ?? 'root'}
        docId={null}
        initialTitle=""
        initialBody={DOC_STANDARD_BODY}
        parentId={parent}
        onSaved={(id) => go(`/kb/doc/${id}`, { replace: true })}
        onCancel={() => go(parent ? `/kb/doc/${parent}` : '/kb')}
      />
    </div>
  )
}
