import IterResult from './iterresult'
import { RRule } from './rrule'
import { DateWithZone } from './datewithzone'
import { iter, iterGen } from './iter'
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
 * The included rrules and rdates are merged with a k-way merge; every source
 * keeps its next candidate buffered and only the source producing the earliest
 * candidate is advanced. Each merged candidate is checked against the exdates
 * and exrules before being yielded. Times already yielded (or ruled out by an
 * exdate) are remembered locally, so each timestamp appears at most once —
 * matching the prefix of `all()`. Only occurrences actually requested are
 * computed, and breaking out of the resulting iterator stops the merge.
 */
export function* iterSetGen(
  _rrule: RRule[],
  _exrule: RRule[],
  _rdate: Date[],
  _exdate: Date[],
  tzid: string | undefined,
  options: IterateOptions = {}
): Generator<Date> {
  const after = options.after
  const minDate = after
    ? new Date(after.getTime() + (options.inc ? 0 : 1))
    : null

  // Timestamps already yielded or known to be excluded. Local to this
  // generator, so concurrent iterations never interfere with each other.
  const seen: { [k: number]: boolean } = {}

  _exdate.forEach(function (date) {
    const zonedDate = new DateWithZone(date, tzid).rezonedDate()
    seen[Number(zonedDate)] = true
  })

  function isExcludedByExrule(dt: number) {
    for (let i = 0; i < _exrule.length; i++) {
      if (_exrule[i].between(new Date(dt - 1), new Date(dt + 1), true).length) {
        return true
      }
    }
    return false
  }

  // Buffered sources, one per rrule plus one for the (sorted) rdates. Each
  // holds its earliest candidate not yet consumed, or null when exhausted.
  const heads: (Date | null)[] = []
  const advances: (() => Date | null)[] = []

  for (let i = 0; i < _rdate.length; i++) {
    addSource(
      heads,
      advances,
      rdateSource(new DateWithZone(_rdate[i], tzid).rezonedDate())
    )
  }

  for (let i = 0; i < _rrule.length; i++) {
    addSource(heads, advances, rruleSource(_rrule[i], minDate))
  }

  for (;;) {
    let earliestIndex = -1
    let earliest: Date | null = null
    for (let i = 0; i < heads.length; i++) {
      const candidate = heads[i]
      if (candidate !== null && (earliest === null || candidate < earliest)) {
        earliest = candidate
        earliestIndex = i
      }
    }

    if (earliest === null) {
      return
    }

    // Consume the earliest candidate from its source only.
    heads[earliestIndex] = advances[earliestIndex]()

    if (minDate && earliest < minDate) {
      continue
    }

    const dt = Number(earliest)
    if (seen[dt]) {
      continue
    }

    if (isExcludedByExrule(dt)) {
      seen[dt] = true
      continue
    }

    seen[dt] = true
    yield earliest
  }
}

function addSource(
  heads: (Date | null)[],
  advances: (() => Date | null)[],
  source: () => Date | null
) {
  heads.push(source())
  advances.push(source)
}

function rdateSource(date: Date): () => Date | null {
  let pending = true
  return function () {
    if (pending) {
      pending = false
      return date
    }
    return null
  }
}

function rruleSource(rule: RRule, minDate: Date | null): () => Date | null {
  const generator = iterGen(rule.options)
  return function () {
    // Use next() explicitly instead of for...of: returning from a for...of
    // loop closes the generator, so a later call would not resume it.
    let step = generator.next()
    while (!step.done) {
      const date = step.value
      if (!minDate || date >= minDate) {
        return date
      }
      step = generator.next()
    }
    return null
  }
}
