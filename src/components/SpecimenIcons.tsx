type IconProps = { size?: number; className?: string };

export function CovertMark({ size = 28, className = "" }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="12.25" stroke="currentColor" strokeWidth="1.5" strokeDasharray="17 5"/>
    <circle cx="16" cy="16" r="6.25" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M5.5 16h5M21.5 16h5M16 5.5v5M16 21.5v5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>;
}

export function ScanIcon({ size = 18, className = "" }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2"/>
  </svg>;
}

export function ArrowIcon({ size = 18, className = "" }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 12h15M14 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter"/>
  </svg>;
}

export function DocumentIcon({ size = 28, className = "" }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M7.5 3.5h11l6 6v19h-17z" stroke="currentColor" strokeWidth="1.25"/>
    <path d="M18.5 3.5v6h6M11 15h10M11 20h10M11 25h6" stroke="currentColor" strokeWidth="1.25"/>
  </svg>;
}

export function RosetteIcon({ size = 34, className = "" }: IconProps) {
  return <svg className={className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="20" r="13" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2"/>
    <ellipse cx="20" cy="20" rx="15" ry="6.5" stroke="currentColor" strokeWidth="1" transform="rotate(45 20 20)"/>
    <ellipse cx="20" cy="20" rx="15" ry="6.5" stroke="currentColor" strokeWidth="1" transform="rotate(-45 20 20)"/>
    <circle cx="20" cy="20" r="4" stroke="currentColor" strokeWidth="1.25"/>
  </svg>;
}
