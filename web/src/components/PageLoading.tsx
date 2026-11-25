/** 따로 불러오는 화면이 오기 전에 잠깐 보이는 자리 (모든 lazy 화면이 같이 쓴다) */
export default function PageLoading() {
  return (
    <div role="status" className="p-8 text-slate-400">
      불러오는 중...
    </div>
  )
}
