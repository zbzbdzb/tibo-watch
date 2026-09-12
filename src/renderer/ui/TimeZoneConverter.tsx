import { memo, useMemo, useState } from 'react';
import { ArrowLeftRight, Clock3, Globe2 } from 'lucide-react';
import { BEIJING_ZONE, COMMON_ZONES, OTHER_ZONES, PACIFIC_ZONE, dayDifference, differenceLabel, localDateTime, resolveLocalTime, utcOffsetMinutes, zoneLabel, zoneTimeLabel } from '../timeZones';

function ZoneOptions() {
  return <><optgroup label="常用时区">{COMMON_ZONES.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</optgroup><optgroup label="其他时区（城市 / 地区）">{OTHER_ZONES.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</optgroup></>;
}
export const TimeZoneConverter = memo(function TimeZoneConverter() {
  const [source, setSource] = useState(PACIFIC_ZONE);
  const [target, setTarget] = useState(BEIJING_ZONE);
  const [local, setLocal] = useState(() => localDateTime(Date.now(), PACIFIC_ZONE));
  const [occurrence, setOccurrence] = useState('');
  const resolution = useMemo(() => resolveLocalTime(local, source), [local, source]);
  const repeated = resolution.kind === 'valid' && resolution.instants.length > 1;
  const instant = resolution.kind === 'valid' && (!repeated || occurrence !== '') ? resolution.instants[Number(occurrence || 0)] ?? null : null;
  const converted = instant === null ? null : localDateTime(instant, target);
  const day = instant === null ? 0 : dayDifference(instant, source, target);
  const dayLabel = day === 0 ? '同日' : day === 1 ? '次日' : day === -1 ? '前一日' : `${day > 0 ? '后' : '前'} ${Math.abs(day)} 日`;
  function useNow() {
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const value = localDateTime(now, source);
    const matches: number[] = resolveLocalTime(value, source).instants;
    setLocal(value); setOccurrence(matches.length > 1 ? String(matches.indexOf(now)) : '');
  }
  function swap() {
    if (instant === null || !converted) return;
    const matches: number[] = resolveLocalTime(converted, target).instants;
    setLocal(converted); setOccurrence(matches.length > 1 ? String(matches.indexOf(instant)) : '');
    setSource(target); setTarget(source);
  }
  return <section className="panel settings-panel timezone-panel" aria-labelledby="timezone-heading">
    <div className="panel-heading"><Globe2/><div><h2 id="timezone-heading">时区换算</h2><p>按所选日期自动处理夏令时。</p></div></div>
    <div className="timezone-zones">
      <label className="field">来源时区<select aria-label="来源时区" value={source} onChange={event => { setSource(event.target.value); setOccurrence(''); }}><ZoneOptions/></select><small>{source}</small></label>
      <button className="icon-button timezone-swap" aria-label="交换来源与目标时区" disabled={instant === null} onClick={swap}><ArrowLeftRight size={20}/></button>
      <label className="field">目标时区<select aria-label="目标时区" value={target} onChange={event => setTarget(event.target.value)}><ZoneOptions/></select><small>{target}</small></label>
    </div>
    <div className="timezone-inputs">
      <label className="field">来源日期<input type="date" min="2000-01-01" max="2100-12-31" value={local.split('T')[0] ?? ''} onChange={event => { setLocal(`${event.target.value}T${local.split('T')[1] ?? ''}`); setOccurrence(''); }} aria-describedby="timezone-input-error" aria-invalid={resolution.kind !== 'valid'}/></label>
      <label className="field">来源时间<input type="time" step="60" value={local.split('T')[1] ?? ''} onChange={event => { setLocal(`${local.split('T')[0] ?? ''}T${event.target.value}`); setOccurrence(''); }} aria-describedby="timezone-input-error" aria-invalid={resolution.kind !== 'valid'}/></label>
      <button className="button timezone-now" onClick={useNow}><Clock3 size={17}/>使用当前时间</button>
    </div>
    {resolution.kind !== 'valid' ? <p className="field-error" id="timezone-input-error" role="alert">{resolution.kind === 'gap' ? '该时间因时区切换而不存在，请选择其他时间。' : '请输入 2000–2100 年间有效的日期和时间。'}</p> : null}
    {repeated ? <label className="field timezone-repeat">该时间出现两次，请选择<select aria-label="重复时间的具体时刻" value={occurrence} onChange={event => setOccurrence(event.target.value)}><option value="">请选择一次，不自动猜测</option>{resolution.instants.map((value, index) => <option key={value} value={index}>{index === 0 ? '第一次' : '第二次'} · {zoneTimeLabel(value, source)}</option>)}</select></label> : null}
    <output className={`timezone-result ${instant === null ? 'unresolved' : ''}`} aria-label="换算结果" aria-live="polite">
      {instant !== null && converted ? <><div className="timezone-result-heading"><span>{zoneLabel(target)}</span><span className="timezone-day">{dayLabel}</span></div><strong className="timezone-result-time">{converted.replace('T', ' ')}</strong><span className="timezone-result-zone">{zoneTimeLabel(instant, target)}</span><div className="timezone-result-detail"><span>{zoneLabel(source)} · {zoneTimeLabel(instant, source)}</span><span>{differenceLabel(utcOffsetMinutes(instant, target) - utcOffsetMinutes(instant, source))}</span></div></> : <span>{repeated ? '选择具体时刻后显示换算结果' : '有效时间的换算结果会显示在这里'}</span>}
    </output>
  </section>;
});
