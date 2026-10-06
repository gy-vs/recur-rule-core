import IterResult from './iterresult'
import { RRule } from './rrule'
import { DateWithZone } from './datewithzone'
import { iter } from './iter'
import { sort } from './dateutil'
import { QueryMethodTypes, IterResultType, IterateOptions } from './types'

export function iterSet<M extends QueryMethodTypes>(
  iterResult: IterResult<M>,
  _rrule: RRule[],
  _exrule: RRule[],
  _rdate: Date[],
  _exdate: Date[],
  tzid: string | undefined
) {
  const _exdateHash: { [k: number]: boolean } = {}
  const _accept = iterResult.accept

  function evalExdate(after: Date, before: Date) {
    _exrule.forEach(function (rrule) {
      rrule.between(after, before, true).forEach(function (date) {
        _exdateHash[Number(date)] = true
      })
    })
  }

  _exdate.forEach(function (date) {
    const zonedDate = new DateWithZone(date, tzid).rezonedDate()
    _exdateHash[Number(zonedDate)] = true
  })

  iterResult.accept = function (date) {
    const dt = Number(date)
    if (isNaN(dt)) return _accept.call(this, date)
    if (!_exdateHash[dt]) {
      evalExdate(new Date(dt - 1), new Date(dt + 1))
      if (!_exdateHash[dt]) {
        _exdateHash[dt] = true
        return _accept.call(this, date)
      }
    }
    return true
  }

  if (iterResult.method === 'between') {
    evalExdate(iterResult.args.after, iterResult.args.before)
    iterResult.accept = function (date) {
      const dt = Number(date)
      if (!_exdateHash[dt]) {
        _exdateHash[dt] = true
        return _accept.call(this, date)
      }
      return true
    }
  }

  for (let i = 0; i < _rdate.length; i++) {
    const zonedDate = new DateWithZone(_rdate[i], tzid).rezonedDate()
    if (!iterResult.accept(new Date(zonedDate.getTime()))) break
  }

  _rrule.forEach(function (rrule) {
    iter(iterResult, rrule.options)
  })

  const res = iterResult._result
  sort(res)
  switch (iterResult.method) {
    case 'all':
    case 'between':
      return res as IterResultType<M>
    case 'before':
      return ((res.length && res[res.length - 1]) || null) as IterResultType<M>
    case 'after':
    default:
      return ((res.length && res[0]) || null) as IterResultType<M>
  }
}

/**
 * Lazily yields the occurrences of a recurrence set in chronological order.
 *
 * RDATEs and the occurrences of the RRULEs are merged (k-way merge on
 * already-sorted streams), EXDATEs and EXRULE occurrences are removed and
 * equal timestamps are yielded only once. The result is therefore identical
 * to `iterSet('all')`, but each occurrence is computed on demand.
 */
export function* iterSetDates(
  _rrule: RRule[],
  _exrule: RRule[],
  _rdate: Date[],
  _exdate: Date[],
  tzid: string | undefined,
  options: IterateOptions = {}
): Generator<Date> {
  const _exdateHash: { [k: number]: boolean } = {}

  _exdate.forEach(function (date) {
    const zonedDate = new DateWithZone(date, tzid).rezonedDate()
    _exdateHash[Number(zonedDate)] = true
  })

  const minDate = options.after
    ? options.inc
      ? options.after
      : new Date(options.after.getTime() + 1)
    : null

  interface Source {
    head: Date | null
    next: () => Date | null
  }

  const sources: Source[] = []

  // All RDATEs are a single sorted stream (the set keeps them sorted).
  let rdateIdx = 0
  if (_rdate.length) {
    sources.push({
      head: new DateWithZone(_rdate[0], tzid).rezonedDate(),
      next: () => {
        rdateIdx++
        return rdateIdx < _rdate.length
          ? new DateWithZone(_rdate[rdateIdx], tzid).rezonedDate()
          : null
      },
    })
  }

  // One lazy RRULE stream per rule, already started at the requested point.
  _rrule.forEach((rrule) => {
    const iterator = rrule.iterate(options)
    sources.push({
      head: iterator.next().value || null,
      next: () => {
        const step = iterator.next()
        return step.done ? null : step.value
      },
    })
  })

  // One lazy EXRULE stream per rule; a head only needs to be advanced while
  // it is no later than the candidate being checked.
  const exIterators = _exrule.map((exrule) => exrule.iterate(options))
  const exHeads: (Date | null)[] = exIterators.map(
    (iterator) => iterator.next().value || null
  )

  const isExcluded = function (dt: number) {
    if (_exdateHash[dt]) return true
    for (let i = 0; i < exIterators.length; i++) {
      while (exHeads[i] !== null && Number(exHeads[i]) < dt) {
        const step = exIterators[i].next()
        exHeads[i] = step.done ? null : step.value
      }
      if (exHeads[i] !== null && Number(exHeads[i]) === dt) {
        _exdateHash[dt] = true
        return true
      }
    }
    return false
  }

  for (;;) {
    let earliest: Date | null = null
    let earliestIdx = -1
    for (let i = 0; i < sources.length; i++) {
      const head = sources[i].head
      if (
        head !== null &&
        (earliest === null || Number(head) < Number(earliest))
      ) {
        earliest = head
        earliestIdx = i
      }
    }
    if (earliest === null) return

    sources[earliestIdx].head = sources[earliestIdx].next()

    if (minDate && Number(earliest) < Number(minDate)) continue

    const dt = Number(earliest)
    if (isNaN(dt) || isExcluded(dt)) continue

    // Several sources may produce the same timestamp; emit it only once.
    if (_exdateHash[dt]) continue
    _exdateHash[dt] = true
    yield earliest
  }
}
