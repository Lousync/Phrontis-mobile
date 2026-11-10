import type { CSSProperties, ReactNode } from 'react'

type P = { size?: number; style?: CSSProperties; sw?: number }

function make(children: ReactNode, defaults?: { sw?: number; filled?: boolean }) {
  return function Icon({ size = 20, style, sw }: P) {
    const filled = defaults?.filled
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24" style={style}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={sw ?? defaults?.sw ?? 1.8} strokeLinecap="round" strokeLinejoin="round"
      >{children}</svg>
    )
  }
}

export const ICalendar = make(<><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></>)
export const IWallet = make(<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" /></>)
export const IBook = make(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>)
export const ISparkle = make(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /><path d="M19 15l.9 2.4L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.6L19 15z" /></>)
export const IBars = make(<path d="M18 20V10M12 20V4M6 20v-6" />)
export const IGear = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>)
export const IHistory = make(<><path d="M3 3v5h5" /><path d="M3.05 13a9 9 0 1 0 .5-5L3 8" /><path d="M12 7v5l4 2" /></>)
export const IMic = make(<><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><path d="M12 19v3" /></>)
export const ISend = make(<><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>, { sw: 2 })
export const ICheck = make(<path d="M20 6L9 17l-5-5" />, { sw: 3 })
export const ISearch = make(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, { sw: 2 })
export const IFolder = make(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />)
export const IChevR = make(<path d="M9 6l6 6-6 6" />, { sw: 2 })
export const IChevL = make(<path d="M15 18l-6-6 6-6" />, { sw: 2 })
export const IPen = make(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>)
export const IBack = make(<path d="M15 18l-6-6 6-6" />, { sw: 2 })
export const IPlus = make(<path d="M12 5v14M5 12h14" />, { sw: 2 })
export const IDots = make(<><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></>, { filled: true })
export const ITrash = make(<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></>)
export const IMonitor = make(<><rect x="2" y="3" width="20" height="13" rx="2" /><path d="M8 21h8M12 16v5" /></>)
export const IBackspace = make(<><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" /><path d="M18 9l-6 6M12 9l6 6" /></>)
export const IKeyboard = make(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 13h6M6 16.5h12" /></>)
export const IStop = make(<rect x="7" y="7" width="10" height="10" rx="2" />, { filled: true })
export const IX = make(<path d="M18 6L6 18M6 6l12 12" />, { sw: 2 })
export const IEye = make(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>)
export const IQuiz = make(<> <circle cx="12" cy="12" r="9" /> <path d="M9 12h6M12 9v6" /> </>)
export const IPin = make(<><path d="M12 17v5" /><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" /></>)
export const IBell = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>)
export const IClip = make(<><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>)

export const IRefresh = make(<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>)
export const IFilePdf = make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h2a1.5 1.5 0 0 1 0 3H8v-3zm0 3v2M13 13v5h1.4a1.6 1.6 0 0 0 1.6-1.6v-1.8A1.6 1.6 0 0 0 14.4 13H13z" /></>, { sw: 1.5 })
export const IDownload = make(<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></>)
export const IUpload = make(<><path d="M12 21V9" /><path d="M7 14l5-5 5 5" /><path d="M5 3h14" /></>)
export const IShare = make(<><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>)
export const IInbox = make(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" /></>)
