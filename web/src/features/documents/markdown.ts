/**
 * Markdown 본문의 공통 스타일. 지식 베이스 등이 함께 쓴다.
 * 한글 본문이 답답하지 않게 줄 간격(1.8)과 문단·제목·목록 사이 여백을 넉넉히 둔다.
 */
export const MARKDOWN_PROSE_CLASS = [
  'text-[15px] leading-[1.8] text-slate-700 break-keep [overflow-wrap:anywhere]',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:my-4',
  '[&_h1]:mt-10 [&_h1]:mb-4 [&_h1]:text-[26px] [&_h1]:leading-snug [&_h1]:font-bold [&_h1]:text-slate-900',
  '[&_h2]:mt-10 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-slate-200 [&_h2]:pb-2 [&_h2]:text-[21px] [&_h2]:leading-snug [&_h2]:font-bold [&_h2]:text-slate-900',
  '[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-[17px] [&_h3]:leading-snug [&_h3]:font-semibold [&_h3]:text-slate-900',
  '[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:font-semibold [&_h4]:text-slate-900',
  '[&_strong]:font-semibold [&_strong]:text-slate-900',
  '[&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:my-1.5 [&_li]:pl-1 [&_li::marker]:text-slate-400 [&_li>ul]:my-1.5 [&_li>ol]:my-1.5 [&_li>p]:my-1',
  '[&_blockquote]:my-5 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:bg-slate-50 [&_blockquote]:px-5 [&_blockquote]:py-3 [&_blockquote]:text-slate-600',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-slate-800',
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-800 [&_pre]:px-5 [&_pre]:py-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_pre]:text-slate-100',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-slate-100',
  '[&_table]:my-5 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
  '[&_hr]:my-10 [&_hr]:border-slate-200',
  '[&_img]:my-5 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-slate-200',
].join(' ')
