import { memo, useMemo, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { parseAnnouncementTimes, type AnnouncementTime } from '../announcementTimes';
import { BEIJING_ZONE, COMMON_ZONES, OTHER_ZONES, PACIFIC_ZONE, PST_ZONE, PDT_ZONE, localDateTime, offsetLabel, zoneLabel, zoneTimeLabel } from '../timeZones';

const preferenceKey = 'tibo-watch-announcement-zone-v1';
const allowedZones = new Set<string>([...COMMON_ZONES.map(zone => zone.id), ...OTHER_ZONES]);
function initialTarget() {
  try {
    const saved = localStorage.getItem(preferenceKey);
    return saved && allowedZones.has(saved) ? saved : BEIJING_ZONE;
  } catch { return BEIJING_ZONE; }
}

export const AnnouncementTimeCard = memo(function AnnouncementTimeCard({ text, createdAt }: { text: string; createdAt: string }) {
  const times = useMemo(() => parseAnnouncementTimes(text, createdAt), [text, createdAt]);
  const [target, setTarget] = useState(initialTarget);
  function changeTarget(zone: string) {
    if (!allowedZones.has(zone)) return;
    setTarget(zone);
    try { localStorage.setItem(preferenceKey, zone); } catch { /* Conversion still works when storage is unavailable. */ }
  }
  if (!times.length) return null;
  return <section className="announcement-time" aria-label="预告时间">
    <div className="announcement-time-heading"><h3><Clock3 size={18}/>预告时间</h3><label className="field">目标时区<select aria-label="预告目标时区" value={target} onChange={event => changeTarget(event.target.value)}><optgroup label="常用时区">{COMMON_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</optgroup><optgroup label="其他时区（城市 / 地区）">{OTHER_ZONES.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</optgroup></select></label></div>
    {times.map((time, index) => <TimeResult key={`${time.raw}-${time.sourceLocal}-${time.kind}-${time.instants.join(',')}-${index}`} time={time} target={target}/>)}
  </section>;
});

function TimeResult({ time, target }: { time: AnnouncementTime; target: string }) {
  const [occurrence, setOccurrence] = useState('');
  const repeated = time.kind === 'ambiguous';
  const instant = time.kind === 'exact' || (repeated && occurrence !== '') ? time.instants[Number(occurrence || 0)] ?? null : null;
  const sourceOffset = time.sourceZone === 'PST' ? -480 : time.sourceZone === 'PDT' ? -420 : null;
  const sourceDisplayZone = time.sourceZone === 'PST' ? PST_ZONE : time.sourceZone === 'PDT' ? PDT_ZONE : PACIFIC_ZONE;
  const sourceLabel = time.sourceZone === 'PST' ? '太平洋标准时间（PST）' : time.sourceZone === 'PDT' ? '太平洋夏令时间（PDT）' : '洛杉矶当地时间';
  const approximate = /(?:[~≈]|\b(?:around|about|approximately|roughly)\b)\s*(?:today\b|tomorrow\b|noon\b|midnight\b|\d{1,2}:\d{2}|\d+\s*(?:am|pm|hours?|hrs?|minutes?|mins?)\b)/i.test(time.raw);
  const pendingMessage = time.kind === 'date-only' ? '原文未提供具体时间，暂不能精确换算。'
    : time.kind === 'missing-date' ? '原文未提供明确日期，暂不能精确换算。'
    : time.kind === 'gap' ? '该美西时间因夏令时切换而不存在，暂不能换算。'
    : repeated ? '该美西时间出现两次，请选择具体时刻后查看换算结果。'
    : '原文日期、时间或时区无法确定，暂不能精确换算。';
  return <div className="announcement-time-entry">
    <p className="announcement-time-raw">原文时间：{time.raw}</p>
    {repeated ? <label className="field announcement-repeat">选择具体时刻<select aria-label="预告重复时间的具体时刻" value={occurrence} onChange={event => setOccurrence(event.target.value)}><option value="">请选择，不自动猜测</option>{time.instants.map((value, index) => <option key={value} value={index}>{index === 0 ? '第一次' : '第二次'} · {zoneTimeLabel(value, PACIFIC_ZONE)}</option>)}</select></label> : null}
    <div className="announcement-time-grid">
      <div className="announcement-pacific"><span>{time.kind === 'invalid' ? '原文时间（待确认）' : sourceLabel}</span>{instant !== null ? <><time dateTime={new Date(instant).toISOString()}>{approximate ? '约 ' : ''}{localDateTime(instant, sourceDisplayZone).replace('T', ' ')}</time><small>{zoneTimeLabel(instant, sourceDisplayZone)}</small></> : time.kind === 'invalid' ? <strong>无法确定</strong> : <><strong>{time.sourceLocal?.replace('T', ' ') ?? time.date ?? '时间待确认'}</strong><small>{time.sourceZone}{time.assumedPacific ? ' · 默认 PST' : ''}</small></>}</div>
      <output className={instant === null ? 'announcement-pending' : ''} aria-label="预告时间换算" aria-live="polite"><span>{zoneLabel(target)}</span>{instant !== null ? <><time dateTime={new Date(instant).toISOString()}>{approximate ? '约 ' : ''}{localDateTime(instant, target).replace('T', ' ')}</time><small>{zoneTimeLabel(instant, target)}</small></> : <p>{pendingMessage}</p>}</output>
    </div>
    {time.kind !== 'invalid' && time.assumedPacific ? <p className="announcement-time-note">原文未注明时区，默认按 PST（UTC−08:00）计算。</p> : sourceOffset !== null && time.kind !== 'invalid' ? <p className="announcement-time-note">按原文 {time.sourceZone}（{offsetLabel(sourceOffset)}）换算。</p> : null}
    {approximate && instant !== null ? <p className="announcement-time-note">原文时间为估计值，换算结果也为估计时间。</p> : null}
  </div>;
}
